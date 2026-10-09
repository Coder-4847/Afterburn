import type { AircraftDef } from '../../aircraft/AircraftDef';

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
    gearHeight: 2.4, bellyHeight: 1.2, energyBleed: 0.85, thrustVectoring: 0.1,
  },
  ratings: { speed: 4, agility: 5, firepower: 4, durability: 3, stealth: 3 },
  hp: 105, rcs: 1.0,
  gun: { name: 'GIAT 30M791', caliber: 30, rounds: 125 },
  countermeasures: { flares: 40, chaff: 40 },
  model: {
    length: 15.3,
    sections: [
      [0, 0, 0, 0], [0.03, 0.25, 0.22, 0], [0.1, 0.5, 0.45, 0], [0.22, 0.8, 0.7, 0], [0.38, 1.0, 0.85, 0],
      [0.55, 1.1, 0.88, 0.02], [0.75, 1.0, 0.8, 0.06], [0.92, 0.85, 0.68, 0.1], [1, 0.78, 0.62, 0.1],
    ],
    wing: { zRoot: 0.4, rootChord: 7.3, tipChord: 1.3, span: 10.9, sweep: 4.2, thickness: 0.26, y: -0.05, dihedral: 0, flapSpan: 0.35 },
    canard: { zRoot: 0.26, rootChord: 2.3, tipChord: 0.9, span: 4.6, sweep: 1.0, y: 0.2 },
    fins: [{ x: 0, zRoot: 0.66, rootChord: 4.2, tipChord: 1.5, height: 3.0, sweep: 2.2, cant: 0 }],
    intakes: [{ x: 0.95, y: -0.3, zFrac: 0.3, w: 0.9, h: 1.15, len: 3.1 }],
    engines: 2, engineSpacing: 0.7, nozzleRadius: 0.5, canopyZ: 0.24, canopyLen: 2.0,
    colors: { body: 0xa5adb8, accent: 0x3aa0ff, dark: 0x343a42 },
  },
};
