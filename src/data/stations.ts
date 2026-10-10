import type { AircraftDef } from '../aircraft/AircraftDef';
import { secAt } from '../aircraft/sections';
import { STORES, type WeaponKind } from './weapons';

/** One weapon station (hardpoint). Positions are in the aircraft's model space (-Z forward). */
export interface StationDef {
  id: string;
  kind: 'tip' | 'wing' | 'belly' | 'bay';
  /** Which kinds of store fit. */
  allow: WeaponKind[];
  /** Heaviest single store this station can carry. */
  maxWeight: number;
  x: number;
  y: number;
  z: number;
  /** Internal bays carry stores with no drag and no visible pylon. */
  internal: boolean;
}

/** The weapons a given aircraft can carry (real-world names per faction). */
export interface Armament {
  ir: string;
  radar: string;
  rocket: string;
  dumb: string;
  guided: string;
  /** Total payload limit in weight units. */
  payload: number;
  stations: StationDef[];
}

interface Layout {
  tip: boolean;
  /** Fractions along each half-span (pairs, left and right). */
  wing: number[];
  /** Fuselage stations (alternating sides). */
  belly: number;
  /** Internal bay stations. */
  bay: number;
  payload: number;
  ir: string;
  radar: string;
  rocket: string;
  dumb: string;
  guided: string;
}

const W = { ir: 'aim9x', radar: 'aim120d', rocket: 'hydra', dumb: 'mk82', guided: 'gbu12' };
const R = { ir: 'r73', radar: 'r77', rocket: 's8', dumb: 'fab250', guided: 'kab500' };
const C = { ir: 'pl10', radar: 'pl15', rocket: 'zs90', dumb: 'type250', guided: 'ls500' };

const LAYOUTS: Record<string, Layout> = {
  f22: { tip: false, wing: [0.5], belly: 0, bay: 6, payload: 9, ...W },
  f16c: { tip: true, wing: [0.3, 0.55, 0.8], belly: 1, bay: 0, payload: 11, ...W },
  fa18e: { tip: true, wing: [0.25, 0.45, 0.65], belly: 2, bay: 0, payload: 13, ...W },
  f15c: { tip: true, wing: [0.4], belly: 4, bay: 0, payload: 12, ...W },
  rafale: { tip: true, wing: [0.28, 0.5, 0.72], belly: 2, bay: 0, payload: 13, ...W, ir: 'micair', radar: 'micaem' },
  typhoon: { tip: true, wing: [0.3, 0.55, 0.78], belly: 4, bay: 0, payload: 14, ...W, ir: 'irist', radar: 'meteor' },
  su57: { tip: false, wing: [0.4, 0.7], belly: 0, bay: 4, payload: 12, ...R },
  su35s: { tip: true, wing: [0.28, 0.5, 0.72], belly: 4, bay: 0, payload: 15, ...R },
  su27: { tip: true, wing: [0.3, 0.55], belly: 4, bay: 0, payload: 13, ...R },
  mig29: { tip: true, wing: [0.35, 0.65], belly: 1, bay: 0, payload: 10, ...R },
  j20: { tip: false, wing: [0.5], belly: 0, bay: 6, payload: 10, ...C },
  j10c: { tip: true, wing: [0.28, 0.5, 0.75], belly: 1, bay: 0, payload: 12, ...C },
  j16: { tip: false, wing: [0.28, 0.5, 0.72], belly: 6, bay: 0, payload: 16, ...C },
  j35: { tip: false, wing: [0.45], belly: 0, bay: 4, payload: 9, ...C },
};

/** Where the first centre-line / fuselage station sits (fraction of the length), for jets with a chin intake in the way. */
const BELLY_Z: Record<string, number> = { f16c: 0.58, j10c: 0.59, typhoon: 0.6 };

/** Fuselage half-width and extent at a given length fraction (same interpolation the model uses). */
function hwAt(def: AircraftDef, f: number): { hw: number; hh: number; yc: number } {
  return secAt(def.model, f);
}

