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

const server = await startServer({ root: project, port: 0, uiDir: resolve('packages/ui/dist') })
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

  // The project panel draws every map small. They arrive as the list is
  // scrolled, one at a time, so this walks it to the bottom first.
  await page.getByRole('button', { name: 'Projekt' }).first().click()
  const count = () => page.evaluate(() => {
    const images = [...document.querySelectorAll('aside img')]
    return {
      drawn: images.length,
      maps: document.querySelectorAll('aside li button').length,
      real: images.every((img) => img.getAttribute('src')?.startsWith('data:image/')),
    }
  })
  // Thumbnails arrive as cells scroll in and are drawn one at a time, so this
  // walks the list and gives the queue time, repeating while any are missing.
  let thumbs = await count()
  for (let pass = 0; pass < 4 && thumbs.drawn < thumbs.maps; pass++) {
    await page.evaluate(async () => {
      const list = document.querySelector('aside .overflow-y-auto')
      list.scrollTop = 0
      for (let i = 0; i < 200; i++) {
        list.scrollTop += 240
        await new Promise((done) => setTimeout(done, 50))
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 4) break
      }
      // And back up: thumbnails are drawn for what is near the viewport, so a
      // one-way sweep would never ask for the rows it started on.
      while (list.scrollTop > 0) {
        list.scrollTop -= 240
        await new Promise((done) => setTimeout(done, 50))
      }
    })
    await page.waitForTimeout(2500)
    thumbs = await count()
  }
  // Naming the ones that never arrived is the difference between "29/31" and
  // knowing where to look.
  const absent = thumbs.drawn < thumbs.maps
    ? await page.evaluate(() =>
        [...document.querySelectorAll('aside li button')]
          .filter((button) => !button.querySelector('img'))
          .map((button) => button.textContent.trim()),
      )
    : []
  check(
    'każda mapa ma miniaturę',
    thumbs.drawn === thumbs.maps && thumbs.maps > 0,
    `${thumbs.drawn}/${thumbs.maps}${absent.length > 0 ? ` — brak: ${absent.join(', ')}` : ''}`,
  )
  check('miniatury to narysowane obrazki', thumbs.real)
  const cached = await page.evaluate(async () => {
    const db = await new Promise((done) => {
      // No version number: the editor owns the schema, and naming a stale one
      // here makes the open fail with a VersionError that never resolves.
      const request = indexedDB.open('tile-editor')
      request.onsuccess = () => done(request.result)
    })
    return await new Promise((done) => {
      const request = db.transaction('thumbs').objectStore('thumbs').getAll()
      request.onsuccess = () => done(request.result.length)
    })
  })
  check('miniatury zostają w pamięci przeglądarki', cached === thumbs.maps, `${cached} w cache`)

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

  // Renaming a property across the project. Left until last on purpose: it
  // rewrites files the editor never opened, so it would invalidate every diff
  // assertion above it.
  await page.evaluate(() => window.__tileEditor.state().setDialog('rename-property'))
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"] li button').length > 0, null, { timeout: 30000 })
  const first = page.locator('[role="dialog"] li button').first()
  const label = (await first.innerText()).split('\n')[0].trim()
  await first.click()
  await page.waitForTimeout(300)
  await page.getByRole('textbox', { name: 'Nowa nazwa property' }).fill(`${label}__zmiana`)
  await page.getByRole('button', { name: 'Podejrzyj' }).click()
  await page.waitForFunction(() => /Zmieni /.test(document.querySelector('[role="dialog"]')?.textContent ?? ''), null, { timeout: 30000 })
  const promised = Number(/Zmieni (\d+) w (\d+)/.exec(await page.locator('[role="dialog"]').innerText())?.[2] ?? 0)
  check('podgląd zmiany liczy pliki', promised > 0, `${label} w ${promised} plikach`)

  const held = execSync(`grep -rl '"${label}"' "${project}" | wc -l`, { encoding: 'utf8' }).trim()
  await page.getByRole('button', { name: /^Zastosuj/ }).click()
  await page.waitForTimeout(1000)
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const left = execSync(`grep -rl '"${label}"' "${project}" | wc -l`, { encoding: 'utf8' }).trim()
  const renamed = execSync(`grep -rl '"${label}__zmiana"' "${project}" | wc -l`, { encoding: 'utf8' }).trim()
  check('zmiana objęła obiecane pliki', Number(renamed) === promised, `${held} → ${left}, nowa nazwa w ${renamed}`)
  check('konsola bez błędów po zmianie', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
  rmSync(workdir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\n  Wszystko przeszło.\n' : `\n  ${failures} sprawdzeń nie przeszło.\n`)
process.exit(failures === 0 ? 0 : 1)
