import type { MapDef } from '../../data/maps/types';
import { makeArchipelagoHeight } from './archipelago';

export type HeightFn = (x: number, z: number) => number;

/** Dispatch on the map's terrain kind. Desert and alpine generators arrive with their maps in Phase 4. */
export function makeHeightFn(map: MapDef): HeightFn {
  switch (map.terrain.kind) {
    case 'archipelago':
      return makeArchipelagoHeight(map);
  }
}
