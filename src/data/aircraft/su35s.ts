import type { AircraftDef } from '../../aircraft/AircraftDef';

/** The ultimate thrust-vectoring dogfighter: monstrous agility and durability, but loud on radar and heavy on fuel burn. */
export const SU35S: AircraftDef = {
  id: 'su35s',
  name: 'Su-35S',
  fullName: 'Su-35S Flanker-E',
  faction: 'russia',
  role: 'Heavy air-superiority fighter',
  blurb: 'Huge wing, huge engines, 3D thrust vectoring. Can hang on the edge of a stall and swing its nose at you, and it absorbs a lot of punishment.',
  flight: {
    stallSpeed: 51, maxSpeed: 640, twMil: 0.68, twAb: 1.14,
    pitchRate: 0.84, rollRate: 3.3, yawRate: 0.44, gLimit: 9, aoaStall: 32,
    gearHeight: 3.3, bellyHeight: 1.6, energyBleed: 0.9, thrustVectoring: 1,
  },
  ratings: { speed: 4, agility: 5, firepower: 5, durability: 5, stealth: 1 },
  hp: 135, rcs: 3.0,
  gun: { name: 'GSh-30-1', caliber: 30, rounds: 150 },
  countermeasures: { flares: 96, chaff: 48 },
  model: {
    length: 21.9, shapeN: 2.8,
    sections: [
      [0, 0, 0, 0], [0.03, 0.3, 0.25, 0], [0.1, 0.65, 0.5, 0], [0.22, 1.0, 0.75, 0], [0.35, 1.5, 0.85, 0],
      [0.5, 1.7, 0.82, 0.03], [0.7, 1.3, 0.72, 0.08], [0.9, 0.95, 0.56, 0.1], [1, 0.75, 0.5, 0.1],
    ],
    wing: { zRoot: 0.42, rootChord: 6.6, tipChord: 1.6, span: 15.3, sweep: 3.7, thickness: 0.3, y: 0.05, dihedral: 0.03, lerx: { length: 4.5, reach: 0.2 } },
    hstab: { zRoot: 0.9, rootChord: 3.0, tipChord: 1.2, span: 9.8, sweep: 2.0, y: 0.15, dihedral: 0 },
    fins: [{ x: 2.7, zRoot: 0.78, rootChord: 4.8, tipChord: 1.8, height: 4.2, sweep: 2.5, cant: 0.05 }],
    intakes: [{ x: 1.4, y: -0.7, zFrac: 0.33, w: 1.5, h: 1.3, len: 4.6 }],
    engines: 2, engineSpacing: 1.75, nozzleRadius: 0.75, vectoringNozzles: true, airbrake: true, canopyZ: 0.22, canopyLen: 2.3,
    colors: { body: 0x7d8794, accent: 0xff4a4a, dark: 0x30363d, camo: 0x56657a },
  },
};
