import { Vector3 } from 'three';
import type { ParticleSystem } from '../render/Particles';
import { smoothstep } from '../core/math';
import type { Aircraft } from './Aircraft';

/** Altitude (m) above which engines leave condensation trails. */
const CONTRAIL_ALT = 3600;
/** G load above which the wings shed visible vortices. */
const VORTEX_G = 4.2;

const _p = new Vector3();

/**
 * Emits contrails from the nozzles and wingtip vortices from the wingtips into a particle system.
 * Particles are spaced along the path (not per frame) so the trail is continuous at any speed or frame rate.
 */
export class TrailEmitter {
  private last: (Vector3 | null)[] = [];

  constructor(private ps: ParticleSystem) {}

  reset(): void {
    this.last = [];
  }

  update(ac: Aircraft, intensity: number): void {
    const f = ac.flight;
    const m = ac.model;
    if (intensity <= 0 || f.crashed) {
      this.last = [];
      return;
    }
    const o = ac.object;
    o.updateMatrixWorld();
    const tips = m.wingtips;
    const jets = m.nozzles;
    const g = Math.abs(f.gLoad);
    const vortex = smoothstep(VORTEX_G, VORTEX_G + 3.5, g) * smoothstep(40, 120, f.speed);
    const contrail = smoothstep(CONTRAIL_ALT, CONTRAIL_ALT + 1200, f.pos.y) * smoothstep(60, 160, f.speed);

    const run = (slot: number, local: Vector3, spacing: number, emit: (x: number, y: number, z: number) => void): void => {
      _p.copy(local).applyMatrix4(o.matrixWorld);
      const prev = this.last[slot];
      if (prev) {
        const dist = prev.distanceTo(_p);
        const steps = Math.min(40, Math.floor(dist / spacing));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          emit(prev.x + (_p.x - prev.x) * t, prev.y + (_p.y - prev.y) * t, prev.z + (_p.z - prev.z) * t);
        }
        if (steps > 0) prev.copy(_p);
      } else this.last[slot] = _p.clone();
    };

    for (let i = 0; i < tips.length; i++) {
      if (vortex > 0.02) {
        const a = 0.5 * vortex * intensity;
        run(i, tips[i], 4.5, (x, y, z) => this.ps.emit(x, y, z, 0, 0, 0, 1.8 + vortex, 0.5, 2.6, 0.95, 0.97, 1, a, 0.2));
      } else this.last[i] = null as unknown as Vector3;
    }
    for (let i = 0; i < jets.length; i++) {
      const slot = tips.length + i;
      if (contrail > 0.02) {
        const a = 0.42 * contrail * intensity;
        run(slot, jets[i], 11, (x, y, z) => this.ps.emit(x, y, z, 0, 0, 0, 7.5, 1.6, 15, 0.97, 0.98, 1, a, 0.05));
      } else this.last[slot] = null as unknown as Vector3;
    }
  }
}
