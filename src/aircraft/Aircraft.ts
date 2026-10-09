import { Group } from 'three';
import type { DifficultyDef } from '../data/difficulty';
import { FlightModel, makeFlightInput, type FlightInput } from '../flight/FlightModel';
import type { AircraftDef } from './AircraftDef';
import { tryLoadGlb } from './ModelLoader';
import { JetModel, type ModelHandle } from './ProceduralJet';

/**
 * One aircraft in the world: flight state + visual model + the controls somebody (player or AI) is applying.
 * Rendering interpolates between the last two physics states so motion stays smooth at any frame rate.
 */
export class Aircraft {
  readonly flight: FlightModel;
  /** Container that carries the interpolated transform; the model lives inside it and can be swapped. */
  readonly object = new Group();
  model: ModelHandle;
  readonly controls: FlightInput = makeFlightInput();
  private disposed = false;

  constructor(readonly def: AircraftDef, difficulty: DifficultyDef, readonly teamColor: number) {
    this.flight = new FlightModel(def, difficulty);
    this.model = new JetModel(def, teamColor);
    this.object.add(this.model.root);
  }

  /** If `public/models/<id>.glb` exists, swap it in for the procedural model. */
  async loadOverride(): Promise<boolean> {
    const handle = await tryLoadGlb(this.def);
    if (!handle || this.disposed) return false;
    this.object.remove(this.model.root);
    this.model.dispose();
    this.model = handle;
    this.object.add(handle.root);
    return true;
  }

  /** Place the visual at the interpolated physics state and advance animations. */
  syncVisual(alpha: number, dt: number): void {
    const f = this.flight;
    const o = this.object;
    o.position.lerpVectors(f.prevPos, f.pos, alpha);
    o.quaternion.slerpQuaternions(f.prevQuat, f.quat, alpha);
    const c = this.controls;
    this.model.update(dt, {
      gearPos: f.gearPos, power: f.power, ab: f.abLevel,
      pitch: c.pitch, roll: c.roll, yaw: c.yaw, airbrake: c.airbrake ? 1 : 0,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.object.removeFromParent();
    this.model.dispose();
  }
}
