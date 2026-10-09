import { Vector3 } from 'three';
import type { AircraftDef } from '../aircraft/AircraftDef';
import { secAt } from '../aircraft/ProceduralJet';
import type { FlightMods } from '../flight/FlightModel';
import { clamp } from '../core/math';

export type ModuleKind = 'fuselage' | 'cockpit' | 'engine' | 'fuel' | 'wingL' | 'wingR' | 'tail';

export interface Box {
  min: Vector3;
  max: Vector3;
}

export interface Module {
  id: string;
  kind: ModuleKind;
  label: string;
  hp: number;
  max: number;
  boxes: Box[];
  /** Local-space centre (effects, blast distance). */
  center: Vector3;
  /** Lower number wins when a shot enters two boxes at once. */
  priority: number;
  /** How much of a blast's energy this module takes. */
  blastWeight: number;
  /** Wing / tail has been ripped off. */
  gone: boolean;
}

/** Things that happened because of damage; the combat layer turns them into smoke, fire, debris and messages. */
export type DamageEvent =
  | { type: 'rip'; part: 'wingL' | 'wingR' | 'tail' }
  | { type: 'engine-fire'; engine: number }
  | { type: 'leak' }
  | { type: 'fire' }
  | { type: 'extinguished' }
  | { type: 'pilot-killed' }
  | { type: 'destroyed'; reason: string };

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({
  min: new Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
  max: new Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
});

/**
 * War Thunder-style module damage. Each module has its own hit points and simplified hit boxes; what breaks
 * changes how the aircraft flies: wings (lift, roll drift), tail (pitch/yaw authority, wobble), engines (thrust,
 * smoke, fire), fuel tanks (leaks and fires), cockpit (pilot kill). Fires burn the structure unless put out
 * by speed.
 */
export class DamageModel {
  modules: Module[] = [];
  /** 0..1 fire intensity. */
  fire = 0;
  leaking = false;
  pilotAlive = true;
  dead = false;
  deathReason = '';
  /** Fuel level 0..1 (leaks drain it faster). */
  fuel = 1;
  private extinguishTimer = 0;
  private rng: () => number;

  constructor(readonly def: AircraftDef, rng: () => number = Math.random) {
    this.rng = rng;
    this.build();
  }