const cache = new Map<string, Armament>();

/** Build an aircraft's stations from its model geometry, so stores hang in the right place for every airframe. */
export function armamentFor(def: AircraftDef): Armament {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const lay = LAYOUTS[def.id] ?? LAYOUTS.f16c;
  const m = def.model;
  const w = m.wing;
  const L = m.length;
  const z0 = -L / 2 + w.zRoot * L;
  const xr = w.xRoot ?? hwAt(def, w.zRoot + 0.08).hw * 0.8;
  const half = w.span / 2 - xr;
  const stations: StationDef[] = [];
  const all: WeaponKind[] = ['ir', 'radar', 'rocket', 'bomb'];

  const wingPos = (f: number, s: number) => ({
    x: s * (xr + half * f),
    y: w.y + f * half * w.dihedral - 0.55,
    z: z0 + w.sweep * f + (w.rootChord + (w.tipChord - w.rootChord) * f) * 0.4,
  });
  if (lay.tip) {
    for (const s of [-1, 1]) {
      const p = wingPos(1, s);
      stations.push({ id: `tip${s < 0 ? 'L' : 'R'}`, kind: 'tip', allow: ['ir'], maxWeight: 1.2, x: p.x - s * 0.1, y: w.y + half * w.dihedral, z: p.z - 0.2, internal: false });
    }
  }
  lay.wing.forEach((f, i) => {
    for (const s of [-1, 1]) {
      const p = wingPos(f, s);
      const heavy = i === 0 || lay.wing.length === 1;
      stations.push({ id: `w${i + 1}${s < 0 ? 'L' : 'R'}`, kind: 'wing', allow: heavy ? all : ['ir', 'radar', 'rocket'], maxWeight: heavy ? 3 : 2, x: p.x, y: p.y, z: p.z, internal: false });
    }
  });
  for (let i = 0; i < lay.belly; i++) {
    const fz = (BELLY_Z[def.id] ?? 0.42) + 0.09 * Math.floor(i / 2);
    const sec = hwAt(def, fz);
    const s = i % 2 === 0 ? -1 : 1;
    const x = lay.belly === 1 ? 0 : s * Math.min(sec.hw * 0.7, 1.1);
    stations.push({ id: `b${i + 1}`, kind: 'belly', allow: ['radar', 'ir', 'bomb', 'rocket'], maxWeight: 2.6, x, y: sec.yc - sec.hh - 0.18, z: -L / 2 + fz * L, internal: false });
  }
  for (let i = 0; i < lay.bay; i++) {
    const fz = 0.4 + 0.05 * Math.floor(i / 2);
    const s = i % 2 === 0 ? -1 : 1;
    stations.push({ id: `bay${i + 1}`, kind: 'bay', allow: ['ir', 'radar', 'bomb'], maxWeight: 2.6, x: s * 0.35, y: -0.35, z: -L / 2 + fz * L, internal: true });
  }

  const a: Armament = { ir: lay.ir, radar: lay.radar, rocket: lay.rocket, dumb: lay.dumb, guided: lay.guided, payload: lay.payload, stations };
  cache.set(def.id, a);
  return a;
}

/** Which store ids this aircraft may mount in a station, per kind. */
export function storesFor(arm: Armament, station: StationDef): string[] {
  const out: string[] = [];
  for (const k of station.allow) {
    if (k === 'ir') out.push(arm.ir);
    else if (k === 'radar') out.push(arm.radar);
    else if (k === 'rocket') out.push(arm.rocket);
    else if (k === 'bomb') out.push(arm.dumb, arm.guided);
  }
  return out.filter((id) => (STORES[id]?.weight ?? 99) <= station.maxWeight);
}

export type PresetName = 'Dogfighter' | 'Beyond-visual-range' | 'Strike' | 'Balanced';
export const PRESETS: PresetName[] = ['Dogfighter', 'Beyond-visual-range', 'Strike', 'Balanced'];

