import type { AircraftDef } from '../../aircraft/AircraftDef';
import { noseKit, blades, dispensers, bayVents, receptacle, windows } from './kit';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 15.96;
const m = (x: number): number => x / L;
// </prelude>


/** Thrust-rich canard delta: fast, strong in a sustained turn, very good energy retention. */
export const TYPHOON: AircraftDef = {
  id: 'typhoon',
  name: 'Typhoon',
  fullName: 'Eurofighter Typhoon',
  faction: 'west',
  role: 'Air-superiority fighter',
  blurb: 'Big engines and an unstable canard delta. Accelerates hard, holds its speed through the turn and stays dangerous in a vertical fight.',
  flight: {
    stallSpeed: 51, maxSpeed: 650, twMil: 0.7, twAb: 1.18,
    pitchRate: 0.76, rollRate: 3.5, yawRate: 0.38, gLimit: 9, aoaStall: 28,
    gearHeight: 1.95, bellyHeight: 1, energyBleed: 0.8, thrustVectoring: 0,
  },
  ratings: { speed: 5, agility: 4, firepower: 4, durability: 3, stealth: 2 },
  hp: 110, rcs: 0.9,
  gun: { name: 'Mauser BK-27', caliber: 27, rounds: 150 },
  countermeasures: { flares: 40, chaff: 40 },
  model: {
    length: L, shapeN: 2.7,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent, widest point above centre]
    sections: [
      [0, 0, 0, -0.05, 0, 2.1], [m(0.6), 0.22, 0.22, -0.05, 0.22], [m(1.8), 0.46, 0.44, -0.04, 0.42, 2.3, 2.8], [m(3.4), 0.66, 0.58, -0.02, 0.54, 2.5, 3.2],
      [m(5.2), 0.84, 0.66, 0, 0.62, 2.8, 3.4], [m(7.4), 1.0, 0.72, 0, 0.62, 3.0, 3.6], [m(9.6), 1.05, 0.74, 0, 0.6, 3.2, 3.6],
      [m(12.0), 0.96, 0.68, 0, 0.56, 3.0, 3.4], [m(14.2), 0.86, 0.6, 0, 0.52, 2.8], [1, 0.8, 0.54, 0, 0.5, 2.6],
    ],
    wing: { zRoot: m(5.0), rootChord: 7.0, tipChord: 0.95, span: 10.95, sweep: 6.2, thickness: 0.28, y: -0.2, dihedral: 0, xRoot: 0.85, flapSpan: 0.4, tipRail: true },
    canard: { zRoot: m(3.9), rootChord: 2.1, tipChord: 0.7, span: 3.7, sweep: 1.4, y: 0.3, xRoot: 0.55 },
    fins: [{ x: 0, zRoot: m(9.0), rootChord: 4.4, tipChord: 1.3, height: 2.5, sweep: 2.6, cant: 0, y: 0.62 }],
    intakes: [{ x: 0, y: -0.82, zFrac: m(5.0), w: 1.6, h: 0.85, len: 3.8, n: 3.4, drop: -0.5, rake: 0.2 }],
    engines: 2, engineSpacing: 0.52, nozzleRadius: 0.5, canopyZ: m(3.4), canopyLen: 2.6, canopyW: 0.46, canopyH: 0.52,
    features: { probe: 'R', radome: 0.07, spine: [m(6.2), m(10.5), 0.45, 0.14], hook: 0.88, sting: false },
    details: [
      ...noseKit(1.7, 0.38),
      ...blades(6.3, 0.7, 6.8, -0.62),
      ...dispensers(12.0, -0.5, 0.5),
      ...windows([[0.22, 0.4, 1.4, 0.1], [0.0, 0.62, 3.0, 0.08]]),
      { k: 'blister', p: [0, 0.72, 10.0], s: [0.14, 0.1, 1.0], mat: 'dark' },
      { k: 'box', p: [0, 0.74, 7.6], s: [0.4, 0.03, 0.9], mat: 'dark' },
    ],
    gear: { mainX: 1.4, mainZ: 0.56, noseZ: 0.18, mainR: 0.34, noseR: 0.2 },
    colors: { body: 0x8c939c, accent: 0x3aa0ff, dark: 0x30363d },
  },
};
