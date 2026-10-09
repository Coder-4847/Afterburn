import type { MapDef } from '../data/maps/types';
import { DEG, clamp } from '../core/math';
import type { Heightmap } from '../world/Heightmap';
import { palette as P } from './palette';

export interface Contact {
  x: number;
  z: number;
  team: 'blue' | 'red';
  kind: 'air' | 'ground' | 'missile';
  /** Heading in radians (0 = north, clockwise) for aircraft. */
  heading: number;
  /** The player's selected target. */
  selected: boolean;
}

export interface MinimapData {
  x: number;
  z: number;
  /** Radians, 0 = north, clockwise. */
  heading: number;
  contacts: Contact[];
}

const SMALL = 176;
const BIG = 560;
const BASE = 512;
/** Metres from the player to the edge of the small map. */
const RANGE = 6500;
/** Enemy aircraft farther than this from the player are not shown (the radar horizon). */
const DETECT = 16000;

const hex = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/**
 * Two views of the same terrain picture: a small heading-up radar in the corner and a full north-up map (M).
 * The terrain is baked once per map into a 512x512 canvas (water depth, ground colour, hillshade, airstrips, boundary).
 */
export class Minimap {
  private small: HTMLCanvasElement;
  private big: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private bctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private map: MapDef | null = null;
  private dpr = 1;
  /** Full map open? */
  open = false;
  enabled = true;
  private time = 0;

  constructor(root: HTMLElement) {
    this.small = document.createElement('canvas');
    this.small.className = 'minimap';
    this.big = document.createElement('canvas');
    this.big.className = 'mapfull';
    root.append(this.small, this.big);
    this.sctx = this.small.getContext('2d')!;
    this.bctx = this.big.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const set = (c: HTMLCanvasElement, px: number) => {
      c.width = Math.round(px * this.dpr);
      c.height = Math.round(px * this.dpr);
      c.style.width = px + 'px';
      c.style.height = px + 'px';
    };
    set(this.small, SMALL);
    const big = Math.min(BIG, Math.floor(Math.min(window.innerWidth, window.innerHeight) - 90));
    set(this.big, big);
  }

