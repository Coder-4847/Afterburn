import { PerspectiveCamera, Vector3 } from 'three';
import type { SpeedUnit } from '../core/Settings';
import { DEG, RAD, clamp, smoothstep } from '../core/math';
import { CombatHudLayer, type CombatHud } from './CombatHud';

export interface HudData {
  speed: number; // m/s
  mach: number;
  altMsl: number;
  agl: number;
  throttle: number;
  power: number;
  ab: number;
  g: number;
  aoaDeg: number;
  heading: number; // rad, 0 = north
  pitch: number; // rad
  gearPos: number;
  grounded: boolean;
  stall: boolean;
  /** 0 none, 1 warning, 2 auto-recover engaged */
  pullUp: 0 | 1 | 2;
  boundaryCountdown: number | null;
  message: string | null;
  nose: Vector3;
  aim: Vector3;
  velocity: Vector3 | null;
  origin: Vector3;
  nearestStrip: { name: string; dist: number } | null;
  cameraMode: 'chase' | 'cockpit';
  visible: boolean;
  /** Sun glare: screen position (px) and strength 0..1, or null. */
  glare: { x: number; y: number; a: number } | null;
  /** 0..1 whiteout from flying inside a cloud. */
  veil: number;
  /** 0..1 speed streaks at the screen edge. */
  speedFx: number;
  /** Weapons, targeting and damage state (null = nothing to show, e.g. while dead). */
  combat: CombatHud | null;
}

export interface HudOptions {
  unit: SpeedUnit;
  ladder: boolean;
  tape: boolean;
  flightPath: boolean;
}

const COL = 'rgba(232,242,247,0.9)';
const COL_DIM = 'rgba(232,242,247,0.5)';
const ACCENT = '#5fe0ff';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const _p = new Vector3();
const _d = new Vector3();

export class Hud {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  private speedVal: HTMLElement;
  private speedUnit: HTMLElement;
  private machVal: HTMLElement;
  private altVal: HTMLElement;
  private aglVal: HTMLElement;
  private gVal: HTMLElement;
  private aoaVal: HTMLElement;
  private thrFill: HTMLElement;
  private thrVal: HTMLElement;
  private thrAb: HTMLElement;
  private gearVal: HTMLElement;
  private warn1: HTMLElement;
  private warn2: HTMLElement;
  private msg: HTMLElement;
  private strip: HTMLElement;
  private vignette: HTMLElement;
  private glare: HTMLElement;
  private veil: HTMLElement;
  private canopy: HTMLElement;
  private combat: CombatHudLayer;
  private cache = new Map<HTMLElement, string>();
  options: HudOptions = { unit: 'kmh', ladder: true, tape: true, flightPath: true };
  private time = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.vignette = el('div', 'hud-vignette', this.root);
    this.glare = el('div', 'hud-glare', this.root);
    const glow = el('i', '', this.glare);
    glow.style.cssText = 'width:70vmin;height:70vmin;background:radial-gradient(circle, rgba(255,244,214,0.55) 0%, rgba(255,226,170,0.18) 22%, rgba(255,200,140,0.05) 50%, rgba(255,200,140,0) 70%)';
    const streak = el('i', '', this.glare);
    streak.style.cssText = 'width:120vmin;height:1.6vmin;background:linear-gradient(90deg, rgba(255,235,200,0), rgba(255,240,215,0.45), rgba(255,235,200,0))';
    this.veil = el('div', 'hud-veil', this.root);
    this.canopy = el('div', 'hud-canopy', this.root);
    this.canvas = el('canvas', 'hud-canvas', this.root);
    this.ctx = this.canvas.getContext('2d')!;

    const spd = el('div', 'ro ro-speed', this.root);
    el('span', 'ro-lbl', spd, 'SPEED');
    const sv = el('div', 'ro-row', spd);
    this.speedVal = el('span', 'ro-val', sv, '0');
    this.speedUnit = el('span', 'ro-unit', sv, 'km/h');
    this.machVal = el('div', 'ro-sub', spd, 'M 0.00');
    const sm = el('div', 'ro-stats', spd);
    this.gVal = el('span', '', sm, 'G 1.0');
    this.aoaVal = el('span', '', sm, 'AoA 0°');

    const alt = el('div', 'ro ro-alt', this.root);
    el('span', 'ro-lbl', alt, 'ALTITUDE');
    const av = el('div', 'ro-row', alt);
    this.altVal = el('span', 'ro-val', av, '0');
    el('span', 'ro-unit', av, 'm');
    this.aglVal = el('div', 'ro-sub', alt, 'AGL 0 m');
    this.strip = el('div', 'ro-stats', alt, '');

