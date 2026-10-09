/**
 * Weapon definitions. Everything is data: add a missile by adding an entry here and naming it in an armament
 * (data/stations.ts). Distances in metres, times in seconds, angles in degrees, damage in "hit points"
 * (a typical fighter has 100-140 HP spread over its modules).
 */
export type WeaponKind = 'ir' | 'radar' | 'rocket' | 'bomb';

export interface MissileDef {
  kind: 'ir' | 'radar';
  id: string;
  name: string;
  /** Payload weight units (an IR missile = 1). */
  weight: number;
  /** Motor: two stages (boost, then sustain). accel is m/s^2, burn is seconds. */
  accel1: number;
  burn1: number;
  accel2: number;
  burn2: number;
  /** Aerodynamic drag coefficient (decel = drag * v^2). */
  drag: number;
  /** Structural / aerodynamic G limit at full speed. */
  maxG: number;
  /** Half-angle the seeker can acquire a target within at launch, and keep tracking within in flight. */
  acquireCone: number;
  trackCone: number;
  /** Maximum lock range against a 1.0 signature target (radar scales with RCS, IR with heat). */
  lockRange: number;
  lockTime: number;
  /** Radar only: own seeker takes over inside this range (before that, datalink from the launcher). */
  activeRange: number;
  /** Self-destructs after this long. */
  flightTime: number;
  /** Proportional navigation gain. */
  nav: number;
  fuseRadius: number;
  blastRadius: number;
  /** Damage at point-blank. */
  warhead: number;
  /** 0..1: how easily flares (IR) or chaff (radar) seduce it. */
  decoySusceptibility: number;
  length: number;
  radius: number;
}

export interface PodDef {
  kind: 'rocket';
  id: string;
  name: string;
  weight: number;
  count: number;
  /** Rocket motor accel / burn time. */
  accel: number;
  burn: number;
  blastRadius: number;
  warhead: number;
  length: number;
  radius: number;
}

export interface BombDef {
  kind: 'bomb';
  id: string;
  name: string;
  weight: number;
  guided: boolean;
  blastRadius: number;
  warhead: number;
  length: number;
  radius: number;
}

export type StoreDef = MissileDef | PodDef | BombDef;

const ir = (o: Partial<MissileDef> & Pick<MissileDef, 'id' | 'name'>): MissileDef => ({
  kind: 'ir', weight: 1, accel1: 210, burn1: 2.4, accel2: 25, burn2: 2.6, drag: 1.1e-5, maxG: 45,
  acquireCone: 40, trackCone: 75, lockRange: 7500, lockTime: 1.0, activeRange: 0, flightTime: 15, nav: 4,
  fuseRadius: 12, blastRadius: 17, warhead: 170, decoySusceptibility: 0.5, length: 2.9, radius: 0.065, ...o,
});

const radar = (o: Partial<MissileDef> & Pick<MissileDef, 'id' | 'name'>): MissileDef => ({
  kind: 'radar', weight: 1.5, accel1: 170, burn1: 3.6, accel2: 22, burn2: 6, drag: 0.9e-5, maxG: 35,
  acquireCone: 55, trackCone: 60, lockRange: 15000, lockTime: 0.9, activeRange: 6500, flightTime: 38, nav: 3.8,
  fuseRadius: 14, blastRadius: 20, warhead: 210, decoySusceptibility: 0.5, length: 3.7, radius: 0.09, ...o,
});

