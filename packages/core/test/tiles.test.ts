import { describe, expect, it } from 'vitest'
import { MoveTilesCommand, SetTilesCommand } from '../src/commands.js'
import { DenseLayerData } from '../src/layer-data.js'
import type { TileLayer } from '../src/model.js'
import {
  captureRegion, clampRegion, fillRegion, floodFill, paintStamp,
  regionContains, regionFromCorners,
} from '../src/tiles.js'

/** A tile layer over the given rows, one number per cell. */
function layerOf(rows: number[][], originX = 0, originY = 0): TileLayer {
  const height = rows.length
  const width = rows[0]!.length
  const data = DenseLayerData.fromArray(width, height, rows.flat(), originX, originY)
  return {
    kind: 'tilelayer',
    id: 1,
    name: 'test',
    opacity: 1,
    visible: true,
    offsetx: 0,
    offsety: 0,
    parallaxx: 1,
    parallaxy: 1,
    properties: [],
    data,
  } as unknown as TileLayer
}

const rowsOf = (layer: TileLayer, width: number, height: number) =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => layer.data.get(x, y)),
  )

describe('regions', () => {
  it('normalises a drag made in any direction', () => {
    const dragged = regionFromCorners(5, 4, 2, 1)
    expect(dragged).toEqual({ x: 2, y: 1, width: 4, height: 4 })
    // Both corners are inclusive, so a drag that never left one cell is 1x1.
    expect(regionFromCorners(3, 3, 3, 3)).toEqual({ x: 3, y: 3, width: 1, height: 1 })
  })

  it('knows what it covers', () => {
    const region = { x: 2, y: 1, width: 2, height: 2 }
    expect(regionContains(region, 2, 1)).toBe(true)
    expect(regionContains(region, 3, 2)).toBe(true)
    expect(regionContains(region, 4, 2)).toBe(false)
    expect(regionContains(region, 2, 0)).toBe(false)
  })

  it('trims to the layer, and vanishes when there is no overlap', () => {
    const layer = layerOf([[0, 0], [0, 0]])
    expect(clampRegion({ x: -2, y: -2, width: 5, height: 5 }, layer)).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    expect(clampRegion({ x: 9, y: 9, width: 2, height: 2 }, layer)).toBeUndefined()
  })
})

