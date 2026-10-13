import { PerspectiveCamera, Vector3 } from 'three';
import type { SpeedUnit } from '../core/Settings';
import { DEG, RAD, clamp, smoothstep } from '../core/math';
import { CombatHudLayer, type CombatHud } from './CombatHud';
import { CockpitLayer } from './Cockpit';
import { Minimap, type MinimapData } from './Minimap';
import { palette as P } from './palette';

export interface HudData {
  speed: number; // m/s
  mach: number;
  altMsl: number;
  agl: number;
  throttle: number;
  power: number;
  ab: number;
  g: number;
  /** Structural / commanded G limit, for the over-G cue. */
  gMax: number;
  aoaDeg: number;
  /** Stall angle of attack (deg). */
  aoaStallDeg: number;
  heading: number; // rad, 0 = north
  pitch: number; // rad
  /** Bank angle (rad), + = right wing down. */
  roll: number;
  /** Vertical speed (m/s), + = climbing. */
  vs: number;
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
  /** Nearest airstrip: name, range (m) and absolute bearing (rad, 0 = north). */
  nearestStrip: { name: string; dist: number; bearing: number } | null;
  /** Touchdown limits of the current difficulty (m/s sink, m/s speed), for the landing cue. */
  landing: { sink: number; speed: number };
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
  minimap: MinimapData | null;
  /** Airframe limits for the cockpit instruments: top speed and the current stall speed (m/s). */
  maxSpeed: number;
  stallSpeed: number;
  /** Control positions, -1..1. */
  stick: { pitch: number; roll: number; yaw: number };
}

export interface HudOptions {
  /** HUD size multiplier (the DOM panels are scaled by CSS; the canvas widgets need to keep clear of them). */
  scale?: number;
  /** Thicker, darker outlines on the canvas HUD. */
  contrast?: boolean;
  /** No vignette, blinking or screen streaks. */
  reduceMotion?: boolean;
  /** 0..1 strength of the high-G grey-out (Arcade keeps it light). */
  gVignette?: number;
  unit: SpeedUnit;
  ladder: boolean;
  tape: boolean;
  flightPath: boolean;
}

const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';
/** Phosphor green, as on a real combiner glass; the high-contrast option goes to near white. */
const GREEN = '#5cffa0';
const GREEN_DIM = 'rgba(92,255,160,0.55)';
const WHITE = '#f1fff6';
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

/** Speed tape scale per unit: label step and ticks per label, visible span in units. */
const SPEED_SCALE: Record<SpeedUnit, { minor: number; major: number; span: number; k: number; label: string }> = {
  kmh: { minor: 10, major: 50, span: 260, k: 3.6, label: 'KMH' },
  kt: { minor: 5, major: 25, span: 140, k: 1.94384, label: 'KT' },
  ms: { minor: 5, major: 25, span: 72, k: 1, label: 'M/S' },
};

/**
 * The flight HUD: heading scale, speed and altitude tapes, pitch ladder, flight path marker, bank scale, G / AoA / Mach
 * readouts and landing cues, drawn the way a combiner-glass HUD is (monochrome green symbology), with the combat layer
 * (weapons, target box, pipper, RWR) on top and the minimap beside it.
 */
export class Hud {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  private warn1: HTMLElement;
  private warn2: HTMLElement;
  private msg: HTMLElement;
  private vignette: HTMLElement;
  private glare: HTMLElement;
  private veil: HTMLElement;
  private canopy: HTMLElement;
  private cockpit: CockpitLayer;
  private cockpitOn = false;
  private combat: CombatHudLayer;
  readonly minimap: Minimap;
  private cache = new Map<HTMLElement, string>();
  options: HudOptions = { unit: 'kmh', ladder: true, tape: true, flightPath: true };
  private time = 0;
  /** Symbology colour for this frame. */
  private col = GREEN;
  private colDim = GREEN_DIM;
  private s = 1;

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
    this.cockpit = new CockpitLayer(this.root);
    this.canvas = el('canvas', 'hud-canvas', this.root);
    this.ctx = this.canvas.getContext('2d')!;

