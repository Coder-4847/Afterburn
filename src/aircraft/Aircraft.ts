import type { DifficultyDef } from '../data/difficulty';
import { FlightModel, makeFlightInput, type FlightInput } from '../flight/FlightModel';
import type { AircraftDef } from './AircraftDef';
import { JetModel } from './ProceduralJet';

/**
 * One aircraft in the world: flight state + visual model + the controls somebody (player or AI) is applying.
 * Rendering interpolates between the last two physics states so motion stays smooth at any frame rate.
 */
export class Aircraft {
  readonly flight: FlightModel;
  readonly model: JetModel;
  readonly controls: FlightInput = makeFlightInput();

  constructor(readonly def: AircraftDef, difficulty: DifficultyDef, teamColor: number) {
    this.flight = new FlightModel(def, difficulty);
    this.model = new JetModel(def, teamColor);
  }

  get object() {
    return this.model.root;
  }

  /** Place the visual at the interpolated physics state and advance animations. */
  syncVisual(alpha: number, dt: number): void {
    const f = this.flight;
    const o = this.model.root;
    o.position.lerpVectors(f.prevPos, f.pos, alpha);
    o.quaternion.slerpQuaternions(f.prevQuat, f.quat, alpha);
    this.model.update(dt, { gearPos: f.gearPos, power: f.power, ab: f.abLevel });
  }
}
