import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Compact, quick-turning point defender: very good in the first turn, but short-legged and light on punch. */
export const MIG29: AircraftDef = {
  id: 'mig29',
  name: 'MiG-29',
  fullName: 'MiG-29 Fulcrum',
  faction: 'russia',
  role: 'Point-defence fighter',
  blurb: 'Small, snappy and cheap. Its big strakes and high alpha give it a vicious first turn, but it bleeds energy and has little margin for error.',
  flight: {
    stallSpeed: 55, maxSpeed: 640, twMil: 0.65, twAb: 1.15,
    pitchRate: 0.78, rollRate: 3.3, yawRate: 0.4, gLimit: 9, aoaStall: 30,
    gearHeight: 2.6, bellyHeight: 1.3, energyBleed: 1.05, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 4, firepower: 3, durability: 3, stealth: 1 },
  hp: 115, rcs: 5.0,
  gun: { name: 'GSh-30-1', caliber: 30, rounds: 100 },
  countermeasures: { flares: 60, chaff: 30 },
  model: {
    length: 17.3, shapeN: 2.6,
    sections: [
      [0, 0, 0, 0], [0.03, 0.3, 0.28, 0], [0.1, 0.65, 0.55, 0], [0.22, 1.05, 0.8, 0], [0.38, 1.5, 0.88, 0],
      [0.55, 1.7, 0.85, 0.05], [0.75, 1.6, 0.78, 0.08], [0.92, 1.35, 0.65, 0.1], [1, 1.2, 0.58, 0.1],
    ],
    wing: { zRoot: 0.4, rootChord: 5.6, tipChord: 1.5, span: 11.4, sweep: 3.8, thickness: 0.28, y: -0.1, dihedral: 0, lerx: { length: 4.6, reach: 0.35 } },
    hstab: { zRoot: 0.84, rootChord: 3.5, tipChord: 1.3, span: 7.8, sweep: 2.0, y: 0, dihedral: -0.15 },
    fins: [{ x: 1.45, zRoot: 0.72, rootChord: 4.0, tipChord: 1.6, height: 2.9, sweep: 2.2, cant: 0.1 }],
    intakes: [{ x: 1.0, y: -0.45, zFrac: 0.32, w: 1.3, h: 1.1, len: 3.9 }],
    engines: 2, engineSpacing: 1.05, nozzleRadius: 0.6, airbrake: true, canopyZ: 0.22, canopyLen: 2.0,
    colors: { body: 0x8c96a2, accent: 0xff4a4a, dark: 0x30363d, camo: 0x62707f },
  },
};
