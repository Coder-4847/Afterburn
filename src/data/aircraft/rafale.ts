import type { AircraftDef } from '../../aircraft/AircraftDef';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 15.27;
const m = (x: number): number => x / L;
// </prelude>

/** Close-coupled canard delta: superb low-speed turner and quick to accelerate, light on structure. */
export const RAFALE: AircraftDef = {
  id: 'rafale',
  name: 'Rafale C',
  fullName: 'Dassault Rafale C',
  faction: 'west',
  role: 'Omnirole fighter',
  blurb: 'Canard-delta agility with strong low-speed handling and a small signature for its class. A sharp turner that loves a knife fight.',
  flight: {
    stallSpeed: 48, maxSpeed: 600, twMil: 0.62, twAb: 1.02,
    pitchRate: 0.8, rollRate: 3.6, yawRate: 0.4, gLimit: 9, aoaStall: 30,
    gearHeight: 1.95, bellyHeight: 1, energyBleed: 0.85, thrustVectoring: 0.1,
  },
  ratings: { speed: 4, agility: 5, firepower: 4, durability: 3, stealth: 3 },
  hp: 105, rcs: 1.0,
  gun: { name: 'GIAT 30M791', caliber: 30, rounds: 125 },
  countermeasures: { flares: 40, chaff: 40 },
  model: {
    length: L, shapeN: 2.6,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.05, 0], [m(0.6), 0.22, 0.22, -0.05], [m(1.8), 0.46, 0.44, -0.04, 0.42], [m(3.3), 0.64, 0.56, -0.02, 0.54],
      [m(5.0), 0.8, 0.64, 0, 0.62], [m(7.0), 0.95, 0.7, 0, 0.62], [m(9.2), 0.98, 0.72, 0, 0.6], [m(11.5), 0.92, 0.68, 0, 0.56],
      [m(13.5), 0.82, 0.6, 0, 0.52], [1, 0.74, 0.54, 0, 0.5],
    ],
    wing: { zRoot: m(6.1), rootChord: 6.2, tipChord: 1.0, span: 10.8, sweep: 5.3, thickness: 0.26, y: -0.2, dihedral: 0, xRoot: 0.75, flapSpan: 0.4, tipRail: true },
    canard: { zRoot: m(4.2), rootChord: 2.0, tipChord: 0.7, span: 3.6, sweep: 1.2, y: 0.35, xRoot: 0.5 },
    fins: [{ x: 0, zRoot: m(9.4), rootChord: 4.1, tipChord: 1.4, height: 2.4, sweep: 2.5, cant: 0, y: 0.6 }],
    intakes: [{ x: 0.98, y: -0.45, zFrac: m(5.2), w: 0.85, h: 1.0, len: 3.4, n: 2.8, toe: 0.25 }],
    engines: 2, engineSpacing: 0.5, nozzleRadius: 0.5, canopyZ: m(3.3), canopyLen: 2.6, canopyW: 0.46, canopyH: 0.5,
    features: { probe: 'L', radome: 0.07, spine: [m(6.0), m(10.5), 0.4, 0.15], hook: 0.88, sting: false },
    gear: { mainX: 1.35, mainZ: 0.56, noseZ: 0.18, mainR: 0.34, noseR: 0.2 },
    colors: { body: 0xa3aab4, accent: 0x3aa0ff, dark: 0x343a42 },
  },
};
