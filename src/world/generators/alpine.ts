import type { MapDef } from '../../data/maps/types';
import { DEG, lerp, smoothstep } from '../../core/math';
import { Simplex2 } from '../noise';

/**
 * Frostline Alps terrain: a big mountain island of ridged peaks (a low-frequency mask lets some regions sag into passes),
 * dropping steeply into icy sea at the map edge. Flat valley basins (some holding frozen lakes) are carved in for the
 * airstrips. Deterministic per seed.
 */
export function makeAlpineHeight(map: MapDef): (x: number, z: number) => number {
  if (map.terrain.kind !== 'alpine') throw new Error('wrong generator');
  const g = map.terrain;
  const seed = map.seed;
  const nWarp = new Simplex2(seed + 5);
  const nMass = new Simplex2(seed + 17);
  const nPass = new Simplex2(seed + 31);
  const nBase = new Simplex2(seed + 47);
  const nDetail = new Simplex2(seed + 61);
  const nBasin = new Simplex2(seed + 79);
  const half = map.size * 0.5;

  const basins = g.basins.map((b) => ({ ...b, cos: Math.cos(b.rot * DEG), sin: Math.sin(b.rot * DEG), reach: Math.max(b.rx, b.rz) * 2.2 }));
  const strips = map.airstrips.map((a) => ({ ...a, dx: Math.sin(a.heading * DEG), dz: -Math.cos(a.heading * DEG) }));

  return (x: number, z: number): number => {
    const wx = x + 320 * nWarp.n(x * 0.0005, z * 0.0005);
    const wz = z + 320 * nWarp.n(x * 0.0005 + 9.1, z * 0.0005 - 4.7);

    // squircle distance from the centre: the island fills the square map, with a rough coast
    const q = Math.pow(Math.pow(Math.abs(wx) / half, 4) + Math.pow(Math.abs(wz) / half, 4), 0.25) + 0.05 * nBase.fbm(wx * 0.0006, wz * 0.0006, 3);
    const env = 1 - smoothstep(0.64, 0.96, q);

    const mass = nMass.ridged(wx * 0.00021, wz * 0.00021, 6, 2.1, 0.5);
    const pass = smoothstep(-0.28, 0.32, nPass.fbm(wx * 0.00026 + 3, wz * 0.00026, 3)); // 0: low pass, 1: high range
    const peaks = Math.pow(mass, 1.3) * g.peak * (0.32 + 0.68 * pass);
    const foothills = 330 * (0.5 + 0.5 * nBase.fbm(wx * 0.0003, wz * 0.0003, 3));
    const rough = 38 * nDetail.fbm(wx * 0.0032, wz * 0.0032, 4) * (0.3 + 0.7 * pass);
    let h = env * (foothills + peaks + rough) - (1 - env) * 75;

    // glacial valleys and lakes
    for (let k = 0; k < basins.length; k++) {
      const b = basins[k];
      const dx = wx - b.x;
      const dz = wz - b.z;
      if (dx > b.reach || dx < -b.reach || dz > b.reach || dz < -b.reach) continue;
      const u = (dx * b.cos + dz * b.sin) / b.rx;
      const v = (-dx * b.sin + dz * b.cos) / b.rz;
      const dd = Math.sqrt(u * u + v * v) + 0.16 * nBasin.fbm(wx * 0.0009, wz * 0.0009, 3);
      const w = 1 - smoothstep(0.5, 1.45, dd);
      if (w <= 0) continue;
      let target = b.floor + 4 * nDetail.fbm(x * 0.004, z * 0.004, 3);
      if (b.lake) target = lerp(b.floor, 8, smoothstep(0.35, 0.8, dd));
      h = lerp(h, target, Math.pow(w, 0.85));
    }

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
