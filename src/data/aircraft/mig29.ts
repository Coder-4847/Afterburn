import type { AircraftDef } from '../../aircraft/AircraftDef';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 17.37;
const m = (x: number): number => x / L;
// </prelude>

/** Compact, quick-turning point defender: very good in the first turn, but short-legged and light on punch. */
export const MIG29: AircraftDef = {
  id: 'mig29',
  name: 'MiG-29',
  fullName: 'MiG-29 Fulcrum',
  faction: 'russia',
  role: 'Point-defence fighter',
  blurb: 'Small, snappy and cheap. Its big strakes and high alpha give it a vicious first turn, but it bleeds energy and has little margin for error.',
  flight: {
    stallSpeed: 55, maxSpeed: 640, twMil: 0.65, twAb: 1.15,
    pitchRate: 0.78, rollRate: 3.3, yawRate: 0.4, gLimit: 9, aoaStall: 30,
    gearHeight: 2.15, bellyHeight: 1.05, energyBleed: 1.05, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 4, firepower: 3, durability: 3, stealth: 1 },
  hp: 115, rcs: 5.0,
  gun: { name: 'GSh-30-1', caliber: 30, rounds: 100 },
  countermeasures: { flares: 60, chaff: 30 },
  model: {
    length: L, shapeN: 2.7,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.05, 0, 2.3], [m(0.7), 0.28, 0.28, -0.05, 0.28, 2.3], [m(2.2), 0.62, 0.52, -0.03, 0.5], [m(4.2), 0.95, 0.66, -0.02, 0.6],
      [m(6.2), 1.25, 0.76, 0, 0.62], [m(8.5), 1.5, 0.82, 0, 0.6], [m(11.0), 1.4, 0.8, 0, 0.58], [m(14.0), 1.2, 0.68, 0, 0.52],
      [m(16.0), 1.05, 0.6, 0, 0.5], [1, 0.95, 0.54, 0, 0.48],
    ],
    wing: {
      zRoot: m(6.9), rootChord: 5.4, tipChord: 1.3, span: 11.36, sweep: 4.0, thickness: 0.28, y: -0.15, dihedral: 0, xRoot: 1.3,
      flapSpan: 0.45, lerx: { length: 3.7, reach: 0.25, thick: 0.45 }, tipRail: true,
    },
    hstab: { zRoot: m(13.2), rootChord: 3.1, tipChord: 1.1, span: 7.8, sweep: 2.3, y: -0.3, dihedral: -0.1, xRoot: 1.15 },
    fins: [{ x: 1.5, zRoot: m(11.6), rootChord: 4.2, tipChord: 1.5, height: 2.6, sweep: 2.4, cant: 0.1, y: 0.6 }],
    intakes: [{ x: 1.0, y: -0.45, zFrac: m(5.0), w: 1.15, h: 1.0, len: 3.9, n: 4.2, toe: 0.15 }],
    engines: 2, engineSpacing: 0.8, nozzleRadius: 0.6, airbrake: true,
    canopyZ: m(3.0), canopyLen: 2.9, canopyW: 0.52, canopyH: 0.55,
    features: { irst: true, radome: 0.07, spine: [m(6.0), m(12.5), 0.6, 0.28], hook: 0.9, sting: true },
    gear: { mainX: 1.4, mainZ: 0.55, noseZ: 0.17, mainR: 0.36, noseR: 0.22 },
    colors: { body: 0x8c96a2, accent: 0xff4a4a, dark: 0x30363d, camo: 0x62707f },
  },
};
