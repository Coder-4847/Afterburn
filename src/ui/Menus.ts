import { codeLabel, type Action, type Input } from '../core/Input';
import type { DifficultyId, QualitySetting, Settings, SettingsStore } from '../core/Settings';
import { DIFFICULTIES } from '../data/difficulty';

export interface MenuCallbacks {
  start(): void;
  resume(): void;
  respawnAir(): void;
  respawnRunway(): void;
  hangar(): void;
  aircraftName(): string;
  /** Called after any setting changes that needs a world rebuild (time of day). */
  changed(key: keyof Settings): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Controls shown to the player. */
const SHOWN: { label: string; actions: Action[]; extra?: string }[] = [
  { label: 'Steer', actions: [], extra: 'Mouse (aim reticle)' },
  { label: 'Fire cannon (hold)', actions: ['fireGun'] },
  { label: 'Fire missile / bomb / rockets', actions: ['fireMissile'] },
  { label: 'Select IR / radar / rockets / bombs', actions: ['weapon1', 'weapon2', 'weapon3', 'weapon4'] },
  { label: 'Cycle target', actions: ['cycleTarget'] },
  { label: 'Lock at reticle', actions: ['lockTarget'] },
  { label: 'Flares / chaff', actions: ['flares', 'chaff'] },
  { label: 'Target view (hold)', actions: ['targetCam'] },
  { label: 'Manual pitch / roll', actions: ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight'] },
  { label: 'Rudder', actions: ['yawLeft', 'yawRight'] },
  { label: 'Throttle', actions: ['throttleUp', 'throttleDown'], extra: 'Mouse wheel' },
  { label: 'Afterburner (hold)', actions: ['afterburner'] },
  { label: 'Airbrake / wheel brakes', actions: ['airbrake'] },
  { label: 'Landing gear', actions: ['gear'] },
  { label: 'Camera', actions: ['camera'] },
  { label: 'Look around (hold)', actions: ['lookAround'] },
  { label: 'Pause', actions: ['pause'] },
  { label: 'FPS counter', actions: ['toggleFps'] },
];

export class Menus {
  readonly root: HTMLElement;
  private layer: HTMLElement;
  private crash: HTMLElement;
  private crashTitle: HTMLElement;
  private crashSub: HTMLElement;
  private crashReason = '';
  private bar?: HTMLElement;
  private barLabel?: HTMLElement;
  visible = false;

  constructor(parent: HTMLElement, private settings: SettingsStore, private input: Input, private cb: MenuCallbacks) {
    this.root = el('div', 'menus', parent);
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    this.crash = el('div', 'crash', this.root);
    this.crashTitle = el('b', '', this.crash, 'CRASHED');
    this.crashSub = el('span', '', this.crash, '');
    this.layer = el('div', '', this.root);
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  }

  private clear(): HTMLElement {
    this.layer.innerHTML = '';
    this.layer.style.pointerEvents = 'auto';
    return this.layer;
  }

  hide(): void {
    this.layer.innerHTML = '';
    this.layer.style.pointerEvents = 'none';
    this.visible = false;
  }

  // ---- loading ---------------------------------------------------------------------------------

  showLoading(): (p: number, label: string) => void {
    const o = el('div', 'overlay solid', this.clear());
    const p = el('div', 'panel', o);
    el('p', 'brand', p, 'AFTERBURN');
    el('h1', 'title', p, 'Preparing airspace');
    el('p', 'sub', p, 'Generating terrain and building the world. Nothing is downloaded: it all happens on your machine.');
    const bar = el('div', 'bar', p);
    this.bar = el('i', '', bar);
    this.barLabel = el('div', 'barlbl', p, 'Starting');
    this.visible = true;
    return (v, label) => {
      if (this.bar) this.bar.style.width = Math.round(v * 100) + '%';
      if (this.barLabel) this.barLabel.textContent = label;
    };
  }

  // ---- ready / start ---------------------------------------------------------------------------

  showReady(): void {
    const o = el('div', 'overlay solid', this.clear());
    const p = el('div', 'panel wide', o);
    el('p', 'brand', p, 'AFTERBURN');
    el('h1', 'title', p, 'Training Range');
    el('p', 'sub', p, 'Coral Archipelago. Airborne east of the Blue island with target balloons dead ahead, a ground-target site on the volcano foothills and three Red drones. Left mouse button fires the cannon, right button the selected weapon. Land and stop on a Blue runway to rearm and repair.');

    el('div', 'section', p, 'Aircraft');
    const hb = el('button', 'btn', p);
    hb.append(this.cb.aircraftName());
    el('small', '', hb, 'Open the hangar to compare and choose from 14 aircraft');
    hb.addEventListener('click', () => this.cb.hangar());

    el('div', 'section', p, 'Controls');
    this.controlsList(p);

    el('div', 'section', p, 'Training range');
    this.select(p, 'Red drones', 'drones', [['passive', 'Passive (evade only)'], ['hostile', 'Hostile (they shoot back)']], undefined, 'Hostile drones hunt you with guns and missiles');

    el('div', 'section', p, 'Flight difficulty');
    this.select(p, 'Difficulty', 'difficulty', Object.values(DIFFICULTIES).map((d) => [d.id, d.label]), (v) => this.cb.changed('difficulty'), DIFFICULTIES[this.settings.value.difficulty].description);

    el('div', 'rule', p);
    const go = el('button', 'btn primary', p, 'CLICK TO FLY');
    go.addEventListener('click', () => this.cb.start());
    el('div', 'footer', p, 'Esc pauses and opens settings. Your mouse will be captured while flying.');
    this.visible = true;
  }

  // ---- pause -----------------------------------------------------------------------------------

  showPause(): void {
    const o = el('div', 'overlay', this.clear());
    const p = el('div', 'panel', o);
    el('p', 'brand', p, 'AFTERBURN');
    el('h1', 'title', p, 'Paused');
    el('p', 'sub', p, 'Training Range · Coral Archipelago');
    const mk = (label: string, sub: string, fn: () => void, primary = false) => {
      const b = el('button', 'btn' + (primary ? ' primary' : ''), p);
      b.append(label);
      if (sub) el('small', '', b, sub);
      b.addEventListener('click', fn);
    };
    mk('RESUME', '', () => this.cb.resume(), true);
    mk('Respawn in the air', 'Restart over the Blue island at cruise speed', () => this.cb.respawnAir());
    mk('Start on the runway', 'Takeoff practice: throttle up, hold Space, pull up at ~270 km/h', () => this.cb.respawnRunway());
    mk('Hangar', `Now flying: ${this.cb.aircraftName()}. Changing aircraft respawns you.`, () => this.cb.hangar());
    mk('Settings', 'Graphics, controls, assists', () => this.showSettings());
    mk('Controls', 'Key bindings', () => this.showControls());
    this.visible = true;
  }

  private showControls(): void {
    const o = el('div', 'overlay', this.clear());
    const p = el('div', 'panel wide', o);
    el('p', 'brand', p, 'AFTERBURN');
    el('h1', 'title', p, 'Controls');
    el('p', 'sub', p, 'Full rebinding arrives with the settings pass in Phase 5.');
    this.controlsList(p);
    const back = el('button', 'btn', p, 'Back');
    back.style.marginTop = '16px';
    back.addEventListener('click', () => this.showPause());
  }

  private controlsList(parent: HTMLElement): void {
    const g = el('div', 'cols', parent);
    for (const r of SHOWN) {
      const keys = r.actions.flatMap((a) => this.input.codes(a).map(codeLabel));
      const text = [...new Set(keys)].join(' / ') || '';
      const row = el('div', 'kv', g);
      el('span', '', row, r.label);
      el('span', 'kbd', row, [text, r.extra].filter(Boolean).join('  ·  '));
    }
  }

  // ---- settings --------------------------------------------------------------------------------

  private showSettings(): void {
    const o = el('div', 'overlay', this.clear());
    const p = el('div', 'panel wide', o);
    el('p', 'brand', p, 'AFTERBURN');
    el('h1', 'title', p, 'Settings');

    el('div', 'section', p, 'Graphics');
    this.select(p, 'Quality', 'quality', [['auto', 'Auto-detect'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']] as [QualitySetting, string][], () => this.cb.changed('quality'));
    this.slider(p, 'Resolution scale', 'resolutionScale', 0.5, 1.5, 0.05, (v) => Math.round(v * 100) + '%', 'Render resolution relative to the window');
    this.toggle(p, 'Adaptive resolution', 'adaptiveResolution', 'Lowers resolution automatically if the frame rate drops');
    this.slider(p, 'Field of view', 'fov', 55, 100, 1, (v) => Math.round(v) + '°');
    this.select(p, 'Time of day', 'timeOfDay', [['day', 'Day'], ['sunset', 'Sunset']], () => this.cb.changed('timeOfDay'));
    this.toggle(p, 'Show FPS', 'showFps');

    el('div', 'section', p, 'Flight');
    this.select(p, 'Difficulty', 'difficulty', Object.values(DIFFICULTIES).map((d) => [d.id as DifficultyId, d.label]), () => this.cb.changed('difficulty'), DIFFICULTIES[this.settings.value.difficulty].description);
    this.select(p, 'Terrain avoidance', 'terrainAssist', [['auto', 'Warning + auto pull-up'], ['warn', 'Warning only'], ['off', 'Off']], undefined, 'The PULL UP warning and optional auto-recover');
    this.select(p, 'Speed units', 'speedUnit', [['kmh', 'km/h'], ['kt', 'knots'], ['ms', 'm/s']]);

    el('div', 'section', p, 'Controls');
    this.slider(p, 'Mouse sensitivity', 'mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
    this.toggle(p, 'Invert Y axis', 'invertY');
    this.select(p, 'Control scheme', 'controlScheme', [['mouse', 'Mouse aim, Shift/Ctrl throttle'], ['mouse-throttle-ws', 'Mouse aim, W/S throttle']]);
    this.toggle(p, 'Camera shake', 'cameraShake');

    el('div', 'section', p, 'Combat');
    this.select(p, 'Red drones', 'drones', [['passive', 'Passive (evade only)'], ['hostile', 'Hostile (they shoot back)']], undefined, 'Hostile drones hunt you with guns and missiles');
    this.toggle(p, 'Damage numbers', 'damageNumbers', 'Floating numbers on your hits');

    el('div', 'section', p, 'Audio');
    this.slider(p, 'Master volume', 'masterVolume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');

    el('div', 'section', p, 'HUD');
    this.toggle(p, 'Pitch ladder', 'hudPitchLadder');
    this.toggle(p, 'Heading tape', 'hudHeadingTape');
    this.toggle(p, 'Flight path marker', 'hudFlightPath');

    const back = el('button', 'btn', p, 'Back');
    back.style.marginTop = '18px';
    back.addEventListener('click', () => this.showPause());
  }

  private select<K extends keyof Settings>(
    parent: HTMLElement, label: string, key: K, options: [string, string][], after?: (v: string) => void, hint?: string,
  ): void {
    const row = el('div', 'row', parent);
    const l = el('label', '', row, label);
    const hintEl = hint ? el('span', 'hint', l, hint) : null;
    const sel = el('select', '', row);
    for (const [v, t] of options) {
      const op = el('option', '', sel, t);
      op.value = v;
    }
    sel.value = String(this.settings.value[key]);
    sel.addEventListener('change', () => {
      this.settings.set(key, sel.value as Settings[K]);
      if (key === 'difficulty' && hintEl) hintEl.textContent = DIFFICULTIES[sel.value as DifficultyId].description;
      after?.(sel.value);
    });
  }

  private slider<K extends keyof Settings>(
    parent: HTMLElement, label: string, key: K, min: number, max: number, step: number, fmt: (v: number) => string, hint?: string,
  ): void {
    const row = el('div', 'row', parent);
    const l = el('label', '', row, label);
    if (hint) el('span', 'hint', l, hint);
    const wrap = el('div', '', row);
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px';
    const input = el('input', '', wrap);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.settings.value[key]);
    const val = el('span', 'val', wrap, fmt(Number(input.value)));
    input.addEventListener('input', () => {
      val.textContent = fmt(Number(input.value));
      this.settings.set(key, Number(input.value) as Settings[K]);
    });
  }

  private toggle<K extends keyof Settings>(parent: HTMLElement, label: string, key: K, hint?: string): void {
    const row = el('div', 'row', parent);
    const l = el('label', '', row, label);
    if (hint) el('span', 'hint', l, hint);
    const t = el('div', 'toggle' + (this.settings.value[key] ? ' on' : ''), row);
    const flip = () => {
      const v = !this.settings.value[key];
      this.settings.set(key, v as Settings[K]);
      t.classList.toggle('on', v);
    };
    t.addEventListener('click', flip);
    l.addEventListener('click', flip);
  }

  // ---- crash banner ------------------------------------------------------------------------------

  showCrash(title: string, reason: string, sub: string): void {
    this.crashTitle.textContent = title;
    this.crashReason = reason;
    this.crashSub.textContent = `${reason}  ·  ${sub}`;
    this.crash.classList.add('show');
  }

  updateCrash(sub: string): void {
    this.crashSub.textContent = `${this.crashReason}  ·  ${sub}`;
  }

  /** Change the label of the main button (used when the browser refuses mouse capture). */
  flashPrimary(text: string): void {
    const b = this.layer.querySelector('.btn.primary');
    if (b) b.textContent = text;
  }

  hideCrash(): void {
    this.crash.classList.remove('show');
  }
}
