import type { SpeedUnit } from '../core/Settings';
import { DEG, RAD, clamp } from '../core/math';
import type { HudData } from './Hud';
import { palette as P } from './palette';

const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';
const TAU = Math.PI * 2;
/** Dial sweep: from 7:30 clockwise through 12 to 4:30 (270 degrees). */
const A0 = 0.75 * Math.PI;
const SWEEP = 1.5 * Math.PI;

const INK = '#d9e2e9';
const DIM = 'rgba(217,226,233,0.55)';
const AMBER = '#ffb347';
const GREEN = '#6dffa8';
const RED = '#ff4d4d';
const CYAN = '#5fe0ff';

const SPEED_UNIT: Record<SpeedUnit, { k: number; label: string; step: number; label2: number }> = {
  kmh: { k: 3.6, label: 'KM/H', step: 20, label2: 100 },
  kt: { k: 1.94384, label: 'KT', step: 10, label2: 50 },
  ms: { k: 1, label: 'M/S', step: 10, label2: 50 },
};

/**
 * The cockpit view's instrument panel: canopy frame, glareshield, warning lamps and working instruments (attitude
 * indicator, airspeed, altimeter, vertical speed, compass, a radar scope and a systems display). Drawn in 2D over the
 * 3D view and fed from the same data as the HUD.
 */
