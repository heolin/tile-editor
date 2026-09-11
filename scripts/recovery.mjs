#!/usr/bin/env node
/**
 * The crash test. Everything else in the editor can be checked without leaving
 * the page; "your unsaved work survives the process dying" cannot, so it gets
 * its own browser context, its own killed page, and its own script.
 *
 *   node scripts/recovery.mjs [projekt]      domyślnie: examples/sokoban
 */
import { chromium } from 'playwright'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startServer } from '@tile-editor/server'

const sourceProject = resolve(process.argv[2] ?? 'examples/sokoban')
const workdir = mkdtempSync(join(tmpdir(), 'tile-editor-recovery-'))
const project = join(workdir, 'project')
cpSync(sourceProject, project, { recursive: true })

const server = await startServer({ root: project, port: 4404, uiDir: resolve('packages/ui/dist') })
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}

/** Reads the store without going through the DOM. */
const peek = (page) => page.evaluate(() => {
  const s = window.__tileEditor.state()
  return {
    dirty: s.dirty,
    path: s.doc?.path,
    drafts: s.drafts.length,
    cells: s.activeTileLayer()?.data.toArray().join(''),
  }
})

try {
  // One context for the whole run: IndexedDB has to outlive the page, which is
  // the entire point of the feature.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const errors = []
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    return page
  }

  let page = watch(await context.newPage())
  await page.goto(server.url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const box = await page.locator('main > div').first().boundingBox()
  await page.getByRole('button', { name: 'Tilesety' }).first().click()
  await page.waitForTimeout(500)
  await page.locator('aside button[title]').nth(3).click()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  // Past the draft debounce.
  await page.waitForTimeout(2500)
  const edited = await peek(page)
  check('edycja czeka niezapisana', edited.dirty === true, edited.path)
  const onDisk = readFileSync(join(project, edited.path), 'utf8')

  // Pull the rug, the way Android does: no unload handler gets a say.
  await page.close()
  page = watch(await context.newPage())
  await page.goto(server.url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const dialog = page.getByRole('dialog', { name: /Niezapisane zmiany/ })
  check('edytor proponuje odzyskanie', (await dialog.count()) === 1)
  const offered = await dialog.innerText().catch(() => '')
  check('szkic podpisany mapą i czasem', /01_coop/.test(offered) && /chwil|sprzed/.test(offered), offered.split('\n').slice(2, 4).join(' · '))

  await page.getByRole('button', { name: /Przywróć/ }).click()
  await page.waitForTimeout(1500)
  const restored = await peek(page)
  check('przywrócone kafle są te same', restored.cells === edited.cells)
  check('i dalej są niezapisane', restored.dirty === true)
  check(
    'plik na dysku nietknięty do czasu zapisu',
    readFileSync(join(project, edited.path), 'utf8') === onDisk,
  )

  await page.getByRole('button', { name: /^Zapisz$/ }).click()
  await page.waitForTimeout(1200)
  check('zapis dopiero teraz zmienia plik', readFileSync(join(project, edited.path), 'utf8') !== onDisk)
  const left = await page.evaluate(async () => {
    const db = await new Promise((done) => {
      const request = indexedDB.open('tile-editor', 1)
      request.onsuccess = () => done(request.result)
    })
    return await new Promise((done) => {
      const request = db.transaction('drafts').objectStore('drafts').getAll()
      request.onsuccess = () => done(request.result.length)
    })
  })
  check('zapisany szkic zostaje sprzątnięty', left === 0, `${left} w schowku`)

  // Switching maps used to drop unsaved edits silently; now they go to a draft.
  await page.mouse.click(box.x + box.width / 2 + 64, box.y + box.height / 2)
  await page.waitForTimeout(600)
  const other = await page.evaluate(() => {
    const s = window.__tileEditor.state()
    const next = s.project.maps.find((m) => m !== s.doc.path)
    void s.openMap(next)
    return next
  })
  await page.waitForTimeout(1500)
  const switched = await peek(page)
  check('przełączenie mapy odkłada szkic', switched.path === other && switched.drafts === 1, other)

  check('konsola bez błędów', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
  rmSync(workdir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\n  Wszystko przeszło.\n' : `\n  ${failures} sprawdzeń nie przeszło.\n`)
process.exit(failures === 0 ? 0 : 1)
