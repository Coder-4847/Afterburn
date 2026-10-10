import type { AircraftDef } from '../../aircraft/AircraftDef';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 15.03;
const m = (x: number): number => x / L;
// </prelude>

/** Light, agile, energy-efficient. Best roll rate in the game; modest thrust and structure. */
export const F16C: AircraftDef = {
  id: 'f16c',
  name: 'F-16C',
  fullName: 'F-16C Fighting Falcon',
  faction: 'west',
  role: 'Multirole fighter',
  blurb: 'The benchmark light fighter. Superb roll and low-speed manoeuvrability, forgiving to fly, but fragile and short on thrust.',
  flight: {
    stallSpeed: 54, maxSpeed: 580, twMil: 0.62, twAb: 1.08,
    pitchRate: 0.74, rollRate: 3.9, yawRate: 0.38, gLimit: 9, aoaStall: 26,
    gearHeight: 1.9, bellyHeight: 0.95, energyBleed: 1.0, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 5, firepower: 3, durability: 2, stealth: 2 },
  hp: 100, rcs: 1.2,
  gun: { name: 'M61A1 Vulcan', caliber: 20, rounds: 511 },
  countermeasures: { flares: 30, chaff: 30 },
  model: {
    length: L, shapeN: 2.6,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.04, 0], [m(0.35), 0.15, 0.15, -0.04], [m(1.2), 0.36, 0.36, -0.04], [m(2.3), 0.52, 0.5, -0.02, 0.48],
      [m(3.3), 0.62, 0.58, 0, 0.56], [m(4.5), 0.76, 0.66, 0, 0.62], [m(5.8), 0.9, 0.72, 0, 0.7], [m(7.6), 0.98, 0.78, 0, 0.72],
      [m(9.6), 0.95, 0.8, 0, 0.72], [m(11.6), 0.85, 0.74, 0, 0.66], [m(13.3), 0.71, 0.64, 0, 0.6], [m(14.6), 0.62, 0.58, 0, 0.57], [1, 0.6, 0.57, 0, 0.57],
    ],
    wing: {
      zRoot: m(5.55), rootChord: 4.75, tipChord: 1.2, span: 9.45, sweep: 3.25, thickness: 0.22, y: -0.28, dihedral: 0, xRoot: 0.8,
      flapSpan: 0.45, lerx: { length: 1.7, reach: 0.1, thick: 0.45 }, tipRail: true,
    },
    hstab: { zRoot: m(11.75), rootChord: 3.1, tipChord: 1.05, span: 5.58, sweep: 1.85, y: -0.12, dihedral: -0.04, xRoot: 0.66 },
    fins: [
      { x: 0, zRoot: m(8.5), rootChord: 4.2, tipChord: 1.25, height: 2.4, sweep: 2.5, cant: 0, y: 0.62 },
      { x: 0.62, zRoot: m(11.0), rootChord: 2.6, tipChord: 1.2, height: -0.62, sweep: 0.8, cant: 0.35, rudder: false, y: -0.5 },
    ],
    intakes: [{ x: 0, y: -0.95, zFrac: m(4.85), w: 1.32, h: 0.94, len: 3.1, n: 3.2, drop: -0.7 }],
    engines: 1, nozzleRadius: 0.56, canopyZ: m(3.05), canopyLen: 2.6, canopyW: 0.43, canopyH: 0.5,
    features: { gun: [-0.64, 0.1, m(4.2)], radome: 0.07, spine: [m(5.7), m(10.2), 0.4, 0.16], hook: 0.88 },
    gear: { mainX: 1.18, mainZ: 0.54, noseZ: 0.19, mainR: 0.3, noseR: 0.2 },
    colors: { body: 0x7f868f, accent: 0x3aa0ff, dark: 0x2a3038 },
  },
};
