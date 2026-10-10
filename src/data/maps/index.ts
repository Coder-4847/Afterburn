import type { MapDef } from './types';
import { CORAL } from './coral';
import { FROSTLINE } from './frostline';
import { SANDSTORM } from './sandstorm';

/**
 * The maps were authored at about 20 km across; with jets doing 200-300 m/s that is a long flight between fights. Every map is
 * shrunk to roughly half that: the terrain is the same shape squeezed, airstrips keep their real length, the spawn and the
 * boundary move in with it. (The Alps are squeezed less: steep valleys and walls get dangerous when compressed.)
 */
export const WORLD_SCALE = 0.55;

function scaled(def: MapDef, s = WORLD_SCALE): MapDef {
  return {
    ...def,
    size: def.size * s,
    designScale: s,
    airstrips: def.airstrips.map((a) => ({ ...a, x: a.x * s, z: a.z * s })),
    spawn: { ...def.spawn, x: def.spawn.x * s, z: def.spawn.z * s },
    boundary: def.boundary * s,
  };
}

export const MAP_LIST: MapDef[] = [scaled(CORAL), scaled(SANDSTORM), scaled(FROSTLINE, 0.7)];

export const MAPS: Record<string, MapDef> = Object.fromEntries(MAP_LIST.map((m) => [m.id, m]));

export type { MapDef } from './types';
