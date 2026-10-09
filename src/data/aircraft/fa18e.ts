import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Carrier-bred workhorse: superb at slow speed and high angle of attack, tough, but short on top speed and thrust. */
export const FA18E: AircraftDef = {
  id: 'fa18e',
  name: 'F/A-18E',
  fullName: 'F/A-18E Super Hornet',
  faction: 'west',
  role: 'Carrier multirole fighter',
  blurb: 'Rugged and docile. Holds control at very high angle of attack and takes a beating, but runs out of speed and energy sooner than the rest.',
  flight: {
    stallSpeed: 52, maxSpeed: 560, twMil: 0.55, twAb: 0.92,
    pitchRate: 0.66, rollRate: 3.4, yawRate: 0.4, gLimit: 7.5, aoaStall: 32,
    gearHeight: 2.6, bellyHeight: 1.3, energyBleed: 1.2, thrustVectoring: 0.1,
  },
  ratings: { speed: 3, agility: 3, firepower: 4, durability: 4, stealth: 2 },
  hp: 130, rcs: 1.0,
  gun: { name: 'M61A2 Vulcan', caliber: 20, rounds: 412 },
  countermeasures: { flares: 60, chaff: 30 },
  model: {
    length: 18.3,
    sections: [
      [0, 0, 0, 0], [0.03, 0.3, 0.28, 0], [0.1, 0.62, 0.55, 0], [0.22, 0.95, 0.8, 0], [0.38, 1.3, 0.92, 0],
      [0.55, 1.55, 0.9, 0.02], [0.75, 1.45, 0.82, 0.08], [0.92, 1.2, 0.68, 0.1], [1, 1.05, 0.6, 0.1],
    ],
    wing: { zRoot: 0.4, rootChord: 5.4, tipChord: 1.7, span: 13.6, sweep: 2.2, thickness: 0.3, y: -0.05, dihedral: -0.02, lerx: { length: 4.3, reach: 0.22 } },
    hstab: { zRoot: 0.83, rootChord: 3.6, tipChord: 1.3, span: 8.6, sweep: 1.8, y: 0.15, dihedral: 0 },
    fins: [{ x: 1.0, zRoot: 0.72, rootChord: 3.9, tipChord: 1.4, height: 3.4, sweep: 2.3, cant: 0.35 }],
    intakes: [{ x: 1.05, y: -0.15, zFrac: 0.3, w: 1.2, h: 1.3, len: 3.2 }],
    engines: 2, engineSpacing: 1.1, nozzleRadius: 0.58, canopyZ: 0.26, canopyLen: 1.9,
    colors: { body: 0x707982, accent: 0x3aa0ff, dark: 0x2c3138 },
  },
};
