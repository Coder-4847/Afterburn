import type { AircraftDef } from '../../aircraft/AircraftDef';
import { noseKit, blades, dispensers, bayVents, receptacle, windows } from './kit';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 19.43;
const m = (x: number): number => x / L;
// </prelude>


/** Big, fast, powerful. Great top speed and climb, sturdy; wide turns and a large radar signature. */
export const F15C: AircraftDef = {
  id: 'f15c',
  name: 'F-15C',
  fullName: 'F-15C Eagle',
  faction: 'west',
  role: 'Air-superiority fighter',
  blurb: 'Twin-engine muscle. Outruns and out-climbs almost everything and survives damage well, but it is big, loud on radar and turns wide.',
  flight: {
    stallSpeed: 60, maxSpeed: 700, twMil: 0.72, twAb: 1.22,
    pitchRate: 0.6, rollRate: 3.2, yawRate: 0.36, gLimit: 9, aoaStall: 24,
    gearHeight: 2.5, bellyHeight: 1.25, energyBleed: 0.9, thrustVectoring: 0,
  },
  ratings: { speed: 5, agility: 3, firepower: 4, durability: 4, stealth: 1 },
  hp: 140, rcs: 5.0,
  gun: { name: 'M61A1 Vulcan', caliber: 20, rounds: 940 },
  countermeasures: { flares: 40, chaff: 40 },
  model: {
    length: L, shapeN: 3.0,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent, widest point above centre]
    sections: [
      [0, 0, 0, -0.05, 0, 2.2], [m(0.8), 0.26, 0.24, -0.05, 0.24, 2.3], [m(2.4), 0.56, 0.46, -0.04, 0.46, 2.4, 2.8], [m(4.2), 0.78, 0.54, -0.03, 0.54, 2.6, 3.2],
      [m(6.2), 1.0, 0.62, 0, 0.6, 3.0, 3.8], [m(8.0), 1.2, 0.7, 0, 0.62, 3.6, 4.2], [m(11.0), 1.22, 0.76, 0, 0.62, 4.0, 4.4],
      [m(14.0), 1.05, 0.74, 0, 0.6, 3.6, 4.0], [m(17.0), 0.8, 0.68, 0, 0.56, 3.0, 3.4], [1, 0.64, 0.6, 0, 0.5, 2.8, 3.0],
    ],
    pods: [
      // engine nacelles and the tail booms that carry the fins
      { x: 0.95, mirror: true, n: 3.0, capBack: true, rings: [[m(9.5), 0.5, 0.45, -0.04, 0.45], [m(12.0), 0.86, 0.68, 0, 0.62], [m(16.0), 0.86, 0.7, 0, 0.62], [m(18.9), 0.78, 0.62, 0, 0.56]] },
      { x: 1.95, mirror: true, n: 2.8, capBack: true, rings: [[m(11.5), 0.12, 0.1, 0.3, 0.1], [m(13.5), 0.32, 0.44, 0.3, 0.3], [m(17.0), 0.34, 0.46, 0.3, 0.3], [m(19.2), 0.26, 0.34, 0.28, 0.24]] },
    ],
    wing: {
      zRoot: m(8.1), rootChord: 5.9, tipChord: 1.9, span: 13.05, sweep: 3.9, thickness: 0.28, y: 0.35, dihedral: 0.0, xRoot: 1.6,
      flapSpan: 0.5, tipRail: true,
    },
    hstab: { zRoot: m(14.5), rootChord: 3.4, tipChord: 1.2, span: 8.6, sweep: 2.6, y: 0.1, dihedral: 0, xRoot: 1.7 },
    fins: [{ x: 1.95, zRoot: m(12.4), rootChord: 4.7, tipChord: 1.9, height: 2.5, sweep: 2.6, cant: 0.05, y: 0.62 }],
    intakes: [{ x: 1.4, y: -0.12, zFrac: m(7.0), w: 1.0, h: 1.5, len: 4.0, n: 4.6, toe: 0.2, ramp: true, rake: 0.25 }],
    engines: 2, engineSpacing: 0.95, nozzleRadius: 0.62, canopyZ: m(3.4), canopyLen: 3.2, canopyW: 0.5, canopyH: 0.6,
    airbrake: true, airbrakeAt: [8.6, 2.4, 0.72],
    features: { gun: [1.5, 0.1, m(8.6)], radome: 0.07, spine: [m(6.6), m(12.5), 0.55, 0.12], hook: 0.9, sting: true },
    details: [
      ...noseKit(1.9, 0.4),
      ...blades(6.4, 0.68, 7.1, -0.64),
      ...dispensers(14.2, -0.56, 0.8),
      ...bayVents(12.8, 1.1, 0.0),
      ...receptacle(7.2, 0.72),
      { k: 'blister', p: [0, 0.78, 10.4], s: [0.3, 0.12, 0.8] },
    ],
    gear: { mainX: 1.55, mainZ: 0.56, noseZ: 0.17, mainR: 0.38, noseR: 0.22 },
    colors: { body: 0x838b95, accent: 0x3aa0ff, dark: 0x30353c },
  },
};
