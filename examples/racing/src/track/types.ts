import type Phaser from 'phaser';

/** Minimal subset of the Tiled JSON (.tmj) map format we consume. */
export interface TmjTilesetRef {
  firstgid: number;
  source: string;
}

export interface TmjTileLayer {
  type: 'tilelayer';
  name: string;
  width: number;
  height: number;
  data: number[]; // row-major, 0 = empty; high bits = flip flags
}

export interface TmjObject {
  gid?: number;
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
}

export interface TmjObjectLayer {
  type: 'objectgroup';
  name: string;
  objects: TmjObject[];
}

export type TmjLayer = TmjTileLayer | TmjObjectLayer;

export interface TmjMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: TmjTilesetRef[];
  layers: TmjLayer[];
}

/** A resolved solid object forwarded to the collision loader. */
export interface PlacedObject {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  solid: boolean;
}

/** Baked collision: convex wall parts in world coords (from bake.py). */
export interface CollisionData {
  track: string;
  world: { width: number; height: number };
  walls: { parts: number[][][] }[];
}

/**
 * Baked racing line (road centreline) for one track, from racing_line.py.
 * Closed loop, uniform arc-length spacing, points[0] on the finish line.
 */
export interface RacingLineData {
  track: string;
  world: { width: number; height: number };
  tileSize: number;
  spacing: number; // px between consecutive points
  length: number; // total loop length (px)
  cells: number; // road tiles traced
  startAxis: 'vertical' | 'horizontal';
  startCell: { col: number; row: number };
  points: number[][]; // [[x, y], …] in driving order
}

export interface LoadedTrack {
  worldWidth: number;
  worldHeight: number;
  /** Layer render objects (tile layers = baked RenderTextures; objects = containers). */
  containers: Phaser.GameObjects.GameObject[];
  /** The raw parsed track-layer for collision + analysis. */
  trackLayer: TmjTileLayer;
  solidObjects: PlacedObject[];
}
