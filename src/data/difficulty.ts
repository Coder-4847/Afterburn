import type { DifficultyId, TerrainAssist } from '../core/Settings';

export interface DifficultyDef {
  id: DifficultyId;
  label: string;
  description: string;
  /** 0..1: how hard the wings are levelled when the reticle is on the nose. */
  autoLevel: number;
  /** 0..1: how strongly the angle-of-attack limiter fights pitch-up near stall. */
  aoaLimiter: number;
  /** Multiplier on the nose-drop at stall (bigger = easier recovery). */
  stallRecovery: number;
  /** Largest bank (rad) the reticle will command in a level turn, so turns hold altitude. */
  maxBank: number;
  /** Multiplier on the aircraft's G limit (Arcade lets you pull harder). */
  gMul: number;
  /** Multiplier on lift. */
  liftMul: number;
  /** rad/s of heading change per unit of rudder, added on top of the aerodynamic turn (small corrections without banking). */
  flatTurn: number;
  /** Multiplier on the angle of attack the limiter allows (more G in a hard turn). */
  aoaHeadroom: number;
  /** Multiplier on all damage the player takes (Arcade is forgiving, Realistic is not). */
  damageTaken: number;
  /** 0..1: how strongly cannon rounds are steered onto a selected target that is close to the gun line. */
  aimAssist: number;
  /** Multiplier on how fast missile seekers lock (the player's). */
  lockSpeed: number;
  /** Flares / chaff are released automatically when a missile is about to hit. */
  autoCountermeasures: boolean;
  /** Default terrain assist for this difficulty. */
  terrainAssist: TerrainAssist;
  /** Touchdown tolerances. */
  landing: { sink: number; roll: number; speed: number; pitchMin: number; pitchMax: number };
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  arcade: {
    id: 'arcade',
    label: 'Arcade',
    description: 'Forgiving. Strong stall protection, auto-level, auto pull-up, generous landings.',
    autoLevel: 1,
    aoaLimiter: 0.95,
    maxBank: 84 * Math.PI / 180,
    stallRecovery: 1.3,
    gMul: 2.0,
    liftMul: 1.1,
    flatTurn: 0.32,
    aoaHeadroom: 1.3,
    damageTaken: 0.35,
    aimAssist: 0.85,
    lockSpeed: 2.2,
    autoCountermeasures: true,
    terrainAssist: 'auto',
    landing: { sink: 12, roll: 40 * Math.PI / 180, speed: 175, pitchMin: -8 * Math.PI / 180, pitchMax: 24 * Math.PI / 180 },
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    description: 'Balanced. Softer assists, warnings only, normal landing limits.',
    autoLevel: 0.5,
    aoaLimiter: 0.65,
    maxBank: 86 * Math.PI / 180,
    stallRecovery: 1,
    gMul: 1.5,
    liftMul: 1,
    flatTurn: 0.18,
    aoaHeadroom: 1.12,
    damageTaken: 0.7,
    aimAssist: 0.5,
    lockSpeed: 1.4,
    autoCountermeasures: false,
    terrainAssist: 'warn',
    landing: { sink: 8, roll: 25 * Math.PI / 180, speed: 145, pitchMin: -4 * Math.PI / 180, pitchMax: 20 * Math.PI / 180 },
  },
  realistic: {
    id: 'realistic',
    label: 'Realistic-lite',
    description: 'Less hand-holding. Weak limiter, no auto-level, tighter landings.',
    autoLevel: 0.08,
    aoaLimiter: 0.28,
    maxBank: 120 * Math.PI / 180,
    stallRecovery: 0.75,
    gMul: 1,
    liftMul: 1,
    flatTurn: 0,
    aoaHeadroom: 1,
    damageTaken: 1,
    aimAssist: 0,
    lockSpeed: 1,
    autoCountermeasures: false,
    terrainAssist: 'warn',
    landing: { sink: 4, roll: 12 * Math.PI / 180, speed: 110, pitchMin: 0, pitchMax: 15 * Math.PI / 180 },
  },
};
