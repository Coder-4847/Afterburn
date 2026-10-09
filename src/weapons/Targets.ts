import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, OctahedronGeometry, SphereGeometry, Vector3,
} from 'three';
import { clamp } from '../core/math';
import type { Attacker, SegHit, Target, Team } from './types';

let nextId = 1000;
export const newTargetId = (): number => nextId++;

/** Segment vs sphere: returns the entry parameter t (0..1) or -1. */
export function segmentSphere(a: Vector3, b: Vector3, c: Vector3, r: number): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  if (A < 1e-9) return fx * fx + fy * fy + fz * fz <= r * r ? 0 : -1;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t1 = (-B - s) / (2 * A);
  const t2 = (-B + s) / (2 * A);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return C <= 0 ? 0 : t2;
  return -1;
}

export type TargetEvent = { type: 'killed'; target: SimpleTarget; killer: Attacker | null; weapon: string };

/** Shared behaviour of the simple (non-aircraft) targets: hit points, burning wreck and respawn. */
export abstract class SimpleTarget implements Target {
  readonly id = newTargetId();
  name: string;
  team: Team = 'red';
  abstract kind: 'air' | 'ground';
  alive = true;
  pos = new Vector3();
  vel = new Vector3();
  abstract radius: number;
  abstract rcs: number;
  hp: number;
  readonly maxHp: number;
  readonly mesh = new Group();
  /** Seconds until the target comes back after being destroyed. */
  respawn = 0;
  respawnDelay: number;
  burn = 0;
  onKilled?: (t: SimpleTarget, killer: Attacker | null, weapon: string) => void;
  lastAttackers = new Map<number, { who: Attacker; dmg: number; t: number }>();
  clock = 0;

  constructor(name: string, hp: number, respawnDelay: number) {
    this.name = name;
    this.hp = this.maxHp = hp;
    this.respawnDelay = respawnDelay;
  }

  abstract irSignature(): number;

  health(): number {
    return this.alive ? clamp(this.hp / this.maxHp, 0, 1) : 0;
  }

  segmentHit(a: Vector3, b: Vector3, out: SegHit): boolean {
    const t = segmentSphere(a, b, this.pos, this.radius);
    if (t < 0) return false;
    out.t = t;
    out.point.copy(a).lerp(b, t);
    out.moduleId = 'body';
    return true;
  }

  hit(_h: SegHit, damage: number, attacker: Attacker | null, weapon: string): void {
    this.take(damage, attacker, weapon);
  }

  blast(point: Vector3, radius: number, warhead: number, attacker: Attacker | null, weapon: string): void {
    const d = point.distanceTo(this.pos) - this.radius * 0.5;
    if (d > radius) return;
    const f = Math.pow(1 - clamp(d / radius, 0, 1), 1.3);
    this.take(warhead * f * 1.2, attacker, weapon);
  }

  protected take(damage: number, attacker: Attacker | null, weapon: string): void {
    if (!this.alive) return;
    this.hp -= damage;
    if (attacker) {
      const e = this.lastAttackers.get(attacker.id) ?? { who: attacker, dmg: 0, t: 0 };
      e.dmg += damage;
      e.t = this.clock;
      this.lastAttackers.set(attacker.id, e);
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.hp = 0;
      this.respawn = this.respawnDelay;
      this.mesh.visible = false;
      this.onKilled?.(this, attacker, weapon);
    }
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.alive) {
      this.respawn -= dt;
      if (this.respawn <= 0) this.reset();
    }
  }

  reset(): void {
    this.alive = true;
    this.hp = this.maxHp;
    this.mesh.visible = true;
    this.lastAttackers.clear();
  }
}

/** A hovering target balloon / banner target: static, hot, easy to see. For gun and missile practice. */
export class AirDummy extends SimpleTarget {
  kind = 'air' as const;
  radius = 4.2;
  rcs = 2.0;
  private home = new Vector3();
  private phase = Math.random() * 6;

