import type { AircraftDef } from '../../aircraft/AircraftDef';
import { noseKit, blades, dispensers, bayVents, receptacle, windows } from './kit';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 18.31;
const m = (x: number): number => x / L;
// </prelude>


/** Carrier-bred workhorse: superb at slow speed and high angle of attack, tough, but short on top speed and thrust. */
export const FA18E: AircraftDef = {
  id: 'fa18e',
  name: 'F/A-18E',
  fullName: 'F/A-18E Super Hornet',
  faction: 'west',
  role: 'Carrier multirole fighter',
  blurb: 'Rugged and docile. Holds control at very high angle of attack and takes a beating, but runs out of speed and energy sooner than the rest.',
  flight: {
    stallSpeed: 52, maxSpeed: 560, twMil: 0.55, twAb: 0.92,
    pitchRate: 0.66, rollRate: 3.4, yawRate: 0.4, gLimit: 7.5, aoaStall: 32,
    gearHeight: 2.15, bellyHeight: 1.05, energyBleed: 1.2, thrustVectoring: 0.1,
  },
  ratings: { speed: 3, agility: 3, firepower: 4, durability: 4, stealth: 2 },
  hp: 130, rcs: 1.0,
  gun: { name: 'M61A2 Vulcan', caliber: 20, rounds: 412 },
  countermeasures: { flares: 60, chaff: 30 },
  model: {
    length: L, shapeN: 2.7,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent, widest point above centre]
    sections: [
      [0, 0, 0, -0.05, 0, 2.2], [m(0.7), 0.24, 0.24, -0.05, 0.24], [m(2.0), 0.52, 0.48, -0.03, 0.46, 2.4, 2.8], [m(3.6), 0.74, 0.58, -0.02, 0.56, 2.5, 3.2],
      [m(5.6), 0.95, 0.66, 0, 0.64, 2.8, 3.4], [m(7.6), 1.12, 0.72, 0, 0.7, 3.2, 3.6], [m(10.0), 1.14, 0.74, 0, 0.66, 3.4, 3.8],
      [m(13.0), 1.02, 0.7, 0, 0.6, 3.2, 3.4], [m(16.0), 0.92, 0.6, 0, 0.54, 2.8, 3.0], [1, 0.86, 0.54, 0, 0.5, 2.6, 2.8],
    ],
    pods: [
      { x: 0.6, mirror: true, n: 2.8, capBack: true, rings: [[m(10.5), 0.3, 0.3, 0.1, 0.3], [m(13.0), 0.56, 0.56, 0.06, 0.5], [m(16.5), 0.56, 0.56, 0.02, 0.5], [m(18.1), 0.54, 0.54, 0, 0.5]] },
    ],
    wing: {
      zRoot: m(7.4), rootChord: 5.4, tipChord: 1.65, span: 13.1, sweep: 2.0, thickness: 0.3, y: -0.08, dihedral: 0, xRoot: 1.0,
      flapSpan: 0.5, lerx: { length: 3.9, reach: 0.22, thick: 0.4 }, tipRail: true,
    },
    hstab: { zRoot: m(12.3), rootChord: 3.1, tipChord: 1.0, span: 8.6, sweep: 2.5, y: -0.1, dihedral: -0.04, xRoot: 0.85 },
    fins: [{ x: 0.95, zRoot: m(11.0), rootChord: 3.9, tipChord: 1.35, height: 3.0, sweep: 2.3, cant: 0.35, y: 0.5 }],
    intakes: [{ x: 1.1, y: -0.18, zFrac: m(6.3), w: 1.0, h: 1.3, len: 3.8, n: 4.2, toe: 0.1, rake: 0.2, ramp: true }],
    engines: 2, engineSpacing: 0.6, nozzleRadius: 0.52, canopyZ: m(3.2), canopyLen: 3.1, canopyW: 0.48, canopyH: 0.52,
    airbrake: true, airbrakeAt: [10.8, 1.8, 0.55],
    features: { probe: 'R', gun: [0, 0.1, m(0.9)], radome: 0.07, spine: [m(6.4), m(12), 0.45, 0.14], hook: 0.9 },
    details: [
      ...noseKit(1.8, 0.4),
      ...blades(6.6, 0.74, 7.2, -0.7),
      ...dispensers(13.6, -0.5, 0.45),
      ...bayVents(11.6, 1.08, 0.0),
      ...windows([[0.18, 0.54, 2.9, 0.08]]),
      { k: 'box', p: [0.42, 0.4, 4.4], s: [0.5, 0.03, 1.1], mirror: true, mat: 'dark' },
    ],
    gear: { mainX: 1.5, mainZ: 0.55, noseZ: 0.17, mainR: 0.36, noseR: 0.22 },
    colors: { body: 0x78808a, accent: 0x3aa0ff, dark: 0x2c3138 },
  },
};
