import type { MapDef } from '../../data/maps/types';
import { DEG, lerp, smoothstep } from '../../core/math';
import { Simplex2 } from '../noise';

/**
 * Sandstorm Basin terrain: a wind-swept dune sea (long ridged dunes stretched along the wind), flat-topped mesas with
 * steep walls, and broken highlands that come and go with a low-frequency mask. Everything fades to a flat floor at the
 * map edge so it joins the ground plane seamlessly. Deterministic per seed.
 */
export function makeDesertHeight(map: MapDef): (x: number, z: number) => number {
  if (map.terrain.kind !== 'desert') throw new Error('wrong generator');
  const g = map.terrain;
  const seed = map.seed;
  const nWarp = new Simplex2(seed + 3);
  const nDune = new Simplex2(seed + 13);
  const nMask = new Simplex2(seed + 29);
  const nHigh = new Simplex2(seed + 43);
  const nDetail = new Simplex2(seed + 59);
  const nEdge = new Simplex2(seed + 71);
  const half = map.size * 0.5;

  const mesas = g.mesas.map((m) => ({ ...m, cos: Math.cos(m.rot * DEG), sin: Math.sin(m.rot * DEG), reach: Math.max(m.rx, m.rz) * 2.4 }));
  const strips = map.airstrips.map((a) => ({ ...a, dx: Math.sin(a.heading * DEG), dz: -Math.cos(a.heading * DEG) }));
  // a mask threshold from the requested coverage (fbm is roughly [-0.6, 0.6])
  const maskLo = 0.12 - g.highlandCover * 0.45;

  return (x: number, z: number): number => {
    const e = smoothstep(half - 3000, half - 900, Math.max(Math.abs(x), Math.abs(z)) + 500 * nEdge.n(x * 0.0006, z * 0.0006));
    const wx = x + 260 * nWarp.n(x * 0.0006, z * 0.0006);
    const wz = z + 260 * nWarp.n(x * 0.0006 + 7.7, z * 0.0006 - 3.1);

    // dunes: stretched along the wind (x axis), crests sharpened with the ridged noise
    const crest = nDune.ridged(wx * 0.0009, wz * 0.0021, 4, 2.1, 0.5);
    const swell = 0.5 + 0.5 * nDune.fbm(wx * 0.0004 + 11, wz * 0.0004, 3);
    let h = g.floor + g.duneAmp * (0.25 + 0.75 * swell) * (crest * 1.25 - 0.35) + 2.5 * nDetail.fbm(x * 0.004, z * 0.004, 3);

    // broken highlands: ridged mountains inside a low-frequency mask, with flattened tops
    const mask = smoothstep(maskLo, maskLo + 0.3, nMask.fbm(wx * 0.00017 + 5, wz * 0.00017, 3));
    if (mask > 0.001) {
      const r = nHigh.ridged(wx * 0.00055, wz * 0.00055, 5, 2.05, 0.48);
      const plateau = Math.min(r, 0.78) / 0.78; // clip the crests: mesa-like shoulders
      h += g.highlandAmp * mask * Math.pow(plateau, 1.5) * (0.7 + 0.3 * nDetail.fbm(wx * 0.002, wz * 0.002, 3));
    }

    // mesas
    let top = 0;
    for (let k = 0; k < mesas.length; k++) {
      const m = mesas[k];
      const dx = wx - m.x;
      const dz = wz - m.z;
      if (dx > m.reach || dx < -m.reach || dz > m.reach || dz < -m.reach) continue;
      const u = (dx * m.cos + dz * m.sin) / m.rx;
      const v = (-dx * m.sin + dz * m.cos) / m.rz;
      const dd = Math.sqrt(u * u + v * v) + 0.2 * nDetail.fbm(wx * 0.0011, wz * 0.0011, 3) + 0.045 * nDetail.n(wx * 0.006, wz * 0.006);
      const wall = 1 - smoothstep(0.78, 1.0, dd); // steep cliff
      const talus = 0.22 * (1 - smoothstep(0.9, 1.9, dd)); // fallen rock skirt
      const t = Math.max(wall, talus);
      if (t > top) {
        const tabletop = 1 + 0.03 * nDetail.n(wx * 0.003, wz * 0.003);
        top = t;
        h = Math.max(h, g.floor + m.height * t * tabletop);
      }
    }

    h = lerp(h, g.floor, e);

    // flatten airstrips
    for (let i = 0; i < strips.length; i++) {
      const a = strips[i];
      const ox = x - a.x;
      const oz = z - a.z;
      const u = ox * a.dx + oz * a.dz;
      const v = -ox * a.dz + oz * a.dx;
      const ex = Math.max(Math.abs(u) - a.length * 0.5 - 90, 0);
      const ez = Math.max(Math.abs(v) - a.width * 0.5 - 80, 0);
      const d = Math.sqrt(ex * ex + ez * ez);
      if (d < 420) h = lerp(h, a.elevation, 1 - smoothstep(0, 420, d));
    }
    return h;
  };
}
