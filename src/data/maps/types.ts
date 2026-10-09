import type { TimeOfDay } from '../../core/Settings';

export interface AirstripDef {
  id: string;
  team: 'blue' | 'red';
  name: string;
  x: number;
  z: number;
  /** Direction of the primary runway number, degrees (0 = north, 90 = east). */
  heading: number;
  length: number;
  width: number;
  /** Flattened height of the strip above sea level (m). */
  elevation: number;
}

export interface IslandDef {
  x: number;
  z: number;
  /** Radii along/across the island's own axes (m), and rotation (deg). */
  rx: number;
  rz: number;
  rot: number;
  /** Highest point above sea level (m). */
  peak: number;
  /** 0..1: how rugged the peaks are. */
  rugged: number;
  reef?: boolean;
}

export interface ArchipelagoGen {
  kind: 'archipelago';
  islands: IslandDef[];
  /** Randomly scattered small islets. */
  scatter: { count: number; minR: number; maxR: number; maxPeak: number };
}

export type TerrainGen = ArchipelagoGen;

export interface LightingPreset {
  sunAzimuth: number; // degrees, compass direction the sun is *in*
  sunElevation: number;
  sunColor: number;
  sunIntensity: number;
  zenith: number;
  horizon: number;
  /** Sky colour below the horizon (also tints reflections on the belly of aircraft). */
  ground: number;
  /** Warm tint blended into the horizon band on the sun's side. */
  sunsetTint: number;
  fogDensity: number;
  envIntensity: number;
  exposure: number;
}

export interface TerrainPalette {
  base: number; // main ground cover
  sand: number; // beaches / low ground
  rock: number;
  snow: number;
  seabed: number;
  /** Height (m) up to which the "sand" colour dominates. */
  sandTop: number;
  /** Height (m) where snow starts (use a huge number for no snow). */
  snowLine: number;
  /** Slope (1 - normal.y) above which rock shows. */
  rockSlope: number;
  detailStrength: number;
}

export interface WaterDef {
  shallow: number;
  deep: number;
  /** Depth (m) at which water goes from clear to deep colour. */
  clarity: number;
  waveStrength: number;
}

export interface MapDef {
  id: string;
  name: string;
  description: string;
  /** Terrain square size (m) and its seed. */
  size: number;
  seed: number;
  seaLevel: number;
  terrain: TerrainGen;
  palette: TerrainPalette;
  water: WaterDef;
  lighting: Record<TimeOfDay, LightingPreset>;
  airstrips: AirstripDef[];
  /** Half-extent of the combat zone (m). Leaving it starts the return-to-combat countdown. */
  boundary: number;
  /** Default start for free flight: position, heading (deg), altitude. */
  spawn: { x: number; z: number; heading: number; altitude: number; speed: number };
}
