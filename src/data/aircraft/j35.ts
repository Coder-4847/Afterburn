import type { AircraftDef } from '../../aircraft/AircraftDef';

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
    gearHeight: 2.5, bellyHeight: 1.2, energyBleed: 0.95, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 4, firepower: 3, durability: 3, stealth: 4 },
  hp: 110, rcs: 0.05,
  gun: { name: 'Type 23-3 (game)', caliber: 23, rounds: 180 },
  countermeasures: { flares: 36, chaff: 24 },
  model: {
    length: 17.3, shapeN: 3.0,
    sections: [
      [0, 0, 0, 0], [0.03, 0.28, 0.2, 0], [0.1, 0.7, 0.38, -0.04], [0.22, 1.2, 0.6, -0.04], [0.38, 1.55, 0.78, 0],
      [0.55, 1.7, 0.8, 0.05], [0.75, 1.6, 0.72, 0.08], [0.92, 1.3, 0.6, 0.1], [1, 1.1, 0.52, 0.1],
    ],
    wing: { zRoot: 0.4, rootChord: 6.2, tipChord: 1.7, span: 11.5, sweep: 3.8, thickness: 0.28, y: -0.05, dihedral: 0.02, lerx: { length: 2.6, reach: 0.2 } },
    hstab: { zRoot: 0.82, rootChord: 3.6, tipChord: 1.4, span: 7.0, sweep: 2.0, y: 0.08, dihedral: 0 },
    fins: [{ x: 1.35, zRoot: 0.74, rootChord: 4.0, tipChord: 1.6, height: 2.2, sweep: 1.9, cant: 0.43 }],
    intakes: [{ x: 1.0, y: -0.3, zFrac: 0.3, w: 0.9, h: 1.1, len: 3.0 }],
    engines: 2, engineSpacing: 1.1, nozzleRadius: 0.55, canopyZ: 0.24, canopyLen: 1.8,
    colors: { body: 0x7e858f, accent: 0xffd23a, dark: 0x2c3036 },
  },
};
