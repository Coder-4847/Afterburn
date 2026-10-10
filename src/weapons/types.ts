import type { Vector3 } from 'three';
import type { DamageEvent } from '../damage/DamageModel';

export type Team = 'blue' | 'red';

/** A point where a projectile segment entered a target. */
export interface SegHit {
  /** 0..1 along the segment. */
  t: number;
  point: Vector3;
  moduleId: string;
}

/** Anything weapons can hit: aircraft, ground targets and training dummies. */
export interface Target {
  readonly id: number;
  name: string;
  team: Team;
  kind: 'air' | 'ground';
  alive: boolean;
  pos: Vector3;
  vel: Vector3;
  /** Bounding-sphere radius for the broad phase. */
  radius: number;
  /** Radar cross-section (m^2). */
  rcs: number;
  /** Heat signature, ~1 = a fighter at cruise; afterburner roughly doubles it. */
  irSignature(): number;
  /** 0..1 for health bars. */
  health(): number;
  segmentHit(a: Vector3, b: Vector3, out: SegHit): boolean;
  hit(h: SegHit, damage: number, attacker: Attacker | null, weapon: string, incendiary: boolean): void;
  blast(point: Vector3, radius: number, warhead: number, attacker: Attacker | null, weapon: string): void;
}

/** Who gets the credit. Fighters implement this. */
export interface Attacker {
  readonly id: number;
  name: string;
  team: Team;
}

export type CombatEvent =
  | { type: 'hit'; attacker: Attacker | null; victim: Target; damage: number; weapon: string; point: Vector3 }
  | { type: 'kill'; killer: Attacker | null; victim: Target; weapon: string; assists: Attacker[] }
  | { type: 'launch'; shooter: Attacker; weapon: string }
  | { type: 'damage-events'; victim: Target; events: DamageEvent[] }
  | { type: 'explosion'; point: Vector3; size: number }
  | { type: 'eject'; who: Attacker; survived: boolean }
  | { type: 'miss-warning'; missileId: number };
