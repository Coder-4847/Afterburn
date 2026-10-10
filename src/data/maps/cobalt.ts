import type { MapDef } from './types';

/**
 * Cobalt Sea: the Carrier Strike map. A wide ocean with the two carrier groups on open water at either end, a small airfield
 * island behind each (for the wingmen's fallback), a rugged island chain across the middle to fight over and fly low through,
 * and islands round the rim. X is east, Z is south. Blue is in the west, Red in the east.
 */
export const COBALT: MapDef = {
  id: 'cobalt',
  name: 'Cobalt Sea',
  description: 'Open ocean for carrier operations: a carrier group at each end, a rugged island chain between them.',
  tagline: 'Carrier Strike only',
  exclusive: 'carrier',
  size: 26000,
  seed: 9137,
  seaLevel: 0,
  terrain: {
    kind: 'archipelago',
    islands: [
      // the middle: a chain of rugged islands across the line between the fleets
      { x: 0, z: 0, rx: 1900, rz: 1050, rot: 25, peak: 240, rugged: 0.8, reef: true },
      { x: -1700, z: -3900, rx: 1300, rz: 800, rot: -15, peak: 130, rugged: 0.55 },
      { x: 1800, z: 3900, rx: 1250, rz: 850, rot: 30, peak: 140, rugged: 0.55 },
      { x: -3200, z: 3200, rx: 700, rz: 520, rot: 50, peak: 70, rugged: 0.4 },
      { x: 3300, z: -3200, rx: 700, rz: 520, rot: 40, peak: 70, rugged: 0.4 },
      // airfield islands behind each fleet
      { x: -9400, z: 3800, rx: 1950, rz: 1250, rot: 5, peak: 44, rugged: 0.15, reef: true },
      { x: 9400, z: -3800, rx: 1950, rz: 1250, rot: 5, peak: 44, rugged: 0.15, reef: true },
      // the rim
      { x: -10400, z: -6400, rx: 1500, rz: 1000, rot: -20, peak: 95, rugged: 0.45 },
      { x: 10400, z: 6400, rx: 1500, rz: 1000, rot: -20, peak: 95, rugged: 0.45 },
      { x: 600, z: -9200, rx: 2100, rz: 1100, rot: 8, peak: 170, rugged: 0.6, reef: true },
      { x: -600, z: 9200, rx: 2100, rz: 1100, rot: 8, peak: 170, rugged: 0.6, reef: true },
    ],
    scatter: { count: 18, minR: 120, maxR: 380, maxPeak: 60 },
  },
  palette: {
    base: 0x35592f,
    sand: 0xe2d3a4,
    rock: 0x5f5b55,
    snow: 0xf2f4f6,
    seabed: 0xc9bd8f,
    sandTop: 4.5,
    snowLine: 99999,
    rockSlope: 0.28,
    detailStrength: 0.55,
  },
  water: { shallow: 0x2fd0c4, deep: 0x062c63, clarity: 14, waveStrength: 1.25 },
  lighting: {
    day: {
      sunAzimuth: 205,
      sunElevation: 52,
      sunColor: 0xfff3dc,
      sunIntensity: 3.7,
      zenith: 0x2562b0,
      horizon: 0xa8c9e6,
      ground: 0x5f8aa0,
      sunsetTint: 0xd5dad9,
      fogDensity: 0.00006,
      envIntensity: 0.75,
      exposure: 1.0,
    },
    sunset: {
      sunAzimuth: 255,
      sunElevation: 8,
      sunColor: 0xffa05a,
      sunIntensity: 2.6,
      zenith: 0x1d3068,
      horizon: 0xee9c70,
      ground: 0x4a4a5e,
      sunsetTint: 0xff7a3a,
      fogDensity: 0.00009,
      envIntensity: 0.6,
      exposure: 1.1,
    },
  },
  airstrips: [
    { id: 'blue-airfield', team: 'blue', name: 'Blue Airfield', x: -9600, z: 3800, heading: 90, length: 1500, width: 48, elevation: 12 },
    { id: 'red-airfield', team: 'red', name: 'Red Airfield', x: 9600, z: -3800, heading: 270, length: 1500, width: 48, elevation: 12 },
  ],
  clouds: { base: 1500, top: 2400, coverage: 0.42, scale: 1.1 },
  boundary: 11800,
  spawn: { x: -6400, z: 0, heading: 90, altitude: 450, speed: 200 },
};
