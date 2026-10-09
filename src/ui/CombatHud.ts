import { PerspectiveCamera, Vector3 } from 'three';
import { clamp } from '../core/math';
import { palette as P } from './palette';

/** Everything the combat part of the HUD needs, gathered by the game once per frame. */
export interface CombatHud {
  group: number;
  groupLabel: string;
  storeName: string;
  /** Rounds / missiles / bombs left in the selected group. */
  count: number;
  groups: { short: string; count: number }[];
  gunAmmo: number;
  gunMax: number;
  flares: number;
  flaresMax: number;
  chaff: number;
  chaffMax: number;
  fuel: number;
  bingo: boolean;
  health: number;
  /** Damage silhouette: top-down rectangles per module (x right, z forward is up the screen). */
  modules: { ratio: number; gone: boolean; rects: number[][] }[];
  fire: boolean;
  leaking: boolean;
  target: {
    name: string;
    kind: 'air' | 'ground';
    pos: Vector3;
    dist: number;
    closing: number;
    health: number;
    progress: number;
    locked: boolean;
    tracking: boolean;
  } | null;
  /** World points to draw the gun lead pipper and the bomb impact point at (or null). */
  lead: Vector3 | null;
  impact: Vector3 | null;
  missiles: { bearing: number; eta: number; kind: 'ir' | 'radar' }[];
  rwr: { bearing: number; locked: boolean }[];
  feed: { text: string; age: number; mine: boolean; theirs: boolean }[];
  /** 0..1 strengths that fade out. */
  hit: number;
  kill: number;
  hurt: number;
  numbers: { pos: Vector3; text: string; age: number; kill: boolean }[];
  kills: number;
  deaths: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const _p = new Vector3();

interface Pt {
  x: number;
  y: number;
}

/** Weapon panel, target box, lead pipper, missile warning ring, RWR scope, damage silhouette, kill feed, hit markers. */
export class CombatHudLayer {
  private panel: HTMLElement;
  private wName: HTMLElement;
  private wCount: HTMLElement;
  private chips: HTMLElement[] = [];
  private gunV: HTMLElement;
  private flareV: HTMLElement;
  private chaffV: HTMLElement;
  private fuelFill: HTMLElement;
  private fuelV: HTMLElement;
  private score: HTMLElement;
  private feed: HTMLElement;
  private hurt: HTMLElement;
  private cache = new Map<HTMLElement, string>();
  private lines: HTMLElement[] = [];
  private time = 0;

  constructor(root: HTMLElement) {
    this.hurt = el('div', 'hud-hurt', root);
    this.panel = el('div', 'wpn', root);
    const top = el('div', 'wpn-top', this.panel);
    this.wName = el('span', 'wpn-name', top, '');
    this.wCount = el('b', 'wpn-count', top, '');
    const g = el('div', 'wpn-groups', this.panel);
    for (let i = 0; i < 4; i++) this.chips.push(el('span', 'wpn-chip', g, ''));
    const row = (label: string): HTMLElement => {
      const r = el('div', 'wpn-row', this.panel);
      el('span', '', r, label);
      return el('b', '', r, '');
    };
    this.gunV = row('GUN');
    this.flareV = row('FLARES');
    this.chaffV = row('CHAFF');
    const fr = el('div', 'wpn-row', this.panel);
    el('span', '', fr, 'FUEL');
    const bar = el('div', 'wpn-bar', fr);
    this.fuelFill = el('i', '', bar);
    this.fuelV = el('b', '', fr, '');
    this.score = el('div', 'hud-score', root);
    this.feed = el('div', 'feed', root);
    for (let i = 0; i < 5; i++) this.lines.push(el('div', 'feed-line', this.feed));
  }

  private set(e: HTMLElement, text: string): void {
    if (this.cache.get(e) !== text) {
      this.cache.set(e, text);
      e.textContent = text;
    }
  }

