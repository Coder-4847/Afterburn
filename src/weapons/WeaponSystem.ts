import { Vector3 } from 'three';
import { STORES, gunProfile, type MissileDef, type WeaponKind } from '../data/weapons';
import { DEG } from '../core/math';
import type { Fighter } from './Fighter';
import type { Target } from './types';

/** Weapon groups, in the order of the 1-4 keys. */
export const GROUPS: WeaponKind[] = ['ir', 'radar', 'rocket', 'bomb'];
export const GROUP_LABEL = ['IR MISSILE', 'RADAR MISSILE', 'ROCKETS', 'BOMBS'];

export interface LockState {
  /** 0..1 while a seeker is acquiring. */
  progress: number;
  locked: boolean;
  /** Seeker can currently see the target (growl) even if not yet locked. */
  tracking: boolean;
}

const _r = new Vector3();
const _f = new Vector3();

/**
 * Everything a fighter can shoot with, plus its countermeasures and target lock. Pure state and logic:
 * the Combat manager owns the projectiles and does the actual launching.
 */
export class WeaponSystem {
  /** Mounted store per station (null once fired). */
  items: (string | null)[] = [];
  /** Rockets left in each pod station. */
  podLeft: number[] = [];
  gunAmmo = 0;
  flares = 0;
  chaff = 0;
  group = 0;
  target: Target | null = null;
  lock: LockState = { progress: 0, locked: false, tracking: false };

  // cooldowns / timers
  gunAcc = 0;
  rocketAcc = 0;
  cooldown = 0;
  flareBurst = 0;
  chaffBurst = 0;
  cmTimer = 0;
  /** Alternate left / right when picking the next station. */
  private flip = false;

  constructor(readonly owner: Fighter) {}

  get kind(): WeaponKind {
    return GROUPS[this.group];
  }

  rearm(): void {
    const lo = this.owner.loadout;
    this.items = [...lo.items];
    this.podLeft = this.items.map((id) => {
      const d = id ? STORES[id] : null;
      return d && d.kind === 'rocket' ? d.count : 0;
    });
    this.gunAmmo = this.owner.aircraft.def.gun.rounds;
    this.flares = this.owner.aircraft.def.countermeasures.flares;
    this.chaff = this.owner.aircraft.def.countermeasures.chaff;
    this.target = null;
    this.lock = { progress: 0, locked: false, tracking: false };
    this.cooldown = 0;
    // start on the first group that has something loaded
    for (let g = 0; g < 4; g++) {
      if (this.remaining(GROUPS[g]) > 0) {
        this.group = g;
        break;
      }
    }
  }

  /** How many shots are left of a kind (rockets count individually). */
  remaining(kind: WeaponKind): number {
    let n = 0;
    for (let i = 0; i < this.items.length; i++) {
      const id = this.items[i];
      if (!id) continue;
      const d = STORES[id];
      if (d.kind !== kind) continue;
      n += kind === 'rocket' ? this.podLeft[i] : 1;
    }
    return n;
  }

  /** Station to fire next for a kind, alternating sides so the aircraft stays balanced. Returns -1 if none. */
  nextStation(kind: WeaponKind): number {
    const st = this.owner.loadout.arm.stations;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const id = this.items[i];
      if (!id || STORES[id].kind !== kind) continue;
      if (kind === 'rocket' && this.podLeft[i] <= 0) continue;
      const side = Math.sign(st[i].x) || 0;
      // prefer the side we did not fire last, then outboard stations first
      const sidePenalty = side === (this.flip ? 1 : -1) ? 0 : 5;
      const score = sidePenalty - Math.abs(st[i].x) * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  consume(i: number): void {
    const id = this.items[i];
    if (!id) return;
    this.flip = Math.sign(this.owner.loadout.arm.stations[i].x) > 0;
    if (STORES[id].kind === 'rocket') {
      this.podLeft[i]--;
      if (this.podLeft[i] <= 0) this.items[i] = null;
    } else this.items[i] = null;
  }

  /** The missile definition for the current IR / radar group (first one found), for lock ranges. */
  currentMissile(): MissileDef | null {
    const k = this.kind;
    if (k !== 'ir' && k !== 'radar') return null;
    for (const id of this.items) {
      if (id && STORES[id].kind === k) return STORES[id] as MissileDef;
    }
    return null;
  }

  selectGroup(g: number): void {
    if (g === this.group) return;
    this.group = g;
    this.lock = { progress: 0, locked: false, tracking: false };
    // a target for another weapon class (air vs ground) doesn't carry over
    if (this.target && (g >= 2) !== (this.target.kind === 'ground')) this.target = null;
  }

  get gun() {
    return gunProfile(this.owner.aircraft.def.gun.caliber);
  }

  /**
   * Seeker logic: IR looks for heat inside its acquisition cone, radar needs the target inside the radar cone and
   * within a range that shrinks with a small radar cross-section. Locking takes a moment.
   */
  updateLock(dt: number, los: (a: Vector3, b: Vector3) => boolean): void {
    const L = this.lock;
    const t = this.target;
    const owner = this.owner;
    if (!t || !t.alive) {
      this.target = null;
      L.progress = 0;
      L.locked = false;
      L.tracking = false;
      return;
    }
    const f = owner.aircraft.flight;
    f.forward(_f);
    _r.copy(t.pos).sub(f.pos);
    const dist = _r.length();
    const ang = Math.acos(Math.max(-1, Math.min(1, _f.dot(_r) / (dist || 1))));
    const k = this.kind;
    let visible = false;
    let lockTime = 1;
    if (k === 'ir') {
      const m = this.currentMissile();
      if (m) {
        // tail-on aspect is hottest; afterburner makes a bright target visible from further away
        const aspect = t.kind === 'air' ? 0.6 + 0.4 * Math.max(0, _r.clone().normalize().dot(tAxis(t))) : 1;
        const range = m.lockRange * Math.min(1.7, Math.max(0.45, t.irSignature() * aspect));
        visible = ang < m.acquireCone * DEG && dist < range && los(f.pos, t.pos);
        lockTime = m.lockTime;
      }
    } else if (k === 'radar') {
      const m = this.currentMissile();
      if (m) {
        const range = m.lockRange * Math.min(1.4, Math.max(0.45, Math.pow(t.rcs / 3, 0.25)));
        visible = ang < 60 * DEG && dist < range && los(f.pos, t.pos);
        lockTime = m.lockTime;
      }
    } else if (k === 'bomb') {
      visible = t.kind === 'ground' && dist < 14000;
      lockTime = 0.5;
    } else {
      visible = false;
    }
    L.tracking = visible;
    L.progress = visible ? Math.min(1, L.progress + dt / lockTime) : Math.max(0, L.progress - dt * 2.5);
    L.locked = L.progress >= 1;
  }
}

const _ax = new Vector3();
/** A target's forward axis (zero for things without one): used for heat aspect. */
function tAxis(t: Target): Vector3 {
  const v = t.vel;
  const l = v.length();
  return l > 20 ? _ax.copy(v).multiplyScalar(1 / l) : _ax.set(0, 0, 0);
}