export class CockpitLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private time = 0;
  private shown = false;
  /** Layout unit: panel sizes follow the shorter of the height and the (16:10 limited) width. */
  private u = 600;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cockpit-canvas';
    this.canvas.style.display = 'none';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.u = Math.min(this.h, this.w / 1.55) * 1.12;
  }

  setVisible(v: boolean): void {
    if (v === this.shown) return;
    this.shown = v;
    this.canvas.style.display = v ? '' : 'none';
  }

  update(d: HudData, unit: SpeedUnit, dt: number, reduceMotion: boolean): void {
    this.time += dt;
    const c = this.ctx;
    const { w, h, u } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.shadowBlur = 0;

    this.drawCanopy(c);
    this.drawPanel(c);

    const cx = w / 2;
    const gy = h - u * 0.145;
    // main cluster: attitude in the middle, speed and altitude either side, vertical speed and compass outboard
    this.adi(c, cx, gy, u * 0.108, d);
    this.asi(c, cx - u * 0.255, gy + u * 0.014, u * 0.083, d, unit);
    this.altimeter(c, cx + u * 0.255, gy + u * 0.014, u * 0.083, d);
    this.vsi(c, cx - u * 0.43, gy + u * 0.03, u * 0.058, d);
    this.compass(c, cx + u * 0.43, gy + u * 0.03, u * 0.058, d);
    this.lamps(c, cx, h - u * 0.298, d);
    this.radar(c, cx - u * 0.68, h - u * 0.155, u * 0.205, d);
    this.systems(c, cx + u * 0.68, h - u * 0.155, u * 0.205, d, reduceMotion);
  }

  // ---- frame ---------------------------------------------------------------------------------------

  private drawCanopy(c: CanvasRenderingContext2D): void {
    const { w, h } = this;
    c.save();
    // top bow
    let g = c.createLinearGradient(0, 0, 0, h * 0.12);
    g.addColorStop(0, 'rgba(7,9,12,0.98)');
    g.addColorStop(0.55, 'rgba(10,12,16,0.9)');
    g.addColorStop(1, 'rgba(10,12,16,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h * 0.12);
    // side rails: dark wedges leaning in toward the top, with a highlight along the inner edge
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 0 : w;
      c.beginPath();
      c.moveTo(x0, 0);
      c.lineTo(x0 - side * w * 0.115, 0);
      c.lineTo(x0 - side * w * 0.05, h * 0.5);
      c.lineTo(x0 - side * w * 0.035, h * 0.78);
      c.lineTo(x0, h * 0.8);
      c.closePath();
      g = c.createLinearGradient(x0, 0, x0 - side * w * 0.12, 0);
      g.addColorStop(0, 'rgba(8,10,13,0.97)');
      g.addColorStop(0.7, 'rgba(14,17,21,0.9)');
      g.addColorStop(1, 'rgba(14,17,21,0.0)');
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = 'rgba(120,135,150,0.35)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x0 - side * w * 0.113, 0);
      c.lineTo(x0 - side * w * 0.049, h * 0.5);
      c.lineTo(x0 - side * w * 0.034, h * 0.78);
      c.stroke();
    }
    // windscreen bow across the upper part of the view
    c.strokeStyle = 'rgba(8,10,13,0.9)';
    c.lineWidth = Math.max(3, h * 0.008);
    c.beginPath();
    c.moveTo(w * 0.115, 0);
    c.quadraticCurveTo(w * 0.5, h * 0.045, w * 0.885, 0);
    c.stroke();
    c.restore();
  }

  private drawPanel(c: CanvasRenderingContext2D): void {
    const { w, h, u } = this;
    // coaming and instrument panel: a raised centre section, sloping away to the sides
    const top = h - u * 0.32;
    c.save();
    c.beginPath();
    c.moveTo(0, h - u * 0.2);
    c.lineTo(w * 0.17, h - u * 0.235);
    c.lineTo(w * 0.5 - u * 0.62, top + u * 0.012);
    c.lineTo(w * 0.5 - u * 0.5, top);
    c.lineTo(w * 0.5 + u * 0.5, top);
    c.lineTo(w * 0.5 + u * 0.62, top + u * 0.012);
    c.lineTo(w * 0.83, h - u * 0.235);
    c.lineTo(w, h - u * 0.2);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    const g = c.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, '#20262d');
    g.addColorStop(0.08, '#14181d');
    g.addColorStop(1, '#090b0e');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = 'rgba(150,165,180,0.5)';
    c.lineWidth = 1.5;
    c.stroke();
    // a soft glare strip along the top edge
    const gl = c.createLinearGradient(0, top - u * 0.035, 0, top + u * 0.02);
    gl.addColorStop(0, 'rgba(10,12,15,0)');
    gl.addColorStop(1, 'rgba(10,12,15,0.9)');
    c.fillStyle = gl;
    c.fillRect(w * 0.5 - u * 0.5, top - u * 0.035, u, u * 0.04);
    // panel seams and screws
    c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 2;
    for (const x of [w * 0.5 - u * 0.62, w * 0.5 + u * 0.62, w * 0.5 - u * 0.345, w * 0.5 + u * 0.345]) {
      c.beginPath();
      c.moveTo(x, top);
      c.lineTo(x, h);
      c.stroke();
    }
    c.fillStyle = 'rgba(170,180,190,0.25)';
    for (let i = 0; i < 14; i++) {
      const x = w * 0.5 - u * 0.62 + i * (u * 1.24 / 13);
      c.beginPath();
      c.arc(x, top + u * 0.02, 1.8, 0, TAU);
      c.fill();
      c.beginPath();
      c.arc(x, h - u * 0.012, 1.8, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  // ---- gauge furniture -------------------------------------------------------------------------------

  private bezel(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.2, x, y, r * 1.18);
    g.addColorStop(0, '#6b7783');
    g.addColorStop(0.6, '#2c343c');
    g.addColorStop(1, '#0d1013');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r * 1.14, 0, TAU);
    c.fill();
    c.fillStyle = '#05070a';
    c.beginPath();
    c.arc(x, y, r * 1.0, 0, TAU);
    c.fill();
  }

  /** Angle on a standard 270-degree dial for a value in [min, max]. */
  private ang(v: number, min: number, max: number): number {
    return A0 + clamp((v - min) / (max - min), 0, 1) * SWEEP;
  }

  private needle(c: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, wid: number, col: string, tail = 0.18): void {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = wid;
    c.beginPath();
    c.moveTo(-len * tail, 0);
    c.lineTo(len, 0);
    c.stroke();
    c.restore();
    c.fillStyle = '#10151a';
    c.beginPath();
    c.arc(x, y, wid * 1.6, 0, TAU);
    c.fill();
  }

  private tick(c: CanvasRenderingContext2D, x: number, y: number, a: number, r0: number, r1: number): void {
    c.beginPath();
    c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    c.stroke();
  }

  private caption(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, col = DIM): void {
    c.fillStyle = col;
    c.font = `600 ${Math.max(7, Math.round(size))}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, x, y);
  }

  // ---- instruments -----------------------------------------------------------------------------------

  /** Attitude indicator: the world on a ball, a bank scale and a fixed aircraft symbol. */
  private adi(c: CanvasRenderingContext2D, x: number, y: number, r: number, d: HudData): void {
    this.bezel(c, x, y, r);
    c.save();
    c.beginPath();
    c.arc(x, y, r * 0.98, 0, TAU);
    c.clip();
    c.translate(x, y);
    c.rotate(-d.roll);
    const pxPerDeg = r / 38;
    const off = d.pitch * RAD * pxPerDeg;
    // sky and ground
    c.fillStyle = '#2f78c4';
    c.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
    c.fillStyle = '#6b4a2b';
    c.fillRect(-r * 2, off, r * 4, r * 3);
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-r * 2, off);
    c.lineTo(r * 2, off);
    c.stroke();
    // pitch ladder
    c.font = `600 ${Math.round(r * 0.17)}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#fff';
    c.lineWidth = 1.5;
    for (let p = -60; p <= 60; p += 5) {
      if (p === 0) continue;
      const yy = off - p * pxPerDeg;
      if (Math.abs(yy) > r * 1.1) continue;
      const half = p % 10 === 0 ? r * 0.34 : r * 0.17;
      c.beginPath();
      c.moveTo(-half, yy);
      c.lineTo(half, yy);
      c.stroke();
      if (p % 10 === 0) {
        c.fillText(String(Math.abs(p)), -half - r * 0.16, yy);
        c.fillText(String(Math.abs(p)), half + r * 0.16, yy);
      }
    }
    c.restore();
    // bank scale (fixed) and pointer (rolls with the horizon)
    c.save();
    c.translate(x, y);
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    for (const deg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (deg - 90) * DEG;
      const len = deg % 30 === 0 ? r * 0.12 : r * 0.07;
      c.beginPath();
      c.moveTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
      c.lineTo(Math.cos(a) * (r * 0.97 - len), Math.sin(a) * (r * 0.97 - len));
      c.stroke();
    }
    c.rotate(-d.roll);
    c.fillStyle = AMBER;
    c.beginPath();
    c.moveTo(0, -r * 0.82);
    c.lineTo(-r * 0.06, -r * 0.7);
    c.lineTo(r * 0.06, -r * 0.7);
    c.closePath();
    c.fill();
    c.restore();
    // aircraft symbol
    c.strokeStyle = AMBER;
    c.fillStyle = AMBER;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x - r * 0.62, y);
    c.lineTo(x - r * 0.2, y);
    c.lineTo(x - r * 0.2, y + r * 0.08);
    c.moveTo(x + r * 0.62, y);
    c.lineTo(x + r * 0.2, y);
    c.lineTo(x + r * 0.2, y + r * 0.08);
    c.stroke();
    c.beginPath();
    c.arc(x, y, 3, 0, TAU);
    c.fill();
    this.caption(c, 'ATT', x, y + r * 1.34, r * 0.17);
  }

  private asi(c: CanvasRenderingContext2D, x: number, y: number, r: number, d: HudData, unit: SpeedUnit): void {
    const su = SPEED_UNIT[unit];
    this.bezel(c, x, y, r);
    const top = Math.ceil((d.maxSpeed * su.k * 1.05) / 100) * 100;
    const v = d.speed * su.k;
    c.lineWidth = 1.2;
    c.font = `600 ${Math.round(r * 0.19)}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let s = 0; s <= top; s += su.step) {
      const a = this.ang(s, 0, top);
      const major = s % su.label2 === 0;
      c.strokeStyle = major ? INK : DIM;
      this.tick(c, x, y, a, r * (major ? 0.78 : 0.86), r * 0.95);
      if (major) {
        c.fillStyle = INK;
        c.fillText(String(s / (su.label2 === 100 ? 100 : 10)), x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
      }
    }
    // stall-speed arc (red band) and the never-exceed end
    const vs = d.stallSpeed * su.k;
    c.strokeStyle = RED;
    c.lineWidth = r * 0.07;
    c.beginPath();
    c.arc(x, y, r * 0.9, this.ang(0, 0, top), this.ang(vs, 0, top));
    c.stroke();
    this.needle(c, x, y, this.ang(v, 0, top), r * 0.88, Math.max(2, r * 0.045), '#fff');
    this.caption(c, su.label, x, y - r * 0.28, r * 0.16);
    this.caption(c, 'M ' + d.mach.toFixed(2), x, y + r * 0.42, r * 0.2, GREEN);
    c.fillStyle = '#000';
    c.fillRect(x - r * 0.3, y + r * 0.58, r * 0.6, r * 0.24);
    this.caption(c, String(Math.round(v)), x, y + r * 0.7, r * 0.2, '#fff');
  }

  private altimeter(c: CanvasRenderingContext2D, x: number, y: number, r: number, d: HudData): void {
    this.bezel(c, x, y, r);
    c.lineWidth = 1.2;
    c.font = `600 ${Math.round(r * 0.2)}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < 50; i++) {
      const a = -Math.PI / 2 + (i / 50) * TAU;
      const major = i % 5 === 0;
      c.strokeStyle = major ? INK : DIM;
      this.tick(c, x, y, a, r * (major ? 0.78 : 0.86), r * 0.95);
      if (major) {
        c.fillStyle = INK;
        c.fillText(String(i / 5), x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
      }
    }
    const alt = Math.max(0, d.altMsl);
    // long hand: hundreds of metres per revolution of 1000; short hand: 10 000 m per revolution
    this.needle(c, x, y, -Math.PI / 2 + ((alt % 10000) / 10000) * TAU, r * 0.5, Math.max(3, r * 0.07), '#fff', 0.1);
    this.needle(c, x, y, -Math.PI / 2 + ((alt % 1000) / 1000) * TAU, r * 0.88, Math.max(2, r * 0.045), '#fff');
    this.caption(c, 'ALT M', x, y - r * 0.3, r * 0.16);
    c.fillStyle = '#000';
    c.fillRect(x - r * 0.34, y + r * 0.5, r * 0.68, r * 0.26);
    this.caption(c, String(Math.round(alt)), x, y + r * 0.63, r * 0.2, '#fff');
    this.caption(c, 'R' + Math.round(Math.max(0, d.agl)), x, y + r * 0.9, r * 0.14, DIM);
  }

  private vsi(c: CanvasRenderingContext2D, x: number, y: number, r: number, d: HudData): void {
    this.bezel(c, x, y, r);
    // centre zero on the 9 o'clock position: +-30 m/s over 150 degrees each way
    const v = clamp(d.vs, -30, 30);
    const base = Math.PI;
    c.lineWidth = 1.2;
    c.font = `600 ${Math.round(r * 0.2)}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let s = -30; s <= 30; s += 5) {
      const a = base + (s / 30) * (150 * DEG);
      const major = s % 10 === 0;
      c.strokeStyle = major ? INK : DIM;
      this.tick(c, x, y, a, r * (major ? 0.74 : 0.84), r * 0.95);
      if (major && s !== 0) {
        c.fillStyle = INK;
        c.fillText(String(Math.abs(s)), x + Math.cos(a) * r * 0.56, y + Math.sin(a) * r * 0.56);
      }
    }
    this.needle(c, x, y, base + (v / 30) * (150 * DEG), r * 0.85, Math.max(2, r * 0.06), '#fff');
    this.caption(c, 'VS', x + r * 0.2, y - r * 0.5, r * 0.2);
    this.caption(c, 'M/S', x + r * 0.2, y + r * 0.5, r * 0.18);
  }

  private compass(c: CanvasRenderingContext2D, x: number, y: number, r: number, d: HudData): void {
    this.bezel(c, x, y, r);
    const hdg = d.heading;
    c.save();
    c.translate(x, y);
    c.rotate(-hdg);
    c.strokeStyle = INK;
    c.fillStyle = INK;
    c.lineWidth = 1.2;
    c.font = `700 ${Math.round(r * 0.26)}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 10) {
      const a = (deg - 90) * DEG;
      const major = deg % 30 === 0;
      this.tick(c, 0, 0, a, r * (major ? 0.76 : 0.86), r * 0.95);
      if (major) {
        const lbl = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg / 10);
        c.save();
        c.translate(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58);
        c.rotate(a + Math.PI / 2);
        c.fillStyle = deg === 0 ? AMBER : INK;
        c.fillText(lbl, 0, 0);
        c.restore();
      }
    }
    // the nearest strip's bearing as a cyan bug on the card
    if (d.nearestStrip) {
      c.rotate(d.nearestStrip.bearing);
      c.fillStyle = CYAN;
      c.beginPath();
      c.moveTo(0, -r * 0.97);
      c.lineTo(-r * 0.09, -r * 0.8);
      c.lineTo(r * 0.09, -r * 0.8);
      c.closePath();
      c.fill();
    }
    c.restore();
    // fixed aircraft and lubber line
    c.fillStyle = AMBER;
    c.beginPath();
    c.moveTo(x, y - r * 0.3);
    c.lineTo(x - r * 0.12, y + r * 0.16);
    c.lineTo(x, y + r * 0.08);
    c.lineTo(x + r * 0.12, y + r * 0.16);
    c.closePath();
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(x, y - r * 0.98);
    c.lineTo(x - r * 0.07, y - r * 1.1);
    c.lineTo(x + r * 0.07, y - r * 1.1);
    c.closePath();
    c.fill();
    this.caption(c, String(Math.round(((hdg * RAD) % 360 + 360) % 360)).padStart(3, '0'), x, y + r * 0.55, r * 0.22, '#fff');
  }

  // ---- warning lamps -----------------------------------------------------------------------------------

  private lamps(c: CanvasRenderingContext2D, cx: number, y: number, d: HudData): void {
    const u = this.u;
    const co = d.combat;
    const blink = Math.floor(this.time * 4) % 2 === 0;
    const gearAir = !d.grounded && d.gearPos < 0.5 && d.agl < 160 && d.speed < 130;
    const list: { t: string; on: boolean; col: string; flash?: boolean }[] = [
      { t: 'FIRE', on: !!co?.fire, col: RED, flash: true },
      { t: 'MSL', on: !!co && co.missiles.length > 0, col: RED, flash: true },
      { t: 'LOCK', on: !!co && co.rwr.some((r) => r.locked), col: AMBER, flash: true },
      { t: 'STALL', on: d.stall, col: AMBER, flash: true },
      { t: 'OVR G', on: d.g > d.gMax * 0.9, col: RED, flash: true },
      { t: 'FUEL', on: !!co && (co.bingo || co.leaking), col: AMBER },
      { t: 'GEAR', on: d.gearPos > 0.98 || gearAir, col: gearAir ? AMBER : GREEN, flash: gearAir },
      { t: 'A/B', on: d.ab > 0.5, col: AMBER },
      { t: 'DMG', on: !!co && co.health < 0.55, col: AMBER },
      { t: 'PULL', on: d.pullUp > 0, col: RED, flash: true },
    ];
    const lw = u * 0.07;
    const lh = u * 0.032;
    const gap = u * 0.008;
    const total = list.length * lw + (list.length - 1) * gap;
    let x = cx - total / 2;
    c.font = `700 ${Math.round(lh * 0.42)}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const l of list) {
      const lit = l.on && (!l.flash || blink);
      c.fillStyle = lit ? l.col : '#0d1115';
      c.fillRect(x, y, lw, lh);
      if (lit) {
        c.save();
        c.shadowColor = l.col;
        c.shadowBlur = 8;
        c.fillRect(x, y, lw, lh);
        c.restore();
      }
      c.strokeStyle = 'rgba(160,175,190,0.35)';
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, lw - 1, lh - 1);
      c.fillStyle = lit ? '#101010' : 'rgba(217,226,233,0.35)';
      c.fillText(l.t, x + lw / 2, y + lh / 2 + 0.5);
      x += lw + gap;
    }
  }

  // ---- multi-function displays -----------------------------------------------------------------------------

  private screen(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    // bezel around a square display centred at (x, y)
    c.fillStyle = '#1b2127';
    c.fillRect(x - s / 2 - 7, y - s / 2 - 7, s + 14, s + 14);
    c.strokeStyle = 'rgba(160,175,190,0.4)';
    c.lineWidth = 1.5;
    c.strokeRect(x - s / 2 - 7.5, y - s / 2 - 7.5, s + 15, s + 15);
    c.fillStyle = '#031008';
    c.fillRect(x - s / 2, y - s / 2, s, s);
    // bezel buttons
    c.fillStyle = '#0a0d10';
    for (let i = 0; i < 5; i++) {
      c.fillRect(x - s / 2 + 8 + i * (s - 16) / 4 - 6, y + s / 2 + 1, 12, 4);
    }
  }

  /** Radar scope: heading up, range rings, contacts, missile warnings. */
  private radar(c: CanvasRenderingContext2D, x: number, y: number, s: number, d: HudData): void {
    this.screen(c, x, y, s);
    const R = s / 2;
    const range = 12000;
    c.save();
    c.beginPath();
    c.rect(x - R, y - R, s, s);
    c.clip();
    c.translate(x, y + R * 0.18);
    // rings and the forward spoke
    c.strokeStyle = 'rgba(109,255,168,0.28)';
    c.lineWidth = 1;
    for (const k of [0.33, 0.66, 1]) {
      c.beginPath();
      c.arc(0, 0, R * 0.92 * k, 0, TAU);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(0, -R * 1.2);
    c.lineTo(0, R * 0.9);
    c.moveTo(-R, 0);
    c.lineTo(R, 0);
    c.stroke();
    // a slow sweep
    const sw = (this.time * 1.4) % TAU;
    const g = c.createConicGradient(sw - Math.PI / 2, 0, 0);
    g.addColorStop(0, 'rgba(109,255,168,0.0)');
    g.addColorStop(0.94, 'rgba(109,255,168,0.0)');
    g.addColorStop(1, 'rgba(109,255,168,0.22)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, R * 0.92, 0, TAU);
    c.fill();
    const hdg = d.heading;
    const sin = Math.sin(hdg);
    const cos = Math.cos(hdg);
    const k = (R * 0.92) / range;
    const co = d.combat;
    if (co) {
      for (const t of co.contacts) {
        const dx = t.pos.x - d.origin.x;
        const dz = t.pos.z - d.origin.z;
        const sx = (dx * cos + dz * sin) * k;
        const sy = -(dx * sin - dz * cos) * k;
        if (Math.hypot(sx, sy) > R * 0.96) continue;
        c.strokeStyle = t.selected ? '#fff' : P.foe;
        c.fillStyle = P.foe;
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(sx, sy - 5);
        c.lineTo(sx + 5, sy);
        c.lineTo(sx, sy + 5);
        c.lineTo(sx - 5, sy);
        c.closePath();
        c.stroke();
        if (t.selected) c.strokeRect(sx - 8, sy - 8, 16, 16);
      }
      // inbound missiles: triangles on the outer ring at their bearing
      for (const m of co.missiles) {
        const b = m.bearing;
        const mx = Math.sin(b) * R * 0.86;
        const my = -Math.cos(b) * R * 0.86;
        c.fillStyle = Math.floor(this.time * 8) % 2 === 0 ? RED : '#601010';
        c.beginPath();
        c.moveTo(mx, my - 6);
        c.lineTo(mx + 5, my + 5);
        c.lineTo(mx - 5, my + 5);
        c.closePath();
        c.fill();
      }
    }
    // own ship
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 6);
    c.lineTo(0, 3);
    c.lineTo(-5, 6);
    c.closePath();
    c.fill();
    c.restore();
    this.caption(c, 'RDR  12 KM', x, y - R + 9, 9, GREEN);
    if (co?.nearest) this.caption(c, (co.nearest.dist / 1000).toFixed(1) + ' KM', x, y + R - 9, 10, P.foe);
  }

  /** Systems page: weapons, engine, fuel, countermeasures, control positions and damage. */
  private systems(c: CanvasRenderingContext2D, x: number, y: number, s: number, d: HudData, reduceMotion: boolean): void {
    this.screen(c, x, y, s);
    const R = s / 2;
    const co = d.combat;
    const left = x - R + 8;
    const fs = Math.max(8, Math.round(s * 0.058));
    c.font = `600 ${fs}px ${MONO}`;
    c.textBaseline = 'middle';
    let ly = y - R + fs * 1.1;
    const line = (a: string, b: string, colB = GREEN): void => {
      c.textAlign = 'left';
      c.fillStyle = DIM;
      c.fillText(a, left, ly);
      c.textAlign = 'right';
      c.fillStyle = colB;
      c.fillText(b, x + R - 8, ly);
      ly += fs * 1.3;
    };
    if (co) {
      c.textAlign = 'left';
      c.fillStyle = GREEN;
      c.fillText((co.storeName || co.groupLabel).slice(0, 14).toUpperCase(), left, ly);
      c.textAlign = 'right';
      c.fillStyle = co.count > 0 ? '#fff' : RED;
      c.fillText(co.count > 0 ? 'x' + co.count : 'EMPTY', x + R - 8, ly);
      ly += fs * 1.4;
      // weapon groups
      const gw = (s - 16) / 4;
      for (let i = 0; i < 4; i++) {
        const gx = x - R + 8 + i * gw;
        const on = i === co.group;
        c.fillStyle = on ? GREEN : 'rgba(109,255,168,0.12)';
        c.fillRect(gx + 1, ly - fs * 0.6, gw - 2, fs * 1.2);
        c.fillStyle = on ? '#031008' : DIM;
        c.textAlign = 'center';
        c.fillText(`${co.groups[i].short}${co.groups[i].count}`, gx + gw / 2, ly);
      }
      ly += fs * 1.6;
      line('GUN', String(co.gunAmmo));
      line('FLR/CHF', `${co.flares}/${co.chaff}`);
      line('FUEL', Math.round(co.fuel * 100) + '%', co.bingo ? AMBER : GREEN);
    }
    // engine bars
    const bar = (label: string, v: number, col: string): void => {
      c.textAlign = 'left';
      c.fillStyle = DIM;
      c.fillText(label, left, ly);
      const bx = left + fs * 3.4;
      const bw = x + R - 8 - bx;
      c.fillStyle = 'rgba(109,255,168,0.14)';
      c.fillRect(bx, ly - fs * 0.35, bw, fs * 0.7);
      c.fillStyle = col;
      c.fillRect(bx, ly - fs * 0.35, bw * clamp(v, 0, 1), fs * 0.7);
      ly += fs * 1.3;
    };
    bar('THR', d.throttle, GREEN);
    bar('RPM', 0.6 + 0.4 * d.power, d.ab > 0.5 ? AMBER : GREEN);
    // control position: stick (pitch, roll) and rudder
    const cs = s * 0.2;
    const sx = x + R - cs / 2 - 10;
    const sy = y + R - cs / 2 - 10;
    c.strokeStyle = 'rgba(109,255,168,0.5)';
    c.lineWidth = 1;
    c.strokeRect(sx - cs / 2, sy - cs / 2, cs, cs);
    c.beginPath();
    c.moveTo(sx - cs / 2, sy);
    c.lineTo(sx + cs / 2, sy);
    c.moveTo(sx, sy - cs / 2);
    c.lineTo(sx, sy + cs / 2);
    c.stroke();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(sx + d.stick.roll * cs * 0.45, sy - d.stick.pitch * cs * 0.45, 3, 0, TAU);
    c.fill();
    c.fillStyle = CYAN;
    c.fillRect(sx - cs / 2 + (d.stick.yaw * 0.5 + 0.5) * cs - 2, sy + cs / 2 + 3, 4, 4);
    // a small damage silhouette bottom-left
    if (co && co.modules.length) {
      const mx0 = x - R + 10;
      const my0 = y + R - cs - 12;
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (const m of co.modules) {
        for (const r of m.rects) {
          minX = Math.min(minX, r[0]);
          maxX = Math.max(maxX, r[2]);
          minZ = Math.min(minZ, r[1]);
          maxZ = Math.max(maxZ, r[3]);
        }
      }
      const hw = Math.max(Math.abs(minX), Math.abs(maxX));
      const k = Math.min((cs * 0.9) / (hw * 2), (cs * 1.1) / (maxZ - minZ));
      for (let i = co.modules.length - 1; i >= 0; i--) {
        const m = co.modules[i];
        c.fillStyle = m.gone ? RED : m.ratio > 0.6 ? GREEN : m.ratio > 0.3 ? AMBER : RED;
        c.globalAlpha = m.gone ? 0.35 : 0.8;
        for (const r of m.rects) c.fillRect(mx0 + cs * 0.45 + r[0] * k, my0 + (r[1] - minZ) * k, Math.max(1.5, (r[2] - r[0]) * k), Math.max(1.5, (r[3] - r[1]) * k));
      }
      c.globalAlpha = 1;
    }
    // the signature move
    if (co) {
      c.textAlign = 'left';
      c.fillStyle = co.maneuver.state === 'ready' ? GREEN : co.maneuver.state === 'active' ? AMBER : DIM;
      c.font = `700 ${Math.max(8, Math.round(fs * 0.9))}px ${MONO}`;
      c.fillText(`${co.maneuver.name.toUpperCase().slice(0, 13)} ${co.maneuver.note}`, left, y - R + s * 0.97 - fs * 0.2 + (reduceMotion ? 0 : 0));
    }
    this.caption(c, 'SYS', x, y - R - 12, 8, DIM);
  }
}
