import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Thrust-rich canard delta: fast, strong in a sustained turn, very good energy retention. */
export const TYPHOON: AircraftDef = {
  id: 'typhoon',
  name: 'Typhoon',
  fullName: 'Eurofighter Typhoon',
  faction: 'west',
  role: 'Air-superiority fighter',
  blurb: 'Big engines and an unstable canard delta. Accelerates hard, holds its speed through the turn and stays dangerous in a vertical fight.',
  flight: {
    stallSpeed: 51, maxSpeed: 650, twMil: 0.7, twAb: 1.18,
    pitchRate: 0.76, rollRate: 3.5, yawRate: 0.38, gLimit: 9, aoaStall: 28,
    gearHeight: 2.4, bellyHeight: 1.2, energyBleed: 0.8, thrustVectoring: 0,
  },
  ratings: { speed: 5, agility: 4, firepower: 4, durability: 3, stealth: 2 },
  hp: 110, rcs: 0.9,
  gun: { name: 'Mauser BK-27', caliber: 27, rounds: 150 },
  countermeasures: { flares: 40, chaff: 40 },
  model: {
    length: 15.96,
    sections: [
      [0, 0, 0, 0], [0.03, 0.25, 0.22, 0], [0.1, 0.5, 0.45, 0], [0.22, 0.8, 0.7, 0], [0.38, 1.0, 0.85, 0],
      [0.55, 1.1, 0.88, 0.02], [0.75, 1.0, 0.8, 0.06], [0.92, 0.85, 0.68, 0.1], [1, 0.78, 0.62, 0.1],
    ],
    wing: { zRoot: 0.38, rootChord: 8.0, tipChord: 1.0, span: 10.95, sweep: 4.8, thickness: 0.26, y: -0.05, dihedral: 0, flapSpan: 0.35 },
    canard: { zRoot: 0.27, rootChord: 2.4, tipChord: 1.0, span: 3.8, sweep: 1.2, y: 0.25 },
    fins: [{ x: 0, zRoot: 0.66, rootChord: 4.2, tipChord: 1.6, height: 3.3, sweep: 2.2, cant: 0 }],
    intakes: [{ x: 0, y: -0.8, zFrac: 0.36, w: 1.9, h: 0.9, len: 4.0 }],
    engines: 2, engineSpacing: 0.65, nozzleRadius: 0.5, canopyZ: 0.25, canopyLen: 2.0,
    colors: { body: 0x8c949e, accent: 0x3aa0ff, dark: 0x30363d },
  },
};
