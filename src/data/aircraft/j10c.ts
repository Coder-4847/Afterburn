import type { AircraftDef } from '../../aircraft/AircraftDef';
import { noseKit, blades, dispensers, bayVents, receptacle, windows } from './kit';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 16.43;
const m = (x: number): number => x / L;
// </prelude>


/** Light canard-delta dogfighter: excellent turn, good thrust-to-weight, fragile. */
export const J10C: AircraftDef = {
  id: 'j10c',
  name: 'J-10C',
  fullName: 'J-10C Vigorous Dragon',
  faction: 'china',
  role: 'Multirole fighter',
  blurb: 'A nimble single-engine canard delta. Turns hard and climbs well for its size, but there is not much structure behind the skin.',
  flight: {
    stallSpeed: 49, maxSpeed: 600, twMil: 0.66, twAb: 1.08,
    pitchRate: 0.8, rollRate: 3.6, yawRate: 0.38, gLimit: 9, aoaStall: 28,
    gearHeight: 1.95, bellyHeight: 1, energyBleed: 0.95, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 5, firepower: 3, durability: 2, stealth: 2 },
  hp: 100, rcs: 1.5,
  gun: { name: 'Type 23-3', caliber: 23, rounds: 200 },
  countermeasures: { flares: 30, chaff: 30 },
  model: {
    length: L, shapeN: 2.6,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent, widest point above centre]
    sections: [
      [0, 0, 0, -0.05, 0, 2.2], [m(0.5), 0.18, 0.18, -0.05, 0.18, 2.2], [m(1.8), 0.42, 0.4, -0.04, 0.38, 2.3, 2.8], [m(3.2), 0.6, 0.54, -0.02, 0.5, 2.5, 3.2, -0.03],
      [m(4.8), 0.78, 0.64, 0, 0.6, 2.7, 3.4, -0.05], [m(6.5), 0.92, 0.72, 0, 0.66, 2.9, 3.6, -0.05], [m(8.5), 1.02, 0.78, 0, 0.7, 3.0, 3.6],
      [m(11.5), 1.0, 0.76, 0, 0.66, 3.0, 3.4], [m(14.0), 0.82, 0.64, 0, 0.58, 2.8], [1, 0.64, 0.56, 0, 0.52, 2.4],
    ],
    wing: { zRoot: m(6.9), rootChord: 5.4, tipChord: 1.2, span: 9.75, sweep: 4.1, thickness: 0.24, y: -0.3, dihedral: 0, xRoot: 0.9, flapSpan: 0.4, tipRail: true },
    canard: { zRoot: m(4.7), rootChord: 1.9, tipChord: 0.75, span: 3.9, sweep: 1.3, y: 0.3, xRoot: 0.55 },
    fins: [
      { x: 0, zRoot: m(9.9), rootChord: 4.2, tipChord: 1.5, height: 2.5, sweep: 2.8, cant: 0, y: 0.65 },
      { x: 0.65, zRoot: m(11.6), rootChord: 2.4, tipChord: 1.1, height: -0.7, sweep: 0.9, cant: 0.4, rudder: false, y: -0.5 },
    ],
    intakes: [{ x: 0, y: -0.95, zFrac: m(5.6), w: 1.4, h: 0.95, len: 3.8, n: 3.5, drop: -0.7, rake: 0.25 }],
    engines: 1, nozzleRadius: 0.58, canopyZ: m(3.1), canopyLen: 2.6, canopyW: 0.44, canopyH: 0.52,
    features: { radome: 0.07, spine: [m(5.9), m(11.0), 0.42, 0.16], hook: 0.88 },
    details: [
      ...noseKit(1.6, 0.36),
      ...blades(6.0, 0.7, 6.6, -0.64),
      ...dispensers(12.6, -0.52, 0.3),
      ...bayVents(11.0, 0.98, 0.1),
      ...windows([[0.0, 0.6, 2.9, 0.1]]),
      { k: 'blister', p: [0, 0.72, 10.0], s: [0.18, 0.14, 1.1] },
    ],
    gear: { mainX: 1.2, mainZ: 0.55, noseZ: 0.19, mainR: 0.3, noseR: 0.2 },
    colors: { body: 0x939ba6, accent: 0xffd23a, dark: 0x30363d },
  },
};
