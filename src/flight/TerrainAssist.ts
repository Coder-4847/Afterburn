import { Vector3 } from 'three';
import type { FlightEnv, FlightModel, SurfaceInfo } from './FlightModel';
import { TERRAIN_ASSIST } from '../data/tuning';
import { G0, clamp } from '../core/math';

const _p = new Vector3();
const _surf: SurfaceInfo = { height: 0, onRunway: false, onApron: false };

export interface TerrainThreat {
  /** Seconds until the projected path (plus a pull-up allowance) hits the ground; Infinity if clear. */
  time: number;
}

/**
 * Looks ahead along the velocity vector. For each future point it asks: "if I started a pull-up
 * right now, would I still clear the ground?" -- the pull-up allowance grows with dive angle and speed.
 */
export function scanTerrain(fm: FlightModel, env: FlightEnv, horizon: number, out: TerrainThreat): TerrainThreat {
  out.time = Infinity;
  const speed = fm.speed;
  if (speed < 30) return out;
  const vy = fm.vel.y / speed; // sin(flight path angle)
  const gamma = Math.asin(clamp(-vy, 0, 1)); // dive angle (>0 when descending)
  const radius = (speed * speed) / (TERRAIN_ASSIST.recoverG * G0);
  const drop = radius * (1 - Math.cos(gamma)); // altitude lost while pulling out
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * horizon;
    _p.copy(fm.pos).addScaledVector(fm.vel, t);
    const h = env.surfaceAt(_p.x, _p.z, _surf).height;
    if (_p.y - h - drop < TERRAIN_ASSIST.margin) {
      out.time = t;
      return out;
    }
  }
  return out;
}
