import type { AircraftDef } from '../../aircraft/AircraftDef';

/** Two-seat strike Flanker with wingtip pods: heavy, tough and long-ranged, a little less agile than the pure fighters. */
export const J16: AircraftDef = {
  id: 'j16',
  name: 'J-16',
  fullName: 'J-16 Flanker',
  faction: 'china',
  role: 'Two-seat strike fighter',
  blurb: 'A big, durable two-seater with lots of missile stations and wingtip ECM pods. Not the sharpest turner, but a heavy hitter that soaks damage.',
  flight: {
    stallSpeed: 60, maxSpeed: 640, twMil: 0.64, twAb: 1.05,
    pitchRate: 0.64, rollRate: 3.1, yawRate: 0.38, gLimit: 8.5, aoaStall: 28,
    gearHeight: 3.3, bellyHeight: 1.6, energyBleed: 1.1, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 3, firepower: 5, durability: 5, stealth: 1 },
  hp: 140, rcs: 3.0,
  gun: { name: 'GSh-30-1', caliber: 30, rounds: 150 },
  countermeasures: { flares: 96, chaff: 48 },
  model: {
    length: 21.9, shapeN: 2.8,
    sections: [
      [0, 0, 0, 0], [0.03, 0.3, 0.25, 0], [0.1, 0.65, 0.5, 0], [0.22, 1.0, 0.75, 0], [0.35, 1.5, 0.88, 0],
      [0.5, 1.7, 0.84, 0.03], [0.7, 1.3, 0.72, 0.08], [0.9, 0.95, 0.56, 0.1], [1, 0.75, 0.5, 0.1],
    ],
    wing: { zRoot: 0.42, rootChord: 6.4, tipChord: 1.6, span: 14.7, sweep: 3.6, thickness: 0.3, y: 0.05, dihedral: 0.03, lerx: { length: 4.5, reach: 0.2 }, pods: true },
    hstab: { zRoot: 0.9, rootChord: 3.0, tipChord: 1.2, span: 9.6, sweep: 2.0, y: 0.15, dihedral: 0 },
    fins: [{ x: 2.6, zRoot: 0.78, rootChord: 4.6, tipChord: 1.8, height: 4.0, sweep: 2.4, cant: 0.04 }],
    intakes: [{ x: 1.4, y: -0.7, zFrac: 0.33, w: 1.5, h: 1.3, len: 4.6 }],
    engines: 2, engineSpacing: 1.7, nozzleRadius: 0.72, airbrake: true, canopyZ: 0.22, canopyLen: 3.2,
    colors: { body: 0x7f8b9a, accent: 0xffd23a, dark: 0x30363d, camo: 0x586578 },
  },
};
