import { Vector3 } from 'three';
import { clamp } from '../core/math';
import { SimpleTarget } from '../weapons/Targets';
import type { Attacker, SegHit, Team } from '../weapons/types';
import { buildShip, SHIP_DIMS, SHIP_MOUNTS, type ShipKind } from './ShipModel';

const _l = new Vector3();

/**
 * A warship: carrier, destroyer or surfaced submarine. Hit by an oriented box (not a sphere, so shots and bombs have to actually
 * land on the hull), tough, slow to sink. Escorts steam in a slow circle; carriers are anchored so aircraft can use the deck.
 */
export class Ship extends SimpleTarget {
  readonly kind = 'ground' as const;
  radius: number;
  rcs = 60;
  readonly dims;
  heading: number;
  /** Steaming speed (m/s) and the circle it follows (null = anchored). */
  patrol: { cx: number; cz: number; r: number; ang: number; dir: 1 | -1; speed: number } | null = null;
  /** Seconds since the ship went down (drives the sinking animation). */
  sinkT = 0;
  /** Cooldown per gun and per launcher, owned by the fleet AI. */
  gunCool: number[];
  samCool: number[];
  private baseY: number;

  constructor(name: string, readonly shipKind: ShipKind, team: Team, teamHex: number, x: number, z: number, heading: number, seaLevel: number) {
    const d = SHIP_DIMS[shipKind];
    super(name, d.hp, Infinity);
    this.team = team;
    this.dims = d;
    this.radius = Math.hypot(d.length / 2, d.beam / 2) * 0.9;
    this.heading = heading;
    this.baseY = seaLevel;
    this.pos.set(x, seaLevel + d.top * 0.4, z);
    this.mesh.add(buildShip(shipKind, team, teamHex));
    this.gunCool = SHIP_MOUNTS[shipKind].gun.map(() => 1 + Math.random() * 2);
    this.samCool = SHIP_MOUNTS[shipKind].sam.map(() => 3 + Math.random() * 7);
    this.applyPose();
  }

  irSignature(): number {
    return this.shipKind === 'carrier' ? 0.9 : 0.5;
  }

  private applyPose(): void {
    const sink = clamp(this.sinkT / 14, 0, 1);
    this.mesh.position.set(this.pos.x, this.baseY - sink * (this.dims.draft + this.dims.top * 0.9), this.pos.z);
    // local +X forward: rotate so it points along the world heading (0 = north = -Z)
    this.mesh.rotation.set(0, Math.PI / 2 - this.heading, 0, 'YXZ');
    this.mesh.rotation.z = sink * 0.35 * (this.shipKind === 'carrier' ? 0.5 : 1);
  }

  /** Local (+X forward, +Y up from the waterline, +Z starboard) to world. */
  toWorld(lx: number, ly: number, lz: number, out: Vector3): Vector3 {
    const f = { x: Math.sin(this.heading), z: -Math.cos(this.heading) };
    // starboard is to the right of forward: (cos h, sin h)
    return out.set(this.pos.x + f.x * lx + Math.cos(this.heading) * lz, this.baseY + ly, this.pos.z + f.z * lx + Math.sin(this.heading) * lz);
  }

  private toLocal(p: Vector3, out: Vector3): Vector3 {
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    return out.set(dx * fx + dz * fz, p.y - this.baseY, dx * Math.cos(this.heading) + dz * Math.sin(this.heading));
  }

  segmentHit(a: Vector3, b: Vector3, out: SegHit): boolean {
    if (!this.alive) return false;
    const la = this.toLocal(a, new Vector3());
    const lb = this.toLocal(b, _l);
    const hx = this.dims.length / 2;
    const hz = this.dims.beam / 2;
    const lo = [-hx, -this.dims.draft, -hz];
    const hi = [hx, this.dims.top + 14, hz];
    const o = [la.x, la.y, la.z];
    const dd = [lb.x - la.x, lb.y - la.y, lb.z - la.z];
    let t0 = 0;
    let t1 = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dd[k]) < 1e-9) {
        if (o[k] < lo[k] || o[k] > hi[k]) return false;
      } else {
        let ta = (lo[k] - o[k]) / dd[k];
        let tb = (hi[k] - o[k]) / dd[k];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) return false;
      }
    }
    out.t = t0;
    out.point.copy(a).lerp(b, t0);
    out.moduleId = 'hull';
    return true;
  }

  hit(h: SegHit, damage: number, attacker: Attacker | null, weapon: string): void {
    // cannon rounds barely scratch a warship; rockets and bombs are what sink them
    const k = weapon === 'Cannon' ? 0.22 : 1;
    this.take(damage * k, attacker, weapon);
    void h;
  }

  blast(point: Vector3, radius: number, warhead: number, attacker: Attacker | null, weapon: string): void {
    if (!this.alive) return;
    const l = this.toLocal(point, new Vector3());
    const dx = Math.max(Math.abs(l.x) - this.dims.length / 2, 0);
    const dy = Math.max(l.y - (this.dims.top + 10), -l.y - this.dims.draft, 0);
    const dz = Math.max(Math.abs(l.z) - this.dims.beam / 2, 0);
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) return;
    const f = Math.pow(1 - clamp(d / radius, 0, 1), 1.2);
    this.take(warhead * f * 1.1, attacker, weapon);
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.alive) {
      this.sinkT += dt;
      this.applyPose();
      return;
    }
    const p = this.patrol;
    if (p) {
      // steam round the circle at constant speed
      p.ang += p.dir * (p.speed / p.r) * dt;
      this.pos.x = p.cx + Math.cos(p.ang) * p.r;
      this.pos.z = p.cz + Math.sin(p.ang) * p.r;
      // heading is the tangent
      const tx = -Math.sin(p.ang) * p.dir;
      const tz = Math.cos(p.ang) * p.dir;
      this.heading = Math.atan2(tx, -tz);
      this.vel.set(tx * p.speed, 0, tz * p.speed);
    }
    this.applyPose();
  }

  get healthFraction(): number {
    return this.alive ? clamp(this.hp / this.maxHp, 0, 1) : 0;
  }
}
