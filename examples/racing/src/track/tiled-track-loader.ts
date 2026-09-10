import Phaser from 'phaser';
import { DEPTH, TILE } from '../constants';
import { resolveGid } from './racing-tileset';
import type { LoadedTrack, PlacedObject, TmjMap, TmjObject, TmjTileLayer } from './types';

/** Origin used for tile-objects. objects.tsj sets objectalignment:center, so
 *  (x,y) is the object centre → origin 0.5. Flip to (0,1) if props look
 *  offset by half a tile. */
const OBJECT_ORIGIN = 0.5;

/**
 * Renders a parsed Tiled track (collection-of-images tilesets, which Phaser's
 * native tilemap can't handle) as containers of images — one per layer, at
 * depths that put cars between low props and tall props (trees/tents).
 */
export function loadTrack(scene: Phaser.Scene, map: TmjMap): LoadedTrack {
  const containers: Phaser.GameObjects.GameObject[] = [];
  let trackLayer: TmjTileLayer | null = null;
  const solidObjects: PlacedObject[] = [];

  for (const layer of map.layers) {
    if (layer.type === 'tilelayer') {
      const depth = layer.name === 'track' ? DEPTH.track : DEPTH.ground;
      containers.push(buildTileLayer(scene, layer, depth));
      if (layer.name === 'track') trackLayer = layer;
    } else if (layer.type === 'objectgroup') {
      const { low, high } = buildObjectLayers(scene, layer.objects, solidObjects);
      containers.push(low, high);
    }
  }

  if (!trackLayer) throw new Error('racing: track layer not found in map');

  return {
    worldWidth: map.width * TILE,
    worldHeight: map.height * TILE,
    containers,
    trackLayer,
    solidObjects,
  };
}

/**
 * Non-integer camera zoom renders each tile image at a fractional screen
 * position, leaving hairline seams between neighbours. NEAREST filtering kills
 * the linear-filter edge bleed, and extruding each tile so neighbours overlap
 * covers the fractional-position gap (the overlap is opaque interior).
 */
const TILE_OVERLAP = 4;

function buildTileLayer(
  scene: Phaser.Scene,
  layer: TmjTileLayer,
  depth: number,
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0).setDepth(depth);
  const filtered = new Set<string>();
  for (let row = 0; row < layer.height; row++) {
    for (let col = 0; col < layer.width; col++) {
      const t = resolveGid(layer.data[row * layer.width + col]);
      if (!t) continue;
      if (!filtered.has(t.key)) {
        scene.textures.get(t.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
        filtered.add(t.key);
      }
      const img = scene.add
        .image(col * TILE + TILE / 2, row * TILE + TILE / 2, t.key)
        .setDisplaySize(TILE + TILE_OVERLAP, TILE + TILE_OVERLAP);
      if (t.flipH) img.setFlipX(true);
      if (t.flipV) img.setFlipY(true);
      container.add(img);
    }
  }
  return container;
}

function buildObjectLayers(
  scene: Phaser.Scene,
  objects: TmjObject[],
  solidOut: PlacedObject[],
): { low: Phaser.GameObjects.Container; high: Phaser.GameObjects.Container } {
  const low = scene.add.container(0, 0).setDepth(DEPTH.objLow);
  const high = scene.add.container(0, 0).setDepth(DEPTH.objHigh);

  for (const obj of objects) {
    if (obj.gid === undefined || !obj.visible) continue;
    const t = resolveGid(obj.gid);
    if (!t) continue;
    const img = scene.add
      .image(obj.x, obj.y, t.key)
      .setOrigin(OBJECT_ORIGIN)
      .setDisplaySize(obj.width, obj.height)
      .setAngle(obj.rotation);
    (t.tall ? high : low).add(img);

    if (t.solid) {
      solidOut.push({
        key: t.key,
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        rotationDeg: obj.rotation,
        solid: true,
      });
    }
  }
  return { low, high };
}
