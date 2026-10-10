import type { AircraftDef } from '../../aircraft/AircraftDef';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 18.92;
const m = (x: number): number => x / L;
// </prelude>

/** The fastest, stealthiest, most capable air-superiority fighter: big thrust, vectoring, tiny radar signature. */
export const F22: AircraftDef = {
  id: 'f22',
  name: 'F-22',
  fullName: 'F-22 Raptor',
  faction: 'west',
  role: 'Stealth air-superiority fighter',
  blurb: 'Supercruise thrust, pitch vectoring and a radar signature the size of a marble. Keeps its energy and its control deep into a fight.',
  flight: {
    stallSpeed: 50, maxSpeed: 650, twMil: 0.88, twAb: 1.3,
    pitchRate: 0.72, rollRate: 3.5, yawRate: 0.4, gLimit: 9.5, aoaStall: 28,
    gearHeight: 2.2, bellyHeight: 1, energyBleed: 0.8, thrustVectoring: 0.7,
  },
  ratings: { speed: 5, agility: 5, firepower: 3, durability: 3, stealth: 5 },
  hp: 110, rcs: 0.02,
  gun: { name: 'M61A2 Vulcan', caliber: 20, rounds: 480 },
  countermeasures: { flares: 24, chaff: 24 },
  model: {
    length: L, shapeN: 3.1,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.05, 0, 2.6], [m(0.7), 0.3, 0.22, -0.05, 0.24, 2.8], [m(2.2), 0.72, 0.4, -0.05, 0.4, 3.1], [m(4.0), 1.1, 0.52, -0.04, 0.46, 3.2],
      [m(6.0), 1.45, 0.68, -0.04, 0.62, 3.3], [m(8.5), 1.7, 0.78, -0.02, 0.7, 3.4], [m(11.0), 1.85, 0.8, 0, 0.72, 3.4], [m(14.0), 1.9, 0.78, 0, 0.68, 3.4],
      [m(16.8), 1.82, 0.7, 0, 0.62, 3.3], [1, 1.7, 0.55, 0, 0.5, 3.2],
    ],
    wing: {
      zRoot: m(9.5), rootChord: 7.4, tipChord: 1.9, span: 13.56, sweep: 4.4, thickness: 0.26, y: -0.12, dihedral: 0.02, xRoot: 1.8,
      flapSpan: 0.5, lerx: { length: 4.2, reach: 0.16, thick: 0.4 },
    },
    hstab: { zRoot: m(14.25), rootChord: 3.7, tipChord: 1.15, span: 8.84, sweep: 3.0, y: 0.05, dihedral: 0, xRoot: 1.6 },
    fins: [{ x: 1.5, zRoot: m(13.0), rootChord: 4.5, tipChord: 1.9, height: 2.2, sweep: 1.0, cant: 0.47, y: 0.35 }],
    intakes: [{ x: 1.55, y: -0.12, zFrac: m(6.2), w: 1.0, h: 1.3, len: 4.2, n: 4, toe: 0.25, splitter: true }],
    engines: 2, engineSpacing: 1.02, nozzleRadius: 0.5, nozzleAspect: 1.5, vectoringNozzles: true, nozzleZ: m(18.1),
    canopyZ: m(3.55), canopyLen: 3.7, canopyW: 0.5, canopyH: 0.48,
    features: { chines: true, radome: 0.07, bay: [m(6.5), m(11.5), 0.5], spine: [m(7.2), m(14), 0.5, 0.2], hook: 0.88, sting: false },
    gear: { mainX: 1.7, mainZ: 0.56, noseZ: 0.18, mainR: 0.36, noseR: 0.22 },
    colors: { body: 0x626972, accent: 0x3aa0ff, dark: 0x2a2f36 },
  },
};