export const STORES: Record<string, StoreDef> = Object.fromEntries(
  [
    // ---- short-range, infrared, high off-boresight ----
    ir({ id: 'aim9x', name: 'AIM-9X', acquireCone: 45, trackCone: 80, maxG: 50, decoySusceptibility: 0.45 }),
    ir({ id: 'irist', name: 'IRIS-T', acquireCone: 48, trackCone: 85, maxG: 60, accel1: 200, burn1: 3.0, decoySusceptibility: 0.4, lockRange: 7800 }),
    ir({ id: 'r73', name: 'R-73', acquireCone: 40, trackCone: 75, maxG: 40, warhead: 185, blastRadius: 19, decoySusceptibility: 0.6, length: 2.9, radius: 0.085 }),
    ir({ id: 'pl10', name: 'PL-10', acquireCone: 44, trackCone: 78, maxG: 45, decoySusceptibility: 0.5, lockRange: 7600 }),
    ir({ id: 'micair', name: 'MICA-IR', acquireCone: 36, trackCone: 70, maxG: 40, burn1: 3.4, flightTime: 18, decoySusceptibility: 0.55, lockRange: 8200, length: 3.1, radius: 0.08 }),
    // ---- medium / long-range, radar ----
    radar({ id: 'aim120d', name: 'AIM-120D', maxG: 35, flightTime: 40, decoySusceptibility: 0.5 }),
    radar({ id: 'meteor', name: 'Meteor', accel1: 190, burn1: 3.2, accel2: 38, burn2: 20, flightTime: 55, maxG: 35, lockRange: 16000, activeRange: 8000, decoySusceptibility: 0.35, drag: 0.8e-5, weight: 1.8 }),
    radar({ id: 'r77', name: 'R-77', maxG: 28, flightTime: 36, lockRange: 14000, decoySusceptibility: 0.6 }),
    radar({ id: 'pl15', name: 'PL-15', maxG: 34, flightTime: 46, lockRange: 16000, activeRange: 7500, decoySusceptibility: 0.42, weight: 1.7 }),
    radar({ id: 'micaem', name: 'MICA-EM', maxG: 40, flightTime: 32, lockRange: 13000, decoySusceptibility: 0.55, burn1: 4.2, weight: 1.4 }),
    // ---- unguided rockets ----
    { kind: 'rocket', id: 'hydra', name: 'Hydra-70 pod', weight: 2, count: 14, accel: 260, burn: 1.1, blastRadius: 9, warhead: 38, length: 2.0, radius: 0.2 } as PodDef,
    { kind: 'rocket', id: 's8', name: 'S-8 pod', weight: 2, count: 20, accel: 240, burn: 1.2, blastRadius: 9, warhead: 36, length: 2.6, radius: 0.22 } as PodDef,
    { kind: 'rocket', id: 'zs90', name: 'Type 90 pod', weight: 2, count: 18, accel: 250, burn: 1.1, blastRadius: 9, warhead: 36, length: 2.3, radius: 0.21 } as PodDef,
    // ---- bombs ----
    { kind: 'bomb', id: 'mk82', name: 'Mk 82', weight: 2, guided: false, blastRadius: 30, warhead: 260, length: 2.2, radius: 0.14 } as BombDef,
    { kind: 'bomb', id: 'fab250', name: 'FAB-250', weight: 2, guided: false, blastRadius: 30, warhead: 260, length: 2.2, radius: 0.14 } as BombDef,
    { kind: 'bomb', id: 'type250', name: 'Type 250-2', weight: 2, guided: false, blastRadius: 30, warhead: 260, length: 2.2, radius: 0.14 } as BombDef,
    { kind: 'bomb', id: 'gbu12', name: 'GBU-12', weight: 2.5, guided: true, blastRadius: 34, warhead: 300, length: 3.3, radius: 0.16 } as BombDef,
    { kind: 'bomb', id: 'kab500', name: 'KAB-500L', weight: 2.5, guided: true, blastRadius: 34, warhead: 300, length: 3.0, radius: 0.18 } as BombDef,
    { kind: 'bomb', id: 'ls500', name: 'LS-500J', weight: 2.5, guided: true, blastRadius: 34, warhead: 300, length: 3.0, radius: 0.18 } as BombDef,
  ].map((d) => [d.id, d as StoreDef]),
);

export function store(id: string): StoreDef {
  return STORES[id];
}

/** Gun profile derived from the aircraft's cannon caliber (rate of fire, muzzle velocity, damage per hit). */
export interface GunProfile {
  muzzleVelocity: number;
  /** Rounds per second while the trigger is held. */
  rate: number;
  /** Damage per round that hits a module. */
  damage: number;
  /** Random cone half-angle (rad). */
  spread: number;
}

export function gunProfile(caliber: number): GunProfile {
  if (caliber >= 30) return { muzzleVelocity: 880, rate: 26, damage: 5.4, spread: 0.0035 };
  if (caliber >= 27) return { muzzleVelocity: 1020, rate: 28, damage: 3.8, spread: 0.003 };
  if (caliber >= 23) return { muzzleVelocity: 960, rate: 50, damage: 2.5, spread: 0.0035 };
  return { muzzleVelocity: 1050, rate: 72, damage: 1.8, spread: 0.003 };
}

export const BULLET_LIFE = 2.3;
export const GRAVITY = 9.81;
