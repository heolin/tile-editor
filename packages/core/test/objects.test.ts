import { describe, expect, it } from 'vitest'
import { AddObjectCommand, RemoveObjectsCommand, SetPropertiesCommand } from '../src/commands.js'
import { cloneObject, createTileMap, objectsOrigin } from '../src/factory.js'
import type { MapObject, ObjectLayer, TileMap } from '../src/model.js'

function objectAt(id: number, x: number, y: number): MapObject {
  return {
    id,
    name: '',
    className: '',
    x,
    y,
    width: 32,
    height: 32,
    rotation: 0,
    visible: true,
    shape: 'tile',
    gid: 5,
    properties: [{ name: 'kind', type: 'string', value: 'wall' }],
  }
}

function mapWithObjects(objects: MapObject[]): { map: TileMap; layer: ObjectLayer } {
  const map = createTileMap({
    width: 10, height: 10, tilewidth: 32, tileheight: 32,
    path: 'a.tmj', layers: [{ name: 'obiekty', kind: 'objectgroup' }],
  })
  const layer = map.layers[0] as ObjectLayer
  layer.objects = objects
  map.nextobjectid = Math.max(...objects.map((o) => o.id), 0) + 1
  return { map, layer }
}

describe('copying an object', () => {
  it('takes the parts of the source file the model only carries along', () => {
    const source = objectAt(1, 0, 0)
    source.extra = { probability: 0.5 }
    source.keyOrder = ['id', 'gid', 'x', 'y']
    source.polygon = [{ x: 0, y: 0 }, { x: 4, y: 4 }]

    const copy = cloneObject(source, 9)
    expect(copy.id).toBe(9)
    expect(copy.extra).toEqual({ probability: 0.5 })
    expect(copy.keyOrder).toEqual(['id', 'gid', 'x', 'y'])

    // Deep enough that editing the copy leaves the original alone.
    copy.properties[0]!.value = 'floor'
    copy.polygon![0]!.x = 99
    copy.extra!.probability = 1
    expect(source.properties[0]!.value).toBe('wall')
    expect(source.polygon![0]!.x).toBe(0)
    expect(source.extra!.probability).toBe(0.5)
  })

  it('leaves absent keys absent, rather than setting them to undefined', () => {
    const copy = cloneObject(objectAt(1, 0, 0), 2)
    expect('polygon' in copy).toBe(false)
    expect('text' in copy).toBe(false)
  })

  it('finds the corner a group of objects hangs from', () => {
    expect(objectsOrigin([objectAt(1, 96, 32), objectAt(2, 32, 128)])).toEqual({ x: 32, y: 32 })
  })
})

describe('adding objects', () => {
  it('puts several in as one step and takes them all back out', () => {
    const { map, layer } = mapWithObjects([objectAt(1, 0, 0)])
    const command = new AddObjectCommand(layer, [objectAt(2, 32, 0), objectAt(3, 64, 0)], map)
    command.apply()
    expect(layer.objects.map((o) => o.id)).toEqual([1, 2, 3])
    command.revert()
    expect(layer.objects.map((o) => o.id)).toEqual([1])
  })

  it('puts the id counter back, so an undone paste leaves no trace in the file', () => {
    const { map, layer } = mapWithObjects([objectAt(1, 0, 0)])
    expect(map.nextobjectid).toBe(2)
    const command = new AddObjectCommand(layer, [objectAt(2, 32, 0), objectAt(3, 64, 0)], map)
    command.apply()
    expect(map.nextobjectid).toBe(4)
    command.revert()
    expect(map.nextobjectid).toBe(2)
  })

  it('still takes a single object, the way placing one does', () => {
    const { map, layer } = mapWithObjects([])
    const command = new AddObjectCommand(layer, objectAt(1, 0, 0), map)
    command.apply()
    expect(command.label).toBe('Dodaj obiekt')
    expect(layer.objects).toHaveLength(1)
  })

  it('restores removed objects at the index they came from', () => {
    const objects = [objectAt(1, 0, 0), objectAt(2, 32, 0), objectAt(3, 64, 0)]
    const { layer } = mapWithObjects(objects)
    const command = new RemoveObjectsCommand(layer, [objects[0]!, objects[2]!])
    command.apply()
    expect(layer.objects.map((o) => o.id)).toEqual([2])
    command.revert()
    expect(layer.objects.map((o) => o.id)).toEqual([1, 2, 3])
  })
})

describe('one property change across many objects', () => {
  it('is a single undo step', () => {
    const objects = [objectAt(1, 0, 0), objectAt(2, 32, 0)]
    const command = new SetPropertiesCommand(
      objects,
      objects.map((o) => [...o.properties, { name: 'railId', type: 'int' as const, value: 7 }]),
    )
    command.apply()
    expect(objects.map((o) => o.properties.length)).toEqual([2, 2])
    command.revert()
    expect(objects.map((o) => o.properties.map((p) => p.name))).toEqual([['kind'], ['kind']])
  })

  it('absorbs the next change to the same objects, so typing is one step', () => {
    const objects = [objectAt(1, 0, 0), objectAt(2, 32, 0)]
    const first = new SetPropertiesCommand(objects, objects.map(() => [{ name: 'kind', type: 'string' as const, value: 'f' }]), 'x', 'k')
    first.apply()
    const second = new SetPropertiesCommand(objects, objects.map(() => [{ name: 'kind', type: 'string' as const, value: 'fl' }]), 'x', 'k')
    second.apply()
    expect(first.absorb(second)).toBe(true)
    // Undoing the merged command goes back to the value before either.
    first.revert()
    expect(objects[0]!.properties[0]!.value).toBe('wall')
  })

  it('refuses to absorb a change to a different set of objects', () => {
    const a = [objectAt(1, 0, 0)]
    const b = [objectAt(2, 0, 0)]
    const first = new SetPropertiesCommand(a, [[]], 'x', 'k')
    expect(first.absorb(new SetPropertiesCommand(b, [[]], 'x', 'k'))).toBe(false)
  })
})