  private project(world: Vector3, cam: PerspectiveCamera, w: number, h: number, out: Pt): boolean {
    _p.copy(world).project(cam);
    out.x = (_p.x * 0.5 + 0.5) * w;
    out.y = (-_p.y * 0.5 + 0.5) * h;
    return _p.z < 1 && _p.z > -1;
  }

  update(c: CanvasRenderingContext2D, d: CombatHud | null, cam: PerspectiveCamera, w: number, h: number, dt: number, scale = 1): void {
    this.time += dt;
    if (!d) {
      this.panel.style.display = 'none';
      this.score.style.display = 'none';
      this.feed.style.display = 'none';
      this.hurt.style.opacity = '0';
      return;
    }
    this.panel.style.display = '';
    this.score.style.display = '';
    this.feed.style.display = '';

    // ---- DOM ----
    this.set(this.wName, d.storeName || d.groupLabel);
    this.set(this.wCount, d.count > 0 ? '×' + d.count : 'EMPTY');
    this.wCount.classList.toggle('empty', d.count <= 0);
    d.groups.forEach((gr, i) => {
      this.set(this.chips[i], `${i + 1} ${gr.short} ${gr.count}`);
      this.chips[i].classList.toggle('on', i === d.group);
      this.chips[i].classList.toggle('empty', gr.count <= 0);
    });
    this.set(this.gunV, String(d.gunAmmo));
    this.gunV.classList.toggle('low', d.gunAmmo < d.gunMax * 0.15);
    this.set(this.flareV, String(d.flares));
    this.flareV.classList.toggle('low', d.flares === 0);
    this.set(this.chaffV, String(d.chaff));
    this.chaffV.classList.toggle('low', d.chaff === 0);
    this.fuelFill.style.width = Math.round(d.fuel * 100) + '%';
    this.fuelFill.classList.toggle('low', d.bingo);
    this.set(this.fuelV, d.bingo ? 'BINGO' : Math.round(d.fuel * 100) + '%');
    this.fuelV.classList.toggle('low', d.bingo);
    this.set(this.score, `KILLS ${d.kills}   DEATHS ${d.deaths}`);
    d.feed.forEach((f, i) => {
      const l = this.lines[i];
      if (!l) return;
      this.set(l, f.text);
      l.style.opacity = String(clamp(1.6 - f.age / 4, 0, 1));
      l.className = 'feed-line' + (f.mine ? ' mine' : f.theirs ? ' theirs' : '');
    });
    for (let i = d.feed.length; i < this.lines.length; i++) {
      this.set(this.lines[i], '');
      this.lines[i].style.opacity = '0';
    }
    this.hurt.style.opacity = String(clamp(d.hurt, 0, 1));

    // ---- canvas ----
    c.save();
    c.shadowBlur = 3;
    this.drawTarget(c, d, cam, w, h);
    this.drawPipper(c, d, cam, w, h);
    this.drawMarkers(c, d, w, h);
    this.drawNumbers(c, d, cam, w, h);
    this.drawMissileWarning(c, d, w, h);
    this.drawRwr(c, d, w, h, scale);
    this.drawSilhouette(c, d, w, h, scale);
    c.restore();
  }

  // ---- target box, lock ring, edge arrow --------------------------------------------------------

