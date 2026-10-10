import type { MapDef } from './types';
import { COBALT } from './cobalt';
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

export const MAP_LIST: MapDef[] = [scaled(CORAL), scaled(SANDSTORM), scaled(FROSTLINE, 0.7), scaled(COBALT)];

export const MAPS: Record<string, MapDef> = Object.fromEntries(MAP_LIST.map((m) => [m.id, m]));

/** Maps a player can pick for the ordinary modes (map-exclusive ones are not in this list). */
export const FREE_MAPS: MapDef[] = MAP_LIST.filter((m) => !m.exclusive);

/** Carrier Strike is played on its own map, whatever map the player last picked. */
export const CARRIER_MAP_ID = MAP_LIST.find((m) => m.exclusive === 'carrier')!.id;

/** The map a sortie is played on: the mode's own map if it has one, else the player's choice. */
export function mapIdFor(sortie: string, chosen: string): string {
  if (sortie === 'carrier') return CARRIER_MAP_ID;
  const m = MAPS[chosen];
  return m && !m.exclusive ? chosen : MAP_LIST[0].id;
}

export type { MapDef } from './types';
