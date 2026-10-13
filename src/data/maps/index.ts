import type { MapDef } from './types';
import { COBALT } from './cobalt';
import { CORAL } from './coral';
import { FROSTLINE } from './frostline';
import { SANDSTORM } from './sandstorm';

/**
 * The maps are authored at about 20 km across. They were once squeezed to 0.55 of that (11 km) to keep fights close; they are
 * now played at full authored size, 1.8x wider than that, so there is room to fly. Airstrips keep their real length. (The Alps
 * were squeezed less because steep valleys get dangerous when compressed; they are 1.8x bigger too.)
 */
export const WORLD_SCALE = 1;

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

export const MAP_LIST: MapDef[] = [scaled(CORAL), scaled(SANDSTORM), scaled(FROSTLINE, 1.25), scaled(COBALT)];

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