  private drawTarget(c: CanvasRenderingContext2D, d: CombatHud, cam: PerspectiveCamera, w: number, h: number): void {
    const t = d.target;
    if (!t) return;
    const col = t.locked ? P.foeLock : P.foe;
    const pt = { x: 0, y: 0 };
    const on = this.project(t.pos, cam, w, h, pt);
    const margin = 46;
    const inside = on && pt.x > margin && pt.x < w - margin && pt.y > margin && pt.y < h - margin;
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = 1.8;
    if (!inside) {
      // arrow on the screen edge pointing toward the target
      let dx = pt.x - w / 2;
      let dy = pt.y - h / 2;
      if (!on) {
        dx = -dx;
        dy = -dy;
      }
      const ang = Math.atan2(dy, dx);
      const ex = clamp(w / 2 + Math.cos(ang) * w, margin, w - margin);
      const ey = clamp(h / 2 + Math.sin(ang) * h, margin, h - margin);
      // clamp along the ray so the arrow keeps its direction
      const k = Math.min((w / 2 - margin) / Math.max(1e-3, Math.abs(Math.cos(ang))), (h / 2 - margin) / Math.max(1e-3, Math.abs(Math.sin(ang))));
      const ax = w / 2 + Math.cos(ang) * k;
      const ay = h / 2 + Math.sin(ang) * k;
      void ex;
      void ey;
      c.save();
      c.translate(ax, ay);
      c.rotate(ang);
      c.beginPath();
      c.moveTo(14, 0);
      c.lineTo(-9, -9);
      c.lineTo(-4, 0);
      c.lineTo(-9, 9);
      c.closePath();
      c.fill();
      c.restore();
      c.font = '600 11px ui-monospace, Consolas, monospace';
      c.textAlign = 'center';
      c.fillText(this.range(t.dist), ax - Math.cos(ang) * 28, ay - Math.sin(ang) * 28);
      return;
    }
    // corner brackets
    const s = clamp(26 + 4000 / Math.max(300, t.dist), 22, 50);
    const L = s * 0.45;
    c.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      c.moveTo(pt.x + sx * s, pt.y + sy * (s - L));
      c.lineTo(pt.x + sx * s, pt.y + sy * s);
      c.lineTo(pt.x + sx * (s - L), pt.y + sy * s);
    }
    c.stroke();
    // lock ring: dashed while acquiring, a filled progress arc, solid + diamond when locked
    if (t.progress > 0 || t.locked) {
      c.lineWidth = 2.4;
      c.beginPath();
      c.arc(pt.x, pt.y, s + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (t.locked ? 1 : t.progress));
      c.stroke();
    }
    if (t.locked) {
      c.beginPath();
      c.moveTo(pt.x, pt.y - 7);
      c.lineTo(pt.x + 7, pt.y);
      c.lineTo(pt.x, pt.y + 7);
      c.lineTo(pt.x - 7, pt.y);
      c.closePath();
      c.stroke();
    } else if (t.tracking) {
      c.setLineDash([4, 4]);
      c.beginPath();
      c.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    c.font = '600 11px ui-monospace, Consolas, monospace';
    c.textAlign = 'center';
    c.fillText(`${t.name}  ${this.range(t.dist)}`, pt.x, pt.y + s + 17);
    if (t.kind === 'air') {
      c.font = '10px ui-monospace, Consolas, monospace';
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.fillText(`${t.closing >= 0 ? '▼' : '▲'} ${Math.round(Math.abs(t.closing) * 3.6)} km/h`, pt.x, pt.y + s + 30);
    }
    // health bar
    const bw = s * 1.5;
    const by = pt.y - s - 10;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(pt.x - bw / 2 - 1, by - 1, bw + 2, 6);
    c.fillStyle = t.health > 0.5 ? P.ok : t.health > 0.25 ? P.amber : P.foeLock;
    c.fillRect(pt.x - bw / 2, by, bw * clamp(t.health, 0, 1), 4);
  }

  private range(m: number): string {
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
  }

  // ---- gun lead pipper and bomb impact point -----------------------------------------------------

