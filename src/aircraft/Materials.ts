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
 * Painted skin: base colour with optional camouflage blotches and an airframe panel layout: brick-pattern skin panels with
 * individual tone shifts, grooves, rivet rows, access hatches, vent slots and flow streaks. A matching bump map makes the
 * grooves catch the light. Cached per colour scheme. Both axes are in metres (one tile is SKIN_TILE metres).
 */
function skinTextures(colors: ModelSpec['colors'], seed: number): SkinTextures {
  const key = `${colors.body}-${colors.camo ?? 0}-${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const S = 1024;
  const px = S / SKIN_TILE; // pixels per metre
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
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 40 + rnd() * 110;
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          const grad = g.createRadialGradient(x + ox, y + oy, r * 0.25, x + ox, y + oy, r);
          grad.addColorStop(0, rgba(colors.camo, 0.9));
          grad.addColorStop(0.75, rgba(colors.camo, 0.7));
          grad.addColorStop(1, rgba(colors.camo, 0));
          g.fillStyle = grad;
          g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
  }

  // skin panels in a brick pattern: rows of irregular height, each row's joints offset from the last
  const rows: { y0: number; y1: number; xs: number[] }[] = [];
  let y = 0;
  while (y < S - 4) {
    const hgt = Math.min(S - y, (0.55 + rnd() * 0.75) * px);
    const xs: number[] = [];
    let x = -rnd() * 0.9 * px;
    while (x < S) {
      xs.push(x);
      x += (0.65 + rnd() * 1.1) * px;
    }
    xs.push(x);
    rows.push({ y0: y, y1: y + hgt, xs });
    y += hgt;
  }
  const lines: [number, number, number, number][] = [];
  for (const r of rows) {
    for (let i = 0; i < r.xs.length - 1; i++) {
      const x0 = r.xs[i];
      const x1 = r.xs[i + 1];
      // individual tone shift per panel
      const v = (rnd() - 0.5) * 0.09;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v * 1.4})`;
      for (const ox of [-S, 0, S]) g.fillRect(x0 + ox, r.y0, x1 - x0, r.y1 - r.y0);
      for (const ox of [-S, 0, S]) lines.push([x0 + ox, r.y0, x0 + ox, r.y1]);
    }
    lines.push([0, r.y0, S, r.y0]);
  }
  for (const [x0, y0, x1, y1] of lines) {
    g.strokeStyle = 'rgba(8,10,14,0.3)';
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x0 + 2, y0 + 2); g.lineTo(x1 + 2, y1 + 2); g.stroke();
    h.strokeStyle = '#262626';
    h.lineWidth = 1.6;
    h.beginPath(); h.moveTo(x0 / 2, y0 / 2); h.lineTo(x1 / 2, y1 / 2); h.stroke();
    // rivets along the joint
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(len / 9);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const rx = x0 + (x1 - x0) * t + (y1 === y0 ? 0 : 5);
      const ry = y0 + (y1 - y0) * t + (x1 === x0 ? 0 : 5);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(rx, ry, 1.6, 1.6);
      h.fillStyle = '#c0c0c0';
      h.fillRect(rx / 2, ry / 2, 1.2, 1.2);
    }
  }
  // access hatches (rounded, with fasteners), vent slots and stencil dashes
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S;
    const yy = rnd() * S;
    const w = (0.18 + rnd() * 0.4) * px;
    const hh = (0.12 + rnd() * 0.25) * px;
    g.strokeStyle = 'rgba(8,10,14,0.42)';
    g.lineWidth = 1.8;
    g.beginPath();
    g.roundRect(x, yy, w, hh, 4);
    g.stroke();
    h.strokeStyle = '#2e2e2e';
    h.lineWidth = 1.4;
    h.beginPath();
    h.roundRect(x / 2, yy / 2, w / 2, hh / 2, 2);
    h.stroke();
    for (const [fx, fy] of [[x + 4, yy + 4], [x + w - 4, yy + 4], [x + 4, yy + hh - 4], [x + w - 4, yy + hh - 4]]) {
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(fx - 1, fy - 1, 2.4, 2.4);
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S;
    const yy = rnd() * S;
    const n = 4 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      g.fillStyle = 'rgba(10,12,16,0.5)';
      g.fillRect(x, yy + k * 5, 26 + rnd() * 8, 1.6);
      h.fillStyle = '#303030';
      h.fillRect(x / 2, (yy + k * 5) / 2, 13, 1);
    }
  }
  for (let i = 0; i < 16; i++) {
    const x = rnd() * S;
    const yy = rnd() * S;
    g.fillStyle = 'rgba(240,240,240,0.5)';
    for (let k = 0; k < 3 + Math.floor(rnd() * 3); k++) g.fillRect(x + k * 7, yy, 4, 1.5);
  }
  // weathering: oily flow streaks along the airflow (the v axis)
  for (let i = 0; i < 50; i++) {
    const x = rnd() * S;
    const yy = rnd() * S;
    const len = 60 + rnd() * 200;
    const grad = g.createLinearGradient(x, yy, x + 3, yy + len);
    grad.addColorStop(0, 'rgba(20,18,16,0.0)');
    grad.addColorStop(0.2, 'rgba(20,18,16,0.10)');
    grad.addColorStop(1, 'rgba(20,18,16,0)');
    g.fillStyle = grad;
    g.fillRect(x, yy, 3 + rnd() * 5, len);
  }
  // fine mottling
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? 0 : 255},${rnd() < 0.5 ? 0 : 255},${rnd() < 0.5 ? 0 : 255},${0.01 + rnd() * 0.02})`;
    g.fillRect(rnd() * S, rnd() * S, 3 + rnd() * 20, 2 + rnd() * 6);
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
  /** National markings (vertex coloured, drawn slightly proud of the skin). */
  decal: MeshStandardMaterial;
}

export function makeJetMaterials(colors: ModelSpec['colors'], teamColor: number, seed: number): JetMaterials {
  const skin = skinTextures(colors, seed);
  const body = new MeshStandardMaterial({
    color: 0xffffff, map: skin.map, bumpMap: skin.bump, bumpScale: 1.1, metalness: 0.22, roughness: 0.5, vertexColors: true,
  });
  const flat = body.clone();
  flat.side = DoubleSide;
  return {
    body,
    flat,
    dark: new MeshStandardMaterial({ color: colors.dark, metalness: 0.3, roughness: 0.55, vertexColors: true }),
    accent: new MeshStandardMaterial({
      color: teamColor, metalness: 0.25, roughness: 0.45, emissive: teamColor, emissiveIntensity: 0.18, side: DoubleSide, vertexColors: true,
    }),
    glass: new MeshStandardMaterial({ color: 0x5a7c98, metalness: 0.85, roughness: 0.06, envMapIntensity: 1.7, transparent: true, opacity: 0.42, depthWrite: false }),
    intake: new MeshStandardMaterial({ color: 0x050607, roughness: 1, metalness: 0 }),
    nozzle: new MeshStandardMaterial({ color: 0x4a4440, metalness: 0.85, roughness: 0.38, side: DoubleSide }),
    heat: new MeshBasicMaterial({ color: new Color(1.6, 0.5, 0.12), toneMapped: false }),
    tyre: new MeshStandardMaterial({ color: 0x111214, roughness: 0.9 }),
    strut: new MeshStandardMaterial({ color: 0xbfc4c9, metalness: 0.8, roughness: 0.35, vertexColors: true }),
    decal: new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
}
