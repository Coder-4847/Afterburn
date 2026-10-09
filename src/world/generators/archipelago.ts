import type { IslandDef, MapDef } from '../../data/maps/types';
import { DEG, lerp, mulberry32, smoothstep } from '../../core/math';
import { Simplex2 } from '../noise';

/**
 * Coral Archipelago terrain: elliptical dome islands with noisy coastlines, a shallow shelf
 * (turquoise lagoons) that drops off to deep water, fringing reef patches, and scattered islets.
 * Deterministic: same seed => same world.
 */
export function makeArchipelagoHeight(map: MapDef): (x: number, z: number) => number {
  if (map.terrain.kind !== 'archipelago') throw new Error('wrong generator');
  const seed = map.seed;
  const nWarp = new Simplex2(seed + 11);
  const nCoast = new Simplex2(seed + 23);
  const nMount = new Simplex2(seed + 37);
  const nDetail = new Simplex2(seed + 41);
  const nSea = new Simplex2(seed + 53);
  const nReef = new Simplex2(seed + 67);

  const islands: IslandDef[] = [...map.terrain.islands];

  // scatter small islets in the gaps
  const rnd = mulberry32(seed + 99);
  const sc = map.terrain.scatter;
  const half = map.size * 0.5 - 1400;
  let guard = 0;
  while (islands.length < map.terrain.islands.length + sc.count && guard++ < 2000) {
    const x = (rnd() * 2 - 1) * half;
    const z = (rnd() * 2 - 1) * half;
    const r = sc.minR + rnd() * (sc.maxR - sc.minR);
    let ok = true;
    for (const o of islands) {
      const d = Math.hypot(x - o.x, z - o.z);
      if (d < Math.max(o.rx, o.rz) * 1.9 + r + 300) { ok = false; break; }
    }
    for (const a of map.airstrips) if (Math.hypot(x - a.x, z - a.z) < 2600) ok = false;
    if (!ok) continue;
    islands.push({ x, z, rx: r, rz: r * (0.6 + rnd() * 0.5), rot: rnd() * 180, peak: 14 + rnd() * (sc.maxPeak - 14), rugged: 0.3, reef: true });
  }

  const isl = islands.map((i) => ({
    ...i,
    cos: Math.cos(i.rot * DEG),
    sin: Math.sin(i.rot * DEG),
    reach: Math.max(i.rx, i.rz) * 3.0,
  }));

  const strips = map.airstrips.map((a) => ({
    ...a,
    dx: Math.sin(a.heading * DEG),
    dz: -Math.cos(a.heading * DEG),
  }));

  return (x: number, z: number): number => {
    // domain warp keeps coastlines from looking like perfect ellipses
    const wx = x + 230 * nWarp.n(x * 0.0007, z * 0.0007);
    const wz = z + 230 * nWarp.n(x * 0.0007 + 17.3, z * 0.0007 - 9.1);
    const cn =
      0.15 * nCoast.n(wx * 0.0016, wz * 0.0016) +
      0.065 * nCoast.n(wx * 0.0058, wz * 0.0058) +
      0.025 * nCoast.n(wx * 0.021, wz * 0.021);

    let maxInfl = 0;
    let dome = 0;
    let reefMask = 0;
    let anyLand = false;
    let ridge = -1;
    let rough = 0;

    for (let k = 0; k < isl.length; k++) {
      const o = isl[k];
      const dx = wx - o.x;
      const dz = wz - o.z;
      if (dx > o.reach || dx < -o.reach || dz > o.reach || dz < -o.reach) continue;
      const u = (dx * o.cos + dz * o.sin) / o.rx;
      const v = (-dx * o.sin + dz * o.cos) / o.rz;
      const dd = Math.sqrt(u * u + v * v) + cn;
      const infl = 1 - smoothstep(1.0, 2.7, dd);
      if (infl > maxInfl) maxInfl = infl;
      if (dd < 1) {
        if (ridge < 0) {
          // half sharp ridges, half smooth massif: needles look wrong, ridgelines look right
          ridge = 0.5 * nMount.ridged(wx * 0.0006, wz * 0.0006, 4, 2, 0.4) + 0.5 * (0.5 + 0.5 * nMount.fbm(wx * 0.0005 + 31, wz * 0.0005, 3, 2, 0.5));
          rough = nDetail.fbm(wx * 0.004, wz * 0.004, 3, 2, 0.45);
        }
        anyLand = true;
        const prof = Math.pow(1 - dd * dd, 1.1);
        const shape = lerp(1, 0.5 + 1.15 * ridge, o.rugged);
        dome += o.peak * prof * shape + 6 * rough * prof * (0.4 + o.rugged);
      }
      if (o.reef) {
        const t = (dd - 1.5) / 0.055;
        const m = Math.exp(-t * t);
        if (m > reefMask) reefMask = m;
      }
    }

    const swell = nSea.fbm(x * 0.0004, z * 0.0004, 3);
    let h = -78 + 72 * Math.pow(maxInfl, 1.3) + swell * 6 * (1 - maxInfl);
    if (anyLand) h += dome;
    // beach shelf: keep the coast from being a razor edge
    if (reefMask > 0.02) {
      const patch = smoothstep(-0.1, 0.3, nReef.n(wx * 0.0035, wz * 0.0035));
      const crest = -0.9 + 1.6 * nReef.n(wx * 0.02, wz * 0.02);
      h = lerp(h, Math.max(h, crest), reefMask * patch);
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
      const e = Math.sqrt(ex * ex + ez * ez);
      if (e < 420) {
        const t = 1 - smoothstep(0, 420, e);
        h = lerp(h, a.elevation, t);
      }
    }
    return h;
  };
}
