import type { AircraftDef } from '../../aircraft/AircraftDef';

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
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.05, 0], [m(0.8), 0.28, 0.28, -0.05], [m(2.4), 0.58, 0.52, -0.03, 0.5], [m(4.2), 0.8, 0.6, -0.02, 0.56],
      [m(6.5), 1.1, 0.7, 0, 0.62], [m(8.5), 1.45, 0.78, 0, 0.62], [m(11.0), 1.85, 0.8, 0, 0.64], [m(14.0), 1.8, 0.78, 0, 0.6],
      [m(17.0), 1.7, 0.72, 0, 0.56], [1, 1.62, 0.64, 0, 0.5],
    ],
    wing: {
      zRoot: m(8.1), rootChord: 5.9, tipChord: 1.9, span: 13.05, sweep: 3.9, thickness: 0.28, y: 0.35, dihedral: 0.0, xRoot: 1.6,
      flapSpan: 0.5, tipRail: true,
    },
    hstab: { zRoot: m(14.5), rootChord: 3.4, tipChord: 1.2, span: 8.6, sweep: 2.6, y: 0.1, dihedral: 0, xRoot: 1.7 },
    fins: [{ x: 1.95, zRoot: m(12.4), rootChord: 4.7, tipChord: 1.9, height: 2.5, sweep: 2.6, cant: 0.05, y: 0.55 }],
    intakes: [{ x: 1.4, y: -0.12, zFrac: m(7.0), w: 1.0, h: 1.5, len: 4.0, n: 4.4, toe: 0.2 }],
    engines: 2, engineSpacing: 0.95, nozzleRadius: 0.62, canopyZ: m(3.4), canopyLen: 3.2, canopyW: 0.5, canopyH: 0.6,
    airbrake: true,
    features: { gun: [1.5, 0.1, m(8.6)], radome: 0.07, spine: [m(6.6), m(12.5), 0.55, 0.12], hook: 0.9, sting: true },
    gear: { mainX: 1.55, mainZ: 0.56, noseZ: 0.17, mainR: 0.38, noseR: 0.22 },
    colors: { body: 0x838b95, accent: 0x3aa0ff, dark: 0x30353c },
  },
};
