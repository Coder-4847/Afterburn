import type { AircraftDef } from '../aircraft/AircraftDef';
import { armamentFor, payloadOf, presetLoadout, storesFor, type Armament, type PresetName } from '../data/stations';
import { STORES } from '../data/weapons';

const KEY = 'afterburn.loadouts.v1';

interface Saved {
  current: (string | null)[];
  custom: Record<string, (string | null)[]>;
}

type Book = Record<string, Saved>;

function readBook(): Book {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Book;
  } catch {
    return {};
  }
}

function writeBook(b: Book): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable */
  }
}

/** The chosen store for every station of one aircraft, with validation and persistence. */
export class Loadout {
  readonly arm: Armament;
  items: (string | null)[];

  constructor(readonly def: AircraftDef) {
    this.arm = armamentFor(def);
    const saved = readBook()[def.id];
    this.items = saved && saved.current.length === this.arm.stations.length ? this.sanitise(saved.current) : presetLoadout(this.arm, 'Balanced');
  }

  /** Re-read what the hangar saved (the loadout screen edits storage directly). */
  reload(): void {
    const saved = readBook()[this.def.id];
    this.items = saved && saved.current.length === this.arm.stations.length ? this.sanitise(saved.current) : presetLoadout(this.arm, 'Balanced');
  }

  /** Drop anything that no longer fits (data changed) and anything over the payload limit. */
  private sanitise(items: (string | null)[]): (string | null)[] {
    let payload = 0;
    return items.map((id, i) => {
      if (!id || !STORES[id] || !storesFor(this.arm, this.arm.stations[i]).includes(id)) return null;
      if (payload + STORES[id].weight > this.arm.payload + 1e-6) return null;
      payload += STORES[id].weight;
      return id;
    });
  }

  get payload(): number {
    return payloadOf(this.items);
  }

  options(i: number): string[] {
    return storesFor(this.arm, this.arm.stations[i]);
  }

  /** Can this station take that store without breaking the payload limit? */
  canSet(i: number, id: string | null): boolean {
    if (!id) return true;
    if (!this.options(i).includes(id)) return false;
    const cur = this.items[i] ? STORES[this.items[i]!].weight : 0;
    return this.payload - cur + STORES[id].weight <= this.arm.payload + 1e-6;
  }

  set(i: number, id: string | null): boolean {
    if (!this.canSet(i, id)) return false;
    this.items[i] = id;
    this.persist();
    return true;
  }

  applyPreset(name: PresetName): void {
    this.items = presetLoadout(this.arm, name);
    this.persist();
  }

  persist(): void {
    const b = readBook();
    const cur = b[this.def.id] ?? { current: [], custom: {} };
    cur.current = [...this.items];
    b[this.def.id] = cur;
    writeBook(b);
  }

  customNames(): string[] {
    return Object.keys(readBook()[this.def.id]?.custom ?? {});
  }

  saveCustom(name: string): void {
    const b = readBook();
    const cur = b[this.def.id] ?? { current: [...this.items], custom: {} };
    cur.custom[name] = [...this.items];
    cur.current = [...this.items];
    b[this.def.id] = cur;
    writeBook(b);
  }

  loadCustom(name: string): boolean {
    const c = readBook()[this.def.id]?.custom[name];
    if (!c || c.length !== this.arm.stations.length) return false;
    this.items = this.sanitise(c);
    this.persist();
    return true;
  }

  deleteCustom(name: string): void {
    const b = readBook();
    if (b[this.def.id]) delete b[this.def.id].custom[name];
    writeBook(b);
  }

  /** Count of each weapon kind currently mounted. */
  count(kind: 'ir' | 'radar' | 'rocket' | 'bomb'): number {
    return this.items.filter((id) => id && STORES[id].kind === kind).length;
  }
}
