import type { ModelSpec, Section } from './AircraftDef';
import { clamp, lerp } from '../core/math';

export interface SecAt {
  /** Height of the widest point (absolute y). */
  ys: number;
  hw: number;
  /** Half height and centre of the whole section (top and bottom as one symmetric extent). */
  hh: number;
  yc: number;
  top: number;
  bot: number;
}

/** A section with every column present: [z, hw, hh, yc, hb, n, nb, ys]. */
export type FullSection = [number, number, number, number, number, number, number, number];

export function fullSections(s: Section[], defN: number): FullSection[] {
  return s.map((q) => {
    const n = q[5] ?? defN;
    return [q[0], q[1], q[2], q[3], q[4] ?? q[2], n, q[6] ?? n, q[7] ?? 0] as FullSection;
  });
}

/**
 * Smooth the stations: a monotone cubic (no overshoot) through half width, heights and centre, linear through the
 * exponents and the shoulder height, `sub` samples per segment. A straight-line loft of a handful of stations looks faceted.
 */
export function refineSections(s: FullSection[], sub: number): FullSection[] {
  const n = s.length;
  if (n < 3) return s;
  const slopes = [1, 2, 3, 4].map((c) => {
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((s[i + 1][c] - s[i][c]) / (s[i + 1][0] - s[i][0] || 1e-6));
    const m = new Array<number>(n);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
      } else {
        const a = m[i] / d[i];
        const b = m[i + 1] / d[i];
        const h = a * a + b * b;
        if (h > 9) {
          const t = 3 / Math.sqrt(h);
          m[i] = t * a * d[i];
          m[i + 1] = t * b * d[i];
        }
      }
    }
    return m;
  });
  const out: FullSection[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = s[i + 1][0] - s[i][0];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const v = (c: number) => h00 * s[i][c] + h10 * h * slopes[c - 1][i] + h01 * s[i + 1][c] + h11 * h * slopes[c - 1][i + 1];
      out.push([
        s[i][0] + t * h, Math.max(0, v(1)), Math.max(0, v(2)), v(3), Math.max(0, v(4)),
        lerp(s[i][5], s[i + 1][5], t), lerp(s[i][6], s[i + 1][6], t), lerp(s[i][7], s[i + 1][7], t),
      ]);
    }
  }
  out.push(s[n - 1]);
  return out;
}

const refined = new WeakMap<ModelSpec, FullSection[]>();
function fine(spec: ModelSpec): FullSection[] {
  let r = refined.get(spec);
  if (!r) refined.set(spec, (r = refineSections(fullSections(spec.sections, spec.shapeN ?? 2.5), 6)));
  return r;
}

export function secAt(spec: ModelSpec, f: number): SecAt {
  const s = fine(spec);
  f = clamp(f, 0, 1);
  let q: FullSection | null = null;
  let r: FullSection | null = null;
  let t = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (f >= s[i][0] && f <= s[i + 1][0]) {
      q = s[i];
      r = s[i + 1];
      t = (f - s[i][0]) / (s[i + 1][0] - s[i][0] || 1);
      break;
    }
  }
  if (!q || !r) q = r = s[s.length - 1];
  const hw = lerp(q[1], r[1], t);
  const yc = lerp(q[3], r[3], t);
  const top = yc + lerp(q[2], r[2], t);
  const bot = yc - lerp(q[4], r[4], t);
  return { hw, hh: (top - bot) / 2, yc: (top + bot) / 2, top, bot, ys: yc + lerp(q[7], r[7], t) };
}