    const warns = el('div', 'warns', this.root);
    this.warn1 = el('div', 'warn', warns);
    this.warn2 = el('div', 'warn', warns);
    this.msg = el('div', 'hud-msg', this.root);
    this.combat = new CombatHudLayer(this.root);
    this.minimap = new Minimap(this.root);
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
    this.minimap?.resize();
    this.cockpit?.resize();
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
    // the cockpit view gets a full instrument panel; the HUD tapes move up out of its way
    this.cockpitOn = d.cameraMode === 'cockpit';
    this.canopy.style.display = 'none';
    this.cockpit.setVisible(this.cockpitOn);
    document.body.classList.toggle('cockpit-view', this.cockpitOn);
    if (this.cockpitOn) this.cockpit.update(d, o.unit, dt, !!o.reduceMotion);
    this.veil.style.opacity = d.veil > 0.01 ? String(Math.min(0.96, d.veil)) : '0';

    // warnings (max two lines)
    const warns: { t: string; cls: string }[] = [];
    if (d.pullUp === 2) warns.push({ t: 'AUTO PULL-UP', cls: 'red blink' });
    else if (d.pullUp === 1) warns.push({ t: 'PULL UP', cls: 'red blink' });
    if (d.combat && d.combat.missiles.length > 0) warns.unshift({ t: 'MISSILE', cls: 'red blink' });
    else if (d.combat && d.combat.rwr.some((r) => r.locked)) warns.unshift({ t: 'LOCKED', cls: 'amber blink' });
    if (d.combat && d.combat.bingo && warns.length < 2) warns.push({ t: 'BINGO FUEL', cls: 'amber' });
    if (d.stall) warns.push({ t: 'STALL', cls: 'amber blink' });
    if (d.g > d.gMax * 0.97) warns.push({ t: 'OVER G', cls: 'red blink' });
    if (d.boundaryCountdown !== null) warns.push({ t: `RETURN TO COMBAT ZONE  ${Math.ceil(d.boundaryCountdown)}`, cls: 'amber' });
    if (!d.grounded && d.gearPos < 0.5 && d.agl < 160 && d.speed < 130 && d.nearestStrip && d.nearestStrip.dist < 3500) warns.push({ t: 'GEAR', cls: 'amber blink' });
    this.setWarn(this.warn1, warns[0]);
    this.setWarn(this.warn2, warns[1]);

    if (d.message) {
      this.set(this.msg, d.message);
      this.msg.style.opacity = '1';
    } else this.msg.style.opacity = '0';

    // G-load vignette (mild "grey-out" at high G, red tint under negative G)
    const gv = smoothstep(5.5, 10, d.g) * 0.7 * (o.gVignette ?? 1);
    const neg = smoothstep(-1.2, -3.5, d.g) * 0.5;
    this.vignette.style.opacity = o.reduceMotion ? '0' : String(Math.max(gv, neg));
    this.vignette.classList.toggle('neg', neg > gv);

