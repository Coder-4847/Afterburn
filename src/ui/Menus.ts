import { ACTION_LABELS, DEFAULT_BINDINGS, codeLabel, type Action, type Input } from '../core/Input';
import type { DifficultyId, QualitySetting, Settings, SettingsStore } from '../core/Settings';
import { DIFFICULTIES } from '../data/difficulty';
import { MAPS, MAP_LIST } from '../data/maps';
import { SKILLS } from '../ai/Pilot';
import { renderScoreboard, type ScoreData } from './Scoreboard';

export interface MenuCallbacks {
  start(): void;
  resume(): void;
  respawnAir(): void;
  respawnRunway(): void;
  respawnCarrier(): void;
  hangar(): void;
  /** Back to the mission setup screen from the pause menu. */
  setup(): void;
  aircraftName(): string;
  /** Called after any setting changes that needs a world rebuild (time of day). */
  changed(key: keyof Settings): void;
  /** Results screen: play the same match again. */
  rematch(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Keys the player can rebind, grouped. Pause (Esc) is fixed so a bad binding can never lock you out of the menu. */
const BIND_GROUPS: { title: string; rows: Action[] }[] = [
  { title: 'Weapons', rows: ['fireGun', 'fireMissile', 'weapon1', 'weapon2', 'weapon3', 'weapon4', 'cycleTarget', 'lockTarget', 'flares', 'chaff', 'targetCam'] },
  { title: 'Flight', rows: ['throttleUp', 'throttleDown', 'afterburner', 'airbrake', 'gear', 'pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight'] },
  { title: 'View and interface', rows: ['camera', 'lookAround', 'map', 'scoreboard', 'eject', 'toggleFps'] },
];

const MODES: { id: Settings['sortie']; name: string; desc: string }[] = [
  { id: 'tdm', name: 'Team Deathmatch', desc: 'You and AI wingmen against an AI team, from 1v1 up to 10v10. First team to the score limit wins.' },
  { id: 'elimination', name: 'Last Stand', desc: 'Everyone has three lives and a spawn is a life. Ejecting can save yours. The first team to wipe out the other wins.' },
  { id: 'carrier', name: 'Carrier Strike', desc: 'Infinite lives. Launch from your carrier deck or the air and sink the enemy carrier, screened by destroyers and submarines with guns and missiles.' },
  { id: 'training', name: 'Training Range', desc: 'Target balloons, ground targets and Red drones that evade (or fight back). No score, no pressure.' },
  { id: 'freeflight', name: 'Free Flight', desc: 'An empty sky. Fly, land, practise, look around.' },
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
    this.layer.setAttribute('role', 'dialog');
    this.layer.setAttribute('aria-live', 'polite');
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

  /** Unrecoverable problem (lost graphics context, repeated errors): explain and offer a reload. */
  showError(title: string, message: string): void {
    const o = el('div', 'overlay solid', this.clear());
    const p = el('div', 'panel', o);
    el('p', 'brand', p, 'AFTERBURN');
    el('h1', 'title', p, title);
    el('p', 'sub', p, message);
    const b = el('button', 'btn primary', p, 'RELOAD');
    b.addEventListener('click', () => window.location.reload());
    this.visible = true;
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

  /** Where the Back button of the settings and controls screens returns to. */
  private backTo: () => void = () => this.showPause();

  private cards<T extends string>(parent: HTMLElement, items: { id: T; name: string; desc: string }[], cur: T, pick: (id: T) => void): void {
    const g = el('div', 'cards', parent);
    for (const it of items) {
      const b = el('button', 'card' + (it.id === cur ? ' on' : ''), g);
      el('b', '', b, it.name);
      el('span', '', b, it.desc);
      b.addEventListener('click', () => pick(it.id));
    }
  }

  showReady(): void {
    this.backTo = () => this.showReady();
    const o = el('div', 'overlay solid', this.clear());
    const p = el('div', 'panel wide', o);
    el('p', 'brand', p, 'AFTERBURN');
    const s = this.settings.value;
    const map = MAPS[s.mapId] ?? MAP_LIST[0];
    el('h1', 'title', p, 'Mission setup');
    const mode = MODES.find((m) => m.id === s.sortie) ?? MODES[0];
    el('p', 'sub', p, `${mode.name} on ${map.name}. Left mouse fires the cannon, right mouse the selected weapon. Land and stop on a Blue runway to rearm and repair.`);

    el('div', 'section', p, 'Mode');
    this.cards(p, MODES, s.sortie, (id) => {
      this.settings.set('sortie', id);
      this.showReady();
    });

    el('div', 'section', p, 'Map');
    this.cards(p, MAP_LIST.map((m) => ({ id: m.id, name: m.name, desc: m.tagline ?? '' })), s.mapId, (id) => {
      this.settings.set('mapId', id);
      this.showReady();
    });
    el('p', 'hint-line', p, map.description);

    if (s.sortie === 'tdm' || s.sortie === 'elimination' || s.sortie === 'carrier') {
      el('div', 'section', p, 'Match');
      if (s.sortie === 'carrier' && (map.groundPlane || map.terrain.kind === 'alpine')) el('p', 'hint-line warn', p, 'This map has no open sea: Carrier Strike will fall back to Team Deathmatch here. Pick a map with water.');
      if (s.sortie === 'carrier') this.select(p, 'Launch from', 'carrierSpawn', [['deck', 'Your carrier deck (catapult)'], ['air', 'In the air over your carrier']], undefined, 'Applies to every respawn. Press 1 (air) or 2 (carrier) on the respawn screen to change it');
      this.select(p, 'Team size', 'teamSize', [1, 2, 3, 5, 10].map((n) => [String(n), `${n} v ${n}`]), undefined, 'You count as one of your side; the rest are AI wingmen');
      if (s.sortie === 'tdm') this.select(p, 'Score limit', 'scoreLimit', [10, 20, 30, 50].map((n) => [String(n), `${n} kills`]));
      this.select(
        p, 'Time limit', 'timeLimit', [[0, 'None'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes']].map(([n, t]) => [String(n), String(t)]), undefined,
        s.sortie === 'elimination' ? 'When it runs out: more pilots left wins, then more lives' : s.sortie === 'carrier' ? 'When it runs out: the carrier in better shape wins' : undefined,
      );
      this.select(p, 'AI skill', 'aiSkill', Object.entries(SKILLS).map(([id, k]) => [id, k.label]), undefined, 'Reaction time, aim, countermeasure use');
    } else if (s.sortie === 'training') {
      el('div', 'section', p, 'Range');
      this.select(p, 'Red drones', 'drones', [['passive', 'Passive (evade only)'], ['hostile', 'Hostile (they shoot back)']], undefined, 'Hostile drones hunt you with guns and missiles');
    }

    el('div', 'section', p, 'Aircraft and handling');
    const hb = el('button', 'btn', p);
    hb.append(this.cb.aircraftName());
    el('small', '', hb, 'Open the hangar to compare aircraft and set the loadout');
    hb.addEventListener('click', () => this.cb.hangar());
    this.select(p, 'Flight difficulty', 'difficulty', Object.values(DIFFICULTIES).map((d) => [d.id, d.label]), () => this.cb.changed('difficulty'), DIFFICULTIES[this.settings.value.difficulty].description);

    el('p', 'hint-line', p, 'Changing the map or mode reloads the world when you press the button below.');
    const go = el('button', 'btn primary', p, 'CLICK TO FLY');
    go.addEventListener('click', () => this.cb.start());
    const row = el('div', 'btn-row', p);
    const st = el('button', 'btn', row, 'Settings');
    st.addEventListener('click', () => this.showSettings());
    const ct = el('button', 'btn', row, 'Controls and key bindings');
    ct.addEventListener('click', () => this.showControls());
    el('div', 'footer', p, 'Esc pauses. Your mouse is captured while flying. Hold P for the scoreboard, M for the map.');
    this.visible = true;
  }

  // ---- pause -----------------------------------------------------------------------------------

  showPause(): void {
    this.backTo = () => this.showPause();
    const o = el('div', 'overlay', this.clear());
    const p = el('div', 'panel', o);
    el('p', 'brand', p, 'AFTERBURN');
    el('h1', 'title', p, 'Paused');
    const s = this.settings.value;
    el('p', 'sub', p, `${(MODES.find((m) => m.id === s.sortie) ?? MODES[0]).name} · ${(MAPS[s.mapId] ?? MAP_LIST[0]).name}`);
    const mk = (label: string, sub: string, fn: () => void, primary = false) => {
      const b = el('button', 'btn' + (primary ? ' primary' : ''), p);
      b.append(label);
      if (sub) el('small', '', b, sub);
      b.addEventListener('click', fn);
    };
    mk('RESUME', '', () => this.cb.resume(), true);
    mk('Respawn in the air', 'Restart at cruise speed over your side of the map', () => this.cb.respawnAir());
    if (s.sortie === 'carrier') mk('Launch from your carrier', 'Catapult launch: throttle up and hold the brakes off', () => this.cb.respawnCarrier());
    mk('Start on the runway', 'Takeoff practice: throttle up, hold Space, pull up at ~270 km/h', () => this.cb.respawnRunway());
    mk('Mission setup', 'Change mode, map or team size (leaves the current match)', () => this.cb.setup());
    mk('Hangar', `Now flying: ${this.cb.aircraftName()}. Changing aircraft respawns you.`, () => this.cb.hangar());
    mk('Settings', 'Graphics, audio, assists', () => this.showSettings());
    mk('Controls', 'Key bindings', () => this.showControls());
    this.visible = true;
  }

  // ---- controls / rebinding --------------------------------------------------------------------

  private showControls(note = ''): void {
    const o = el('div', 'overlay', this.clear());
    const p = el('div', 'panel wide', o);
    el('p', 'brand', p, 'AFTERBURN');
    el('h1', 'title', p, 'Controls');
    el('p', 'sub', p, 'Steering is the mouse (the jet follows the reticle) and the wheel is throttle. Click a key to rebind it, then press the new key or mouse button (Esc cancels).');
    if (note) el('p', 'hint-line warn', p, note);
    for (const g of BIND_GROUPS) {
      el('div', 'section', p, g.title);
      const grid = el('div', 'cols', p);
      for (const a of g.rows) {
        const row = el('div', 'kv bind', grid);
        el('span', '', row, ACTION_LABELS[a]);
        const codes = this.input.codes(a);
        const b = el('button', 'keybtn', row, codes.length ? [...new Set(codes.map(codeLabel))].join(' / ') : '—');
        b.addEventListener('click', () => this.capture(a, b));
      }
    }
    const fixed = el('div', 'kv', el('div', 'cols', p));
    el('span', '', fixed, 'Pause');
    el('span', 'kbd', fixed, 'Esc (fixed)');

    const row = el('div', 'btn-row', p);
    const reset = el('button', 'btn', row, 'Reset all to defaults');
    reset.addEventListener('click', () => {
      this.settings.set('bindings', {});
      this.showControls('Key bindings reset.');
    });
    const back = el('button', 'btn', row, 'Back');
    back.addEventListener('click', () => this.backTo());
  }

  /** Wait for the next key or mouse button and bind it to an action (taking it from any other action that had it). */
  private capture(action: Action, btn: HTMLButtonElement): void {
    btn.textContent = 'press a key…';
    btn.classList.add('listening');
    const stop = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('contextmenu', onCtx, true);
    };
    const assign = (code: string) => {
      stop();
      const b: Record<string, string[]> = { ...this.settings.value.bindings };
      let moved = '';
      for (const other of Object.keys(DEFAULT_BINDINGS) as Action[]) {
        if (other === action) continue;
        const cur = b[other] ?? DEFAULT_BINDINGS[other];
        if (cur.includes(code)) {
          b[other] = cur.filter((x) => x !== code);
          moved = ACTION_LABELS[other];
        }
      }
      b[action] = [code];
      this.settings.set('bindings', b);
      this.showControls(moved ? `${codeLabel(code)} was bound to "${moved}": that action is now unbound.` : '');
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        stop();
        this.showControls();
        return;
      }
      assign(e.code);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.target === btn) return; // the click that started the capture
      e.preventDefault();
      e.stopPropagation();
      assign('Mouse' + e.button);
    };
    const onCtx = (e: Event) => e.preventDefault();
    setTimeout(() => {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('contextmenu', onCtx, true);
    }, 0);
  }

  // ---- results ---------------------------------------------------------------------------------

  showResults(r: { outcome: 'win' | 'loss' | 'draw'; reason: string; data: ScoreData }): void {
    this.backTo = () => this.showReady();
    const o = el('div', 'overlay', this.clear());
    const p = el('div', 'panel wide results', o);
    el('p', 'brand', p, 'AFTERBURN');
    const h = el('h1', 'title result-' + r.outcome, p, r.outcome === 'win' ? 'VICTORY' : r.outcome === 'loss' ? 'DEFEAT' : 'DRAW');
    h.style.letterSpacing = '0.3em';
    el('p', 'sub', p, r.reason);
    const board = el('div', 'sb-body', p);
    renderScoreboard(board, r.data);
    const row = el('div', 'btn-row', p);
    const again = el('button', 'btn primary', row, 'REMATCH');
    again.addEventListener('click', () => this.cb.rematch());
    const setup = el('button', 'btn', row, 'Mission setup');
    setup.addEventListener('click', () => this.cb.setup());
    const hg = el('button', 'btn', row, 'Hangar');
    hg.addEventListener('click', () => this.cb.hangar());
    this.visible = true;
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
    this.select(p, 'Control scheme', 'controlScheme', [['mouse-throttle-ws', 'W/S throttle, A/D rudder, Q/E roll'], ['mouse', 'Shift/Ctrl throttle, W/S manual pitch']]);
    this.slider(p, 'Camera distance', 'cameraDistance', 0.4, 1.5, 0.05, (v) => Math.round(v * 100) + '%', 'Closer makes the jet look bigger');
    this.toggle(p, 'Camera shake', 'cameraShake');

    el('div', 'section', p, 'Combat');
    this.select(p, 'Red drones', 'drones', [['passive', 'Passive (evade only)'], ['hostile', 'Hostile (they shoot back)']], undefined, 'Hostile drones hunt you with guns and missiles');
    this.toggle(p, 'Damage numbers', 'damageNumbers', 'Floating numbers on your hits');

    el('div', 'section', p, 'Audio');
    this.slider(p, 'Effects volume', 'masterVolume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    this.slider(p, 'Music volume', 'musicVolume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');

    el('div', 'section', p, 'Accessibility');
    this.toggle(p, 'Colour-blind safe colours', 'colorblind', 'Blue against orange instead of blue against red (applies when the next mission loads)');
    this.toggle(p, 'Reduce motion', 'reduceMotion', 'No screen shake, speed streaks, sun glare, G-load vignette or blinking; less field-of-view push');
    this.slider(p, 'HUD size', 'hudScale', 0.8, 1.5, 0.05, (v) => Math.round(v * 100) + '%', 'Scales the readouts, weapon panel, score and kill feed');
    this.toggle(p, 'High-contrast HUD', 'highContrast', 'Heavier outlines and darker panels behind the HUD');

    el('div', 'section', p, 'HUD');
    this.toggle(p, 'Pitch ladder', 'hudPitchLadder');
    this.toggle(p, 'Heading tape', 'hudHeadingTape');
    this.toggle(p, 'Flight path marker', 'hudFlightPath');
    this.toggle(p, 'Minimap', 'minimap', 'M opens the full map');

    el('div', 'section', p, 'Saved data');
    const reset = el('button', 'btn', p);
    reset.append('Reset all settings');
    el('small', '', reset, 'Back to defaults (graphics, controls, key bindings, accessibility). Saved loadouts are kept.');
    reset.addEventListener('click', () => {
      if (!window.confirm('Reset all settings to their defaults?')) return;
      this.settings.reset();
      for (const k of Object.keys(this.settings.value) as (keyof Settings)[]) this.cb.changed(k);
      this.showSettings();
    });
    const back = el('button', 'btn', p, 'Back');
    back.style.marginTop = '18px';
    back.addEventListener('click', () => this.backTo());
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
    const numeric = typeof this.settings.value[key] === 'number';
    sel.value = String(this.settings.value[key]);
    sel.addEventListener('change', () => {
      this.settings.set(key, (numeric ? Number(sel.value) : sel.value) as Settings[K]);
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
