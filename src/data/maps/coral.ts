import type { MapDef } from './types';

/**
 * Coral Archipelago: bright tropical islands. Blue starts in the west, Red in the east,
 * with a rugged volcano island in the middle as the frontline.
 * X is east, Z is south (so north = -Z). All coordinates in metres from the map centre.
 */
export const CORAL: MapDef = {
  id: 'coral',
  name: 'Coral Archipelago',
  description: 'Tropical islands over bright shallow water. Wide open sky, low-level island hopping.',
  size: 20480,
  seed: 4242,
  seaLevel: 0,
  terrain: {
    kind: 'archipelago',
    islands: [
      { x: -6800, z: 500, rx: 2100, rz: 1500, rot: 10, peak: 62, rugged: 0.22, reef: true }, // Blue main
      { x: -5600, z: -5200, rx: 1650, rz: 1150, rot: -20, peak: 55, rugged: 0.2, reef: true },
      { x: -5200, z: 5400, rx: 1550, rz: 1150, rot: 25, peak: 55, rugged: 0.2, reef: true },
      { x: 0, z: 200, rx: 2800, rz: 2100, rot: 30, peak: 500, rugged: 0.85, reef: true }, // central volcano
      { x: -800, z: -5600, rx: 1300, rz: 900, rot: 0, peak: 110, rugged: 0.5 },
      { x: 1200, z: 5000, rx: 1200, rz: 900, rot: 40, peak: 100, rugged: 0.5 },
      { x: 6800, z: -500, rx: 2100, rz: 1500, rot: 10, peak: 62, rugged: 0.22, reef: true }, // Red main
      { x: 5600, z: 5200, rx: 1650, rz: 1150, rot: -20, peak: 55, rugged: 0.2, reef: true },
      { x: 5200, z: -5400, rx: 1550, rz: 1150, rot: 25, peak: 55, rugged: 0.2, reef: true },
    ],
    scatter: { count: 16, minR: 140, maxR: 420, maxPeak: 70 },
  },
  palette: {
    base: 0x3d6a32,
    sand: 0xe6d6a6,
    rock: 0x6d655b,
    snow: 0xf2f4f6,
    seabed: 0xd2c496,
    sandTop: 4.5,
    snowLine: 99999,
    rockSlope: 0.3,
    detailStrength: 0.55,
  },
  water: { shallow: 0x3ee0cf, deep: 0x08407e, clarity: 15, waveStrength: 1.0 },
  lighting: {
    day: {
      sunAzimuth: 220,
      sunElevation: 46,
      sunColor: 0xfff1d6,
      sunIntensity: 3.8,
      zenith: 0x2a68b8,
      horizon: 0xaccfe9,
      ground: 0x6f93a3,
      sunsetTint: 0xd8dcd8,
      fogDensity: 0.00006,
      envIntensity: 0.75,
      exposure: 1.0,
    },
    sunset: {
      sunAzimuth: 262,
      sunElevation: 7,
      sunColor: 0xffa45c,
      sunIntensity: 2.6,
      zenith: 0x1f3470,
      horizon: 0xf0a374,
      ground: 0x4d4b5e,
      sunsetTint: 0xff7a3a,
      fogDensity: 0.00009,
      envIntensity: 0.6,
      exposure: 1.1,
    },
  },
  airstrips: [
    { id: 'blue-alpha', team: 'blue', name: 'Blue Alpha', x: -7000, z: 500, heading: 90, length: 1600, width: 48, elevation: 14 },
    { id: 'blue-bravo', team: 'blue', name: 'Blue Bravo', x: -5600, z: -5200, heading: 70, length: 1500, width: 48, elevation: 12 },
    { id: 'blue-charlie', team: 'blue', name: 'Blue Charlie', x: -5200, z: 5400, heading: 110, length: 1500, width: 48, elevation: 12 },
    { id: 'red-alpha', team: 'red', name: 'Red Alpha', x: 7000, z: -500, heading: 270, length: 1600, width: 48, elevation: 14 },
    { id: 'red-bravo', team: 'red', name: 'Red Bravo', x: 5600, z: 5200, heading: 250, length: 1500, width: 48, elevation: 12 },
    { id: 'red-charlie', team: 'red', name: 'Red Charlie', x: 5200, z: -5400, heading: 290, length: 1500, width: 48, elevation: 12 },
  ],
  boundary: 9600,
  spawn: { x: -5200, z: 500, heading: 90, altitude: 650, speed: 210 },
};