    // ---- canvas ----
    this.col = o.contrast ? WHITE : GREEN;
    this.colDim = o.contrast ? 'rgba(241,255,246,0.72)' : GREEN_DIM;
    this.s = clamp(Math.min(this.w, this.h) / 800, 0.78, 1.7) * (o.scale ?? 1);
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.shadowColor = o.contrast ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.6)';
    c.shadowBlur = o.contrast ? 7 : 3;

    if (d.speedFx > 0.02) this.drawSpeedLines(c, d.speedFx);
    if (o.ladder) this.drawLadder(c, d, cam);
    this.drawMarkers(c, d, cam);
    if (o.tape) {
      this.drawHeading(c, d);
      this.drawSpeedTape(c, d);
      this.drawAltTape(c, d);
      this.drawBank(c, d);
      this.drawLanding(c, d);
    }
    this.combat.update(c, d.combat, cam, this.w, this.h, dt, o.scale ?? 1, this.cockpitOn);
    this.minimap.update(d.minimap, dt);
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

  private font(px: number, weight = 600): string {
    return `${weight} ${Math.round(px * this.s)}px ${MONO}`;
  }

  /** A boxed digital readout with a pointer on one side. */
  private box(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, pointer: 'left' | 'right' | 'none', col: string): void {
    const s = this.s;
    c.save();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(2,10,6,0.62)';
    c.strokeStyle = col;
    c.lineWidth = 1.5;
    c.beginPath();
    c.rect(x - w / 2, y - h / 2, w, h);
    if (pointer === 'right') {
      c.moveTo(x + w / 2, y - 6 * s);
      c.lineTo(x + w / 2 + 8 * s, y);
      c.lineTo(x + w / 2, y + 6 * s);
    } else if (pointer === 'left') {
      c.moveTo(x - w / 2, y - 6 * s);
      c.lineTo(x - w / 2 - 8 * s, y);
      c.lineTo(x - w / 2, y + 6 * s);
    }
    c.fill();
    c.stroke();
    c.restore();
    c.fillStyle = col;
    c.font = this.font(15, 700);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, x, y + 1);
    c.textBaseline = 'alphabetic';
  }

  // ---- heading scale -------------------------------------------------------------------------------

  private drawHeading(c: CanvasRenderingContext2D, d: HudData): void {
    const s = this.s;
    const cx = this.w / 2;
    const top = Math.max(34, this.h * 0.065) * (0.85 + 0.15 * s);
    const span = 60;
    const width = Math.min(560 * s, this.w * 0.46);
    const ppd = width / span;
    const hdg = ((d.heading * RAD) % 360 + 360) % 360;
    c.save();
    c.beginPath();
    c.rect(cx - width / 2, top - 4 * s, width, 36 * s);
    c.clip();
    c.strokeStyle = this.col;
    c.lineWidth = 1.3;
    c.font = this.font(11, 600);
    c.textAlign = 'center';
    const start = Math.floor((hdg - span / 2) / 5) * 5;
    for (let a = start; a <= hdg + span / 2 + 5; a += 5) {
      const x = cx + (a - hdg) * ppd;
      const aa = ((a % 360) + 360) % 360;
      const major = aa % 10 === 0;
      c.globalAlpha = 1 - (Math.abs(x - cx) / (width / 2)) * 0.6;
      c.beginPath();
      c.moveTo(x, top + 22 * s);
      c.lineTo(x, top + 22 * s - (major ? 10 : 5) * s);
      c.stroke();
      if (major) {
        const cardinal = aa === 0 ? 'N' : aa === 90 ? 'E' : aa === 180 ? 'S' : aa === 270 ? 'W' : null;
        c.fillStyle = cardinal ? ACCENT : this.col;
        c.fillText(cardinal ?? String(Math.round(aa / 10)).padStart(2, '0'), x, top + 9 * s);
      }
    }
    // the nearest strip as a marker on the scale
    if (d.nearestStrip) {
      let rel = d.nearestStrip.bearing * RAD - hdg;
      rel = ((rel + 540) % 360) - 180;
      const x = cx + clamp(rel, -span / 2 + 1, span / 2 - 1) * ppd;
      c.globalAlpha = 1;
      c.fillStyle = this.col;
      c.beginPath();
      c.moveTo(x, top + 23 * s);
      c.lineTo(x - 4 * s, top + 30 * s);
      c.lineTo(x + 4 * s, top + 30 * s);
      c.closePath();
      c.fill();
    }
    c.restore();
    // caret and the digital heading
    c.fillStyle = this.col;
    c.beginPath();
    c.moveTo(cx, top + 24 * s);
    c.lineTo(cx - 5 * s, top + 33 * s);
    c.lineTo(cx + 5 * s, top + 33 * s);
    c.closePath();
    c.fill();
    this.box(c, cx, top + 47 * s, 48 * s, 20 * s, String(Math.round(hdg) % 360).padStart(3, '0'), 'none', this.col);
  }

  // ---- speed and altitude tapes ----------------------------------------------------------------------

  private tape(
    c: CanvasRenderingContext2D, x: number, cy: number, w: number, h: number, value: number, perUnit: number,
    minor: number, major: number, side: 'left' | 'right', label: (v: number) => string, minValue = -Infinity,
  ): void {
    const s = this.s;
    c.save();
    c.beginPath();
    c.rect(side === 'left' ? x - w : x, cy - h / 2, w, h);
    c.clip();
    c.strokeStyle = this.col;
    c.fillStyle = this.col;
    c.lineWidth = 1.3;
    c.font = this.font(11, 600);
    c.textAlign = side === 'left' ? 'right' : 'left';
    c.textBaseline = 'middle';
    const half = h / 2 / perUnit;
    const v0 = Math.floor((value - half) / minor) * minor;
    for (let v = v0; v <= value + half + minor; v += minor) {
      if (v < minValue) continue;
      const y = cy - (v - value) * perUnit;
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const len = (isMajor ? 11 : 6) * s;
      const fade = 1 - Math.abs(y - cy) / (h / 2) * 0.55;
      c.globalAlpha = fade;
      c.beginPath();
      if (side === 'left') {
        c.moveTo(x, y);
        c.lineTo(x - len, y);
      } else {
        c.moveTo(x, y);
        c.lineTo(x + len, y);
      }
      c.stroke();
      if (isMajor) c.fillText(label(v), side === 'left' ? x - len - 5 * s : x + len + 5 * s, y);
    }
    c.restore();
    // the scale's spine
    c.strokeStyle = this.colDim;
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(x, cy - h / 2);
    c.lineTo(x, cy + h / 2);
    c.stroke();
    c.textBaseline = 'alphabetic';
  }

  private tapeH(): number {
    return Math.min(250 * this.s, this.h * (this.cockpitOn ? 0.26 : 0.36));
  }

  private tapeCy(): number {
    return this.h * (this.cockpitOn ? 0.39 : 0.5);
  }

  private drawSpeedTape(c: CanvasRenderingContext2D, d: HudData): void {
    const s = this.s;
    const cx = this.w / 2;
    const cy = this.tapeCy();
    const o = this.options;
    const sc = SPEED_SCALE[o.unit];
    const x = cx - Math.max(250 * s, this.w * 0.17);
    const h = this.tapeH();
    const v = d.speed * sc.k;
    this.tape(c, x, cy, 68 * s, h, v, h / sc.span, sc.minor, sc.major, 'left', (n) => String(Math.round(n)), 0);
    this.box(c, x - 40 * s, cy, 58 * s, 24 * s, String(Math.round(v)), 'right', d.stall ? P.amber : this.col);
    c.fillStyle = this.colDim;
    c.font = this.font(10, 600);
    c.textAlign = 'center';
    c.fillText(sc.label, x - 34 * s, cy - h / 2 - 8 * s);
    // Mach, G and AoA under the tape (the way a HUD stacks them)
    const gHot = d.g > d.gMax * 0.8;
    c.textAlign = 'left';
    c.font = this.font(13, 700);
    c.fillStyle = this.col;
    c.fillText('M ' + d.mach.toFixed(2), x - 66 * s, cy + h / 2 + 22 * s);
    c.fillStyle = gHot ? P.amber : this.col;
    c.fillText('G ' + d.g.toFixed(1), x - 66 * s, cy + h / 2 + 40 * s);
    c.fillStyle = Math.abs(d.aoaDeg) > d.aoaStallDeg * 0.85 ? P.amber : this.col;
    c.fillText('α ' + d.aoaDeg.toFixed(1), x - 66 * s, cy + h / 2 + 58 * s);

    // throttle column beside the tape
    const tx = x - 84 * s;
    const th = h * 0.62;
    const ty = cy + h / 2 - th;
    c.strokeStyle = this.colDim;
    c.lineWidth = 1.2;
    c.strokeRect(tx - 4 * s, ty, 8 * s, th);
    c.fillStyle = this.col;
    c.globalAlpha = 0.85;
    c.fillRect(tx - 3 * s, ty + th * (1 - clamp(d.throttle, 0, 1)), 6 * s, th * clamp(d.throttle, 0, 1));
    c.globalAlpha = 1;
    if (d.ab > 0.5) {
      c.strokeStyle = P.amber;
      c.lineWidth = 1.6;
      c.strokeRect(tx - 6 * s, ty - 2 * s, 12 * s, th + 4 * s);
    }
    c.fillStyle = d.ab > 0.5 ? P.amber : this.colDim;
    c.font = this.font(10, 700);
    c.textAlign = 'center';
    c.fillText(d.ab > 0.5 ? 'AB' : Math.round(d.throttle * 100) + '', tx, ty - 7 * s);
  }

  private drawAltTape(c: CanvasRenderingContext2D, d: HudData): void {
    const s = this.s;
    const cx = this.w / 2;
    const cy = this.tapeCy();
    const x = cx + Math.max(250 * s, this.w * 0.17);
    const h = this.tapeH();
    const span = 400;
    this.tape(c, x, cy, 74 * s, h, d.altMsl, h / span, 20, 100, 'right', (n) => String(Math.round(n)), -50);
    this.box(c, x + 44 * s, cy, 64 * s, 24 * s, String(Math.round(d.altMsl)), 'left', this.col);
    c.fillStyle = this.colDim;
    c.font = this.font(10, 600);
    c.textAlign = 'center';
    c.fillText('ALT M', x + 40 * s, cy - h / 2 - 8 * s);
    // vertical speed on a short scale, and the height above the ground
    const vs = d.vs;
    c.textAlign = 'left';
    c.font = this.font(13, 700);
    c.fillStyle = this.col;
    const agl = Math.max(0, d.agl);
    c.fillText((agl < 1500 ? 'R ' + Math.round(agl) : 'R ----'), x + 6 * s, cy + h / 2 + 22 * s);
    const vsCol = d.landing && !d.grounded && d.gearPos > 0.5 && -vs > d.landing.sink * 0.9 ? P.amber : this.col;
    c.fillStyle = vsCol;
    c.fillText('VS ' + (vs >= 0 ? '+' : '') + vs.toFixed(0), x + 6 * s, cy + h / 2 + 40 * s);
    // fuel and gear status in the same stack
    if (d.combat) {
      c.fillStyle = d.combat.bingo ? P.amber : this.col;
      c.fillText('FUEL ' + Math.round(d.combat.fuel * 100), x + 6 * s, cy + h / 2 + 58 * s);
    }
    // gear lights: three triangles, steady when down and locked
    if (d.gearPos > 0.02) {
      const blink = d.gearPos < 0.98 && Math.floor(this.time * 6) % 2 === 0;
      c.fillStyle = d.gearPos > 0.98 ? this.col : P.amber;
      c.globalAlpha = blink ? 0.3 : 1;
      for (let i = -1; i <= 1; i++) {
        const gx = x + 54 * s + i * 14 * s;
        const gy = cy + h / 2 + 18 * s;
        c.beginPath();
        c.moveTo(gx, gy + 8 * s);
        c.lineTo(gx - 5 * s, gy - 2 * s);
        c.lineTo(gx + 5 * s, gy - 2 * s);
        c.closePath();
        c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  // ---- bank scale ------------------------------------------------------------------------------------

  private drawBank(c: CanvasRenderingContext2D, d: HudData): void {
    const s = this.s;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const R = 118 * s;
    const bank = d.roll;
    const abs = Math.abs(bank) * RAD;
    c.save();
    c.translate(cx, cy);
    c.globalAlpha = clamp(0.35 + abs / 30, 0.35, 1);
    c.strokeStyle = this.col;
    c.lineWidth = 1.3;
    for (const deg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (deg - 90) * DEG;
      const len = deg % 30 === 0 ? 9 * s : 5 * s;
      c.beginPath();
      c.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      c.lineTo(Math.cos(a) * (R + len), Math.sin(a) * (R + len));
      c.stroke();
    }
    // pointer: rides the scale toward the side of the lowered wing
    const pa = (clamp(bank * RAD, -75, 75) - 90) * DEG;
    c.fillStyle = abs > 65 ? P.amber : this.col;
    c.beginPath();
    c.moveTo(Math.cos(pa) * (R - 2 * s), Math.sin(pa) * (R - 2 * s));
    c.lineTo(Math.cos(pa + 0.07) * (R - 12 * s), Math.sin(pa + 0.07) * (R - 12 * s));
    c.lineTo(Math.cos(pa - 0.07) * (R - 12 * s), Math.sin(pa - 0.07) * (R - 12 * s));
    c.closePath();
    c.fill();
    c.restore();
  }

  // ---- landing cue ------------------------------------------------------------------------------------

  /** With the gear down near a runway or deck: sink rate against the touchdown limit, and a flare prompt. */
  private drawLanding(c: CanvasRenderingContext2D, d: HudData): void {
    if (d.grounded || d.gearPos < 0.5 || !d.nearestStrip || d.nearestStrip.dist > 4500 || d.agl > 450) return;
    const s = this.s;
    const cx = this.w / 2;
    const y = this.tapeCy() + this.tapeH() / 2 + 92 * s;
    const sink = Math.max(0, -d.vs);
    const lim = d.landing.sink;
    const col = sink < lim * 0.75 ? this.col : sink < lim * 1.2 ? P.amber : P.foeLock;
    c.textAlign = 'center';
    c.font = this.font(13, 700);
    c.fillStyle = col;
    c.fillText(`SINK ${sink.toFixed(1)}`, cx - 56 * s, y);
    c.fillStyle = d.speed > d.landing.speed * 0.7 ? P.amber : this.col;
    c.fillText(`${d.nearestStrip.name.toUpperCase()}  ${(d.nearestStrip.dist / 1000).toFixed(1)}`, cx + 56 * s, y);
    if (d.agl < 30 && sink > lim * 0.55) {
      c.fillStyle = P.amber;
      c.font = this.font(18, 700);
      c.globalAlpha = Math.floor(this.time * 5) % 2 === 0 ? 1 : 0.4;
      c.fillText('FLARE', cx, y + 26 * s);
      c.globalAlpha = 1;
    }
  }

  // ---- pitch ladder -------------------------------------------------------------------------------------

  /** Pitch ladder drawn as real world directions, so it stays correct in any camera. */
  private drawLadder(c: CanvasRenderingContext2D, d: HudData, cam: PerspectiveCamera): void {
    const psi = d.heading;
    const pitchDeg = d.pitch * RAD;
    const s = this.s;
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const dirAt = (az: number, el: number, out: Vector3): Vector3 => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    c.font = this.font(11, 600);
    c.textBaseline = 'middle';
    for (let p = -90; p <= 90; p += 5) {
      if (Math.abs(p - pitchDeg) > 34) continue;
      const el = p * DEG;
      const horizon = p === 0;
      const tenth = p % 10 === 0;
      // [inner, outer] half-angles (deg of azimuth) of the bar
      const inner = horizon ? 6 : 3.2;
      const outer = horizon ? 26 : tenth ? 10 : 6.2;
      const fade = 1 - Math.abs(p - pitchDeg) / 40;
      c.strokeStyle = horizon ? this.col : this.colDim;
      c.fillStyle = this.colDim;
      c.globalAlpha = clamp(fade * 1.3, 0.12, 1);
      c.lineWidth = horizon ? 1.8 : 1.3;
      for (const side of [-1, 1]) {
        const ok1 = this.project(_d.copy(d.origin).addScaledVector(dirAt(psi + side * inner * DEG, el, _p), 1000), cam, a);
        const ok2 = this.project(_d.copy(d.origin).addScaledVector(dirAt(psi + side * outer * DEG, el, _p), 1000), cam, b);
        if (!ok1 || !ok2) continue;
        if (p < 0) c.setLineDash([6 * s, 5 * s]);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        c.setLineDash([]);
        if (!horizon && tenth) {
          // end tick toward the horizon, and the number
          const tick = (p > 0 ? 6 : -6) * s;
          c.beginPath();
          c.moveTo(b.x, b.y);
          c.lineTo(b.x, b.y + tick);
          c.stroke();
          c.textAlign = side < 0 ? 'right' : 'left';
          c.fillText(String(Math.abs(p)), b.x + side * 8 * s, b.y);
        } else if (horizon) {
          c.beginPath();
          c.moveTo(b.x, b.y);
          c.lineTo(b.x, b.y + 7 * s);
          c.stroke();
        }
      }
    }
    c.globalAlpha = 1;
    c.textBaseline = 'alphabetic';
  }

  // ---- boresight, flight path marker, aim reticle ----------------------------------------------------------

  private drawMarkers(c: CanvasRenderingContext2D, d: HudData, cam: PerspectiveCamera): void {
    const s = this.s;
    const pt = { x: 0, y: 0 };
    // waterline: the nose of the aircraft (a small W with a centre dot, as on the real glass)
    let noseOk = false;
    const nosePt = { x: 0, y: 0 };
    if (this.project(_d.copy(d.origin).addScaledVector(d.nose, 1500), cam, nosePt)) {
      noseOk = true;
      c.strokeStyle = this.col;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(nosePt.x - 15 * s, nosePt.y);
      c.lineTo(nosePt.x - 6 * s, nosePt.y);
      c.lineTo(nosePt.x - 3 * s, nosePt.y + 4 * s);
      c.moveTo(nosePt.x + 15 * s, nosePt.y);
      c.lineTo(nosePt.x + 6 * s, nosePt.y);
      c.lineTo(nosePt.x + 3 * s, nosePt.y + 4 * s);
      c.stroke();
      c.beginPath();
      c.arc(nosePt.x, nosePt.y, 1.5 * s, 0, Math.PI * 2);
      c.fillStyle = this.col;
      c.fill();
    }
    // flight path marker: circle, wings and fin (it lies on the horizon when you fly level)
    if (this.options.flightPath && d.velocity && d.speed > 25 && this.project(_d.copy(d.origin).addScaledVector(d.velocity, 1500), cam, pt)) {
      c.strokeStyle = this.col;
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(pt.x, pt.y, 6.5 * s, 0, Math.PI * 2);
      c.moveTo(pt.x - 6.5 * s, pt.y);
      c.lineTo(pt.x - 17 * s, pt.y);
      c.moveTo(pt.x + 6.5 * s, pt.y);
      c.lineTo(pt.x + 17 * s, pt.y);
      c.moveTo(pt.x, pt.y - 6.5 * s);
      c.lineTo(pt.x, pt.y - 13 * s);
      c.stroke();
      // AoA bracket: on approach (gear down) it sits at the FPM's height when the angle of attack is on speed
      if (d.gearPos > 0.5 && !d.grounded) {
        const pxPerDeg = this.h / Math.max(20, cam.fov);
        const on = 8.5;
        const by = pt.y + (on - d.aoaDeg) * pxPerDeg * 0.9;
        const ok = Math.abs(d.aoaDeg - on) < 1.2;
        c.strokeStyle = ok ? this.col : P.amber;
        c.lineWidth = 1.8;
        const bx = pt.x - 34 * s;
        c.beginPath();
        c.moveTo(bx + 8 * s, by - 8 * s);
        c.lineTo(bx, by - 8 * s);
        c.lineTo(bx, by + 8 * s);
        c.lineTo(bx + 8 * s, by + 8 * s);
        c.stroke();
        c.beginPath();
        c.moveTo(pt.x - 24 * s, pt.y);
        c.lineTo(bx + 8 * s, pt.y);
        c.setLineDash([2 * s, 3 * s]);
        c.stroke();
        c.setLineDash([]);
      }
    }
    void noseOk;
    // mouse-aim reticle: where the nose is being steered
    if (this.project(_d.copy(d.origin).addScaledVector(d.aim, 1500), cam, pt)) {
      c.strokeStyle = ACCENT;
      c.fillStyle = ACCENT;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(pt.x, pt.y, 15 * s, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 1.3;
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        c.moveTo(pt.x + Math.cos(a) * 15 * s, pt.y + Math.sin(a) * 15 * s);
        c.lineTo(pt.x + Math.cos(a) * 21 * s, pt.y + Math.sin(a) * 21 * s);
      }
      c.stroke();
      c.beginPath();
      c.arc(pt.x, pt.y, 2 * s, 0, Math.PI * 2);
      c.fill();
    }
  }
}
