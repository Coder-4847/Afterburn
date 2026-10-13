import type { AircraftDef } from '../../aircraft/AircraftDef';
import { noseKit, blades, dispensers, bayVents, receptacle, windows } from './kit';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 21.9;
const m = (x: number): number => x / L;
// </prelude>


/** The ultimate thrust-vectoring dogfighter: monstrous agility and durability, but loud on radar and heavy on fuel burn. */
export const SU35S: AircraftDef = {
  id: 'su35s',
  name: 'Su-35S',
  fullName: 'Su-35S Flanker-E',
  faction: 'russia',
  role: 'Heavy air-superiority fighter',
  maneuver: 'kulbit',
  blurb: 'Huge wing, huge engines, 3D thrust vectoring. Can hang on the edge of a stall and swing its nose at you, and it absorbs a lot of punishment.',
  flight: {
    stallSpeed: 51, maxSpeed: 640, twMil: 0.68, twAb: 1.14,
    pitchRate: 0.84, rollRate: 3.3, yawRate: 0.44, gLimit: 9, aoaStall: 32,
    gearHeight: 2.6, bellyHeight: 1.3, energyBleed: 0.9, thrustVectoring: 1,
  },
  ratings: { speed: 4, agility: 5, firepower: 5, durability: 5, stealth: 1 },
  hp: 135, rcs: 3.0,
  gun: { name: 'GSh-30-1', caliber: 30, rounds: 150 },
  countermeasures: { flares: 96, chaff: 48 },
  model: {
    length: L, shapeN: 2.8,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent, widest point above centre]
    sections: [
      [0, 0, 0, -0.05, 0, 2.2], [m(0.9), 0.3, 0.28, -0.05, 0.3, 2.3], [m(2.8), 0.66, 0.46, -0.04, 0.46, 2.5, 2.9, -0.04], [m(4.8), 0.95, 0.58, -0.02, 0.52, 2.7, 3.1, -0.04],
      [m(7.0), 1.18, 0.66, 0, 0.5, 3.0, 3.4, 0], [m(9.5), 1.04, 0.68, 0.05, 0.5, 3.2, 3.6], [m(13.0), 0.9, 0.62, 0.05, 0.46, 3.0, 3.4], [m(17.0), 0.72, 0.5, 0.05, 0.4],
      [m(21.0), 0.5, 0.4, 0.05, 0.35], [1, 0.4, 0.34, 0.05, 0.3],
    ],
    pods: [
      { x: 1.35, mirror: true, n: 2.8, capBack: true, rings: [
        [m(7.2), 0.6, 0.54, -0.18, 0.5], [m(9.2), 0.8, 0.66, -0.1, 0.56], [m(13), 0.86, 0.7, 0, 0.62], [m(17.5), 0.82, 0.68, 0, 0.6], [m(21.2), 0.76, 0.62, 0, 0.58], [m(21.8), 0.72, 0.6, 0, 0.56],
      ] },
      // the tail boom between the nacelles, and the ventral keel under it
      { x: 0, n: 2.4, capBack: true, rings: [[m(11), 0.1, 0.08, -0.5, 0.08], [m(14), 0.34, 0.2, -0.46, 0.18], [m(19), 0.3, 0.18, -0.4, 0.16], [m(21.6), 0.2, 0.1, -0.36, 0.1]] },
    ],
    wing: {
      zRoot: m(8.7), rootChord: 6.9, tipChord: 1.6, span: 15.3, sweep: 5.4, thickness: 0.3, y: 0.12, dihedral: 0.03, xRoot: 1.6,
      flapSpan: 0.4, lerx: { length: 4.3, reach: 0.22, thick: 0.4 }, pods: true,
    },
    hstab: { zRoot: m(18.0), rootChord: 3.4, tipChord: 1.3, span: 9.8, sweep: 2.4, y: 0.1, dihedral: 0, xRoot: 1.95 },
    fins: [{ x: 2.35, zRoot: m(15.2), rootChord: 5.3, tipChord: 1.8, height: 3.0, sweep: 3.0, cant: 0.04, y: 0.7 }],
    intakes: [{ x: 1.35, y: -0.5, zFrac: m(6.9), w: 1.35, h: 1.2, len: 3.4, n: 3.2, toe: 0.1, ramp: true }],
    engines: 2, engineSpacing: 1.35, nozzleRadius: 0.7, vectoringNozzles: true,
    airbrake: true, airbrakeAt: [10.6, 3.0, 0.85],
    canopyZ: m(3.5), canopyLen: 3.3, canopyW: 0.54, canopyH: 0.6,
    features: { irst: true, probe: 'L', gun: [1.1, 0.0, m(8.2)], radome: 0.07, spine: [m(7.0), m(14.5), 0.7, 0.34], hook: 0.93, sting: true },
    details: [
      ...noseKit(2.0, 0.5),
      ...blades(8.0, 0.7, 9.0, -0.6),
      ...dispensers(18.8, -0.4, 0.9),
      ...receptacle(9.6, 0.68),
      ...bayVents(14.0, 1.05, 0.2),
      { k: 'blister', p: [0, 0.74, 16.2], s: [0.16, 0.14, 1.5] },
      { k: 'blade', p: [0.5, 0.7, 7.6], s: [0.2, 0.3, 0.03], mirror: true },
    ],
    gear: { mainX: 1.75, mainZ: 0.55, noseZ: 0.18, mainR: 0.4, noseR: 0.24 },
    colors: { body: 0x7d8794, accent: 0xff4a4a, dark: 0x30363d, camo: 0x56657a },
  },
};