  private build(): void {
    const m = this.def.model;
    const L = m.length;
    const hp = this.def.hp;
    const zAt = (f: number) => -L / 2 + f * L;
    const wide = m.sections.reduce((a, s) => Math.max(a, s[1]), 0);
    const high = m.sections.reduce((a, s) => Math.max(a, s[3] + s[2]), 0);
    const low = m.sections.reduce((a, s) => Math.min(a, s[3] - s[2]), 0);
    const add = (id: string, kind: ModuleKind, label: string, frac: number, boxes: Box[], priority: number, blastWeight: number): void => {
      const c = new Vector3();
      for (const b of boxes) c.add(b.min).add(b.max);
      c.multiplyScalar(0.5 / boxes.length);
      this.modules.push({ id, kind, label, hp: hp * frac, max: hp * frac, boxes, center: c, priority, blastWeight, gone: false });
    };

    // cockpit
    const cz = zAt(m.canopyZ);
    const clen = (m.canopyLen ?? 2) * 0.8;
    const sec = secAt(m, m.canopyZ);
    add('cockpit', 'cockpit', 'Cockpit', 0.28, [box(-0.6, sec.yc + sec.hh - 0.7, cz - 0.3, 0.6, sec.yc + sec.hh + 0.55, cz + clen * 1.3)], 0, 0.4);

    // engines at the tail
    const ex = m.engines === 1 ? [0] : [-(m.engineSpacing ?? 0.7), m.engineSpacing ?? 0.7];
    const tail = m.sections[m.sections.length - 1];
    ex.forEach((x, i) => {
      const r = m.nozzleRadius * 1.15;
      add(`engine${i}`, 'engine', m.engines === 1 ? 'Engine' : `Engine ${i + 1}`, m.engines === 1 ? 0.5 : 0.4, [box(x - r, tail[3] - r, zAt(0.62), x + r, tail[3] + r, L / 2 + 0.4)], 1, 0.9);
    });

    // fuel tanks behind the cockpit
    const fsec = secAt(m, 0.5);
    add('fuel', 'fuel', 'Fuel tanks', 0.42, [box(-fsec.hw * 0.7, fsec.yc - fsec.hh * 0.3, zAt(0.4), fsec.hw * 0.7, fsec.yc + fsec.hh * 0.95, zAt(0.62))], 2, 0.8);

    // wings
    const w = m.wing;
    const z0 = zAt(w.zRoot);
    const xr = secAt(m, w.zRoot + 0.08).hw * 0.8;
    const half = w.span / 2 - xr;
    for (const s of [-1, 1]) {
      const id = s < 0 ? 'wingL' : 'wingR';
      add(id, id as ModuleKind, s < 0 ? 'Left wing' : 'Right wing', 0.6, [box(s * (xr * 0.9), w.y - 0.35, z0 - 0.2, s * (xr + half), w.y + 0.35 + half * w.dihedral, z0 + w.sweep + w.tipChord + 0.2)], 3, 0.6);
    }

    // tail: tailplanes and fins
    const bs: Box[] = [];
    if (m.hstab) {
      const h = m.hstab;
      const hz = zAt(h.zRoot);
      bs.push(box(-h.span / 2, h.y - 0.3, hz, h.span / 2, h.y + 0.3, hz + h.sweep + h.tipChord));
    }
    for (const f of m.fins) {
      if (f.height < 0) continue;
      const fz = zAt(f.zRoot);
      for (const s of f.x === 0 ? [0] : [-1, 1]) {
        const x = s * f.x;
        bs.push(box(x - 0.35 - f.cant * f.height * 0.5, high - 0.3, fz, x + 0.35 + f.cant * f.height * 0.5, high + f.height, fz + f.sweep + f.tipChord));
      }
    }
    if (bs.length === 0) bs.push(box(-1, -0.5, zAt(0.85), 1, 0.8, L / 2));
    add('tail', 'tail', 'Tail', 0.5, bs, 4, 0.7);

    // fuselage: everything else
    add('fuselage', 'fuselage', 'Fuselage', 1.0, [box(-wide, low, zAt(0.06), wide, high, zAt(0.9))], 5, 1.1);
  }

  get(id: string): Module {
    return this.modules.find((m) => m.id === id)!;
  }

  byKind(kind: ModuleKind): Module[] {
    return this.modules.filter((m) => m.kind === kind);
  }

  /** Fraction (0..1) of a module's health left. */
  ratio(id: string): number {
    const m = this.get(id);
    return m.gone ? 0 : clamp(m.hp / m.max, 0, 1);
  }

  /** Overall condition for the target box / HUD, weighting what actually keeps you flying. */
  health(): number {
    if (this.dead) return 0;
    const engines = this.byKind('engine');
    const eng = engines.reduce((s, e) => s + this.ratio(e.id), 0) / engines.length;
    const wing = (this.ratio('wingL') + this.ratio('wingR')) / 2;
    return clamp(0.55 * this.ratio('fuselage') + 0.14 * eng + 0.1 * wing + 0.08 * this.ratio('tail') + 0.08 * this.ratio('cockpit') + 0.05 * this.ratio('fuel'), 0, 1);
  }

