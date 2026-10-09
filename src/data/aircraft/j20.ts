import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Long-range stealth interceptor: fast, big weapon bays and a small signature, less nimble than the dogfighters. */
export const J20: AircraftDef = {
  id: 'j20',
  name: 'J-20',
  fullName: 'J-20 Mighty Dragon',
  faction: 'china',
  role: 'Stealth heavy fighter',
  blurb: 'A long-range canard-delta stealth fighter. Fast and hard to see, built for slashing attacks rather than long turning fights.',
  flight: {
    stallSpeed: 57, maxSpeed: 650, twMil: 0.7, twAb: 1.05,
    pitchRate: 0.58, rollRate: 3.0, yawRate: 0.36, gLimit: 9, aoaStall: 26,
    gearHeight: 2.9, bellyHeight: 1.4, energyBleed: 0.9, thrustVectoring: 0,
  },
  ratings: { speed: 5, agility: 3, firepower: 4, durability: 4, stealth: 4 },
  hp: 130, rcs: 0.08,
  gun: { name: 'Type 23-3 (game)', caliber: 23, rounds: 220 },
  countermeasures: { flares: 36, chaff: 24 },
  model: {
    length: 20.3, shapeN: 3.3,
    sections: [
      [0, 0, 0, 0], [0.04, 0.28, 0.2, 0], [0.12, 0.7, 0.38, -0.05], [0.25, 1.3, 0.6, -0.05], [0.4, 1.75, 0.78, 0],
      [0.56, 2.0, 0.8, 0.04], [0.75, 1.85, 0.72, 0.08], [0.92, 1.5, 0.6, 0.1], [1, 1.3, 0.52, 0.1],
    ],
    wing: { zRoot: 0.42, rootChord: 9.0, tipChord: 1.6, span: 12.9, sweep: 5.5, thickness: 0.28, y: -0.1, dihedral: 0.02, lerx: { length: 3.5, reach: 0.18 } },
    canard: { zRoot: 0.27, rootChord: 3.2, tipChord: 1.1, span: 6.2, sweep: 1.5, y: 0.2 },
    fins: [
      { x: 1.55, zRoot: 0.78, rootChord: 4.3, tipChord: 1.7, height: 2.2, sweep: 2.0, cant: 0.3 },
      { x: 1.9, zRoot: 0.7, rootChord: 4.0, tipChord: 1.2, height: -1.6, sweep: 1.8, cant: 0.5, rudder: false },
    ],
    intakes: [{ x: 1.1, y: -0.3, zFrac: 0.3, w: 0.9, h: 1.2, len: 3.3 }],
    engines: 2, engineSpacing: 1.2, nozzleRadius: 0.62, canopyZ: 0.22, canopyLen: 2.0,
    colors: { body: 0x7a828c, accent: 0xffd23a, dark: 0x2c3036 },
  },
};
