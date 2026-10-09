import type { AircraftDef } from '../../aircraft/AircraftDef';

/** The fastest, stealthiest, most capable air-superiority fighter: big thrust, vectoring, tiny radar signature. */
export const F22: AircraftDef = {
  id: 'f22',
  name: 'F-22',
  fullName: 'F-22 Raptor',
  faction: 'west',
  role: 'Stealth air-superiority fighter',
  blurb: 'Supercruise thrust, pitch vectoring and a radar signature the size of a marble. Keeps its energy and its control deep into a fight.',
  flight: {
    stallSpeed: 50, maxSpeed: 650, twMil: 0.88, twAb: 1.3,
    pitchRate: 0.72, rollRate: 3.5, yawRate: 0.4, gLimit: 9.5, aoaStall: 28,
    gearHeight: 2.6, bellyHeight: 1.3, energyBleed: 0.8, thrustVectoring: 0.7,
  },
  ratings: { speed: 5, agility: 5, firepower: 3, durability: 3, stealth: 5 },
  hp: 110, rcs: 0.02,
  gun: { name: 'M61A2 Vulcan', caliber: 20, rounds: 480 },
  countermeasures: { flares: 24, chaff: 24 },
  model: {
    length: 18.9, shapeN: 3.4,
    sections: [
      [0, 0, 0, 0], [0.03, 0.25, 0.18, 0], [0.1, 0.7, 0.38, -0.05], [0.22, 1.25, 0.62, -0.05], [0.38, 1.55, 0.78, 0],
      [0.55, 1.7, 0.82, 0.05], [0.75, 1.6, 0.75, 0.08], [0.92, 1.35, 0.62, 0.1], [1, 1.2, 0.55, 0.1],
    ],
    wing: { zRoot: 0.4, rootChord: 9.0, tipChord: 1.9, span: 13.6, sweep: 5.3, thickness: 0.3, y: -0.05, dihedral: 0.02, lerx: { length: 4.2, reach: 0.16 } },
    hstab: { zRoot: 0.8, rootChord: 4.6, tipChord: 1.6, span: 8.8, sweep: 2.6, y: 0.1, dihedral: 0 },
    fins: [{ x: 1.55, zRoot: 0.72, rootChord: 4.6, tipChord: 1.8, height: 2.5, sweep: 2.2, cant: 0.47 }],
    intakes: [{ x: 1.15, y: -0.15, zFrac: 0.3, w: 1.1, h: 1.3, len: 3.8 }],
    engines: 2, engineSpacing: 1.0, nozzleRadius: 0.62, vectoringNozzles: true, canopyZ: 0.24, canopyLen: 1.7,
    colors: { body: 0x7b828c, accent: 0x3aa0ff, dark: 0x2f343b },
  },
};
