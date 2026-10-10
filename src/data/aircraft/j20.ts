import type { AircraftDef } from '../../aircraft/AircraftDef';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 20.3;
const m = (x: number): number => x / L;
// </prelude>

/** Long-range stealth interceptor: fast, big weapon bays and a small signature, less nimble than the dogfighters. */
export const J20: AircraftDef = {
  id: 'j20',
  name: 'J-20',
  fullName: 'J-20 Mighty Dragon',
  faction: 'china',
  role: 'Stealth heavy fighter',
  blurb: 'A long-range canard-delta stealth fighter. Fast and hard to see, built for slashing attacks rather than long turning fights.',
  flight: {
    stallSpeed: 57, maxSpeed: 650, twMil: 0.7, twAb: 1.05,
    pitchRate: 0.58, rollRate: 3.0, yawRate: 0.36, gLimit: 9, aoaStall: 26,
    gearHeight: 2.3, bellyHeight: 1.1, energyBleed: 0.9, thrustVectoring: 0,
  },
  ratings: { speed: 5, agility: 3, firepower: 4, durability: 4, stealth: 4 },
  hp: 130, rcs: 0.08,
  gun: { name: 'Type 23-3 (game)', caliber: 23, rounds: 220 },
  countermeasures: { flares: 36, chaff: 24 },
  model: {
    length: L, shapeN: 3.2,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.05, 0, 2.6], [m(0.9), 0.3, 0.22, -0.05, 0.22, 2.8], [m(3.0), 0.75, 0.42, -0.04, 0.4, 3.1], [m(5.2), 1.05, 0.52, -0.03, 0.46, 3.2],
      [m(7.5), 1.4, 0.6, 0, 0.5, 3.3], [m(10.5), 1.75, 0.64, 0, 0.52, 3.4], [m(14.0), 1.9, 0.64, 0, 0.5, 3.4], [m(17.5), 1.7, 0.58, 0, 0.5, 3.2],
      [1, 1.35, 0.5, 0, 0.45, 3.0],
    ],
    pods: [
      { x: 1.2, mirror: true, n: 2.4, capBack: true, rings: [
        [m(5.4), 0.1, 0.1, -0.05, 0.1], [m(6.4), 0.36, 0.34, -0.04, 0.3], [m(7.6), 0.42, 0.42, -0.04, 0.4], [m(9.0), 0.2, 0.2, -0.02, 0.2],
      ] },
    ],
    wing: {
      zRoot: m(9.4), rootChord: 8.0, tipChord: 1.8, span: 12.9, sweep: 4.6, thickness: 0.26, y: -0.12, dihedral: 0.02, xRoot: 1.7,
      flapSpan: 0.45, lerx: { length: 2.6, reach: 0.16, thick: 0.4 },
    },
    canard: { zRoot: m(5.8), rootChord: 2.7, tipChord: 0.95, span: 5.3, sweep: 2.1, y: 0.15, xRoot: 0.95 },
    fins: [
      { x: 1.4, zRoot: m(14.5), rootChord: 4.0, tipChord: 1.6, height: 2.1, sweep: 2.1, cant: 0.33, y: 0.45 },
      { x: 1.05, zRoot: m(13.2), rootChord: 3.6, tipChord: 1.4, height: -1.25, sweep: 1.4, cant: 0.6, rudder: false, y: -0.35 },
    ],
    intakes: [{ x: 1.25, y: -0.12, zFrac: m(7.0), w: 0.95, h: 1.15, len: 3.6, n: 3.4, toe: 0.2 }],
    engines: 2, engineSpacing: 1.05, nozzleRadius: 0.6, nozzleZ: m(19.6),
    canopyZ: m(3.5), canopyLen: 3.5, canopyW: 0.5, canopyH: 0.5,
    features: { chines: true, radome: 0.07, bay: [m(7.8), m(13.5), 0.5], spine: [m(7.5), m(15), 0.5, 0.18], hook: 0.88, sting: false },
    gear: { mainX: 1.7, mainZ: 0.56, noseZ: 0.18, mainR: 0.36, noseR: 0.22 },
    colors: { body: 0x7a828c, accent: 0xffd23a, dark: 0x2c3036 },
  },
};
