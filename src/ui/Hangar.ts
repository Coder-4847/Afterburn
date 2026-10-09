import type { AircraftDef } from '../aircraft/AircraftDef';
import { AIRCRAFT_LIST, FACTIONS } from '../data/aircraft';
import type { HangarScene } from '../render/HangarScene';
import { PRESETS, payloadOf, type StationDef } from '../data/stations';
import { STORES } from '../data/weapons';
import { Loadout } from '../weapons/Loadout';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const STATS: { key: keyof AircraftDef['ratings']; label: string }[] = [
  { key: 'speed', label: 'Speed' },
  { key: 'agility', label: 'Agility' },
  { key: 'firepower', label: 'Firepower' },
  { key: 'durability', label: 'Durability' },
  { key: 'stealth', label: 'Stealth' },
];

export interface HangarCallbacks {
  select(id: string): void;
  back(): void;
  /** The loadout screen changed the saved weapons for this aircraft id. */
  loadoutChanged(id: string): void;
}

const STATION_NAMES: Record<StationDef['kind'], string> = { tip: 'Wingtip', wing: 'Wing pylon', belly: 'Fuselage', bay: 'Internal bay' };

/** Hangar screen UI: aircraft list, 3D viewer controls and the stat sheet. The 3D part lives in HangarScene. */
export class HangarUI {
  readonly root: HTMLElement;
  private info!: HTMLElement;
  private items = new Map<string, HTMLButtonElement>();
  private current = '';
  private chosen = '';
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private tab: 'specs' | 'loadout' = 'specs';
  private onCanvas: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: () => void; wheel: (e: WheelEvent) => void } | null = null;

  constructor(parent: HTMLElement, private scene: HangarScene, private canvas: HTMLElement, private cb: HangarCallbacks) {
    this.root = el('div', 'hangar', parent);
    this.root.style.display = 'none';
    this.build();
  }

  private build(): void {
    const left = el('div', 'hg-panel hg-list', this.root);
    el('p', 'brand', left, 'AFTERBURN');
    el('h1', 'title', left, 'Hangar');
    for (const f of FACTIONS) {
      el('div', 'section', left, f.label);
      for (const a of AIRCRAFT_LIST.filter((x) => x.faction === f.id)) {
        const b = el('button', 'hg-item', left);
        el('span', 'hg-name', b, a.name);
        el('span', 'hg-role', b, a.role);
        b.addEventListener('click', () => this.preview(a.id));
        this.items.set(a.id, b);
      }
    }

    const right = el('div', 'hg-panel hg-info', this.root);
    const tabs = el('div', 'hg-tabs', right);
    for (const [id, label] of [['specs', 'SPECS'], ['loadout', 'LOADOUT']] as const) {
      const b = el('button', 'hg-tab', tabs, label);
      b.addEventListener('click', () => {
        this.tab = id;
        for (const o of Array.from(tabs.children)) o.classList.toggle('on', o === b);
        this.renderInfo(AIRCRAFT_LIST.find((a) => a.id === this.chosen)!);
      });
      b.classList.toggle('on', id === this.tab);
    }
    this.info = el('div', '', right);

    const bar = el('div', 'hg-toolbar', this.root);
    const tog = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = el('button', 'hg-tog', bar, label);
      b.classList.toggle('on', get());
      b.addEventListener('click', () => {
        set(!get());
        b.classList.toggle('on', get());
      });
    };
    tog('Landing gear', () => this.scene.gearDown, (v) => (this.scene.gearDown = v));
    tog('Afterburner', () => this.scene.afterburner, (v) => (this.scene.afterburner = v));
    tog('Animate controls', () => this.scene.animate, (v) => (this.scene.animate = v));
    el('span', 'hg-hint', bar, 'Drag to rotate · scroll to zoom');
  }

  show(currentId: string): void {
    this.root.style.display = '';
    this.current = currentId;
    this.preview(currentId);
    const down = (e: PointerEvent) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.scene.orbit(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const up = () => (this.dragging = false);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.scene.zoom(e.deltaY);
    };
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.canvas.addEventListener('wheel', wheel, { passive: false });
    this.onCanvas = { down, move, up, wheel };
  }

  hide(): void {
    this.root.style.display = 'none';
    if (this.onCanvas) {
      this.canvas.removeEventListener('pointerdown', this.onCanvas.down);
      window.removeEventListener('pointermove', this.onCanvas.move);
      window.removeEventListener('pointerup', this.onCanvas.up);
      this.canvas.removeEventListener('wheel', this.onCanvas.wheel);
      this.onCanvas = null;
    }
  }

  private preview(id: string): void {
    const def = AIRCRAFT_LIST.find((a) => a.id === id)!;
    this.chosen = id;
    for (const [k, b] of this.items) b.classList.toggle('active', k === id);
    this.items.get(id)?.scrollIntoView({ block: 'nearest' });
    this.onPreview?.(def);
    const lo = new Loadout(def);
    this.scene.setLoadout(lo.items, lo.arm);
    this.renderInfo(def);
  }

  /** Set by the game: swap the 3D model. */
  onPreview?: (def: AircraftDef) => void;

  private renderInfo(a: AircraftDef): void {
    const f = a.flight;
    this.info.innerHTML = '';
    if (this.tab === 'loadout') {
      this.renderLoadout(a);
      return;
    }
    el('p', 'brand', this.info, a.faction.toUpperCase());
    el('h1', 'title', this.info, a.fullName);
    el('p', 'sub', this.info, a.role);
    el('p', 'hg-blurb', this.info, a.blurb);

    const stats = el('div', 'hg-stats', this.info);
    for (const s of STATS) {
      const row = el('div', 'hg-stat', stats);
      el('span', 'hg-stat-l', row, s.label);
      const bar = el('span', 'hg-bar', row);
      for (let i = 1; i <= 5; i++) el('i', i <= a.ratings[s.key] ? 'on' : '', bar);
    }

    const grid = el('div', 'hg-grid', this.info);
    const kv = (k: string, v: string) => {
      const r = el('div', 'kv', grid);
      el('span', '', r, k);
      el('span', 'kbd', r, v);
    };
    kv('Top speed (SL)', `${Math.round(f.maxSpeed * 3.6)} km/h`);
    kv('Thrust / weight', `${f.twMil.toFixed(2)} · ${f.twAb.toFixed(2)} AB`);
    kv('Stall speed', `${Math.round(f.stallSpeed * 3.6)} km/h`);
    kv('G limit', `${f.gLimit.toFixed(1)} G`);
    kv('Pitch rate', `${Math.round((f.pitchRate * 180) / Math.PI)}°/s`);
    kv('Roll rate', `${Math.round((f.rollRate * 180) / Math.PI)}°/s`);
    kv('Structure', `${a.hp} HP`);
    kv('Radar signature', a.rcs < 0.1 ? `${a.rcs.toFixed(2)} m²` : `${a.rcs.toFixed(1)} m²`);
    kv('Cannon', `${a.gun.caliber} mm · ${a.gun.rounds} rds`);
    kv('Flares / chaff', `${a.countermeasures.flares} / ${a.countermeasures.chaff}`);
    if (f.thrustVectoring > 0.3) kv('Thrust vectoring', f.thrustVectoring > 0.9 ? '3D' : 'Pitch');

    const row = el('div', 'hg-actions', this.info);
    const sel = el('button', 'btn primary', row, a.id === this.current ? 'SELECTED' : 'SELECT');
    sel.addEventListener('click', () => {
      this.current = a.id;
      this.cb.select(a.id);
    });
    const back = el('button', 'btn', row, 'Back');
    back.addEventListener('click', () => this.cb.back());
  }

  // ---- loadout screen ---------------------------------------------------------------------------

  private renderLoadout(a: AircraftDef): void {
    const lo = new Loadout(a);
    const arm = lo.arm;
    el('p', 'brand', this.info, a.name.toUpperCase());
    el('h1', 'title', this.info, 'Loadout');
    el('p', 'sub', this.info, `${arm.stations.length} stations · payload limit ${arm.payload} · the gun and countermeasures are always fitted`);

    // payload bar
    const pl = el('div', 'lo-payload', this.info);
    const lbl = el('div', 'lo-pl-lbl', pl);
    const bar = el('div', 'lo-bar', pl);
    const fill = el('i', '', bar);

    // presets
    el('div', 'section', this.info, 'Presets');
    const pr = el('div', 'lo-presets', this.info);
    const selects: HTMLSelectElement[] = [];
    let counts!: HTMLElement;
    const sync = () => {
      const used = payloadOf(lo.items);
      lbl.textContent = `PAYLOAD  ${used.toFixed(1)} / ${arm.payload}`;
      fill.style.width = Math.min(100, (used / arm.payload) * 100) + '%';
      fill.classList.toggle('full', used > arm.payload - 0.51);
      selects.forEach((s, i) => {
        s.value = lo.items[i] ?? '';
        for (const op of Array.from(s.options)) {
          if (op.value) op.disabled = !lo.canSet(i, op.value);
        }
      });
      this.scene.setLoadout(lo.items, arm);
      this.cb.loadoutChanged(a.id);
      counts.textContent = `IR ${lo.count('ir')}  ·  Radar ${lo.count('radar')}  ·  Rocket pods ${lo.count('rocket')}  ·  Bombs ${lo.count('bomb')}`;
    };
    for (const p of PRESETS) {
      const b = el('button', 'lo-btn', pr, p);
      b.addEventListener('click', () => {
        lo.applyPreset(p);
        sync();
      });
    }
    const clr = el('button', 'lo-btn', pr, 'Clear');
    clr.addEventListener('click', () => {
      lo.items = lo.items.map(() => null);
      lo.persist();
      sync();
    });

    // stations
    el('div', 'section', this.info, 'Stations');
    const list = el('div', 'lo-stations', this.info);
    arm.stations.forEach((st, i) => {
      const row = el('div', 'lo-row', list);
      const name = el('span', 'lo-name', row, `${STATION_NAMES[st.kind]}${Math.abs(st.x) > 0.01 ? (st.x < 0 ? ' L' : ' R') : ''}`);
      name.title = st.id;
      const sel = el('select', 'lo-sel', row);
      const none = el('option', '', sel, '— empty —');
      none.value = '';
      for (const id of lo.options(i)) {
        const d = STORES[id];
        const type = d.kind === 'rocket' ? 'pod' : d.kind === 'bomb' ? (d.guided ? 'guided' : 'bomb') : d.kind === 'ir' ? 'IR' : 'radar';
        const op = el('option', '', sel, `${d.name} · ${type} [${d.weight}]`);
        op.value = id;
      }
      sel.addEventListener('change', () => {
        if (!lo.set(i, sel.value || null)) sel.value = lo.items[i] ?? '';
        sync();
      });
      selects.push(sel);
    });
    counts = el('p', 'lo-counts', this.info, '');

    // custom loadouts
    el('div', 'section', this.info, 'Saved loadouts');
    const saveRow = el('div', 'lo-save', this.info);
    const nameIn = el('input', 'lo-input', saveRow);
    nameIn.type = 'text';
    nameIn.placeholder = 'Name this loadout';
    nameIn.maxLength = 24;
    const saveBtn = el('button', 'lo-btn', saveRow, 'Save');
    const saved = el('div', 'lo-saved', this.info);
    const drawSaved = () => {
      saved.innerHTML = '';
      const names = lo.customNames();
      if (names.length === 0) el('p', 'lo-none', saved, 'None yet. Set up the stations, name the loadout, press Save.');
      for (const n of names) {
        const r = el('div', 'lo-saved-row', saved);
        el('span', '', r, n);
        const load = el('button', 'lo-btn', r, 'Load');
        load.addEventListener('click', () => {
          if (lo.loadCustom(n)) sync();
        });
        const del = el('button', 'lo-btn danger', r, '×');
        del.addEventListener('click', () => {
          lo.deleteCustom(n);
          drawSaved();
        });
      }
    };
    saveBtn.addEventListener('click', () => {
      const n = nameIn.value.trim();
      if (!n) return;
      lo.saveCustom(n);
      nameIn.value = '';
      drawSaved();
    });
    drawSaved();
    sync();

    const row = el('div', 'hg-actions', this.info);
    row.style.marginTop = '14px';
    const selBtn = el('button', 'btn primary', row, a.id === this.current ? 'SELECTED' : 'SELECT');
    selBtn.addEventListener('click', () => {
      this.current = a.id;
      this.cb.select(a.id);
    });
    const back = el('button', 'btn', row, 'Back');
    back.addEventListener('click', () => this.cb.back());
  }

  get previewed(): string {
    return this.chosen;
  }
}
