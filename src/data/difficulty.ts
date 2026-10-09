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
    gMul: 1.28,
    liftMul: 1.1,
    terrainAssist: 'auto',
    landing: { sink: 9, roll: 35 * Math.PI / 180, speed: 150, pitchMin: -6 * Math.PI / 180, pitchMax: 22 * Math.PI / 180 },
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    description: 'Balanced. Softer assists, warnings only, normal landing limits.',
    autoLevel: 0.5,
    aoaLimiter: 0.65,
    maxBank: 86 * Math.PI / 180,
    stallRecovery: 1,
    gMul: 1.12,
    liftMul: 1,
    terrainAssist: 'warn',
    landing: { sink: 6, roll: 20 * Math.PI / 180, speed: 125, pitchMin: -3 * Math.PI / 180, pitchMax: 18 * Math.PI / 180 },
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
    terrainAssist: 'warn',
    landing: { sink: 4, roll: 12 * Math.PI / 180, speed: 110, pitchMin: 0, pitchMax: 15 * Math.PI / 180 },
  },
};
