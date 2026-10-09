import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Light canard-delta dogfighter: excellent turn, good thrust-to-weight, fragile. */
export const J10C: AircraftDef = {
  id: 'j10c',
  name: 'J-10C',
  fullName: 'J-10C Vigorous Dragon',
  faction: 'china',
  role: 'Multirole fighter',
  blurb: 'A nimble single-engine canard delta. Turns hard and climbs well for its size, but there is not much structure behind the skin.',
  flight: {
    stallSpeed: 49, maxSpeed: 600, twMil: 0.66, twAb: 1.08,
    pitchRate: 0.8, rollRate: 3.6, yawRate: 0.38, gLimit: 9, aoaStall: 28,
    gearHeight: 2.4, bellyHeight: 1.2, energyBleed: 0.95, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 5, firepower: 3, durability: 2, stealth: 2 },
  hp: 100, rcs: 1.5,
  gun: { name: 'Type 23-3', caliber: 23, rounds: 200 },
  countermeasures: { flares: 30, chaff: 30 },
  model: {
    length: 16.4,
    sections: [
      [0, 0, 0, 0], [0.03, 0.25, 0.22, 0], [0.1, 0.5, 0.45, 0], [0.22, 0.78, 0.7, 0], [0.38, 0.98, 0.85, 0],
      [0.55, 1.05, 0.88, 0.02], [0.75, 0.95, 0.78, 0.06], [0.92, 0.8, 0.66, 0.1], [1, 0.72, 0.6, 0.1],
    ],
    wing: { zRoot: 0.42, rootChord: 6.2, tipChord: 1.0, span: 9.75, sweep: 4.2, thickness: 0.26, y: -0.05, dihedral: 0, flapSpan: 0.38 },
    canard: { zRoot: 0.27, rootChord: 2.0, tipChord: 0.8, span: 4.2, sweep: 0.9, y: 0.25 },
    fins: [
      { x: 0, zRoot: 0.66, rootChord: 4.4, tipChord: 1.6, height: 3.4, sweep: 2.5, cant: 0 },
      { x: 0.9, zRoot: 0.78, rootChord: 2.4, tipChord: 1.0, height: -0.9, sweep: 1.0, cant: 0.4, rudder: false },
    ],
    intakes: [{ x: 0, y: -0.78, zFrac: 0.35, w: 1.6, h: 1.0, len: 3.4 }],
    engines: 1, nozzleRadius: 0.58, canopyZ: 0.24, canopyLen: 2.1,
    colors: { body: 0x939ba6, accent: 0xffd23a, dark: 0x30363d },
  },
};
