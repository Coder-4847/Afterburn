import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Light, agile, energy-efficient. Best roll rate in the game; modest thrust and structure. */
export const F16C: AircraftDef = {
  id: 'f16c',
  name: 'F-16C',
  fullName: 'F-16C Fighting Falcon',
  faction: 'west',
  role: 'Multirole fighter',
  blurb: 'The benchmark light fighter. Superb roll and low-speed manoeuvrability, forgiving to fly, but fragile and short on thrust.',
  flight: {
    stallSpeed: 54, maxSpeed: 580, twMil: 0.62, twAb: 1.08,
    pitchRate: 0.74, rollRate: 3.9, yawRate: 0.38, gLimit: 9, aoaStall: 26,
    gearHeight: 2.2, bellyHeight: 1.1, energyBleed: 1.0, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 5, firepower: 3, durability: 2, stealth: 2 },
  hp: 100, rcs: 1.2,
  gun: { name: 'M61A1 Vulcan', caliber: 20, rounds: 511 },
  countermeasures: { flares: 30, chaff: 30 },
  model: {
    length: 15,
    sections: [
      [0, 0, 0, 0], [0.03, 0.2, 0.2, 0], [0.12, 0.5, 0.5, 0], [0.26, 0.85, 0.78, 0], [0.4, 1.0, 0.92, 0],
      [0.62, 0.98, 0.88, 0.02], [0.8, 0.82, 0.74, 0.08], [0.94, 0.66, 0.58, 0.1], [1, 0.58, 0.52, 0.1],
    ],
    wing: { zRoot: 0.42, rootChord: 5.2, tipChord: 1.3, span: 9.8, sweep: 3.1, thickness: 0.26, y: -0.1, dihedral: 0, lerx: { length: 2.8, reach: 0.3 } },
    hstab: { zRoot: 0.84, rootChord: 3.3, tipChord: 1.1, span: 5.6, sweep: 1.6, y: 0, dihedral: -0.05 },
    fins: [
      { x: 0, zRoot: 0.7, rootChord: 3.7, tipChord: 1.4, height: 3.1, sweep: 2.0, cant: 0 },
      { x: 0.8, zRoot: 0.82, rootChord: 2.3, tipChord: 1.1, height: -0.9, sweep: 1.0, cant: 0.35, rudder: false },
    ],
    intakes: [{ x: 0, y: -0.62, zFrac: 0.35, w: 1.15, h: 0.95, len: 3.1 }],
    engines: 1, nozzleRadius: 0.55, canopyZ: 0.25, canopyLen: 2.1,
    colors: { body: 0x858f9b, accent: 0x3aa0ff, dark: 0x2a3038 },
  },
};
