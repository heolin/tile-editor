import type Phaser from 'phaser';
import { CAT, WALL_RESTITUTION } from '../constants';
import { resolveGid } from '../track/racing-tileset';
import { getRoadWalls } from '../track/track-assets';
import type { CollisionData, PlacedObject, TmjTileLayer } from '../track/types';

/**
 * Build walls PER TILE: each road tile contributes its own curb/off-road parts
 * at its cell — no map-level merging. The per-tile drivable was buffered at bake
 * time so the channel stays connected across tile edges.
 */
export function buildWallsPerTile(scene: Phaser.Scene, layer: TmjTileLayer): number {
  const atlas = getRoadWalls();
  const T = atlas.tileSize;
  let count = 0;
  for (let row = 0; row < layer.height; row++) {
    for (let col = 0; col < layer.width; col++) {
      const r = resolveGid(layer.data[row * layer.width + col]);
      if (!r || r.isObject) continue;
      const parts = atlas.tiles[r.key];
      if (!parts) continue;
      for (const part of parts) {
        const world = part.map(([x, y]) => [
          col * T + (r.flipH ? T - x : x),
          row * T + (r.flipV ? T - y : y),
        ]);
        if (addStaticConvex(scene, world)) count++;
      }
    }
  }
  return count;
}

const DEG2RAD = Math.PI / 180;

const WALL_OPTS = {
  isStatic: true,
  restitution: WALL_RESTITUTION,
  friction: 0,
  collisionFilter: { category: CAT.WALL },
};

/**
 * Build static Matter wall bodies from a baked collision atlas. Each part is a
 * pre-decomposed CONVEX loop (world coords), so fromVertices needs no
 * poly-decomp. One static body per part.
 */
export function buildWalls(scene: Phaser.Scene, data: CollisionData): number {
  let count = 0;
  for (const wall of data.walls) {
    for (const part of wall.parts) {
      if (addStaticConvex(scene, part)) count++;
    }
  }
  return count;
}

/** |signed area| of a polygon (shoelace). */
function polyArea(verts: number[][]): number {
  let a = 0;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    a += verts[j][0] * verts[i][1] - verts[i][0] * verts[j][1];
  }
  return Math.abs(a) / 2;
}

function addStaticConvex(scene: Phaser.Scene, verts: number[][]): boolean {
  // Skip degenerate parts — matter.add.fromVertices throws on collinear/zero-area
  // vertex sets, which would abort the whole scene.
  if (verts.length < 3 || polyArea(verts) < 2) return false;
  const n = verts.length;
  const cx = verts.reduce((s, v) => s + v[0], 0) / n;
  const cy = verts.reduce((s, v) => s + v[1], 0) / n;
  const vs = verts.map(([x, y]) => ({ x, y }));
  try {
    // fromVertices recenters the shape to (cx,cy); passing the centroid keeps
    // the part at its authored world position.
    scene.matter.add.fromVertices(cx, cy, vs, WALL_OPTS, false, 0.01, 1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Solid props get a simple primitive body by category (circle / thin rect /
 * block); decals are skipped upstream (only solid PlacedObjects arrive here).
 */
export function buildObjectBodies(scene: Phaser.Scene, objects: PlacedObject[]): number {
  let count = 0;
  for (const obj of objects) {
    const body = objectBody(scene, obj);
    if (body) count++;
  }
  return count;
}

function objectBody(scene: Phaser.Scene, obj: PlacedObject): boolean {
  const { key, x, y, width: w, height: h, rotationDeg } = obj;
  const angle = rotationDeg * DEG2RAD;
  const opts = { ...WALL_OPTS, angle };

  const startsWith = (p: string) => key.startsWith(p);

  if (startsWith('barrel') || startsWith('tires') || startsWith('cone') || startsWith('rock')) {
    scene.matter.add.circle(x, y, (Math.min(w, h) / 2) * 0.55, opts);
  } else if (startsWith('barrier')) {
    scene.matter.add.rectangle(x, y, w, h * 0.5, opts);
  } else if (startsWith('tree')) {
    scene.matter.add.circle(x, y, w * 0.22, opts); // trunk only
  } else if (startsWith('tent') || startsWith('tribune')) {
    scene.matter.add.rectangle(x, y, w, h, opts);
  } else {
    scene.matter.add.circle(x, y, (Math.min(w, h) / 2) * 0.5, opts);
  }
  return true;
}
