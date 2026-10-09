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

export interface MesaDef {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  /** Height of the flat top above the basin floor (m). */
  height: number;
}

/** Sandstorm Basin: a flat dune sea ringed by flat-topped mesas and broken highlands. */
export interface DesertGen {
  kind: 'desert';
  /** Height of the basin floor (m). Also the height the terrain fades to at the map edge. */
  floor: number;
  duneAmp: number;
  highlandAmp: number;
  /** 0..1 fraction of the map covered by highlands. */
  highlandCover: number;
  mesas: MesaDef[];
}

export interface BasinDef {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  /** Valley floor height (m). With `lake` the floor is carved below sea level instead. */
  floor: number;
  lake?: boolean;
}

/** Frostline Alps: a mountain island of high ridges, flat glacial valleys and frozen lakes, falling away to icy sea. */
export interface AlpineGen {
  kind: 'alpine';
  peak: number;
  basins: BasinDef[];
}

export type TerrainGen = ArchipelagoGen | DesertGen | AlpineGen;

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

export interface CloudDef {
  /** Cloud base and the highest tops (m above sea level). */
  base: number;
  top: number;
  /** 0..1: how much of the map is covered. */
  coverage: number;
  /** Puff size multiplier. */
  scale: number;
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
  clouds?: CloudDef;
  /** Maps with no sea: a flat plane of this colour at height y fills the world beyond the terrain (and the water is hidden). */
  groundPlane?: { color: number; y: number };
  /** Short label for menus. */
  tagline?: string;
  /** Half-extent of the combat zone (m). Leaving it starts the return-to-combat countdown. */
  boundary: number;
  /** Default start for free flight: position, heading (deg), altitude. */
  spawn: { x: number; z: number; heading: number; altitude: number; speed: number };
}
