import type { AircraftDef } from '../../aircraft/AircraftDef';

// <prelude>
/** Fuselage length (m) and a metres -> length-fraction helper, so the numbers below are real distances from the nose. */
const L = 21.9;
const m = (x: number): number => x / L;
// </prelude>

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
    gearHeight: 2.6, bellyHeight: 1.3, energyBleed: 1.1, thrustVectoring: 0,
  },
  ratings: { speed: 4, agility: 3, firepower: 5, durability: 5, stealth: 1 },
  hp: 140, rcs: 3.0,
  gun: { name: 'GSh-30-1', caliber: 30, rounds: 150 },
  countermeasures: { flares: 96, chaff: 48 },
  model: {
    length: L, shapeN: 2.8,
    // [z, half width, half height above, y centre, half height below, top exponent, bottom exponent]
    sections: [
      [0, 0, 0, -0.05, 0, 2.4], [m(0.9), 0.3, 0.3, -0.05, 0.3, 2.4], [m(2.8), 0.66, 0.5, -0.04, 0.46], [m(4.8), 0.95, 0.62, -0.02, 0.52],
      [m(7.0), 1.15, 0.7, 0, 0.5], [m(9.5), 1.0, 0.7, 0.05, 0.5], [m(13.0), 0.9, 0.62, 0.05, 0.46], [m(17.0), 0.72, 0.5, 0.05, 0.4],
      [m(21.0), 0.5, 0.4, 0.05, 0.35], [1, 0.4, 0.34, 0.05, 0.3],
    ],
    pods: [
      { x: 1.32, mirror: true, n: 2.6, capBack: true, rings: [
        [m(7.2), 0.6, 0.54, -0.18, 0.5], [m(9.2), 0.78, 0.66, -0.1, 0.55], [m(13), 0.84, 0.7, 0, 0.6], [m(17.5), 0.8, 0.68, 0, 0.58], [m(21.2), 0.74, 0.62, 0, 0.56], [m(21.8), 0.7, 0.6, 0, 0.55],
      ] },
    ],
    wing: {
      zRoot: m(8.7), rootChord: 6.9, tipChord: 1.6, span: 14.7, sweep: 5.3, thickness: 0.3, y: 0.12, dihedral: 0.03, xRoot: 1.6,
      flapSpan: 0.4, lerx: { length: 4.3, reach: 0.22, thick: 0.4 }, pods: true,
    },
    hstab: { zRoot: m(18.0), rootChord: 3.2, tipChord: 1.2, span: 9.6, sweep: 2.4, y: 0.1, dihedral: 0, xRoot: 1.9 },
    fins: [{ x: 2.35, zRoot: m(15.2), rootChord: 5.2, tipChord: 1.8, height: 3.0, sweep: 3.0, cant: 0.04, y: 0.7 }],
    intakes: [{ x: 1.32, y: -0.5, zFrac: m(6.9), w: 1.35, h: 1.2, len: 3.4, n: 3.2, toe: 0.1 }],
    engines: 2, engineSpacing: 1.32, nozzleRadius: 0.68, airbrake: true, tandem: true,
    canopyZ: m(3.4), canopyLen: 4.6, canopyW: 0.54, canopyH: 0.6,
    features: { irst: true, probe: 'L', gun: [1.1, 0.0, m(8.2)], radome: 0.07, spine: [m(8.0), m(14.5), 0.7, 0.34], hook: 0.93, sting: true },
    gear: { mainX: 1.75, mainZ: 0.55, noseZ: 0.18, mainR: 0.4, noseR: 0.24 },
    colors: { body: 0x7f8b9a, accent: 0xffd23a, dark: 0x30363d, camo: 0x586578 },
  },
};
