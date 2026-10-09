import { CanvasTexture, Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from '../core/math';
import type { ModelSpec } from './AircraftDef';

/** One texture tile covers this many metres of skin (UVs in the jet builder are metres / TILE). */
export const SKIN_TILE = 6;

interface SkinTextures {
  map: CanvasTexture;
  bump: CanvasTexture;
}

const cache = new Map<string, SkinTextures>();

const css = (hex: number): string => '#' + hex.toString(16).padStart(6, '0');

function rgba(hex: number, a: number, shade = 1): string {
  const c = new Color(hex);
  const f = (v: number) => Math.round(Math.min(1, Math.max(0, v ** (1 / 2.2) * shade)) * 255);
  return `rgba(${f(c.r)},${f(c.g)},${f(c.b)},${a})`;
}

/**
 * Painted skin: base colour with optional camouflage blotches, panel lines, rivets and weathering.
 * A matching bump map makes the panel lines catch the light. Cached per colour scheme.
 */
function skinTextures(colors: ModelSpec['colors'], seed: number): SkinTextures {
  const key = `${colors.body}-${colors.camo ?? 0}-${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const S = 1024;
  const rnd = mulberry32(seed * 7919 + colors.body);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const b = document.createElement('canvas');
  b.width = b.height = S / 2;
  const h = b.getContext('2d')!;

  g.fillStyle = css(colors.body);
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, S / 2, S / 2);

  // camouflage: soft overlapping blotches in a second colour (wrapped so the tile repeats cleanly)
  if (colors.camo !== undefined) {
    for (let i = 0; i < 46; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 50 + rnd() * 120;
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          const grad = g.createRadialGradient(x + ox, y + oy, r * 0.2, x + ox, y + oy, r);
          grad.addColorStop(0, rgba(colors.camo, 0.85));
          grad.addColorStop(0.7, rgba(colors.camo, 0.6));
          grad.addColorStop(1, rgba(colors.camo, 0));
          g.fillStyle = grad;
          g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
  }
  // fine mottling
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? 0 : 255},${rnd() < 0.5 ? 0 : 255},${rnd() < 0.5 ? 0 : 255},${0.012 + rnd() * 0.02})`;
    g.fillRect(rnd() * S, rnd() * S, 4 + rnd() * 30, 2 + rnd() * 10);
  }

  // panel lines: an irregular grid of rectangles, drawn as a dark groove plus a faint highlight beside it
  const lines: [number, number, number, number][] = [];
  const xs: number[] = [0];
  while (xs[xs.length - 1] < S) xs.push(xs[xs.length - 1] + 90 + rnd() * 190);
  for (const x of xs) lines.push([x, 0, x, S]);
  const ys: number[] = [0];
  while (ys[ys.length - 1] < S) ys.push(ys[ys.length - 1] + 80 + rnd() * 170);
  for (const y of ys) lines.push([0, y, S, y]);
  // broken, shorter lines inside panels
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 60 + rnd() * 150;
    lines.push(rnd() < 0.5 ? [x, y, x + len, y] : [x, y, x, y + len]);
  }
  for (const [x0, y0, x1, y1] of lines) {
    g.strokeStyle = 'rgba(8,10,14,0.27)';
    g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x0 + 2.5, y0 + 2.5); g.lineTo(x1 + 2.5, y1 + 2.5); g.stroke();
    h.strokeStyle = '#2c2c2c';
    h.lineWidth = 1.6;
    h.beginPath(); h.moveTo(x0 / 2, y0 / 2); h.lineTo(x1 / 2, y1 / 2); h.stroke();
  }
  // rivets along some lines
  for (let i = 0; i < 700; i++) {
    const [x0, y0, x1, y1] = lines[Math.floor(rnd() * lines.length)];
    const t = rnd();
    const x = x0 + (x1 - x0) * t + (y1 === y0 ? 0 : 6);
    const y = y0 + (y1 - y0) * t + (x1 === x0 ? 0 : 6);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(x, y, 2, 2);
    h.fillStyle = '#b4b4b4';
    h.fillRect(x / 2, y / 2, 1.4, 1.4);
  }
  // access hatches and a little exhaust-style weathering streaks
  for (let i = 0; i < 22; i++) {
    const x = rnd() * S, y = rnd() * S, w = 30 + rnd() * 70, hh = 20 + rnd() * 40;
    g.strokeStyle = 'rgba(8,10,14,0.38)';
    g.lineWidth = 1.8;
    g.strokeRect(x, y, w, hh);
    h.strokeStyle = '#303030';
    h.lineWidth = 1.2;
    h.strokeRect(x / 2, y / 2, w / 2, hh / 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = rnd() * S;
    const grad = g.createLinearGradient(x, y, x + 6 + rnd() * 8, y + 100 + rnd() * 160);
    grad.addColorStop(0, 'rgba(20,18,16,0.10)');
    grad.addColorStop(1, 'rgba(20,18,16,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 10, 260);
  }

  const mk = (cv: HTMLCanvasElement, srgb: boolean): CanvasTexture => {
    const t = new CanvasTexture(cv);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const out = { map: mk(c, true), bump: mk(b, false) };
  cache.set(key, out);
  return out;
}

export interface JetMaterials {
  body: MeshStandardMaterial;
  /** Same skin, double-sided, for thin slabs (wings, fins). */
  flat: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  accent: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  intake: MeshStandardMaterial;
  nozzle: MeshStandardMaterial;
  /** Hot glow inside the nozzle; intensity follows throttle. */
  heat: MeshBasicMaterial;
  tyre: MeshStandardMaterial;
  strut: MeshStandardMaterial;
}

export function makeJetMaterials(colors: ModelSpec['colors'], teamColor: number, seed: number): JetMaterials {
  const skin = skinTextures(colors, seed);
  const body = new MeshStandardMaterial({
    color: 0xffffff, map: skin.map, bumpMap: skin.bump, bumpScale: 1.0, metalness: 0.42, roughness: 0.46,
  });
  const flat = body.clone();
  flat.side = DoubleSide;
  return {
    body,
    flat,
    dark: new MeshStandardMaterial({ color: colors.dark, metalness: 0.6, roughness: 0.5 }),
    accent: new MeshStandardMaterial({ color: teamColor, metalness: 0.25, roughness: 0.45, emissive: teamColor, emissiveIntensity: 0.18, side: DoubleSide }),
    glass: new MeshStandardMaterial({ color: 0x0d1822, metalness: 0.95, roughness: 0.04, envMapIntensity: 1.7 }),
    intake: new MeshStandardMaterial({ color: 0x050607, roughness: 1, metalness: 0 }),
    nozzle: new MeshStandardMaterial({ color: 0x4a4440, metalness: 0.85, roughness: 0.38, side: DoubleSide }),
    heat: new MeshBasicMaterial({ color: new Color(1.6, 0.5, 0.12), toneMapped: false }),
    tyre: new MeshStandardMaterial({ color: 0x111214, roughness: 0.9 }),
    strut: new MeshStandardMaterial({ color: 0xbfc4c9, metalness: 0.8, roughness: 0.35 }),
  };
}
