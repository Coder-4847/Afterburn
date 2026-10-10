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
  /** Where the wing leaves the fuselage side (m from the centre line). Default: a bit inside the fuselage skin. */
  xRoot?: number;
  /** Fraction of the half span covered by the inboard flap (rest is the aileron). Default 0.42. */
  flapSpan?: number;
  /** Leading-edge root extension: how far forward of the root LE (m) and how far out along the span (0..1). */
  lerx?: { length: number; reach: number; /** Thickness as a fraction of the wing root thickness (default 0.5). */ thick?: number };
  /** ECM / launcher pods on the wingtips. */
  pods?: boolean;
  /** Wingtip launch rails (a thin dark rail on each tip). */
  tipRail?: boolean;
}

export interface TailplaneSpec {
  zRoot: number;
  rootChord: number;
  tipChord: number;
  span: number;
  sweep: number;
  y: number;
  dihedral: number;
  /** Where the surface leaves the fuselage / boom (m from the centre line). */
  xRoot?: number;
  thickness?: number;
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
  /** Height of the fin root above the centre line (m). Default: the top (or bottom) of the fuselage there. */
  y?: number;
  thickness?: number;
}

export interface IntakeSpec {
  /** Centre line offset (m), y and z (fraction of the length). */
  x: number;
  y: number;
  zFrac: number;
  w: number;
  h: number;
  len: number;
  /** Squareness of the mouth: 2 = ellipse, 4+ = a rounded rectangle. Default 3.6. */
  n?: number;
  /** The duct moves toward the centre line by this much over its length (m). */
  toe?: number;
  /** The duct moves down by this much over its length (m). */
  drop?: number;
  /** A thin boundary-layer splitter plate beside the mouth (default true). */
  splitter?: boolean;
  /** Lip rake: the mouth plane leans (z shift per metre of height; + = top further aft). */
  rake?: number;
  /** A wedge ramp visible inside the mouth (F-15, F-22, MiG-29, Su-27). */
  ramp?: boolean;
  /** Vertical lean of the duct sides (outward toward the bottom, m over the mouth height). */
  cant?: number;
}

/**
 * Section of the fuselage: [z fraction 0(nose)..1(tail), half width, half height above yc, y centre, half height below yc (default: same),
 * top exponent (default shapeN), bottom exponent (default: top), height of the widest point above yc (default 0: a shoulder or chine line)].
 */
export type Section = [number, number, number, number, number?, number?, number?, number?];

/** An extra lofted body: engine nacelle, tail boom, intake bump, conformal fairing. */
/** A small fitted part: blister, box, cylinder, antenna blade, vent grille, cone. Positions are metres (z from the nose). */
export interface DetailSpec {
  k: 'blister' | 'box' | 'cyl' | 'blade' | 'vent' | 'cone';
  /** x (right), y (up), z (metres from the nose). */
  p: [number, number, number];
  /** blister: radii x,y,z. box: width, height, length. cyl/cone: radius, length (along z), radius at the far end for a cone. blade: height, chord, thickness. vent: width, length, slats. */
  s: [number, number, number];
  /** Rotation about x, y, z (rad). */
  r?: [number, number, number];
  /** Also place the mirror image. */
  mirror?: boolean;
  mat?: 'body' | 'dark' | 'strut' | 'glass' | 'accent' | 'intake';
}

export interface PodSpec {
  /** Centre line offset (m). */
  x: number;
  /** Also build the mirror image. */
  mirror?: boolean;
  rings: Section[];
  mat?: 'body' | 'dark' | 'intake' | 'glass';
  /** Default cross-section exponent. */
  n?: number;
  /** Close the front with a dark disc (an intake mouth). */
  mouth?: boolean;
  /** Close the rear end. */
  capBack?: boolean;
  segments?: number;
}

export interface ModelFeatures {
  /** Sharp forebody chines (F-22, Su-57, J-20, J-35). */
  chines?: boolean;
  /** Infra-red search and track ball ahead of the windscreen. */
  irst?: boolean;
  /** Fixed refuelling probe on this side of the nose. */
  probe?: 'L' | 'R';
  /** Gun muzzle: x (m), y (m) and z (fraction). */
  gun?: [number, number, number];
  /** Where the radome ends (fraction of the length). Default 0.1. */
  radome?: number;
  /** Ventral weapons bay doors: z start / end (fractions) and half width (m). */
  bay?: [number, number, number];
  /** A second, raised dorsal fairing behind the canopy: [z0, z1, half width, height] (fractions, m). */
  spine?: [number, number, number, number];
  /** Tail sting between the engines. Default true on twins. */
  sting?: boolean;
  /** Arrestor hook position (fraction). */
  hook?: number;
}

/** Parameters for the procedural jet builder (see aircraft/ProceduralJet.ts). */
export interface ModelSpec {
  length: number;
  /** Fuselage cross sections: [z fraction 0(nose)..1(tail), half width, half height, y centre, half height below, top exponent, bottom exponent]. */
  sections: Section[];
  /** Cross-section squareness: 2 = ellipse, 4 = boxy. Default 2.5. */
  shapeN?: number;
  wing: WingSpec;
  hstab?: TailplaneSpec;
  canard?: Omit<TailplaneSpec, 'dihedral'>;
  fins: FinSpec[];
  intakes: IntakeSpec[];
  pods?: PodSpec[];
  /** Small fitted parts: antennas, blisters, vents, fairings, hatches. */
  details?: DetailSpec[];
  engines: 1 | 2;
  /** Engine centre-line offset when twin (m). */
  engineSpacing?: number;
  nozzleRadius: number;
  /** Nozzle width over height (default 1). */
  nozzleAspect?: number;
  /** Nozzle style: round petals (default) or a rectangular two-dimensional nozzle. */
  nozzleStyle?: 'round' | 'flat';
  /** Nozzle exit position (fraction of the length). Default just behind the end of the fuselage. */
  nozzleZ?: number;
  /** Nozzle height above the centre line (default: the last fuselage station's). */
  nozzleY?: number;
  /** Nozzles tilt with pitch/yaw input. */
  vectoringNozzles?: boolean;
  /** Start of the canopy (fraction of the length) and its glass length (m). */
  canopyZ: number;
  canopyLen?: number;
  /** Half width and height of the bubble (m). */
  canopyW?: number;
  canopyH?: number;
  /** Two seats in tandem under one long canopy. */
  tandem?: boolean;
  /** Dorsal airbrake panel. */
  airbrake?: boolean;
  /** Airbrake placement: start z (m from the nose), length and half width (m). */
  airbrakeAt?: [number, number, number];
  features?: ModelFeatures;
  /** Landing gear placement: main wheel offset (m), main leg z and nose leg z (fractions). */
  gear?: { mainX?: number; mainZ?: number; noseZ?: number; mainR?: number; noseR?: number };
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
  const glass = def.model.canopyLen ?? 2;
  return {
    distance: o.distance ?? L * 1.72,
    height: o.height ?? L * 0.36,
    cockpit: o.cockpit ?? [0, top + 0.2, -L / 2 + f * L + glass * 0.35],
  };
}
