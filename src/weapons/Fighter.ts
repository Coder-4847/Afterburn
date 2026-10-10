import { Matrix4, Vector3 } from 'three';
import type { Aircraft } from '../aircraft/Aircraft';
import { DamageModel, type DamageEvent } from '../damage/DamageModel';
import { clamp } from '../core/math';
import { STORES } from '../data/weapons';
import { Loadout } from './Loadout';
import { newTargetId, segmentSphere } from './Targets';
import type { Attacker, SegHit, Target, Team } from './types';
import { WeaponSystem } from './WeaponSystem';

/** The combat layer implements this so a Fighter can report what happened to it. */
export interface FighterHooks {
  damageEvents(f: Fighter, ev: DamageEvent[], attacker: Attacker | null, weapon: string): void;
  hitEvent(attacker: Attacker | null, victim: Target, damage: number, weapon: string, point: Vector3): void;
}

/** Anything that drives a fighter's controls each tick (human input lives in Game, AI in /ai). */
export interface Brain {
  update(f: Fighter, dt: number): void;
}

export interface Stats {
  kills: number;
  assists: number;
  deaths: number;
  shots: number;
  hits: number;
  damage: number;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _m = new Matrix4();

/**
 * One combatant: the aircraft (flight + visuals) plus module damage, weapons, loadout, stats and team.
 * It is also a Target: weapons hit it through its module hit boxes.
 */
export class Fighter implements Target, Attacker {
  readonly id = newTargetId();
  readonly kind = 'air' as const;
  readonly damage: DamageModel;
  readonly weapons: WeaponSystem;
  loadout: Loadout;
  brain: Brain | null = null;
  hooks: FighterHooks | null = null;
  state: 'alive' | 'wreck' | 'dead' = 'alive';
  respawn = 0;
  stats: Stats = { kills: 0, assists: 0, deaths: 0, shots: 0, hits: 0, damage: 0 };
  clock = 0;
  recent = new Map<number, { who: Attacker; dmg: number; t: number }>();
  /** Last attacker and weapon, for kill credit. */
  lastHit: { who: Attacker; weapon: string; t: number } | null = null;
  /** Multiplier on incoming damage (the player's difficulty setting). */
  damageScale = 1;
  /** Seconds since the last time this fighter was hit (HUD flash, AI reactions). */
  sinceHit = 99;
  /** For debris and effects: the part groups that are currently gone. */
  private hidden = new Set<string>();

  private invFrame = -1;
  private inv = new Matrix4();

  constructor(public name: string, public team: Team, readonly aircraft: Aircraft, readonly isPlayer = false) {
    this.damage = new DamageModel(aircraft.def);
    this.loadout = new Loadout(aircraft.def);
    this.weapons = new WeaponSystem(this);
    this.weapons.rearm();
    this.mountVisuals();
  }

  // ---- Target interface ---------------------------------------------------------------------

  get alive(): boolean {
    return this.state === 'alive';
  }
  get pos(): Vector3 {
    return this.aircraft.flight.pos;
  }
  get vel(): Vector3 {
    return this.aircraft.flight.vel;
  }
  get radius(): number {
    return this.aircraft.def.model.length * 0.66 + 3;
  }
  get rcs(): number {
    return this.aircraft.def.rcs;
  }

  irSignature(): number {
    const f = this.aircraft.flight;
    // afterburner is a beacon; a burning engine is too
    return 0.45 + 0.35 * f.power + 1.5 * f.abLevel + 0.6 * this.damage.fire;
  }

  health(): number {
    return this.state === 'alive' ? this.damage.health() : 0;
  }

  /** World -> local matrix for the current physics state (cached per tick). */
  private ensureFrame(tick: number): void {
    if (this.invFrame === tick) return;
    this.invFrame = tick;
    const f = this.aircraft.flight;
    this.inv.compose(f.pos, f.quat, _c.set(1, 1, 1)).invert();
  }

  tick = 0;
  readonly fxAcc = { smoke: 0, fire: 0, leak: 0, wreck: 0 };