  private drawPipper(c: CanvasRenderingContext2D, d: CombatHud, cam: PerspectiveCamera, w: number, h: number): void {
    const pt = { x: 0, y: 0 };
    if (d.lead && this.project(d.lead, cam, w, h, pt)) {
      c.strokeStyle = P.amber;
      c.fillStyle = P.amber;
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
      c.fill();
    }
    if (d.impact && this.project(d.impact, cam, w, h, pt)) {
      c.strokeStyle = P.amber;
      c.lineWidth = 1.6;
      const s = 9;
      c.strokeRect(pt.x - s, pt.y - s, s * 2, s * 2);
      c.beginPath();
      c.moveTo(pt.x - s - 5, pt.y);
      c.lineTo(pt.x - s, pt.y);
      c.moveTo(pt.x + s, pt.y);
      c.lineTo(pt.x + s + 5, pt.y);
      c.moveTo(pt.x, pt.y - s - 5);
      c.lineTo(pt.x, pt.y - s);
      c.moveTo(pt.x, pt.y + s);
      c.lineTo(pt.x, pt.y + s + 5);
      c.stroke();
      c.font = '10px ui-monospace, Consolas, monospace';
      c.fillStyle = P.amber;
      c.textAlign = 'center';
      c.fillText('CCIP', pt.x, pt.y + s + 18);
    }
  }

  // ---- hit / kill markers and floating damage numbers ---------------------------------------------

  private drawMarkers(c: CanvasRenderingContext2D, d: CombatHud, w: number, h: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const draw = (k: number, col: string, r0: number, r1: number) => {
      if (k <= 0.02) return;
      c.strokeStyle = col;
      c.globalAlpha = clamp(k, 0, 1);
      c.lineWidth = 2.4;
      c.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        c.moveTo(cx + sx * r0, cy + sy * r0);
        c.lineTo(cx + sx * r1, cy + sy * r1);
      }
      c.stroke();
      c.globalAlpha = 1;
    };
    draw(d.hit, '#ffffff', 9, 17);
    draw(d.kill, P.foeLock, 12, 28);
  }

  private drawNumbers(c: CanvasRenderingContext2D, d: CombatHud, cam: PerspectiveCamera, w: number, h: number): void {
    if (d.numbers.length === 0) return;
    const pt = { x: 0, y: 0 };
    c.textAlign = 'center';
    for (const n of d.numbers) {
      if (!this.project(n.pos, cam, w, h, pt)) continue;
      const a = clamp(1.4 - n.age / 0.9, 0, 1);
      c.globalAlpha = a;
      c.font = (n.kill ? '700 17px' : '600 13px') + ' ui-monospace, Consolas, monospace';
      c.fillStyle = n.kill ? P.foeLock : P.amber;
      c.fillText(n.text, pt.x, pt.y - n.age * 46 - 8);
    }
    c.globalAlpha = 1;
  }

  // ---- missile warning ring ----------------------------------------------------------------------

