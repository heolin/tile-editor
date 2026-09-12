#!/usr/bin/env node
/**
 * Renderer benchmark. Generates maps of increasing size against the sokoban
 * tileset and measures how long a scripted pan and zoom takes.
 *
 * The browser here runs on SwiftShader, a software rasteriser, so every number
 * is a floor rather than a forecast: real hardware (the Adreno 650 in a Galaxy
 * Tab S7) is far quicker. What matters is the shape of the curve.
 */
import { chromium } from 'playwright'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startServer } from '@tile-editor/server'
import { createTileMap, serializeMapJson, DEFAULT_HINTS, walkLayers } from '@tile-editor/core'

/** name -> [size, fill]. The empty 200 isolates cost that is not fragment shading. */
const CASES = [
  ['50', 50, true],
  ['100', 100, true],
  ['200', 200, true],
  ['200-pusta', 200, false],
]
const work = mkdtempSync(join(tmpdir(), 'bench-'))
const project = join(work, 'p')
cpSync(resolve('examples/sokoban'), project, { recursive: true })

for (const [name, size, fill] of CASES) {
  const map = createTileMap({
    path: `levels/bench-${name}.tmj`,
    width: size,
    height: size,
    tilewidth: 128,
    tileheight: 128,
    tilesets: [{ path: 'sokoban.tsj', tilecount: 31 }],
    layers: [
      { name: 'floor', kind: 'tilelayer' },
      { name: 'walls', kind: 'tilelayer' },
      { name: 'things', kind: 'tilelayer' },
    ],
  })
  // Fill with a spread of tiles so the renderer cannot skip empty cells.
  let n = 0
  if (fill) {
    for (const layer of walkLayers(map.layers)) {
      if (layer.kind !== 'tilelayer') continue
      n++
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (n === 1 || (x + y) % n === 0) layer.data.set(x, y, 1 + ((x * 7 + y * 13 + n) % 31))
        }
      }
    }
  }
  writeFileSync(join(project, `levels/bench-${name}.tmj`), serializeMapJson(map, DEFAULT_HINTS))
}

const server = await startServer({ root: project, port: 0, uiDir: resolve('packages/ui/dist') })
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(server.url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

console.log('\n  mapa         kafli     wczytanie   rysowanie (śr.)   najgorsze   rysowań')
console.log('  ---------------------------------------------------------------------')

for (const [name, size, fill] of CASES) {
  await page.getByRole('button', { name: 'Projekt' }).first().click()
  await page.waitForTimeout(300)
  const openedAt = Date.now()
  await page.getByRole('button', { name: `bench-${name}`, exact: true }).click()
  await page.waitForFunction((n) => document.querySelector('header')?.textContent?.includes(`bench-${n}`), name, { timeout: 60000 })
  await page.waitForTimeout(1200)
  const loadMs = Date.now() - openedAt

  // Drive the camera and read the renderer's own timing, so the number is the
  // cost of drawing rather than of waiting for the next animation frame.
  const stats = await page.evaluate(async () => {
    const renderer = window.__tileEditor
    const canvas = document.querySelector('main > div')
    const rect = canvas.getBoundingClientRect()
    const times = []
    const startCount = renderer.drawCount
    for (let i = 0; i < 40; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          deltaY: i % 2 === 0 ? -60 : 60,
        }),
      )
      await new Promise((r) => requestAnimationFrame(() => r()))
      times.push(renderer.lastDrawMs)
    }
    times.sort((a, b) => a - b)
    return {
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      worst: times[times.length - 1],
      draws: renderer.drawCount - startCount,
    }
  })

  const cells = fill ? size * size * 3 : 0
  console.log(
    `  ${name.padEnd(10)} ${String(cells).padStart(8)}` +
      `   ${(loadMs / 1000).toFixed(2).padStart(7)} s   ${stats.avg.toFixed(2).padStart(12)} ms` +
      `   ${stats.worst.toFixed(2).padStart(8)} ms   ${String(stats.draws).padStart(6)}`,
  )
}

console.log(errors.length ? `\n  BŁĘDY: ${errors.slice(0, 3).join(' | ')}` : '\n  konsola czysta')
console.log('  (SwiftShader — rasteryzacja programowa, czyli dolna granica)\n')

await browser.close()
await server.close()
rmSync(work, { recursive: true, force: true })
