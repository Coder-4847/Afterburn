import type { AircraftDef } from '../../aircraft/AircraftDef';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 20.1;
const m = (x: number): number => x / L;
// </prelude>

/** Stealthy, thrust-vectoring heavyweight: huge control authority at low speed, strong energy, decent signature. */
export const SU57: AircraftDef = {
  id: 'su57',
  name: 'Su-57',
  fullName: 'Su-57 Felon',
  faction: 'russia',
  role: 'Stealth multirole fighter',
  blurb: 'Blended body, canted all-moving tails and 3D thrust vectoring. Pivots where others stall, and keeps a low radar profile.',
  flight: {
    stallSpeed: 50, maxSpeed: 650, twMil: 0.8, twAb: 1.2,
    pitchRate: 0.82, rollRate: 3.4, yawRate: 0.44, gLimit: 9.5, aoaStall: 30,
    gearHeight: 2.35, bellyHeight: 1.15, energyBleed: 0.85, thrustVectoring: 1,
  },
  ratings: { speed: 5, agility: 5, firepower: 4, durability: 4, stealth: 4 },
  hp: 125, rcs: 0.1,
  gun: { name: '9A-1A-4071K', caliber: 30, rounds: 150 },
  countermeasures: { flares: 48, chaff: 24 },
  model: {
    length: L, shapeN: 3.0,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.05, 0, 2.6], [m(0.8), 0.32, 0.24, -0.05, 0.24, 2.8], [m(2.6), 0.78, 0.42, -0.04, 0.4, 3.1], [m(4.6), 1.2, 0.5, -0.03, 0.44, 3.2],
      [m(7.0), 1.55, 0.58, 0, 0.5, 3.3], [m(9.5), 1.85, 0.62, 0, 0.5, 3.4], [m(12.5), 1.95, 0.62, 0, 0.5, 3.4], [m(15.5), 1.4, 0.58, 0, 0.5, 3.2],
      [m(18.0), 0.9, 0.5, 0, 0.45, 3.0], [1, 0.6, 0.42, 0, 0.4, 2.8],
    ],
    pods: [
      { x: 1.2, mirror: true, n: 2.8, capBack: true, rings: [
        [m(9.0), 0.2, 0.2, 0, 0.2], [m(11.5), 0.72, 0.7, 0, 0.62], [m(15), 0.78, 0.72, 0, 0.64], [m(18.2), 0.74, 0.68, 0, 0.62], [m(19.4), 0.68, 0.62, 0, 0.58],
      ] },
    ],
    wing: {
      zRoot: m(8.7), rootChord: 7.3, tipChord: 1.8, span: 14.1, sweep: 5.6, thickness: 0.28, y: -0.1, dihedral: 0.02, xRoot: 2.0,
      flapSpan: 0.45, lerx: { length: 4.6, reach: 0.25, thick: 0.4 },
    },
    hstab: { zRoot: m(15.3), rootChord: 3.6, tipChord: 1.3, span: 8.6, sweep: 2.7, y: 0.1, dihedral: 0, xRoot: 1.55 },
    fins: [{ x: 1.7, zRoot: m(14.4), rootChord: 3.7, tipChord: 1.5, height: 2.3, sweep: 2.0, cant: 0.44, y: 0.55 }],
    intakes: [{ x: 1.4, y: -0.2, zFrac: m(7.3), w: 1.0, h: 1.3, len: 4.0, n: 3.8, toe: 0.35 }],
    engines: 2, engineSpacing: 1.2, nozzleRadius: 0.58, vectoringNozzles: true, nozzleZ: m(19.4),
    canopyZ: m(3.9), canopyLen: 3.7, canopyW: 0.5, canopyH: 0.5,
    features: { chines: true, radome: 0.07, bay: [m(7.5), m(12.5), 0.5], spine: [m(7.8), m(14), 0.5, 0.2], hook: 0.88, sting: true },
    gear: { mainX: 1.8, mainZ: 0.56, noseZ: 0.18, mainR: 0.36, noseR: 0.22 },
    colors: { body: 0x6c737d, accent: 0xff4a4a, dark: 0x2b2f35 },
  },
};