  private drawMissileWarning(c: CanvasRenderingContext2D, d: CombatHud, w: number, h: number): void {
    if (d.missiles.length === 0) return;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.2;
    const blink = Math.floor(this.time * Math.max(2.5, 14 / Math.max(1, d.missiles[0].eta))) % 2 === 0;
    c.strokeStyle = P.foeLock;
    c.fillStyle = P.foeLock;
    c.globalAlpha = blink ? 0.95 : 0.45;
    c.lineWidth = 1.2;
    c.setLineDash([3, 7]);
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    for (const m of d.missiles.slice(0, 4)) {
      c.save();
      c.translate(cx + Math.sin(m.bearing) * R, cy - Math.cos(m.bearing) * R);
      c.rotate(m.bearing);
      c.beginPath();
      c.moveTo(0, -13);
      c.lineTo(10, 8);
      c.lineTo(0, 3);
      c.lineTo(-10, 8);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
  }

  // ---- radar warning scope -------------------------------------------------------------------------

  private drawRwr(c: CanvasRenderingContext2D, d: CombatHud, w: number, h: number, scale: number): void {
    const R = 50;
    const cx = w - Math.max(24, w * 0.04) - 258 * scale - R;
    const cy = h * 0.91 - R;
    c.save();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(6,10,14,0.45)';
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(232,242,247,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    c.moveTo(cx, cy - R);
    c.lineTo(cx, cy + R);
    c.moveTo(cx - R, cy);
    c.lineTo(cx + R, cy);
    c.stroke();
    c.fillStyle = 'rgba(232,242,247,0.8)';
    c.beginPath();
    c.moveTo(cx, cy - 6);
    c.lineTo(cx + 4, cy + 4);
    c.lineTo(cx - 4, cy + 4);
    c.closePath();
    c.fill();
    c.font = '9px ui-monospace, Consolas, monospace';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(232,242,247,0.5)';
    c.fillText('RWR', cx, cy + R + 11);
    for (const r of d.rwr) {
      const rr = R * (r.locked ? 0.62 : 0.86);
      const x = cx + Math.sin(r.bearing) * rr;
      const y = cy - Math.cos(r.bearing) * rr;
      const blink = r.locked ? Math.floor(this.time * 8) % 2 === 0 : true;
      c.fillStyle = r.locked ? P.foeLock : P.amber;
      c.globalAlpha = blink ? 1 : 0.4;
      c.beginPath();
      c.arc(x, y, r.locked ? 5 : 3.5, 0, Math.PI * 2);
      c.fill();
      if (r.locked) {
        c.strokeStyle = P.foeLock;
        c.beginPath();
        c.arc(x, y, 8, 0, Math.PI * 2);
        c.stroke();
      }
    }
    c.restore();
  }

  // ---- damage silhouette ---------------------------------------------------------------------------

  private drawSilhouette(c: CanvasRenderingContext2D, d: CombatHud, w: number, h: number, scale: number): void {
    if (d.modules.length === 0) return;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const m of d.modules) {
      for (const r of m.rects) {
        minX = Math.min(minX, r[0]);
        maxX = Math.max(maxX, r[2]);
        minZ = Math.min(minZ, r[1]);
        maxZ = Math.max(maxZ, r[3]);
      }
    }
    const bw = 104;
    const bh = 118;
    const hw = Math.max(Math.abs(minX), Math.abs(maxX));
    const k = Math.min((bw - 16) / (hw * 2), (bh - 22) / (maxZ - minZ));
    const x0 = Math.max(24, w * 0.04) + 86 * scale + bw / 2;
    const y0 = h * 0.91 - bh;
    c.save();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(6,10,14,0.4)';
    c.fillRect(x0 - bw / 2, y0, bw, bh);
    const sx = (x: number) => x0 + x * k;
    const sz = (z: number) => y0 + 8 + (z - minZ) * k;
    for (let i = d.modules.length - 1; i >= 0; i--) {
      const m = d.modules[i];
      const col = m.gone ? P.foeLock : m.ratio > 0.6 ? P.ok : m.ratio > 0.3 ? P.amber : P.foeLock;
      for (const r of m.rects) {
        const x = sx(r[0]);
        const z = sz(r[1]);
        const rw = Math.max(2, (r[2] - r[0]) * k);
        const rh = Math.max(2, (r[3] - r[1]) * k);
        if (m.gone) {
          c.setLineDash([2, 2]);
          c.strokeStyle = col;
          c.globalAlpha = 0.8;
          c.strokeRect(x, z, rw, rh);
          c.setLineDash([]);
        } else {
          c.fillStyle = col;
          c.globalAlpha = 0.28 + 0.5 * (1 - m.ratio < 0 ? 0 : m.ratio);
          c.fillRect(x, z, rw, rh);
          c.globalAlpha = 0.75;
          c.strokeStyle = col;
          c.lineWidth = 1;
          c.strokeRect(x, z, rw, rh);
        }
      }
    }
    c.globalAlpha = 1;
    c.font = '9px ui-monospace, Consolas, monospace';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(232,242,247,0.55)';
    c.fillText('DAMAGE', x0, y0 + bh + 11);
    if (d.fire || d.leaking) {
      c.font = '700 10px ui-monospace, Consolas, monospace';
      const blink = Math.floor(this.time * 4) % 2 === 0;
      if (blink) {
        c.fillStyle = d.fire ? P.foeLock : P.amber;
        c.fillText(d.fire ? 'FIRE' : 'FUEL LEAK', x0, y0 + 11);
      }
    }
    c.restore();
  }
}
