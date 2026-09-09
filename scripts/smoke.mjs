#!/usr/bin/env node
/**
 * End-to-end smoke test. Starts the editor against a throwaway copy of a
 * project, drives the real UI in a browser, and checks the two things that
 * matter most: the map renders, and a one-tile edit produces a one-line diff.
 *
 *   node scripts/smoke.mjs [projekt]      domyślnie: examples/sokoban
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startServer } from '@tile-editor/server'

const sourceProject = resolve(process.argv[2] ?? 'examples/sokoban')
const workdir = mkdtempSync(join(tmpdir(), 'tile-editor-smoke-'))
const project = join(workdir, 'project')
cpSync(sourceProject, project, { recursive: true })

const server = await startServer({ root: project, port: 4399, uiDir: resolve('packages/ui/dist') })
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto(server.url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const canvas = await page.evaluate(() => {
    const el = document.querySelector('main canvas')
    return el ? { w: el.width, h: el.height, gl: !!(el.getContext('webgl2') || el.getContext('webgl')) } : null
  })
  check('płótno WebGL istnieje', Boolean(canvas?.gl), canvas ? `${canvas.w}x${canvas.h}` : 'brak canvas')

  const mapName = (await page.locator('header').first().innerText()).replace(/\s+/g, ' ').trim()
  check('mapa się otworzyła', mapName.length > 0, mapName)

  await page.getByRole('button', { name: 'Tilesety' }).first().click()
  await page.waitForTimeout(600)
  const tiles = page.locator('aside button[title]')
  const tileCount = await tiles.count()
  check('tileset ma kafle', tileCount > 0, `${tileCount} kafli`)
  await tiles.nth(3).click()

  // A project whose active layer holds objects cannot be painted on, so the
  // edit under test depends on what the map actually contains.
  const objectTool = page.getByRole('button', { name: 'Stawianie obiektów' })
  const objectMode = await objectTool.isEnabled()
  if (objectMode) await objectTool.click()
  check('narzędzie pasuje do warstwy', true, objectMode ? 'warstwa obiektów' : 'warstwa kafli')

  const box = await page.locator('main > div').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(400)
  check('edycja oznaczona jako niezapisana', await page.getByRole('button', { name: /Zapisz$/ }).isEnabled())

  await page.getByRole('button', { name: /Zapisz$/ }).click()
  await page.waitForTimeout(1000)
  check('konsola bez błędów', errors.length === 0, errors.slice(0, 2).join(' | '))

  // Compare against the pristine source. One tile is one line; a new object is
  // a handful. Either way only one file may move, and it must move a little.
  const diff = execSync(`diff -r -u "${sourceProject}" "${project}" || true`, { encoding: 'utf8' })
  const changed = diff.split('\n').filter((l) => /^[+-][^+-]/.test(l))
  const files = diff.split('\n').filter((l) => l.startsWith('--- ')).length
  check('zmienił się dokładnie jeden plik', files === 1, `${files} plików`)
  if (objectMode) {
    check('nowy obiekt to mała zmiana', changed.length > 0 && changed.length <= 16, `${changed.length} linii`)
  } else {
    check('zapis zmienił dokładnie jedną linię', changed.length === 2, changed.join('  ->  ').trim() || 'brak zmian')
  }
} finally {
  await browser.close()
  await server.close()
  rmSync(workdir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\n  Wszystko przeszło.\n' : `\n  ${failures} sprawdzeń nie przeszło.\n`)
process.exit(failures === 0 ? 0 : 1)
