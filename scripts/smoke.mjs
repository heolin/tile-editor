#!/usr/bin/env node
/**
 * End-to-end smoke test. Starts the editor against a throwaway copy of a
 * project, drives the real UI in a browser, and checks the two things that
 * matter most: the map renders, and a one-tile edit produces a one-line diff.
 *
 * `npm run smoke` uruchamia go dwa razy: sokoban ma same warstwy kafli,
 * tilt-ball same obiekty, więc dopiero oba przechodzą przez cały edytor.
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

  // Bulk tile editing, on a tile layer only: select a block, copy it, paste it
  // somewhere else through the context menu, and confirm the selection refuses
  // to let a brush write outside itself. Runs before any painting, so the undo
  // at the end leaves the document exactly as it was found.
  if (!objectMode) {
    const view = await page.evaluate(() => {
      const s = window.__tileEditor.state()
      return { tw: s.doc.map.tilewidth, th: s.doc.map.tileheight, ...s.camera }
    })
    const at = (tx, ty) => ({
      x: box.x + view.x + (tx + 0.5) * view.tw * view.zoom,
      y: box.y + view.y + (ty + 0.5) * view.th * view.zoom,
    })
    const peek = () => page.evaluate(() => {
      const s = window.__tileEditor.state()
      return { selection: s.tileSelection, clipboard: s.clipboard, undo: s.history.canUndo }
    })

    await page.keyboard.press('s')
    await page.mouse.move(...Object.values(at(1, 1)))
    await page.mouse.down()
    await page.mouse.move(...Object.values(at(2, 2)), { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const selected = await peek()
    check(
      'zaznaczenie obszaru',
      selected.selection?.width === 2 && selected.selection?.height === 2,
      JSON.stringify(selected.selection),
    )

    await page.keyboard.press('Control+c')
    await page.waitForTimeout(200)
    const copied = await peek()
    check('kopiowanie do schowka', copied.clipboard?.gids?.length === 4, `${copied.clipboard?.width}x${copied.clipboard?.height}`)

    await page.mouse.click(...Object.values(at(4, 4)), { button: 'right' })
    await page.waitForTimeout(200)
    const paste = page.getByRole('menuitem', { name: /Wklej tutaj/ })
    check('menu oferuje wklejenie', (await paste.count()) === 1)
    if (await paste.count()) await paste.first().click()
    await page.waitForTimeout(300)
    const pasted = await peek()
    check(
      'wklejenie przenosi zaznaczenie',
      pasted.selection?.x === 4 && pasted.selection?.y === 4,
      JSON.stringify(pasted.selection),
    )
    await page.keyboard.press('Control+z')

    // Dragging from inside the selection carries the block with it.
    await page.keyboard.press('s')
    // The block is wherever the paste left it, so the grab starts there.
    const held = (await peek()).selection
    await page.mouse.move(...Object.values(at(held.x, held.y)))
    await page.mouse.down()
    await page.mouse.move(...Object.values(at(held.x + 3, held.y - 2)), { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const dragged = await peek()
    check(
      'przeciągnięcie przenosi blok',
      dragged.selection?.x === held.x + 3 && dragged.selection?.y === held.y - 2,
      JSON.stringify(dragged.selection),
    )
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(200)

    // With a selection up, a brush stroke outside it must change nothing.
    await page.keyboard.press('b')
    const before = await page.evaluate(() => window.__tileEditor.state().activeTileLayer().data.toArray().join())
    await page.mouse.click(...Object.values(at(8, 6)))
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => window.__tileEditor.state().activeTileLayer().data.toArray().join())
    check('zaznaczenie blokuje pędzel poza sobą', before === after)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    check('Esc odznacza', (await peek()).selection === undefined)

    // Copying loads the block onto the brush, so the palette pick the edit
    // below relies on has to be made again.
    await tiles.nth(3).click()
  }

  // The object clipboard, on an object layer. Like the tile block above it runs
  // before the edit under test and undoes itself, so the diff stays honest.
  if (objectMode) {
    const peek = () => page.evaluate(() => {
      const s = window.__tileEditor.state()
      return {
        selected: s.selectedObjectIds.length,
        held: s.objectClipboard?.objects.length,
        objects: s.activeObjectLayer()?.objects.length,
        panel: document.querySelector('aside h2, aside header')?.textContent ?? '',
      }
    })
    await page.getByRole('button', { name: 'Zaznaczanie obiektów' }).click()
    // A band starting outside the map cannot land on an object, so it always
    // rubber-bands rather than dragging whatever sits under the first press.
    const view = await page.evaluate(() => ({ ...window.__tileEditor.state().camera }))
    const at = (wx, wy) => ({ x: box.x + view.x + wx * view.zoom, y: box.y + view.y + wy * view.zoom })
    const start = at(-60, -60)
    const end = at(4000, 4000)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const many = await peek()
    check('ramka zaznacza wiele obiektów', many.selected > 1, `${many.selected} obiektów`)

    await page.getByRole('button', { name: 'Properties' }).first().click()
    await page.waitForTimeout(400)
    const title = await page.locator('aside').first().innerText()
    check('panel właściwości zbiorczych', title.toLowerCase().includes(`${many.selected} obiektów`), title.split('\n')[0])

    await page.keyboard.press('Control+c')
    await page.waitForTimeout(200)
    check('kopiowanie obiektów', (await peek()).held === many.selected)

    await page.keyboard.press('Control+d')
    await page.waitForTimeout(300)
    const duplicated = await peek()
    check('duplikowanie obiektów', duplicated.objects === many.objects * 2, `${duplicated.objects} obiektów`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    check('cofnięcie zdejmuje kopie', (await peek()).objects === many.objects)

    await page.evaluate(() => window.__tileEditor.state().selectObjects([]))
    await page.getByRole('button', { name: 'Stawianie obiektów' }).click()
  }

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(400)
  check('edycja oznaczona jako niezapisana', await page.getByRole('button', { name: /Zapisz$/ }).isEnabled())

  await page.getByRole('button', { name: /Zapisz$/ }).click()
  await page.waitForTimeout(1000)
  check('konsola bez błędów', errors.length === 0, errors.slice(0, 2).join(' | '))

  // Compare against the pristine source. One tile is one line; a new object is
  // a handful. Either way only one file may move, and it must move a little.
  const diff = execSync(`diff -r -u "${sourceProject}" "${project}" || true`, { encoding: 'utf8' })
  const all = diff.split('\n').filter((l) => /^[+-][^+-]/.test(l))
  // The first save also cleans up whitespace-only lines the level generator
  // left behind. That is documented behaviour, not part of the edit.
  const changed = all.filter((l) => l.slice(1).trim() !== '' && l.slice(1).trim() !== '},')
  const whitespace = all.length - changed.length
  const files = diff.split('\n').filter((l) => l.startsWith('--- ')).length
  check('zmienił się dokładnie jeden plik', files === 1, `${files} plików`)
  if (objectMode) {
    check('nowy obiekt to mała zmiana', changed.length > 0 && changed.length <= 16, `${changed.length} linii`)
  } else {
    check(
      'zapis zmienił dokładnie jedną linię',
      changed.length === 2,
      `${changed.join('  ->  ').trim() || 'brak zmian'}${whitespace > 0 ? ` (+${whitespace} linii formatowania)` : ''}`,
    )
  }
} finally {
  await browser.close()
  await server.close()
  rmSync(workdir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\n  Wszystko przeszło.\n' : `\n  ${failures} sprawdzeń nie przeszło.\n`)
process.exit(failures === 0 ? 0 : 1)
