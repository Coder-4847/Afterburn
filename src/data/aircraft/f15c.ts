import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Big, fast, powerful. Great top speed and climb, sturdy; wide turns and a large radar signature. */
export const F15C: AircraftDef = {
  id: 'f15c',
  name: 'F-15C',
  fullName: 'F-15C Eagle',
  faction: 'west',
  role: 'Air-superiority fighter',
  blurb: 'Twin-engine muscle. Outruns and out-climbs almost everything and survives damage well, but it is big, loud on radar and turns wide.',
  flight: {
    stallSpeed: 60, maxSpeed: 700, twMil: 0.72, twAb: 1.22,
    pitchRate: 0.6, rollRate: 3.2, yawRate: 0.36, gLimit: 9, aoaStall: 24,
    gearHeight: 3.1, bellyHeight: 1.5, energyBleed: 0.9, thrustVectoring: 0,
  },
  ratings: { speed: 5, agility: 3, firepower: 4, durability: 4, stealth: 1 },
  hp: 140, rcs: 5.0,
  gun: { name: 'M61A1 Vulcan', caliber: 20, rounds: 940 },
  countermeasures: { flares: 40, chaff: 40 },
  model: {
    length: 19.4,
    sections: [
      [0, 0, 0, 0], [0.03, 0.3, 0.28, 0], [0.1, 0.55, 0.5, 0], [0.22, 0.85, 0.7, 0], [0.38, 1.55, 0.85, 0.05],
      [0.55, 1.75, 0.85, 0.08], [0.75, 1.7, 0.8, 0.1], [0.92, 1.45, 0.65, 0.1], [1, 1.3, 0.6, 0.1],
    ],
    wing: { zRoot: 0.42, rootChord: 5.8, tipChord: 2.1, span: 13.05, sweep: 3.4, thickness: 0.28, y: 0.3, dihedral: 0.02 },
    hstab: { zRoot: 0.82, rootChord: 3.9, tipChord: 1.5, span: 8.6, sweep: 2.2, y: 0.15, dihedral: 0 },
    fins: [{ x: 2.0, zRoot: 0.7, rootChord: 4.6, tipChord: 1.8, height: 3.7, sweep: 2.6, cant: 0.05 }],
    intakes: [{ x: 1.35, y: -0.05, zFrac: 0.34, w: 1.2, h: 1.45, len: 3.9 }],
    engines: 2, engineSpacing: 1.0, nozzleRadius: 0.62, airbrake: true, canopyZ: 0.22, canopyLen: 2.1,
    colors: { body: 0x9aa3ae, accent: 0x3aa0ff, dark: 0x30353c },
  },
};