  /** Bake the terrain picture for a map. */
  setMap(map: MapDef, hm: Heightmap): void {
    this.map = map;
    const c = document.createElement('canvas');
    c.width = c.height = BASE;
    const g = c.getContext('2d')!;
    const img = g.createImageData(BASE, BASE);
    const p = map.palette;
    const base = hex(p.base);
    const sand = hex(p.sand);
    const rock = hex(p.rock);
    const snow = hex(p.snow);
    const shallow = hex(map.water.shallow);
    const deep = hex(map.water.deep);
    const noSea = !!map.groundPlane;
    const cell = map.size / (BASE - 1);
    const h = (i: number, j: number) => hm.sample(-hm.half + clamp(i, 0, BASE - 1) * cell, -hm.half + clamp(j, 0, BASE - 1) * cell);
    for (let j = 0; j < BASE; j++) {
      for (let i = 0; i < BASE; i++) {
        const y = h(i, j);
        const gx = (h(i + 1, j) - h(i - 1, j)) / (2 * cell);
        const gz = (h(i, j + 1) - h(i, j - 1)) / (2 * cell);
        const slope = Math.min(1, Math.hypot(gx, gz) * 1.6);
        // hillshade: light from the north-west
        const shade = clamp(0.82 + (-gx * 0.62 - gz * 0.62) * 2.4, 0.5, 1.3);
        let r: number, gg: number, b: number;
        if (!noSea && y <= map.seaLevel + 0.01) {
          const t = clamp((map.seaLevel - y) / (map.water.clarity * 1.4), 0, 1);
          r = shallow[0] + (deep[0] - shallow[0]) * t;
          gg = shallow[1] + (deep[1] - shallow[1]) * t;
          b = shallow[2] + (deep[2] - shallow[2]) * t;
        } else {
          let col = y < p.sandTop ? sand : base;
          if (y > p.sandTop && y < p.sandTop + 25) {
            const t = (y - p.sandTop) / 25;
            col = [sand[0] + (base[0] - sand[0]) * t, sand[1] + (base[1] - sand[1]) * t, sand[2] + (base[2] - sand[2]) * t];
          }
          const rk = clamp((slope - 0.35) / 0.3, 0, 1);
          let out: [number, number, number] = [col[0] + (rock[0] - col[0]) * rk, col[1] + (rock[1] - col[1]) * rk, col[2] + (rock[2] - col[2]) * rk];
          if (y > p.snowLine) {
            const t = clamp((y - p.snowLine) / 120, 0, 1) * (1 - rk * 0.5);
            out = [out[0] + (snow[0] - out[0]) * t, out[1] + (snow[1] - out[1]) * t, out[2] + (snow[2] - out[2]) * t];
          }
          r = out[0] * shade;
          gg = out[1] * shade;
          b = out[2] * shade;
        }
        const k = (j * BASE + i) * 4;
        img.data[k] = r;
        img.data[k + 1] = gg;
        img.data[k + 2] = b;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // airstrips and the edge of the combat zone
    const px = BASE / map.size;
    g.save();
    g.translate(BASE / 2, BASE / 2);
    for (const a of map.airstrips) {
      g.save();
      g.translate(a.x * px, a.z * px);
      g.rotate((a.heading - 90) * DEG);
      g.fillStyle = a.team === 'blue' ? P.blue : P.red;
      g.fillRect(-a.length * px * 0.5, -1.4, a.length * px, 2.8);
      g.restore();
    }
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.setLineDash([6, 6]);
    g.lineWidth = 1.2;
    const bd = map.boundary * px;
    g.strokeRect(-bd, -bd, bd * 2, bd * 2);
    g.restore();
    this.base = c;
  }

  toggleOpen(): void {
    this.open = !this.open;
  }

  update(d: MinimapData | null, dt: number): void {
    this.time += dt;
    const showSmall = !!d && this.enabled && !!this.base;
    this.small.style.display = showSmall ? '' : 'none';
    this.big.style.display = d && this.open && this.base ? 'block' : 'none';
    if (!d || !this.base || !this.map) return;
    if (showSmall) this.drawSmall(d);
    if (this.open) this.drawBig(d);
  }

  private visibleContacts(d: MinimapData): Contact[] {
    return d.contacts.filter((c) => {
      if (c.team === 'blue') return true;
      if (c.kind === 'ground') return Math.hypot(c.x - d.x, c.z - d.z) < DETECT * 0.8;
      return Math.hypot(c.x - d.x, c.z - d.z) < DETECT;
    });
  }

  private drawContact(g: CanvasRenderingContext2D, c: Contact, rot: number, size: number): void {
    g.save();
    g.translate(c.x, c.z);
    g.rotate(rot);
    const col = c.team === 'blue' ? P.blue : P.red;
    g.fillStyle = col;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = size * 0.22;
    if (c.kind === 'air') {
      g.rotate(c.heading);
      g.beginPath();
      g.moveTo(0, -size * 1.1);
      g.lineTo(size * 0.8, size * 0.8);
      g.lineTo(0, size * 0.35);
      g.lineTo(-size * 0.8, size * 0.8);
      g.closePath();
      g.stroke();
      g.fill();
    } else if (c.kind === 'ground') {
      g.fillRect(-size * 0.6, -size * 0.6, size * 1.2, size * 1.2);
      g.strokeRect(-size * 0.6, -size * 0.6, size * 1.2, size * 1.2);
    } else {
      g.fillStyle = Math.floor(this.time * 6) % 2 === 0 ? '#ffffff' : P.red;
      g.beginPath();
      g.arc(0, 0, size * 0.4, 0, Math.PI * 2);
      g.fill();
    }
    if (c.selected) {
      g.strokeStyle = '#ffd24d';
      g.lineWidth = size * 0.25;
      g.beginPath();
      g.arc(0, 0, size * 1.6, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  private drawSmall(d: MinimapData): void {
    const g = this.sctx;
    const map = this.map!;
    const s = SMALL / 2 / RANGE; // px per metre
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, SMALL, SMALL);
    g.save();
    g.beginPath();
    g.arc(SMALL / 2, SMALL / 2, SMALL / 2 - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#0b1218';
    g.fillRect(0, 0, SMALL, SMALL);
    g.translate(SMALL / 2, SMALL / 2);
    g.rotate(-d.heading);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base!, (-map.size / 2 - d.x) * s, (-map.size / 2 - d.z) * s, map.size * s, map.size * s);
    // contacts, drawn in the rotated frame; icons counter-rotate so they stay upright where it matters
    for (const c of this.visibleContacts(d)) {
      const dx = (c.x - d.x) * s;
      const dz = (c.z - d.z) * s;
      if (Math.hypot(dx, dz) > SMALL / 2 + 6) continue;
      this.drawContact(g, { ...c, x: dx, z: dz }, 0, 5.5);
    }
    g.restore();
    // range rings, player, north tick
    g.save();
    g.translate(SMALL / 2, SMALL / 2);
    g.strokeStyle = 'rgba(232,242,247,0.25)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, SMALL / 2 - 1, 0, Math.PI * 2);
    g.arc(0, 0, SMALL / 4, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5, 6);
    g.closePath();
    g.stroke();
    g.fill();
    g.rotate(-d.heading);
    g.fillStyle = '#5fe0ff';
    g.font = '600 10px ui-monospace, Consolas, monospace';
    g.textAlign = 'center';
    g.fillText('N', 0, -(SMALL / 2 - 12));
    g.restore();
  }

  private drawBig(d: MinimapData): void {
    const g = this.bctx;
    const map = this.map!;
    const W = this.big.width / this.dpr;
    const s = W / map.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, W);
    g.drawImage(this.base!, 0, 0, W, W);
    g.save();
    g.translate(W / 2, W / 2);
    // detection radius around the player
    g.strokeStyle = 'rgba(232,242,247,0.22)';
    g.setLineDash([4, 6]);
    g.beginPath();
    g.arc(d.x * s, d.z * s, DETECT * s, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    for (const c of this.visibleContacts(d)) this.drawContact(g, { ...c, x: c.x * s, z: c.z * s }, 0, 6);
    // the player
    g.translate(d.x * s, d.z * s);
    g.rotate(d.heading);
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, W - 1);
    g.font = '600 11px ui-monospace, Consolas, monospace';
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.shadowColor = '#000';
    g.shadowBlur = 3;
    g.fillText(`${map.name.toUpperCase()}   ·   M TO CLOSE`, 10, 18);
    g.shadowBlur = 0;
  }
}