  segmentHit(a: Vector3, b: Vector3, out: SegHit): boolean {
    if (segmentSphere(a, b, this.pos, this.radius) < 0) return false;
    this.ensureFrame(this.tick);
    const la = _a.copy(a).applyMatrix4(this.inv);
    const lb = _b.copy(b).applyMatrix4(this.inv);
    let bestT = Infinity;
    let bestP = 99;
    let bestId = '';
    const dx = lb.x - la.x;
    const dy = lb.y - la.y;
    const dz = lb.z - la.z;
    for (const m of this.damage.modules) {
      if (m.gone) continue;
      for (const bx of m.boxes) {
        // slab test
        let t0 = 0;
        let t1 = 1;
        let ok = true;
        for (let ax = 0; ax < 3 && ok; ax++) {
          const o = ax === 0 ? la.x : ax === 1 ? la.y : la.z;
          const d = ax === 0 ? dx : ax === 1 ? dy : dz;
          const lo = ax === 0 ? bx.min.x : ax === 1 ? bx.min.y : bx.min.z;
          const hi = ax === 0 ? bx.max.x : ax === 1 ? bx.max.y : bx.max.z;
          if (Math.abs(d) < 1e-9) {
            if (o < lo || o > hi) ok = false;
          } else {
            let ta = (lo - o) / d;
            let tb = (hi - o) / d;
            if (ta > tb) [ta, tb] = [tb, ta];
            t0 = Math.max(t0, ta);
            t1 = Math.min(t1, tb);
            if (t0 > t1) ok = false;
          }
        }
        if (!ok) continue;
        if (t0 < bestT - 1e-3 || (Math.abs(t0 - bestT) <= 1e-3 && m.priority < bestP)) {
          bestT = t0;
          bestP = m.priority;
          bestId = m.id;
        }
      }
    }
    if (bestT === Infinity) return false;
    out.t = bestT;
    out.point.copy(a).lerp(b, bestT);
    out.moduleId = bestId;
    return true;
  }

  hit(h: SegHit, damage: number, attacker: Attacker | null, weapon: string, incendiary: boolean): void {
    if (this.state !== 'alive') return;
    const m = this.damage.get(h.moduleId);
    const before = this.damage.health();
    const scaled = damage * this.damageScale;
    const ev = this.damage.damage(m, scaled, incendiary);
    const dealt = Math.max(0, scaled);
    this.noteAttack(attacker, weapon, dealt);
    this.hooks?.hitEvent(attacker, this, dealt, weapon, h.point);
    if (ev.length) this.hooks?.damageEvents(this, ev, attacker, weapon);
    void before;
  }

  blast(point: Vector3, radius: number, warhead: number, attacker: Attacker | null, weapon: string): void {
    if (this.state !== 'alive') return;
    const f = this.aircraft.flight;
    const all: DamageEvent[] = [];
    let total = 0;
    for (const m of this.damage.modules) {
      if (m.gone) continue;
      _a.copy(m.center).applyQuaternion(f.quat).add(f.pos);
      const d = _a.distanceTo(point) - 1.2;
      if (d >= radius) continue;
      const k = Math.pow(1 - clamp(d / radius, 0, 1), 1.4);
      const amt = warhead * k * m.blastWeight * (0.85 + Math.random() * 0.3) * this.damageScale;
      if (amt <= 0.2) continue;
      total += amt;
      all.push(...this.damage.damage(m, amt));
      if (this.damage.dead) break;
    }
    if (total > 0) {
      this.noteAttack(attacker, weapon, total);
      this.hooks?.hitEvent(attacker, this, total, weapon, point);
    }
    if (all.length) this.hooks?.damageEvents(this, all, attacker, weapon);
  }

  private noteAttack(attacker: Attacker | null, weapon: string, dmg: number): void {
    this.sinceHit = 0;
    if (!attacker || attacker.id === this.id) return;
    const e = this.recent.get(attacker.id) ?? { who: attacker, dmg: 0, t: 0 };
    e.dmg += dmg;
    e.t = this.clock;
    this.recent.set(attacker.id, e);
    this.lastHit = { who: attacker, weapon, t: this.clock };
  }

