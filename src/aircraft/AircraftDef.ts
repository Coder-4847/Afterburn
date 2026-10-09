/**
 * Data-driven aircraft definition. Adding an aircraft = adding one of these objects in /src/data/aircraft.
 * Phase 1 uses `flight`, `model`, `camera`. Later phases fill in modules, hardpoints, guns, countermeasures.
 */
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
}

/** Parameters for the procedural jet builder (see aircraft/ProceduralJet.ts). */
export interface ModelSpec {
  length: number;
  /** Fuselage cross sections: [z fraction 0(nose)..1(tail), half width, half height, y centre]. */
  sections: [number, number, number, number][];
  wing: {
    zRoot: number; // fraction along the fuselage of the wing root leading edge
    rootChord: number;
    tipChord: number;
    span: number; // tip to tip
    sweep: number; // tip leading edge set back from root leading edge (m)
    thickness: number;
    y: number;
    dihedral: number;
  };
  hstab: { zRoot: number; rootChord: number; tipChord: number; span: number; sweep: number; y: number; dihedral: number };
  fins: { x: number; zRoot: number; rootChord: number; tipChord: number; height: number; sweep: number; cant: number }[];
  canard?: { zRoot: number; rootChord: number; tipChord: number; span: number; sweep: number; y: number };
  engines: number;
  nozzleRadius: number;
  canopyZ: number;
  colors: { body: number; accent: number; dark: number };
}

export interface AircraftDef {
  id: string;
  name: string;
  fullName: string;
  faction: 'west' | 'russia' | 'china';
  role: string;
  flight: FlightParams;
  /** 1..5 stars shown in the hangar. */
  ratings: { speed: number; agility: number; firepower: number; durability: number; stealth: number };
  model: ModelSpec;
  camera: { distance: number; height: number; cockpit: [number, number, number] };
}
