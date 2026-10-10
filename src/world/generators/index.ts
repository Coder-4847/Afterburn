import type { MapDef } from '../../data/maps/types';
import { makeAlpineHeight } from './alpine';
import { makeArchipelagoHeight } from './archipelago';
import { makeDesertHeight } from './desert';

export type HeightFn = (x: number, z: number) => number;

/** Dispatch on the map's terrain kind. */
export function makeHeightFn(map: MapDef): HeightFn {
  const s = map.designScale ?? 1;
  if (s === 1) return generate(map);
  // build the terrain in design space (the size the map was authored at), then sample it shrunk by the scale factor
  const design: MapDef = {
    ...map,
    size: map.size / s,
    airstrips: map.airstrips.map((a) => ({ ...a, x: a.x / s, z: a.z / s, length: a.length / s, width: a.width / s })),
  };
  const fn = generate(design);
  return (x, z) => fn(x / s, z / s);
}

function generate(map: MapDef): HeightFn {
  switch (map.terrain.kind) {
    case 'archipelago':
      return makeArchipelagoHeight(map);
    case 'desert':
      return makeDesertHeight(map);
    case 'alpine':
      return makeAlpineHeight(map);
  }
}