  /** Apply damage to one module and return what it caused. */
  damage(m: Module, amount: number, incendiary = false): DamageEvent[] {
    const ev: DamageEvent[] = [];
    if (this.dead || amount <= 0) return ev;
    const before = m.hp / m.max;
    m.hp -= amount;

    if (m.kind === 'cockpit' && this.pilotAlive) {
      if (m.hp <= 0 || (m.hp < m.max * 0.7 && this.rng() < (amount / m.max) * 0.5)) {
        this.pilotAlive = false;
        ev.push({ type: 'pilot-killed' });
        this.kill('Pilot killed', ev);
        return ev;
      }
    }
    if ((m.kind === 'wingL' || m.kind === 'wingR' || m.kind === 'tail') && m.hp <= 0 && !m.gone) {
      m.gone = true;
      m.hp = 0;
      ev.push({ type: 'rip', part: m.kind });
    }
    if (m.kind === 'engine') {
      const after = Math.max(0, m.hp) / m.max;
      if (m.hp <= 0) m.hp = 0;
      if (after < 0.38 && before >= 0.38 && this.fire < 0.5 && this.rng() < 0.75) {
        this.fire = Math.max(this.fire, 0.7);
        ev.push({ type: 'engine-fire', engine: this.modules.filter((x) => x.kind === 'engine').indexOf(m) });
      }
    }
    if (m.kind === 'fuel') {
      if (m.hp / m.max < 0.62 && !this.leaking) {
        this.leaking = true;
        ev.push({ type: 'leak' });
      }
      if ((incendiary || this.leaking) && this.fire < 0.3 && this.rng() < (incendiary ? 0.25 : 0.1)) {
        this.fire = 0.6;
        ev.push({ type: 'fire' });
      }
    }
    if (m.kind === 'fuselage' && m.hp <= 0) this.kill('Structural failure', ev);
    return ev;
  }

  private kill(reason: string, ev: DamageEvent[]): void {
    if (this.dead) return;
    this.dead = true;
    this.deathReason = reason;
    ev.push({ type: 'destroyed', reason });
  }

  /** Time-based effects: fire burns, fuel drains, fires may go out when you fly fast. */
  update(dt: number, speed: number, throttle: number): DamageEvent[] {
    const ev: DamageEvent[] = [];
    if (this.dead) return ev;
    if (this.leaking) {
      this.fuel = Math.max(0, this.fuel - dt * 0.012);
      // a leak near a hot engine eventually catches
      if (this.fire < 0.2 && throttle > 0.5 && this.ratio('fuel') < 0.45 && this.rng() < dt * 0.08) {
        this.fire = 0.6;
        ev.push({ type: 'fire' });
      }
    }
    if (this.fire > 0) {
      const fus = this.get('fuselage');
      const burn = 2.8 * this.fire * (this.def.hp / 110);
      fus.hp -= burn * dt;
      for (const e of this.byKind('engine')) e.hp = Math.max(0, e.hp - 1.2 * this.fire * dt);
      if (fus.hp <= 0) this.kill('Burned up', ev);
      this.extinguishTimer += dt;
      if (this.extinguishTimer >= 1) {
        this.extinguishTimer = 0;
        // speed blows fires out; a screaming dive is the classic fix
        const p = 0.07 + 0.5 * clamp((speed - 200) / 260, 0, 1);
        if (this.rng() < p) {
          this.fire = 0;
          ev.push({ type: 'extinguished' });
        }
      }
    }
    return ev;
  }

  /** Translate the damage state into flight-model multipliers. */
  applyTo(mods: FlightMods, hasFuel: boolean): void {
    const engines = this.byKind('engine');
    let thrust = 0;
    for (const e of engines) thrust += Math.pow(this.ratio(e.id), 0.7);
    thrust /= engines.length;
    mods.thrust = hasFuel ? thrust : 0;

    const wl = this.ratio('wingL');
    const wr = this.ratio('wingR');
    const tail = this.ratio('tail');
    mods.lift = 1 - 0.3 * (1 - wl) - 0.3 * (1 - wr);
    mods.drag = 1 + 0.35 * (1 - tail) + (this.get('wingL').gone ? 0.25 : 0) + (this.get('wingR').gone ? 0.25 : 0);
    mods.pitch = 0.4 + 0.6 * tail;
    mods.yaw = 0.3 + 0.7 * tail;
    mods.roll = 0.3 + 0.7 * Math.min(wl, wr);
    mods.rollDrift = ((1 - wr) - (1 - wl)) * 1.0; // a hurt left wing rolls you left (negative)
    mods.wobble = (1 - tail) * 0.22 + (this.get('tail').gone ? 0.12 : 0);
  }

  repair(): void {
    for (const m of this.modules) {
      m.hp = m.max;
      m.gone = false;
    }
    this.fire = 0;
    this.leaking = false;
    this.pilotAlive = true;
    this.dead = false;
    this.deathReason = '';
    this.fuel = 1;
  }
}