    const thr = el('div', 'throttle', this.root);
    el('span', 'ro-lbl', thr, 'THR');
    const bar = el('div', 'thr-bar', thr);
    this.thrFill = el('div', 'thr-fill', bar);
    this.thrAb = el('div', 'thr-ab', bar);
    this.thrVal = el('span', 'thr-val', thr, '75');
    this.gearVal = el('span', 'gear-val', thr, 'GEAR UP');

    const warns = el('div', 'warns', this.root);
    this.warn1 = el('div', 'warn', warns);
    this.warn2 = el('div', 'warn', warns);
    this.msg = el('div', 'hud-msg', this.root);
    this.combat = new CombatHudLayer(this.root);
    this.resize();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  private set(e: HTMLElement, text: string): void {
    if (this.cache.get(e) !== text) {
      this.cache.set(e, text);
      e.textContent = text;
    }
  }

  private project(world: Vector3, cam: PerspectiveCamera, out: { x: number; y: number }): boolean {
    _p.copy(world).project(cam);
    out.x = (_p.x * 0.5 + 0.5) * this.w;
    out.y = (-_p.y * 0.5 + 0.5) * this.h;
    return _p.z < 1 && _p.z > -1;
  }

  update(d: HudData, cam: PerspectiveCamera, dt: number): void {
    this.time += dt;
    const o = this.options;
    this.setVisible(d.visible);
    if (!d.visible) return;
    if (d.glare && d.glare.a > 0.01) {
      this.glare.style.opacity = String(d.glare.a);
      this.glare.style.transform = `translate(${d.glare.x}px, ${d.glare.y}px)`;
    } else this.glare.style.opacity = '0';
    this.canopy.style.display = d.cameraMode === 'cockpit' ? 'block' : 'none';
    this.veil.style.opacity = d.veil > 0.01 ? String(Math.min(0.96, d.veil)) : '0';

    // ---- DOM readouts ----
    const spd = o.unit === 'kmh' ? d.speed * 3.6 : o.unit === 'kt' ? d.speed * 1.94384 : d.speed;
    this.set(this.speedVal, String(Math.round(spd)));
    this.set(this.speedUnit, o.unit === 'kmh' ? 'km/h' : o.unit === 'kt' ? 'kt' : 'm/s');
    this.set(this.machVal, 'M ' + d.mach.toFixed(2));
    this.set(this.altVal, String(Math.round(d.altMsl)));
    this.set(this.aglVal, 'AGL ' + Math.round(Math.max(0, d.agl)) + ' m');
    this.set(this.gVal, 'G ' + d.g.toFixed(1));
    this.set(this.aoaVal, 'AoA ' + Math.round(d.aoaDeg) + '°');
    this.set(this.strip, d.nearestStrip ? `${d.nearestStrip.name}  ${(d.nearestStrip.dist / 1000).toFixed(1)} km` : '');
    this.thrFill.style.height = Math.round(d.throttle * 100) + '%';
    this.thrAb.style.opacity = String(clamp(d.ab, 0, 1));
    this.set(this.thrVal, d.ab > 0.5 ? 'AB' : String(Math.round(d.throttle * 100)));
    this.set(this.gearVal, d.gearPos > 0.98 ? 'GEAR DOWN' : d.gearPos < 0.02 ? 'GEAR UP' : 'GEAR ···');
    this.gearVal.classList.toggle('on', d.gearPos > 0.5);

    // warnings (max two lines)
    const warns: { t: string; cls: string }[] = [];
    if (d.pullUp === 2) warns.push({ t: 'AUTO PULL-UP', cls: 'red blink' });
    else if (d.pullUp === 1) warns.push({ t: 'PULL UP', cls: 'red blink' });
    if (d.combat && d.combat.missiles.length > 0) warns.unshift({ t: 'MISSILE', cls: 'red blink' });
    else if (d.combat && d.combat.rwr.some((r) => r.locked)) warns.unshift({ t: 'LOCKED', cls: 'amber blink' });
    if (d.combat && d.combat.bingo && warns.length < 2) warns.push({ t: 'BINGO FUEL', cls: 'amber' });
    if (d.stall) warns.push({ t: 'STALL', cls: 'amber blink' });
    if (d.boundaryCountdown !== null) warns.push({ t: `RETURN TO COMBAT ZONE  ${Math.ceil(d.boundaryCountdown)}`, cls: 'amber' });
    if (!d.grounded && d.gearPos < 0.5 && d.agl < 160 && d.speed < 130 && d.nearestStrip && d.nearestStrip.dist < 3500) warns.push({ t: 'GEAR', cls: 'amber blink' });
    this.setWarn(this.warn1, warns[0]);
    this.setWarn(this.warn2, warns[1]);

    if (d.message) {
      this.set(this.msg, d.message);
      this.msg.style.opacity = '1';
    } else this.msg.style.opacity = '0';

    // G-load vignette (mild "grey-out" at high G, red tint under negative G)
    const gv = smoothstep(5.5, 10, d.g) * 0.7;
    const neg = smoothstep(-1.2, -3.5, d.g) * 0.5;
    this.vignette.style.opacity = String(Math.max(gv, neg));
    this.vignette.classList.toggle('neg', neg > gv);

    // ---- canvas ----
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 3;

    if (d.speedFx > 0.02) this.drawSpeedLines(c, d.speedFx);
    if (o.tape) this.drawTape(c, d.heading);
    if (o.ladder) this.drawLadder(c, d, cam);
    this.drawMarkers(c, d, cam);
    this.combat.update(c, d.combat, cam, this.w, this.h, dt);
  }