  constructor(name: string, pos: Vector3) {
    super(name, 55, 8);
    this.home.copy(pos);
    this.pos.copy(pos);
    const red = new MeshStandardMaterial({ color: 0xd9412f, roughness: 0.5, emissive: 0x5a1208, emissiveIntensity: 0.6 });
    const white = new MeshStandardMaterial({ color: 0xf1f1f1, roughness: 0.6 });
    const body = new Mesh(new OctahedronGeometry(3.6, 0), red);
    body.scale.set(1, 0.8, 1.35);
    const ring = new Mesh(new SphereGeometry(1.7, 14, 10), white);
    ring.scale.set(1.45, 0.35, 1.45);
    for (const m of [body, ring]) {
      m.castShadow = true;
      this.mesh.add(m);
    }
    this.mesh.position.copy(pos);
  }

  irSignature(): number {
    return 1.1;
  }

  update(dt: number): void {
    super.update(dt);
    if (!this.alive) return;
    this.phase += dt;
    this.pos.y = this.home.y + Math.sin(this.phase * 0.8) * 1.6;
    this.pos.x = this.home.x + Math.sin(this.phase * 0.31) * 6;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y += dt * 0.5;
  }
}

export type GroundKind = 'truck' | 'radar' | 'bunker' | 'tent';

/** Static ground targets for rockets and bombs. */
export class GroundTarget extends SimpleTarget {
  kind = 'ground' as const;
  radius: number;
  rcs = 6;

  constructor(name: string, readonly gk: GroundKind, pos: Vector3, heading = 0) {
    super(name, gk === 'bunker' ? 150 : gk === 'radar' ? 90 : 70, 25);
    this.radius = gk === 'bunker' ? 9 : gk === 'radar' ? 6 : 5;
    this.pos.copy(pos);
    this.pos.y += this.radius * 0.45;
    const olive = new MeshStandardMaterial({ color: 0x5b6648, roughness: 0.85 });
    const dark = new MeshStandardMaterial({ color: 0x2d3328, roughness: 0.9 });
    const grey = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.4 });
    const add = (m: Mesh, x = 0, y = 0, z = 0) => {
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.mesh.add(m);
    };
    if (gk === 'truck') {
      add(new Mesh(new BoxGeometry(2.6, 2.2, 4.2), olive), 0, 1.6, -1);
      add(new Mesh(new BoxGeometry(2.4, 2.0, 2.2), dark), 0, 1.5, 2.2);
      for (const sx of [-1.2, 1.2]) for (const sz of [-2.2, 0.2, 2.4]) add(new Mesh(new CylinderGeometry(0.55, 0.55, 0.4, 12).rotateZ(Math.PI / 2), dark), sx, 0.55, sz);
    } else if (gk === 'radar') {
      add(new Mesh(new BoxGeometry(5, 2.4, 3.2), olive), 0, 1.4, 0);
      add(new Mesh(new CylinderGeometry(0.3, 0.3, 3.5, 8), grey), 0, 4.2, 0);
      const dish = new Mesh(new ConeGeometry(2.8, 1.2, 20, 1, true).rotateX(-Math.PI / 2), grey);
      add(dish, 0, 6.2, 0.4);
    } else if (gk === 'bunker') {
      add(new Mesh(new BoxGeometry(11, 3.6, 8), new MeshStandardMaterial({ color: 0x77786f, roughness: 0.95 })), 0, 1.8, 0);
      add(new Mesh(new CylinderGeometry(3.6, 3.6, 11, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), dark), 0, 3.6, 0);
    } else {
      add(new Mesh(new ConeGeometry(4.2, 3.4, 4), new MeshStandardMaterial({ color: 0x8a8660, roughness: 0.95 })), 0, 1.7, 0);
    }
    this.mesh.position.copy(pos);
    this.mesh.rotation.y = heading;
    this.mesh.userData.groundPos = pos.clone();
  }

  irSignature(): number {
    return this.gk === 'truck' ? 0.7 : 0.3;
  }
}
