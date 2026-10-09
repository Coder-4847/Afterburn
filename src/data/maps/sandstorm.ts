import type { MapDef } from './types';

/**
 * Sandstorm Basin: a dry basin of dunes ringed by mesas and broken highlands, hazy air and low, hot sun.
 * Blue starts in the west, Red in the east, with a mesa field in between. There is no sea: a flat plane of sand fills the
 * world beyond the terrain. X is east, Z is south.
 */
export const SANDSTORM: MapDef = {
  id: 'sandstorm',
  name: 'Sandstorm Basin',
  tagline: 'Desert · mesas · haze',
  description: 'A dune basin ringed by flat-topped mesas. Dusty haze cuts visibility; canyons and ridgelines hide low-flying jets.',
  size: 20480,
  seed: 7788,
  seaLevel: -400,
  groundPlane: { color: 0xcdb27a, y: 30 },
  terrain: {
    kind: 'desert',
    floor: 30,
    duneAmp: 15,
    highlandAmp: 430,
    highlandCover: 0.5,
    mesas: [
      { x: 0, z: 0, rx: 1900, rz: 1200, rot: 20, height: 260 },
      { x: -3400, z: -4300, rx: 1400, rz: 850, rot: -15, height: 190 },
      { x: 3700, z: 3900, rx: 1500, rz: 950, rot: 35, height: 210 },
      { x: -2300, z: 4900, rx: 950, rz: 700, rot: 0, height: 150 },
      { x: 2600, z: -4700, rx: 1150, rz: 800, rot: 50, height: 170 },
      { x: -600, z: 3000, rx: 420, rz: 320, rot: 30, height: 90 },
      { x: 700, z: -3100, rx: 400, rz: 300, rot: -40, height: 100 },
    ],
  },
  palette: {
    base: 0xa9764a,
    sand: 0xdcc088,
    rock: 0x74594a,
    snow: 0xf2f4f6,
    seabed: 0xcdb27a,
    sandTop: 78,
    snowLine: 99999,
    rockSlope: 0.3,
    detailStrength: 0.7,
  },
  water: { shallow: 0xd8c28f, deep: 0xc4a97a, clarity: 5, waveStrength: 0 },
  lighting: {
    day: {
      sunAzimuth: 200,
      sunElevation: 60,
      sunColor: 0xfff0cf,
      sunIntensity: 4.1,
      zenith: 0x3b73b8,
      horizon: 0xe3cfa6,
      ground: 0xa68f6a,
      sunsetTint: 0xf0c890,
      fogDensity: 0.00018,
      envIntensity: 0.8,
      exposure: 1.05,
    },
    sunset: {
      sunAzimuth: 255,
      sunElevation: 8,
      sunColor: 0xff9a4d,
      sunIntensity: 2.9,
      zenith: 0x2a2f6a,
      horizon: 0xe8905a,
      ground: 0x6a4a3a,
      sunsetTint: 0xff6a2a,
      fogDensity: 0.00024,
      envIntensity: 0.6,
      exposure: 1.15,
    },
  },
  airstrips: [
    { id: 'blue-alpha', team: 'blue', name: 'Blue Alpha', x: -7200, z: 600, heading: 90, length: 1700, width: 50, elevation: 30 },
    { id: 'blue-bravo', team: 'blue', name: 'Blue Bravo', x: -6300, z: -4700, heading: 60, length: 1500, width: 48, elevation: 30 },
    { id: 'blue-charlie', team: 'blue', name: 'Blue Charlie', x: -6300, z: 4900, heading: 120, length: 1500, width: 48, elevation: 30 },
    { id: 'red-alpha', team: 'red', name: 'Red Alpha', x: 7200, z: -600, heading: 270, length: 1700, width: 50, elevation: 30 },
    { id: 'red-bravo', team: 'red', name: 'Red Bravo', x: 6300, z: 4700, heading: 240, length: 1500, width: 48, elevation: 30 },
    { id: 'red-charlie', team: 'red', name: 'Red Charlie', x: 6300, z: -4900, heading: 300, length: 1500, width: 48, elevation: 30 },
  ],
  clouds: { base: 2700, top: 3300, coverage: 0.1, scale: 1.2 },
  boundary: 9600,
  spawn: { x: -5400, z: 600, heading: 90, altitude: 520, speed: 210 },
};
