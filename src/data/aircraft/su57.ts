import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Stealthy, thrust-vectoring heavyweight: huge control authority at low speed, strong energy, decent signature. */
export const SU57: AircraftDef = {
  id: 'su57',
  name: 'Su-57',
  fullName: 'Su-57 Felon',
  faction: 'russia',
  role: 'Stealth multirole fighter',
  blurb: 'Blended body, canted all-moving tails and 3D thrust vectoring. Pivots where others stall, and keeps a low radar profile.',
  flight: {
    stallSpeed: 50, maxSpeed: 650, twMil: 0.8, twAb: 1.2,
    pitchRate: 0.82, rollRate: 3.4, yawRate: 0.44, gLimit: 9.5, aoaStall: 30,
    gearHeight: 3.0, bellyHeight: 1.5, energyBleed: 0.85, thrustVectoring: 1,
  },
  ratings: { speed: 5, agility: 5, firepower: 4, durability: 4, stealth: 4 },
  hp: 125, rcs: 0.1,
  gun: { name: '9A-1A-4071K', caliber: 30, rounds: 150 },
  countermeasures: { flares: 48, chaff: 24 },
  model: {
    length: 20.1, shapeN: 3.2,
    sections: [
      [0, 0, 0, 0], [0.03, 0.3, 0.2, 0], [0.1, 0.8, 0.4, -0.05], [0.22, 1.5, 0.6, -0.05], [0.38, 2.1, 0.75, 0],
      [0.55, 2.0, 0.78, 0.05], [0.75, 1.5, 0.7, 0.08], [0.92, 1.05, 0.58, 0.1], [1, 0.85, 0.52, 0.1],
    ],
    wing: { zRoot: 0.36, rootChord: 7.5, tipChord: 2.0, span: 14.1, sweep: 3.8, thickness: 0.3, y: -0.05, dihedral: 0.02, lerx: { length: 5.0, reach: 0.22 } },
    hstab: { zRoot: 0.8, rootChord: 3.8, tipChord: 1.4, span: 8.6, sweep: 2.4, y: 0.12, dihedral: 0 },
    fins: [{ x: 2.2, zRoot: 0.72, rootChord: 4.4, tipChord: 1.8, height: 2.7, sweep: 2.2, cant: 0.44 }],
    intakes: [{ x: 1.5, y: -0.4, zFrac: 0.3, w: 1.0, h: 1.2, len: 3.8 }],
    engines: 2, engineSpacing: 1.55, nozzleRadius: 0.6, vectoringNozzles: true, canopyZ: 0.22, canopyLen: 2.1,
    colors: { body: 0x6c737d, accent: 0xff4a4a, dark: 0x2b2f35 },
  },
};
