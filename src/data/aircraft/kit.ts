import type { DetailSpec } from '../../aircraft/AircraftDef';

const PI = Math.PI;

/**
 * Small repeated parts every fighter carries, so the airframe data files can stay about what makes each jet different.
 * Positions are metres: x right, y above the fuselage axis, z from the nose.
 */

/** Angle-of-attack vanes and static ports either side of the nose. */
export function noseKit(z: number, hw: number, y = 0): DetailSpec[] {
  return [
    { k: 'blade', p: [hw, y, z], s: [0.2, 0.15, 0.012], r: [0, 0, PI / 2 + 0.2], mirror: true, mat: 'strut' },
    { k: 'box', p: [hw * 0.98, y + 0.12, z + 1.0], s: [0.02, 0.1, 0.22], mirror: true, mat: 'dark' },
    { k: 'box', p: [hw * 0.98, y - 0.12, z + 1.0], s: [0.02, 0.07, 0.14], mirror: true, mat: 'dark' },
  ];
}

/** UHF / VHF blade antennas on the spine and belly and an IFF blister. */
export function blades(zTop: number, yTop: number, zBot: number, yBot: number): DetailSpec[] {
  return [
    { k: 'blade', p: [0, yTop, zTop], s: [0.24, 0.36, 0.028] },
    { k: 'blade', p: [0, yBot, zBot], s: [0.2, 0.3, 0.028], r: [PI, 0, 0] },
    { k: 'blister', p: [0, yTop - 0.02, zTop + 1.6], s: [0.12, 0.05, 0.3], mat: 'dark' },
  ];
}

/** Chaff and flare dispenser blocks on the lower rear fuselage. */
export function dispensers(z: number, y: number, x: number): DetailSpec[] {
  return [
    { k: 'box', p: [x, y, z], s: [0.3, 0.1, 0.55], mirror: true, mat: 'dark' },
    { k: 'box', p: [x, y, z + 0.7], s: [0.3, 0.1, 0.55], mirror: true, mat: 'dark' },
  ];
}

/** Louvred cooling vents low on each side of the engine bay. */
export function bayVents(z: number, x: number, y: number): DetailSpec[] {
  return [
    { k: 'vent', p: [x, y, z], s: [0.3, 0.7, 5], r: [0, 0, PI / 2], mirror: true, mat: 'dark' },
    { k: 'vent', p: [x, y + 0.34, z + 1.3], s: [0.26, 0.5, 4], r: [0, 0, PI / 2], mirror: true, mat: 'dark' },
  ];
}

/** An air-to-air refuelling receptacle slot on the spine. */
export function receptacle(z: number, y: number): DetailSpec[] {
  return [{ k: 'box', p: [0, y, z], s: [0.34, 0.03, 0.8], mat: 'dark' }];
}

/** Optical windows (IRST, targeting sensors, missile warning) as small glass blisters. */
export function windows(list: [number, number, number, number?][]): DetailSpec[] {
  return list.map(([x, y, z, r]) => ({ k: 'blister' as const, p: [x, y, z] as [number, number, number], s: [r ?? 0.1, (r ?? 0.1) * 0.7, (r ?? 0.1) * 1.5] as [number, number, number], mat: 'glass' as const, mirror: x !== 0 }));
}
