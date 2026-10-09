import type { AircraftDef } from '../../aircraft/AircraftDef';

/** The original Flanker: long-legged, superb at low speed and big, with no vectoring. Tough and good in a turning fight. */
export const SU27: AircraftDef = {
  id: 'su27',
  name: 'Su-27',
  fullName: 'Su-27 Flanker',
  faction: 'russia',
  role: 'Air-superiority fighter',
  blurb: 'The classic Flanker. A massive wing, long range and excellent slow-speed handling, with sturdy structure; the radar sees it from far away.',
  flight: {
    stallSpeed: 57, maxSpeed: 650, twMil: 0.62, twAb: 1.08,
    pitchRate: 0.72, rollRate: 3.1, yawRate: 0.4, gLimit: 9, aoaStall: 30,
    gearHeight: 3.3, bellyHeight: 1.6, energyBleed: 1.15, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 4, firepower: 4, durability: 5, stealth: 1 },
  hp: 135, rcs: 10.0,
  gun: { name: 'GSh-30-1', caliber: 30, rounds: 150 },
  countermeasures: { flares: 96, chaff: 48 },
  model: {
    length: 21.9, shapeN: 2.8,
    sections: [
      [0, 0, 0, 0], [0.03, 0.3, 0.25, 0], [0.1, 0.65, 0.5, 0], [0.22, 1.0, 0.75, 0], [0.35, 1.5, 0.85, 0],
      [0.5, 1.7, 0.82, 0.03], [0.7, 1.3, 0.72, 0.08], [0.9, 0.95, 0.56, 0.1], [1, 0.75, 0.5, 0.1],
    ],
    wing: { zRoot: 0.42, rootChord: 6.4, tipChord: 1.6, span: 14.7, sweep: 3.6, thickness: 0.3, y: 0.05, dihedral: 0.03, lerx: { length: 4.5, reach: 0.2 } },
    hstab: { zRoot: 0.9, rootChord: 3.0, tipChord: 1.2, span: 9.6, sweep: 2.0, y: 0.15, dihedral: 0 },
    fins: [{ x: 2.6, zRoot: 0.78, rootChord: 4.6, tipChord: 1.8, height: 3.9, sweep: 2.4, cant: 0.04 }],
    intakes: [{ x: 1.4, y: -0.7, zFrac: 0.33, w: 1.5, h: 1.3, len: 4.6 }],
    engines: 2, engineSpacing: 1.7, nozzleRadius: 0.72, airbrake: true, canopyZ: 0.22, canopyLen: 2.2,
    colors: { body: 0x8b9aab, accent: 0xff4a4a, dark: 0x30363d, camo: 0x5a6a7c },
  },
};
