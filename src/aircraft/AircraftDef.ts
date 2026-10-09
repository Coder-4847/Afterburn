/**
 * Data-driven aircraft definition. Adding an aircraft = adding one of these objects in /src/data/aircraft
 * and registering it in /src/data/aircraft/index.ts. Nothing else needs to change.
 */
export type Faction = 'west' | 'russia' | 'china';

export interface FlightParams {
  /** 1G stall speed, sea level, clean (m/s). Sets how much lift the wing makes per m/s^2. */
  stallSpeed: number;
  /** Max speed at sea level with afterburner (m/s). Parasitic drag is derived from this + thrust. */
  maxSpeed: number;
  /** Thrust / weight at military power and with afterburner. */
  twMil: number;
  twAb: number;
  /** Command limits at full authority (rad/s). */
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  /** Structural G limit (pitch rate is capped to this at speed). */
  gLimit: number;
  /** Stall angle of attack (degrees). */
  aoaStall: number;
  /** CG height above the ground when sitting on the wheels / on the belly (m). */
  gearHeight: number;
  bellyHeight: number;
  /** Multiplier on induced drag: >1 bleeds energy faster in hard turns (heavy / high wing loading), <1 holds energy. */
  energyBleed: number;
  /** 0..1: thrust vectoring. Keeps control authority at low speed and extends usable AoA. */
  thrustVectoring: number;
}

export interface WingSpec {
  /** Fraction along the fuselage (from the nose) of the wing root leading edge. */
  zRoot: number;
  rootChord: number;
  tipChord: number;
  /** Tip to tip, metres. */
  span: number;
  /** Tip leading edge set back from the root leading edge (m). */
  sweep: number;
  thickness: number;
  y: number;
  dihedral: number;
  /** Fraction of the half span covered by the inboard flap (rest is the aileron). Default 0.42. */
  flapSpan?: number;
  /** Leading-edge root extension: how far forward of the root LE (m) and how far out along the span (0..1). */
  lerx?: { length: number; reach: number };
  /** ECM / launcher pods on the wingtips. */
  pods?: boolean;
}

export interface TailplaneSpec {
  zRoot: number;
  rootChord: number;
  tipChord: number;
  span: number;
  sweep: number;
  y: number;
  dihedral: number;
}

export interface FinSpec {
  x: number;
  zRoot: number;
  rootChord: number;
  tipChord: number;
  /** Negative = ventral fin hanging below the fuselage. */
  height: number;
  sweep: number;
  /** Outward tilt from vertical (rad). */
  cant: number;
  /** Has a hinged rudder. Default true for upper fins. */
  rudder?: boolean;
}

export interface IntakeSpec {
  /** Centre line offset (m), y and z (fraction of the length). */
  x: number;
  y: number;
  zFrac: number;
  w: number;
  h: number;
  len: number;
}

/** Parameters for the procedural jet builder (see aircraft/ProceduralJet.ts). */
export interface ModelSpec {
  length: number;
  /** Fuselage cross sections: [z fraction 0(nose)..1(tail), half width, half height, y centre]. */
  sections: [number, number, number, number][];
  /** Cross-section squareness: 2 = ellipse, 4 = boxy. Default 2.5. */
  shapeN?: number;
  wing: WingSpec;
  hstab?: TailplaneSpec;
  canard?: Omit<TailplaneSpec, 'dihedral'>;
  fins: FinSpec[];
  intakes: IntakeSpec[];
  engines: 1 | 2;
  /** Engine centre-line offset when twin (m). */
  engineSpacing?: number;
  nozzleRadius: number;
  /** Nozzles tilt with pitch/yaw input. */
  vectoringNozzles?: boolean;
  canopyZ: number;
  canopyLen?: number;
  /** Dorsal airbrake panel. */
  airbrake?: boolean;
  colors: { body: number; accent: number; dark: number; camo?: number };
}

export interface GunSpec {
  name: string;
  caliber: number; // mm
  rounds: number;
}

export interface AircraftDef {
  id: string;
  name: string;
  fullName: string;
  faction: Faction;
  role: string;
  /** One or two lines for the hangar. */
  blurb: string;
  flight: FlightParams;
  /** 1..5 stars shown in the hangar. */
  ratings: { speed: number; agility: number; firepower: number; durability: number; stealth: number };
  /** Structural hit points and radar cross-section (m^2): used by damage and lock-range in Phase 3. */
  hp: number;
  rcs: number;
  gun: GunSpec;
  countermeasures: { flares: number; chaff: number };
  model: ModelSpec;
  /** Optional camera overrides. By default derived from the model length. */
  camera?: { distance?: number; height?: number; cockpit?: [number, number, number] };
}

/** Chase-camera distance/height and cockpit eye point, derived from the model unless overridden. */
export function cameraFor(def: AircraftDef): { distance: number; height: number; cockpit: [number, number, number] } {
  const L = def.model.length;
  const secs = def.model.sections;
  const f = def.model.canopyZ;
  let top = 0.9;
  for (let i = 0; i < secs.length - 1; i++) {
    if (f >= secs[i][0] && f <= secs[i + 1][0]) top = secs[i][3] + secs[i][2];
  }
  const o = def.camera ?? {};
  return {
    distance: o.distance ?? L * 1.72,
    height: o.height ?? L * 0.36,
    cockpit: o.cockpit ?? [0, top + 0.12, -L / 2 + f * L - 0.1],
  };
}