describe('copy and paste', () => {
  it('lifts a block and puts it back down somewhere else', () => {
    const layer = layerOf([
      [1, 2, 0, 0],
      [3, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const stamp = captureRegion(layer, { x: 0, y: 0, width: 2, height: 2 })
    expect(stamp).toEqual({ width: 2, height: 2, gids: [1, 2, 3, 4] })

    const command = new SetTilesCommand('Wklej', layer, 'p')
    paintStamp(command, stamp, 2, 2)
    command.apply()
    expect(rowsOf(layer, 4, 4)).toEqual([
      [1, 2, 0, 0],
      [3, 4, 0, 0],
      [0, 0, 1, 2],
      [0, 0, 3, 4],
    ])

    command.revert()
    expect(rowsOf(layer, 4, 4)[2]).toEqual([0, 0, 0, 0])
  })

  it('drops the part of a paste that hangs off the map', () => {
    const layer = layerOf([[0, 0], [0, 0]])
    const command = new SetTilesCommand('Wklej', layer, 'p')
    paintStamp(command, { width: 2, height: 2, gids: [7, 7, 7, 7] }, 1, 1)
    command.apply()
    expect(rowsOf(layer, 2, 2)).toEqual([[0, 0], [0, 7]])
  })

  it('reports a paste entirely off the map as no edit at all', () => {
    const layer = layerOf([[0, 0], [0, 0]])
    const command = new SetTilesCommand('Wklej', layer, 'p')
    paintStamp(command, { width: 1, height: 1, gids: [7] }, 9, 9)
    expect(command.empty).toBe(true)
  })
})

describe('a selection masks every tool', () => {
  it('keeps writes inside the region', () => {
    const layer = layerOf([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ])
    const command = new SetTilesCommand('Maluj', layer, 's', { x: 1, y: 1, width: 2, height: 2 })
    fillRegion(command, { x: 0, y: 0, width: 3, height: 3 }, 5)
    command.apply()
    expect(rowsOf(layer, 3, 3)).toEqual([
      [0, 0, 0],
      [0, 5, 5],
      [0, 5, 5],
    ])
  })

  it('bounds a flood fill that would otherwise swallow the layer', () => {
    const layer = layerOf([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ])
    const command = new SetTilesCommand('Wypełnij', layer, 's', { x: 0, y: 0, width: 3, height: 1 })
    floodFill(layer, 0, 0, 9, command)
    command.apply()
    expect(rowsOf(layer, 3, 3)).toEqual([
      [9, 9, 9],
      [0, 0, 0],
      [0, 0, 0],
    ])
  })

  it('erases a region by filling it with zero', () => {
    const layer = layerOf([[1, 1], [1, 1]])
    const command = new SetTilesCommand('Wyczyść', layer, 's')
    fillRegion(command, { x: 0, y: 0, width: 2, height: 1 }, 0)
    command.apply()
    expect(rowsOf(layer, 2, 2)).toEqual([[0, 0], [1, 1]])
  })
})

describe('flood fill', () => {
  it('spreads four ways and stops at a different tile', () => {
    const layer = layerOf([
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 0],
    ])
    const command = new SetTilesCommand('Wypełnij', layer, 's')
    floodFill(layer, 0, 0, 4, command)
    command.apply()
    expect(rowsOf(layer, 3, 3)).toEqual([
      [4, 4, 1],
      [4, 1, 1],
      [1, 1, 0],
    ])
  })

  it('works on a layer that does not start at the origin', () => {
    // Infinite maps put layers anywhere; indexing them from zero used to walk
    // off the visited-cells array and leave most of the region unfilled.
    const layer = layerOf([[0, 0], [0, 0]], 16, 16)
    const command = new SetTilesCommand('Wypełnij', layer, 's')
    floodFill(layer, 16, 16, 3, command)
    command.apply()
    expect([
      [layer.data.get(16, 16), layer.data.get(17, 16)],
      [layer.data.get(16, 17), layer.data.get(17, 17)],
    ]).toEqual([[3, 3], [3, 3]])
  })
})

describe('moving a block', () => {
  const block = () => layerOf([
    [1, 2, 0, 0],
    [3, 4, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ])

  it('leaves an empty hole behind and puts the tiles down elsewhere', () => {
    const layer = block()
    const command = new MoveTilesCommand(layer, { x: 0, y: 0, width: 2, height: 2 }, captureRegion(layer, { x: 0, y: 0, width: 2, height: 2 }))
    command.setDelta(2, 2)
    expect(rowsOf(layer, 4, 4)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 1, 2],
      [0, 0, 3, 4],
    ])
    command.revert()
    expect(rowsOf(layer, 4, 4)).toEqual([
      [1, 2, 0, 0],
      [3, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
  })

  it('copies instead when asked, leaving the original in place', () => {
    const layer = block()
    const command = new MoveTilesCommand(layer, { x: 0, y: 0, width: 2, height: 2 }, captureRegion(layer, { x: 0, y: 0, width: 2, height: 2 }), true)
    command.setDelta(2, 0)
    expect(rowsOf(layer, 4, 4)[0]).toEqual([1, 2, 1, 2])
    expect(rowsOf(layer, 4, 4)[1]).toEqual([3, 4, 3, 4])
  })

  it('survives being re-aimed, which is what a drag does forty times', () => {
    const layer = block()
    const region = { x: 0, y: 0, width: 2, height: 2 }
    const command = new MoveTilesCommand(layer, region, captureRegion(layer, region))
    for (const [dx, dy] of [[1, 0], [2, 1], [1, 2], [2, 2]] as const) command.setDelta(dx, dy)
    expect(rowsOf(layer, 4, 4)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 1, 2],
      [0, 0, 3, 4],
    ])
    command.revert()
    expect(rowsOf(layer, 4, 4)[0]).toEqual([1, 2, 0, 0])
  })

  it('overlaps itself without eating the tiles it is standing on', () => {
    const layer = block()
    const region = { x: 0, y: 0, width: 2, height: 2 }
    const command = new MoveTilesCommand(layer, region, captureRegion(layer, region))
    command.setDelta(1, 0)
    // The source column the destination covers must not come back as a hole.
    expect(rowsOf(layer, 4, 4)[0]).toEqual([0, 1, 2, 0])
    expect(rowsOf(layer, 4, 4)[1]).toEqual([0, 3, 4, 0])
    command.revert()
    expect(rowsOf(layer, 4, 4)[0]).toEqual([1, 2, 0, 0])
  })

  it('drops the part that would leave the map, and keeps the rest reversible', () => {
    const layer = block()
    const region = { x: 0, y: 0, width: 2, height: 2 }
    const command = new MoveTilesCommand(layer, region, captureRegion(layer, region))
    command.setDelta(3, 0)
    expect(rowsOf(layer, 4, 4)[0]).toEqual([0, 0, 0, 1])
    command.revert()
    expect(rowsOf(layer, 4, 4)[0]).toEqual([1, 2, 0, 0])
  })

  it('knows whether it went anywhere, so a tap costs no undo step', () => {
    const layer = block()
    const region = { x: 0, y: 0, width: 2, height: 2 }
    const command = new MoveTilesCommand(layer, region, captureRegion(layer, region))
    expect(command.moved).toBe(false)
    command.setDelta(0, 0)
    expect(command.moved).toBe(false)
    command.setDelta(1, 1)
    expect(command.moved).toBe(true)
    expect(command.target).toEqual({ x: 1, y: 1, width: 2, height: 2 })
  })
})