  private setWarn(e: HTMLElement, w?: { t: string; cls: string }): void {
    if (!w) {
      this.set(e, '');
      e.className = 'warn';
      return;
    }
    this.set(e, w.t);
    e.className = 'warn ' + w.cls;
  }

  /** Streaks racing outward from the centre, only in the periphery. Pure feel: no information. */
  private drawSpeedLines(c: CanvasRenderingContext2D, k: number): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const R = Math.hypot(cx, cy);
    c.save();
    c.shadowBlur = 0;
    c.lineWidth = 1.2;
    for (let i = 0; i < 38; i++) {
      const h1 = Math.sin(i * 127.1) * 43758.5453;
      const h2 = Math.sin(i * 311.7) * 43758.5453;
      const h3 = Math.sin(i * 74.7) * 43758.5453;
      const a = (h1 - Math.floor(h1)) * Math.PI * 2;
      const speed = 0.7 + (h2 - Math.floor(h2)) * 0.9;
      const ph = ((h3 - Math.floor(h3)) + this.time * speed * 0.9) % 1;
      const r0 = R * (0.42 + ph * 0.55);
      const len = R * (0.05 + ph * 0.12 * k);
      c.strokeStyle = `rgba(235,245,255,${0.5 * k * Math.sin(ph * Math.PI)})`;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      c.stroke();
    }
    c.restore();
  }

  private drawTape(c: CanvasRenderingContext2D, heading: number): void {
    const cx = this.w / 2;
    const top = 30;
    const span = 70;
    const width = Math.min(520, this.w * 0.42);
    const ppd = width / span;
    const hdg = ((heading * RAD) % 360 + 360) % 360;
    c.save();
    c.beginPath();
    c.rect(cx - width / 2, top - 6, width, 44);
    c.clip();
    c.strokeStyle = COL;
    c.fillStyle = COL;
    c.lineWidth = 1.3;
    c.font = '600 11px ui-monospace, "SF Mono", Consolas, monospace';
    c.textAlign = 'center';
    const start = Math.floor((hdg - span / 2) / 5) * 5;
    for (let a = start; a <= hdg + span / 2 + 5; a += 5) {
      const x = cx + (a - hdg) * ppd;
      const aa = ((a % 360) + 360) % 360;
      const major = aa % 10 === 0;
      c.globalAlpha = 1 - Math.abs(x - cx) / (width / 2) * 0.7;
      c.beginPath();
      c.moveTo(x, top + 16);
      c.lineTo(x, top + 16 + (major ? 9 : 5));
      c.stroke();
      if (major) {
        const cardinal = aa === 0 ? 'N' : aa === 90 ? 'E' : aa === 180 ? 'S' : aa === 270 ? 'W' : null;
        c.fillStyle = cardinal ? ACCENT : COL;
        c.fillText(cardinal ?? String(Math.round(aa / 10)).padStart(2, '0'), x, top + 12);
      }
    }
    c.restore();
    // caret + numeric
    c.fillStyle = ACCENT;
    c.beginPath();
    c.moveTo(cx, top + 15);
    c.lineTo(cx - 5, top + 6);
    c.lineTo(cx + 5, top + 6);
    c.closePath();
    c.fill();
    c.font = '600 13px ui-monospace, "SF Mono", Consolas, monospace';
    c.textAlign = 'center';
    c.fillStyle = COL;
    c.fillText(String(Math.round(hdg) % 360).padStart(3, '0') + '°', cx, top - 8);
  }

  /** Pitch ladder drawn as real world directions, so it stays correct in any camera. */
  private drawLadder(c: CanvasRenderingContext2D, d: HudData, cam: PerspectiveCamera): void {
    const psi = d.heading;
    const pitchDeg = d.pitch * RAD;
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const dirAt = (az: number, el: number, out: Vector3): Vector3 => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    c.font = '11px ui-monospace, "SF Mono", Consolas, monospace';
    c.textBaseline = 'middle';
    for (let p = -80; p <= 80; p += 10) {
      if (Math.abs(p - pitchDeg) > 38) continue;
      const el = p * DEG;
      const horizon = p === 0;
      const inner = horizon ? 5 : 4;
      const outer = horizon ? 22 : 11;
      const fade = 1 - Math.abs(p - pitchDeg) / 44;
      c.strokeStyle = horizon ? COL : COL_DIM;
      c.fillStyle = COL_DIM;
      c.globalAlpha = clamp(fade * 1.25, 0.15, 1);
      c.lineWidth = horizon ? 1.5 : 1.2;
      for (const side of [-1, 1]) {
        const ok1 = this.project(_d.copy(d.origin).addScaledVector(dirAt(psi + side * inner * DEG, el, _p), 1000), cam, a);
        const ok2 = this.project(_d.copy(d.origin).addScaledVector(dirAt(psi + side * outer * DEG, el, _p), 1000), cam, b);
        if (!ok1 || !ok2) continue;
        if (p < 0) c.setLineDash([7, 6]);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        c.setLineDash([]);
        if (!horizon) {
          // end tick toward the horizon, and the number
          const tick = p > 0 ? 6 : -6;
          c.beginPath();
          c.moveTo(b.x, b.y);
          c.lineTo(b.x, b.y + tick);
          c.stroke();
          c.textAlign = side < 0 ? 'right' : 'left';
          c.fillText(String(Math.abs(p)), b.x + side * 7, b.y);
        }
      }
    }
    c.globalAlpha = 1;
    c.textBaseline = 'alphabetic';
  }

  private drawMarkers(c: CanvasRenderingContext2D, d: HudData, cam: PerspectiveCamera): void {
    const pt = { x: 0, y: 0 };
    // nose / boresight
    if (this.project(_d.copy(d.origin).addScaledVector(d.nose, 1500), cam, pt)) {
      c.strokeStyle = COL;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(pt.x - 11, pt.y); c.lineTo(pt.x - 4, pt.y);
      c.moveTo(pt.x + 4, pt.y); c.lineTo(pt.x + 11, pt.y);
      c.moveTo(pt.x, pt.y - 11); c.lineTo(pt.x, pt.y - 4);
      c.stroke();
      c.beginPath();
      c.arc(pt.x, pt.y, 1.4, 0, Math.PI * 2);
      c.fillStyle = COL;
      c.fill();
    }
    // flight path marker
    if (this.options.flightPath && d.velocity && d.speed > 25 && this.project(_d.copy(d.origin).addScaledVector(d.velocity, 1500), cam, pt)) {
      c.strokeStyle = COL;
      c.lineWidth = 1.3;
      c.beginPath();
      c.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      c.moveTo(pt.x - 6, pt.y); c.lineTo(pt.x - 14, pt.y);
      c.moveTo(pt.x + 6, pt.y); c.lineTo(pt.x + 14, pt.y);
      c.moveTo(pt.x, pt.y - 6); c.lineTo(pt.x, pt.y - 11);
      c.stroke();
    }
    // mouse-aim reticle
    if (this.project(_d.copy(d.origin).addScaledVector(d.aim, 1500), cam, pt)) {
      c.strokeStyle = ACCENT;
      c.fillStyle = ACCENT;
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(pt.x, pt.y, 15, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 1.3;
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        c.moveTo(pt.x + Math.cos(a) * 15, pt.y + Math.sin(a) * 15);
        c.lineTo(pt.x + Math.cos(a) * 21, pt.y + Math.sin(a) * 21);
      }
      c.stroke();
      c.beginPath();
      c.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
      c.fill();
    }
  }
}
