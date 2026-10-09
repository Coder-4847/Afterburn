import type { MapDef } from './types';
import { CORAL } from './coral';
import { FROSTLINE } from './frostline';
import { SANDSTORM } from './sandstorm';

export const MAPS: Record<string, MapDef> = {
  [CORAL.id]: CORAL,
  [SANDSTORM.id]: SANDSTORM,
  [FROSTLINE.id]: FROSTLINE,
};

export const MAP_LIST: MapDef[] = [CORAL, SANDSTORM, FROSTLINE];

export type { MapDef } from './types';
