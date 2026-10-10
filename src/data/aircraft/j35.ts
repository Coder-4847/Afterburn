import type { AircraftDef } from '../../aircraft/AircraftDef';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 17.3;
const m = (x: number): number => x / L;
// </prelude>

/** Twin-engine stealth fighter: balanced, low signature, good thrust. A modern all-rounder. */
export const J35: AircraftDef = {
  id: 'j35',
  name: 'J-35',
  fullName: 'J-35 Gyrfalcon',
  faction: 'china',
  role: 'Stealth multirole fighter',
  blurb: 'A balanced twin-engine stealth design. No standout stat, but a low signature, good thrust and no real weakness.',
  flight: {
    stallSpeed: 55, maxSpeed: 620, twMil: 0.6, twAb: 1.0,
    pitchRate: 0.7, rollRate: 3.3, yawRate: 0.38, gLimit: 9, aoaStall: 27,
    gearHeight: 2.15, bellyHeight: 1.05, energyBleed: 0.95, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 4, firepower: 3, durability: 3, stealth: 4 },
  hp: 110, rcs: 0.05,
  gun: { name: 'Type 23-3 (game)', caliber: 23, rounds: 180 },
  countermeasures: { flares: 36, chaff: 24 },
  model: {
    length: L, shapeN: 3.0,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.05, 0, 2.6], [m(0.7), 0.28, 0.2, -0.05, 0.2, 2.8], [m(2.2), 0.66, 0.38, -0.04, 0.36, 3.0], [m(4.0), 0.98, 0.5, -0.03, 0.44, 3.1],
      [m(6.0), 1.28, 0.58, 0, 0.5, 3.2], [m(8.5), 1.45, 0.62, 0, 0.52, 3.3], [m(11.5), 1.5, 0.62, 0, 0.5, 3.3], [m(14.5), 1.3, 0.56, 0, 0.48, 3.1],
      [1, 1.05, 0.5, 0, 0.44, 3.0],
    ],
    pods: [
      { x: 1.05, mirror: true, n: 2.4, capBack: true, rings: [
        [m(4.4), 0.1, 0.1, -0.05, 0.1], [m(5.4), 0.32, 0.3, -0.04, 0.28], [m(6.6), 0.38, 0.38, -0.04, 0.36], [m(8.0), 0.18, 0.18, -0.02, 0.18],
      ] },
    ],
    wing: {
      zRoot: m(7.6), rootChord: 5.6, tipChord: 1.3, span: 11.5, sweep: 3.6, thickness: 0.26, y: -0.1, dihedral: 0.02, xRoot: 1.3,
      flapSpan: 0.45, lerx: { length: 2.4, reach: 0.18, thick: 0.4 },
    },
    hstab: { zRoot: m(13.0), rootChord: 3.3, tipChord: 1.2, span: 7.0, sweep: 2.2, y: 0.05, dihedral: 0, xRoot: 1.15 },
    fins: [{ x: 1.2, zRoot: m(11.7), rootChord: 3.8, tipChord: 1.5, height: 2.2, sweep: 1.9, cant: 0.43, y: 0.45 }],
    intakes: [{ x: 1.0, y: -0.12, zFrac: m(5.6), w: 0.85, h: 1.0, len: 3.2, n: 3.2, toe: 0.15 }],
    engines: 2, engineSpacing: 0.85, nozzleRadius: 0.52, canopyZ: m(3.2), canopyLen: 3.1, canopyW: 0.48, canopyH: 0.5,
    features: { chines: true, radome: 0.07, bay: [m(6.5), m(11), 0.45], spine: [m(6.6), m(12.5), 0.45, 0.16], hook: 0.88, sting: false },
    gear: { mainX: 1.5, mainZ: 0.56, noseZ: 0.18, mainR: 0.34, noseR: 0.2 },
    colors: { body: 0x7e858f, accent: 0xffd23a, dark: 0x2c3036 },
  },
};
