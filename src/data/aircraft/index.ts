import type { AircraftDef, Faction } from '../../aircraft/AircraftDef';
import { F15C } from './f15c';
import { F16C } from './f16c';
import { F22 } from './f22';
import { FA18E } from './fa18e';
import { J10C } from './j10c';
import { J16 } from './j16';
import { J20 } from './j20';
import { J35 } from './j35';
import { MIG29 } from './mig29';
import { RAFALE } from './rafale';
import { SU27 } from './su27';
import { SU35S } from './su35s';
import { SU57 } from './su57';
import { TYPHOON } from './typhoon';

/** The full roster, in hangar order. Add a new aircraft by importing it and appending it here. */
export const AIRCRAFT_LIST: AircraftDef[] = [
  F22, F16C, FA18E, F15C, RAFALE, TYPHOON,
  SU57, SU35S, SU27, MIG29,
  J20, J10C, J16, J35,
];

export const AIRCRAFT: Record<string, AircraftDef> = Object.fromEntries(AIRCRAFT_LIST.map((a) => [a.id, a]));

export const FACTIONS: { id: Faction; label: string }[] = [
  { id: 'west', label: 'West' },
  { id: 'russia', label: 'Russia' },
  { id: 'china', label: 'China' },
];

export const DEFAULT_AIRCRAFT = 'f16c';

export function getAircraft(id: string): AircraftDef {
  return AIRCRAFT[id] ?? AIRCRAFT[DEFAULT_AIRCRAFT];
}
