import type { MapDef } from '../../data/maps/types';
import { makeAlpineHeight } from './alpine';
import { makeArchipelagoHeight } from './archipelago';
import { makeDesertHeight } from './desert';

export type HeightFn = (x: number, z: number) => number;

/** Dispatch on the map's terrain kind. */
export function makeHeightFn(map: MapDef): HeightFn {
  switch (map.terrain.kind) {
    case 'archipelago':
      return makeArchipelagoHeight(map);
    case 'desert':
      return makeDesertHeight(map);
    case 'alpine':
      return makeAlpineHeight(map);
  }
}