/** Fill stations according to a role. Respects what fits where and the payload limit. */
export function presetLoadout(arm: Armament, preset: PresetName): (string | null)[] {
  const items: (string | null)[] = arm.stations.map(() => null);
  let payload = 0;
  const put = (i: number, id: string | null): void => {
    if (!id) return;
    const st = arm.stations[i];
    const def = STORES[id];
    if (!def || !storesFor(arm, st).includes(id)) return;
    if (payload + def.weight > arm.payload + 1e-6) return;
    items[i] = id;
    payload += def.weight;
  };
  const stIdx = (k: StationDef['kind']) => arm.stations.map((s, i) => (s.kind === k ? i : -1)).filter((i) => i >= 0);
  const tips = stIdx('tip');
  const wings = stIdx('wing');
  const bellies = stIdx('belly');
  const bays = stIdx('bay');
  const order = [...wings].sort((a, b) => Math.abs(arm.stations[a].x) - Math.abs(arm.stations[b].x)); // inboard first

  switch (preset) {
    case 'Dogfighter':
      tips.forEach((i) => put(i, arm.ir));
      bays.forEach((i, n) => put(i, n < 2 ? arm.radar : arm.ir));
      wings.forEach((i) => put(i, arm.ir));
      bellies.slice(0, 2).forEach((i) => put(i, arm.ir));
      break;
    case 'Beyond-visual-range':
      tips.forEach((i) => put(i, arm.ir));
      bays.forEach((i) => put(i, arm.radar));
      order.forEach((i) => put(i, arm.radar));
      bellies.forEach((i) => put(i, arm.radar));
      break;
    case 'Strike':
      tips.forEach((i) => put(i, arm.ir));
      bays.forEach((i, n) => put(i, n < 2 ? arm.guided : arm.ir));
      order.slice(0, 2).forEach((i) => put(i, arm.guided));
      bellies.forEach((i) => put(i, arm.dumb));
      order.slice(2, 4).forEach((i) => put(i, arm.rocket));
      order.slice(4).forEach((i) => put(i, arm.ir));
      break;
    case 'Balanced':
      tips.forEach((i) => put(i, arm.ir));
      bays.forEach((i, n) => put(i, n % 2 === 0 ? arm.radar : arm.ir));
      order.slice(0, 2).forEach((i) => put(i, arm.radar));
      order.slice(2, 4).forEach((i) => put(i, arm.ir));
      order.slice(4).forEach((i) => put(i, arm.rocket));
      bellies.slice(0, 2).forEach((i, n) => put(i, n === 0 ? arm.radar : arm.dumb));
      // an all-rounder should be able to try everything: make room for a rocket pod and a bomb if none got mounted
      {
        const flex = [...order].reverse().concat(bellies, bays);
        const swap = (kind: 'rocket' | 'bomb', ids: string[]): void => {
          if (items.some((id) => id && STORES[id].kind === kind)) return;
          for (const i of flex) {
            const cur = items[i];
            const radars = items.filter((x) => x && STORES[x].kind === 'radar').length;
            if (cur && STORES[cur].kind !== 'ir' && !(STORES[cur].kind === 'radar' && radars > 2)) continue;
            for (const id of ids) {
              if (!storesFor(arm, arm.stations[i]).includes(id)) continue;
              const w = payloadOf(items) - (cur ? STORES[cur].weight : 0) + STORES[id].weight;
              if (w > arm.payload + 1e-6) continue;
              items[i] = id;
              return;
            }
          }
        };
        swap('rocket', [arm.rocket]);
        swap('bomb', [arm.guided, arm.dumb]);
        payload = payloadOf(items);
      }
      break;
  }
  return items;
}

export function payloadOf(items: (string | null)[]): number {
  return items.reduce((s, id) => s + (id ? (STORES[id]?.weight ?? 0) : 0), 0);
}