  /** Who killed us and who helped (recent damage dealers). */
  credit(): { killer: Attacker | null; weapon: string; assists: Attacker[] } {
    const killer = this.lastHit && this.clock - this.lastHit.t < 25 ? this.lastHit.who : null;
    const assists: Attacker[] = [];
    for (const e of this.recent.values()) {
      if (e.who.id !== killer?.id && this.clock - e.t < 25 && e.dmg >= 12) assists.push(e.who);
    }
    return { killer, weapon: this.lastHit?.weapon ?? '', assists };
  }

  // ---- per-tick simulation hooks --------------------------------------------------------------

  /**
   * Before the flight model steps: tick damage (fires, leaks), burn fuel and turn the damage state and the
   * weight/drag of external stores into flight multipliers.
   */
  prePhysics(dt: number): void {
    this.clock += dt;
    this.sinceHit += dt;
    this.tick++;
    const ac = this.aircraft;
    const f = ac.flight;
    if (this.state !== 'alive') return;
    const ev = this.damage.update(dt, f.speed, ac.controls.throttle);
    if (ev.length) this.hooks?.damageEvents(this, ev, null, 'fire');
    // fuel: AB burns it fast, a leak faster still
    const burn = 0.00062 * (0.25 + f.power * 0.75) + 0.0016 * f.abLevel;
    this.damage.fuel = Math.max(0, this.damage.fuel - burn * dt);
    this.damage.applyTo(f.mods, this.damage.fuel > 0);
    // external stores cost speed and thrust (internal bays are free)
    let ext = 0;
    const st = this.loadout.arm.stations;
    for (let i = 0; i < this.weapons.items.length; i++) {
      const id = this.weapons.items[i];
      if (id && !st[i].internal) ext += STORES[id].weight;
    }
    const w = ext / Math.max(1, this.loadout.arm.payload);
    f.mods.drag *= 1 + 0.22 * w;
    f.mods.thrust *= 1 - 0.07 * w;
  }

  /** Visuals for stores on pylons. */
  mountVisuals(): void {
    const m = this.aircraft.model as { mountStores?: (items: (string | null)[], arm: unknown) => void };
    m.mountStores?.(this.loadout.items, this.loadout.arm);
  }

  hideStore(i: number): void {
    (this.aircraft.model as { setStoreVisible?: (i: number, v: boolean) => void }).setStoreVisible?.(i, false);
  }

  /** Hide a ripped-off part on the model. Returns false if the model has no separable parts. */
  ripPart(part: 'wingL' | 'wingR' | 'tail'): boolean {
    const parts = (this.aircraft.model as { parts?: Record<string, { visible: boolean }> }).parts;
    if (!parts) return false;
    parts[part].visible = false;
    this.hidden.add(part);
    return true;
  }

  /** Does anything need repairing, refuelling or reloading? */
  needsService(): boolean {
    const w = this.weapons;
    const def = this.aircraft.def;
    const st = this.loadout.arm.stations;
    for (let i = 0; i < this.loadout.items.length; i++) if (this.loadout.items[i] !== w.items[i]) return true;
    void st;
    for (let i = 0; i < w.items.length; i++) {
      const id = w.items[i];
      if (id && STORES[id].kind === 'rocket' && w.podLeft[i] < (STORES[id] as { count: number }).count) return true;
    }
    return this.damage.health() < 0.999 || this.damage.fuel < 0.99 || w.gunAmmo < def.gun.rounds || w.flares < def.countermeasures.flares || w.chaff < def.countermeasures.chaff
      || this.damage.modules.some((m) => m.hp < m.max - 0.01) || this.damage.fire > 0 || this.damage.leaking;
  }

  /** Repair, refuel and rearm without touching position or life state (landing on a friendly runway). */
  service(): void {
    this.damage.repair();
    this.weapons.rearm();
    this.hidden.clear();
    (this.aircraft.model as { restoreParts?: () => void }).restoreParts?.();
    (this.aircraft.model as { showAllStores?: () => void }).showAllStores?.();
  }

  /** Full repair and rearm, used on respawn. */
  reset(): void {
    this.service();
    this.state = 'alive';
    this.recent.clear();
    this.lastHit = null;
    this.aircraft.flight.wreck = false;
    this.aircraft.flight.crashed = null;
    this.aircraft.object.visible = true;
  }
}
