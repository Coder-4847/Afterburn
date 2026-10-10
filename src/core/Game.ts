import { Vector3 } from 'three';
import { TrainingRange } from '../ai/Range';
import { Skirmish } from '../ai/Skirmish';
import { Aircraft } from '../aircraft/Aircraft';
import { GameAudio } from '../audio/Audio';
import { Music } from '../audio/Music';
import { codeLabel } from './Input';
import { palette, setColorblind } from '../ui/palette';
import { Match, formatClock } from '../modes/Match';
import { ScoreboardOverlay, type ScoreData } from '../ui/Scoreboard';
import { cameraFor } from '../aircraft/AircraftDef';
import { TrailEmitter } from '../aircraft/Trails';
import { getAircraft } from '../data/aircraft';
import { DIFFICULTIES } from '../data/difficulty';
import { GRAVITY, STORES } from '../data/weapons';
import { MAPS } from '../data/maps';
import { FLIGHT, TERRAIN_ASSIST, WORLD_BOUNDARY } from '../data/tuning';
import { MouseAim } from '../flight/MouseAim';
import { scanTerrain, type TerrainThreat } from '../flight/TerrainAssist';
import type { SurfaceInfo } from '../flight/FlightModel';
import { CameraRig } from '../render/CameraRig';
import { GameRenderer } from '../render/GameRenderer';
import { HangarScene } from '../render/HangarScene';
import { ParticleSystem } from '../render/Particles';
import { QUALITY, detectQuality, type QualityPreset } from '../render/quality';
import { Combat } from '../weapons/Combat';
import { Fighter } from '../weapons/Fighter';
import { GROUPS, GROUP_LABEL } from '../weapons/WeaponSystem';
import type { CombatEvent } from '../weapons/types';
import type { CombatHud } from '../ui/CombatHud';
import type { Contact, MinimapData } from '../ui/Minimap';
import { Hud, type HudData } from '../ui/Hud';
import { HangarUI } from '../ui/Hangar';
import { Menus } from '../ui/Menus';
import { World } from '../world/World';
import { clamp, DEG, smoothstep, yieldToMain } from './math';
import { Input } from './Input';
import { SettingsStore, type QualityLevel, type Settings } from './Settings';

type GameState = 'loading' | 'ready' | 'playing' | 'paused' | 'hangar' | 'results';

const TEAM_BLUE = 0x3aa0ff;
const _fwd = new Vector3();
const _vel = new Vector3();
const _tmp = new Vector3();
const _h1 = new Vector3();
const _h2 = new Vector3();
const _surf: SurfaceInfo = { height: 0, onRunway: false, onApron: false };
const _mouse = { x: 0, y: 0 };
const _cam = new Vector3();
const _sunP = new Vector3();

/**
 * Owns the main loop and wires everything together.
 *  - physics runs at a fixed 60 Hz (`stepPhysics`), rendering runs at display rate with interpolation
 *  - input is sampled once per rendered frame (`processInput`), then the fixed steps use that snapshot
 */
export class Game {
  readonly settings = new SettingsStore();
  private canvas: HTMLCanvasElement;
  private renderer: GameRenderer;
  private input: Input;
  private rig: CameraRig;
  private hud: Hud;
  private menus: Menus;
  private world!: World;
  private player!: Aircraft;
  private aim = new MouseAim();
  private hangar!: HangarScene;
  private hangarUi!: HangarUI;
  private hangarReturn: 'ready' | 'paused' = 'ready';
  private smoke!: ParticleSystem;
  private fire!: ParticleSystem;
  private trails!: TrailEmitter;
  private audio = new GameAudio();
  private combat!: Combat;
  private fighter!: Fighter;
  private range!: TrainingRange;
  private skirmish: Skirmish | null = null;
  private match: Match | null = null;
  private music = new Music(this.audio);
  private scoreboard!: ScoreboardOverlay;
  private matchEl!: HTMLElement;
  private briefEl!: HTMLElement;
  private briefUntil = 0;
  private matchText = '';
  private mapId = '';
  private builtSig = '';
  private quality!: QualityPreset;
  private detected: QualityLevel = 'medium';

  state: GameState = 'loading';
  private acc = 0;
  private alpha = 0;
  private lastTime = 0;
  private fpsEl: HTMLElement;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsText = '';

  // per-frame input snapshot used by the fixed steps
  private kb = { pitch: 0, roll: 0, yaw: 0 };
  private cmd = { pitch: 0, roll: 0, yaw: 0 };

  // gameplay state
  private message: { text: string; until: number } | null = null;
  private clock = 0;
  private threat: TerrainThreat = { time: Infinity };
  private pullUp: 0 | 1 | 2 = 0;
  private recovering = false;
  private recoverClear = 0;
  private crashTimer = 0;
  private crashed = false;
  private lockFailures = 0;
  private boundaryTimer = WORLD_BOUNDARY.countdown;
  private outside = false;

  // combat state (input snapshot for the fixed steps, HUD feedback)
  private firing = false;
  private rocketsHeld = false;
  private feed: { text: string; age: number; mine: boolean; theirs: boolean }[] = [];
  private numbers: { pos: Vector3; text: string; age: number; kill: boolean; value: number; victim: number }[] = [];
  private hitK = 0;
  private killK = 0;
  private hurtK = 0;
  private serviceTimer = 0;
  private rwrTimer = 0;
  private hudModules: { ratio: number; gone: boolean; rects: number[][] }[] = [];
  private hudGroups = [{ short: 'IR', count: 0 }, { short: 'RDR', count: 0 }, { short: 'RKT', count: 0 }, { short: 'BMB', count: 0 }];
  private hudTarget: NonNullable<CombatHud['target']> | null = null;
  private lead = new Vector3();
  private impact = new Vector3();

  // adaptive resolution
  private avgDt = 1 / 60;
  private adaptTimer = 0;
  private adaptCooldown = 5;
  private upscaleWait = 15;
  private stableTime = 0;
  private lastDownscale = -100;

  constructor(private root: HTMLElement) {
    this.canvas = root.querySelector('#game') as HTMLCanvasElement;
    const ui = root.querySelector('#ui') as HTMLElement;
    const saved = this.settings.value.quality;
    this.renderer = new GameRenderer(this.canvas, saved !== 'low');
    this.input = new Input(this.canvas, this.settings);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.hud = new Hud(ui);
    this.hud.setVisible(false);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    ui.appendChild(this.fpsEl);
    this.menus = new Menus(ui, this.settings, this.input, {
      start: () => void this.startFlying(),
      resume: () => void this.resume(),
      respawnAir: () => { this.spawnAir(); void this.resume(); },
      respawnRunway: () => { this.spawnRunway(); void this.resume(); },
      hangar: () => this.openHangar(),
      setup: () => { this.builtSig = ''; this.state = 'ready'; this.menus.showReady(); },
      rematch: () => { this.builtSig = ''; void this.rebuild(); },
      aircraftName: () => getAircraft(this.settings.value.aircraftId).fullName,
      changed: (k) => this.applySetting(k),
    });

    this.settings.changed.on((k) => {
      if (k === 'masterVolume' || k === 'musicVolume' || k === 'drones' || k === 'hudScale' || k === 'highContrast' || k === 'reduceMotion' || k === 'colorblind') this.applySetting(k);
    });
    // browsers only allow audio after a gesture: the first click anywhere starts the menu music
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    this.scoreboard = new ScoreboardOverlay(ui);
    this.matchEl = document.createElement('div');
    this.matchEl.className = 'hud-match';
    this.matchEl.style.display = 'none';
    this.hud.root.appendChild(this.matchEl);
    this.briefEl = document.createElement('div');
    this.briefEl.className = 'hud-brief';
    this.hud.root.appendChild(this.briefEl);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fatal('Graphics context lost', 'The browser reclaimed the graphics card (often after sleep, a driver reset or too many tabs). Reload to continue.');
    });
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.state === 'hangar') this.closeHangar(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('pointerlockchange', () => {
      if (this.state === 'playing' && !this.input.locked && !this.input.lockless) this.pause();
    });

    this.quality = QUALITY.medium;
  }

  // ---------------------------------------------------------------------------------------------
  // setup
  // ---------------------------------------------------------------------------------------------

  async init(): Promise<void> {
    const progress = this.menus.showLoading();
    this.detected = detectQuality(this.renderer.gl.getContext());
    this.quality = this.resolveQuality();
    this.renderer.setQuality(this.quality, this.settings.value.resolutionScale);
    // give the loading panel a moment to paint (a timer, not rAF: rAF never fires in background tabs)
    await yieldToMain();

    await this.loadWorld(this.settings.value.mapId, progress);
    this.buildSortie();
    this.applyAllSettings();

    this.hangar = new HangarScene(this.renderer.gl);
    this.hangarUi = new HangarUI(this.root.querySelector('#ui') as HTMLElement, this.hangar, this.canvas, {
      select: (id) => { this.settings.set('aircraftId', id); this.setAircraft(id); this.closeHangar(); },
      back: () => this.closeHangar(),
      loadoutChanged: (id) => { if (id === this.player.def.id) this.refreshLoadout(); },
    });
    this.hangarUi.onPreview = (def) => this.hangar.setAircraft(def, TEAM_BLUE);
    this.hangar.resize(window.innerWidth / window.innerHeight);
    // two warm-up frames so shaders compile before the menu appears
    this.renderFrame(0);
    this.renderFrame(0);

    this.state = 'ready';
    this.menus.showReady();
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  // ---- maps and sorties ---------------------------------------------------------------------

  /** The part of the settings that needs the world or the aircraft rebuilt when it changes. */
  private sortieSig(): string {
    const s = this.settings.value;
    return [s.mapId, s.sortie, s.teamSize, s.aiSkill, s.scoreLimit, s.timeLimit, s.colorblind].join('|');
  }

  /** Take the sortie apart: every aircraft, the training range and the combat layer (before the world goes away). */
  private teardownSortie(): void {
    if (!this.combat) return;
    this.range?.clear();
    this.skirmish?.clear();
    this.skirmish = null;
    for (const f of [...this.combat.fighters]) f.aircraft.dispose();
    this.player?.dispose();
    this.combat.dispose();
  }

  private async loadWorld(mapId: string, progress: (p: number, label: string) => void): Promise<void> {
    const map = MAPS[mapId] ?? MAPS.coral;
    const old = this.world;
    this.teardownSortie();
    this.world = await World.create(map, this.renderer.gl, this.quality, this.settings.value.timeOfDay, progress);
    old?.dispose();
    this.smoke = new ParticleSystem(9000, false, true);
    this.fire = new ParticleSystem(3500, true, false);
    this.world.scene.add(this.smoke.points, this.fire.points);
    this.trails = new TrailEmitter(this.smoke);
    this.world.fogToneMapped = !this.renderer.postActive;
    this.mapId = map.id;
    this.builtSig = '';

  }

  /** Create the combat layer, the player's aircraft and whatever the sortie puts in the air (training range or AI teams). */
  private buildSortie(): void {
    const s = this.settings.value;
    this.combat = new Combat(this.world.scene, this.world, this.smoke, this.fire);
    this.combat.audio = this.audio;
    this.combat.events.on((e) => this.onCombatEvent(e));
    this.range = new TrainingRange(this.combat, this.world.scene, this.smoke);
    this.skirmish = null;
    this.match = null;
    this.setAircraft(s.aircraftId, true);
    this.fighter.stats = { kills: 0, assists: 0, deaths: 0, shots: 0, hits: 0, damage: 0 };
    if (s.sortie === 'training') this.range.build(s.drones === 'hostile', this.world.map);
    else if (s.sortie === 'tdm') {
      this.skirmish = new Skirmish(this.combat, this.world.scene, this.smoke, this.world.map, s.aiSkill);
      this.skirmish.build(s.teamSize - 1, s.teamSize);
      this.match = new Match({ scoreLimit: s.scoreLimit, timeLimit: s.timeLimit * 60, teamSize: s.teamSize });
    }
    this.feed = [];
    this.numbers = [];
    this.hud.minimap.setMap(this.world.map, this.world.heightmap);
    this.builtSig = this.sortieSig();
    this.briefed = false;
    this.applySetting('difficulty', true);
    this.world.terrain.prewarm(this.rig.camera.position);
  }

  /** Apply a changed map / sortie setup: shows the loading panel, then returns to the ready screen. */
  private async rebuild(): Promise<void> {
    this.state = 'loading';
    this.input.captureKeys = false;
    this.hud.setVisible(false);
    const progress = this.menus.showLoading();
    await yieldToMain();
    if (this.settings.value.mapId !== this.mapId) await this.loadWorld(this.settings.value.mapId, progress);
    else {
      progress(0.4, 'Deploying aircraft');
      await yieldToMain();
      this.teardownSortie();
    }
    this.buildSortie();
    this.renderFrame(0);
    this.renderFrame(0);
    progress(1, 'Ready');
    this.state = 'ready';
    this.menus.showReady();
    this.menus.flashPrimary('READY  -  CLICK TO FLY');
  }

  private resolveQuality(): QualityPreset {
    const q = this.settings.value.quality;
    return QUALITY[q === 'auto' ? this.detected : q];
  }

  private applyAllSettings(): void {
    for (const k of ['fov', 'difficulty', 'cameraShake', 'hudPitchLadder', 'speedUnit', 'showFps', 'masterVolume', 'musicVolume', 'drones', 'colorblind', 'reduceMotion', 'hudScale', 'highContrast'] as (keyof Settings)[]) this.applySetting(k, true);
  }

  private applySetting(key: keyof Settings, silent = false): void {
    const s = this.settings.value;
    switch (key) {
      case 'quality':
      case 'resolutionScale':
        this.quality = this.resolveQuality();
        this.renderer.adaptiveScale = 1;
        this.renderer.setQuality(this.quality, s.resolutionScale);
        this.world?.setQuality(this.quality);
        if (this.world) this.world.fogToneMapped = !this.renderer.postActive;
        break;
      case 'fov': this.rig.baseFov = s.fov; break;
      case 'timeOfDay': this.world?.setTimeOfDay(s.timeOfDay); break;
      case 'difficulty':
        if (this.player) this.player.flight.difficulty = DIFFICULTIES[s.difficulty];
        if (this.fighter) this.fighter.damageScale = DIFFICULTIES[s.difficulty].damageTaken;
        break;
      case 'cameraShake':
      case 'reduceMotion':
        this.rig.shakeEnabled = s.cameraShake && !s.reduceMotion;
        this.rig.fovKickScale = s.reduceMotion ? 0.25 : 1;
        document.body.classList.toggle('reduce-motion', s.reduceMotion);
        break;
      case 'colorblind': setColorblind(s.colorblind); break;
      case 'hudScale': document.documentElement.style.setProperty('--hud-scale', String(s.hudScale)); break;
      case 'highContrast': document.body.classList.toggle('hi-contrast', s.highContrast); break;
      case 'showFps': this.fpsEl.style.display = s.showFps ? '' : 'none'; break;
      case 'masterVolume': this.audio.setVolume(s.masterVolume); break;
      case 'musicVolume': this.audio.setMusicVolume(s.musicVolume); break;
      case 'drones': this.range?.setHostile(s.drones === 'hostile'); break;
      default: break;
    }
    this.hud.options = { unit: s.speedUnit, ladder: s.hudPitchLadder, tape: s.hudHeadingTape, flightPath: s.hudFlightPath, contrast: s.highContrast, reduceMotion: s.reduceMotion, scale: s.hudScale };
    if (key === 'showFps' && !silent) this.fpsText = '';
  }

  private onResize(): void {
    this.renderer.applySize();
    this.rig.resize(window.innerWidth / window.innerHeight);
    this.hangar?.resize(window.innerWidth / window.innerHeight);
    this.hud.resize();
  }

  // ---------------------------------------------------------------------------------------------
  // flow
  // ---------------------------------------------------------------------------------------------

  /**
   * Capture the mouse. Browsers sometimes refuse a re-lock right after Esc, so the first refusal just asks for
   * another click; only a second consecutive refusal (embedded/locked-down browsers) falls back to a free cursor.
   */
  private async acquireLock(): Promise<boolean> {
    if (await this.input.requestLock()) {
      this.lockFailures = 0;
      this.input.lockless = false;
      return true;
    }
    if (++this.lockFailures >= 2) {
      this.input.lockless = true;
      return true;
    }
    this.menus.flashPrimary('CLICK AGAIN TO CAPTURE THE MOUSE');
    return false;
  }

  private async startFlying(): Promise<void> {
    this.audio.unlock(); // must happen inside the click's call stack
    if (this.match?.over) this.builtSig = ''; // a finished match is never resumed
    if (this.sortieSig() !== this.builtSig) {
      await this.rebuild(); // the pointer-lock gesture would have expired: ask for another click
      return;
    }
    if (await this.acquireLock()) this.enterPlay();
  }

  private async resume(): Promise<void> {
    if (this.state === 'playing') return;
    this.audio.unlock();
    if (await this.acquireLock()) this.enterPlay();
  }

  private enterPlay(): void {
    this.state = 'playing';
    this.menus.hide();
    this.input.captureKeys = true;
    this.input.clear();
    document.body.classList.add('playing');
    this.lastTime = performance.now();
    this.acc = 0;
    this.aim.snapTo(this.player.flight); // never resume with a stale reticle
    this.audio.setPaused(false);
    if (!this.settings.value.seenIntro) this.settings.set('seenIntro', true);
    if (!this.briefed) this.showBrief();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.captureKeys = false;
    this.input.exitLock();
    document.body.classList.remove('playing');
    this.audio.setPaused(true);
    this.audio.lockTone('off', 0);
    this.menus.showPause();
  }

  // ---- aircraft selection / hangar ------------------------------------------------------------

  /** Swap the player's aircraft (new flight model + model) and respawn in the air. */
  private setAircraft(id: string, force = false): void {
    const def = getAircraft(id);
    if (!force && this.player && this.player.def.id === def.id) return;
    const old = this.player;
    const p = new Aircraft(def, DIFFICULTIES[this.settings.value.difficulty], TEAM_BLUE);
    this.player = p;
    this.world.scene.add(p.object);
    old?.dispose();
    void p.loadOverride(); // swaps in public/models/<id>.glb if one exists
    if (this.fighter) this.combat.removeFighter(this.fighter);
    const prev = this.fighter?.stats;
    this.fighter = new Fighter('You', 'blue', p, true);
    this.fighter.damageScale = DIFFICULTIES[this.settings.value.difficulty].damageTaken;
    if (prev) this.fighter.stats = prev;
    this.combat.addFighter(this.fighter);
    this.buildHudModules();
    this.trails?.reset();
    this.spawnAir();
  }

  private buildHudModules(): void {
    this.hudModules = this.fighter.damage.modules.map((m) => ({
      ratio: 1,
      gone: false,
      rects: m.boxes.map((b) => [b.min.x, b.min.z, b.max.x, b.max.z]),
    }));
  }

  /** The hangar edited this aircraft's saved loadout: pick it up on the live fighter. */
  private refreshLoadout(): void {
    const f = this.fighter;
    const before = f.loadout.items.join('|');
    f.loadout.reload();
    if (f.loadout.items.join('|') === before) return;
    f.weapons.rearm(); // new weapons are fitted; damage is not repaired by visiting the hangar
    f.mountVisuals();
  }

  private openHangar(): void {
    this.hangarReturn = this.state === 'paused' ? 'paused' : 'ready';
    this.state = 'hangar';
    this.menus.hide();
    this.hud.setVisible(false);
    this.hangarUi.show(this.settings.value.aircraftId);
  }

  private closeHangar(): void {
    this.hangarUi.hide();
    this.refreshLoadout();
    this.state = this.hangarReturn;
    if (this.hangarReturn === 'paused') this.menus.showPause();
    else this.menus.showReady();
  }

  private say(text: string, seconds = 2.2): void {
    this.message = { text, until: this.clock + seconds };
  }

  private groundAt = (x: number, z: number): number => this.world.surfaceAt(x, z, _surf).height;

  /** Where the player starts and respawns in the air. Team deathmatch starts out toward the middle, a few km from the enemy. */
  private spawnPoint(): { x: number; z: number; heading: number; altitude: number; speed: number } {
    const map = this.world.map;
    const sp = map.spawn;
    if (this.settings.value.sortie === 'tdm' && this.skirmish) {
      const strip = map.airstrips.find((a) => a.team === 'blue');
      if (strip) {
        return {
          x: strip.x * 0.48,
          z: strip.z * 0.48,
          heading: Math.atan2(-strip.x, strip.z) / DEG,
          altitude: Math.max(sp.altitude, this.skirmish.cruiseAlt),
          speed: sp.speed,
        };
      }
    }
    return sp;
  }

  private distToStrip(): number {
    const p = this.player.flight.pos;
    const a = this.world.nearestAirstrip(p.x, p.z);
    return Math.hypot(a.def.x - p.x, a.def.z - p.z);
  }

  spawnAir(): void {
    const m = this.spawnPoint();
    const f = this.player.flight;
    const c = this.player.controls;
    const ground = this.groundAt(m.x, m.z);
    _tmp.set(m.x, Math.max(ground, 0) + m.altitude, m.z);
    f.reset(_tmp, m.heading * DEG, m.speed, false, 0.75);
    c.throttle = 0.75;
    c.gearDown = false;
    c.afterburner = false;
    c.airbrake = false;
    this.afterSpawn();
  }

  spawnRunway(): void {
    const strip = this.world.airstrips[0];
    const d = strip.def;
    const f = this.player.flight;
    const c = this.player.controls;
    const u = -d.length / 2 + 110;
    _tmp.set(d.x + strip.dirX * u, d.elevation + f.def.flight.gearHeight, d.z + strip.dirZ * u);
    f.reset(_tmp, d.heading * DEG, 0, true, 0);
    f.grounded = true;
    c.throttle = 0;
    c.gearDown = true;
    c.afterburner = false;
    this.afterSpawn();
  }

  private afterSpawn(): void {
    const f = this.player.flight;
    this.crashed = false;
    this.crashTimer = 0;
    this.recovering = false;
    this.pullUp = 0;
    this.boundaryTimer = WORLD_BOUNDARY.countdown;
    this.fighter?.reset();
    this.player.object.visible = true;
    this.hurtK = 0;
    this.serviceTimer = 0;
    this.menus.hideCrash();
    this.aim.snapTo(f);
    this.player.syncVisual(1, 0);
    this.rig.snap(f.quat);
    this.rig.update(0.016, this.rigTarget(), this.groundAt);
  }

  private crash(reason: string): void {
    if (this.crashed) return;
    this.crashed = true;
    this.crashTimer = 3.4;
    this.combat.crashFighter(this.fighter, reason, true);
    this.player.object.visible = false;
    this.rig.addShake(1.2);
    this.explode(reason);
    this.audio.explosion(this.player.flight.pos, 26);
    this.menus.showCrash(reason === 'Left combat zone' ? 'OUT OF BOUNDS' : 'CRASHED', reason, 'Respawning in 3');
  }

  /** The combat layer shot us down (wreck falling, or blown apart on the spot). */
  private checkDeath(): void {
    const fg = this.fighter;
    if (this.crashed || fg.state === 'alive') return;
    this.crashed = true;
    const cr = fg.credit();
    const title = fg.damage.deathReason === 'Pilot killed' ? 'PILOT KILLED' : 'SHOT DOWN';
    const reason = cr.killer ? `${cr.killer.name}  ·  ${cr.weapon || fg.damage.deathReason}` : fg.damage.deathReason || 'Destroyed';
    this.crashTimer = fg.state === 'wreck' ? 6 : 3.4;
    this.rig.addShake(1);
    this.menus.showCrash(title, reason, 'Respawning in 6');
  }

  /** Fireball and smoke on impact (or a white splash if we hit the sea). */
  private explode(reason: string): void {
    const f = this.player.flight;
    const p = f.pos;
    const water = reason === 'Water' || this.groundAt(p.x, p.z) <= 0.01;
    const n = Math.round(60 * this.quality.trails + 20);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = 15 + Math.random() * 70;
      const vx = Math.cos(th) * sp * (1 - up * 0.4) + f.vel.x * 0.25;
      const vz = Math.sin(th) * sp * (1 - up * 0.4) + f.vel.z * 0.25;
      const vy = up * sp * 0.9 + 6;
      if (water) {
        // a column of spray: fast, upward, falling back as it fades
        this.smoke.emit(p.x, p.y, p.z, vx * 0.45, vy * 1.5 + 12, vz * 0.45, 1.6 + Math.random() * 2.2, 3.5, 20, 0.92, 0.96, 1, 0.55, 0.7, 14);
        if (i % 2 === 0) this.smoke.emit(p.x, p.y, p.z, vx * 0.9, 4 + up * 8, vz * 0.9, 2 + Math.random() * 2, 4, 26, 0.9, 0.95, 1, 0.4, 1.6, 2);
      } else {
        this.fire.emit(p.x, p.y + 2, p.z, vx, vy * 0.7, vz, 0.5 + Math.random() * 0.9, 7, 26, 2.6, 1.15 + Math.random() * 0.5, 0.3, 0.9, 2.2);
        this.smoke.emit(p.x, p.y + 3, p.z, vx * 0.5, vy * 0.8 + 4, vz * 0.5, 4 + Math.random() * 4, 9, 46, 0.07, 0.07, 0.08, 0.75, 0.9, -5);
        if (i % 2 === 0) this.fire.emit(p.x, p.y + 1, p.z, vx * 1.6, vy * 1.4, vz * 1.6, 1 + Math.random() * 1.8, 1.2, 0.2, 3, 2.2, 1.2, 1, 0.2, 9.8);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // main loop
  // ---------------------------------------------------------------------------------------------

  private errorCount = 0;
  private dead = false;

  /** Stop the game and show a reload prompt. */
  private fatal(title: string, message: string): void {
    if (this.dead) return;
    this.dead = true;
    this.state = 'loading';
    this.input.captureKeys = false;
    this.input.exitLock();
    document.body.classList.remove('playing');
    this.hud.setVisible(false);
    this.menus.showError(title, message);
  }

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    if (this.dead) return;
    try {
      this.frame(now);
      this.errorCount = Math.max(0, this.errorCount - 0.05);
    } catch (e) {
      console.error(e);
      // a one-off glitch is survivable; the same error every frame is not
      if (++this.errorCount > 20) this.fatal('Something went wrong', 'The game hit a repeating error and stopped. Reloading usually fixes it. Your settings and loadouts are saved.');
    }
  };

  private frame(now: number): void {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.1);

    if (this.state === 'playing') {
      this.processInput(dt);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FLIGHT.fixedDt && steps < FLIGHT.maxSubSteps) {
        this.stepPhysics(FLIGHT.fixedDt);
        this.acc -= FLIGHT.fixedDt;
        steps++;
      }
      if (steps === FLIGHT.maxSubSteps) this.acc = 0; // spiral-of-death guard
      this.alpha = this.acc / FLIGHT.fixedDt;
      this.clock += dt;
      this.checkDeath();
      this.updateCrash(dt);
      this.updateFeedback(dt);
      this.governResolution(dt);
    } else if (this.state === 'paused' || this.state === 'results') {
      // keep the Esc key responsive when pointer lock isn't available
      this.input.endFrame();
    }
    if (this.state !== 'loading') this.updateMusic(dt);

    if (this.state === 'hangar') this.renderHangar(dt);
    else if (this.state !== 'loading') this.renderFrame(this.state === 'playing' ? dt : 0);
    this.input.endFrame();
    this.updateFps(dt);
  }

  private renderFrame(dt: number): void {
    const p = this.player;
    p.syncVisual(this.alpha, dt);
    p.model.root.visible = this.rig.mode !== 'cockpit' || this.crashed; // cockpit-lite: no airframe in view
    if (this.state === 'playing') this.rig.update(dt, this.rigTarget(), this.groundAt);
    this.combat.render(this.alpha);
    this.range.render(this.alpha, dt, this.quality.trails);
    this.skirmish?.render(this.alpha, dt, this.quality.trails);
    if (this.state === 'playing') this.updateAudio(dt);
    this.world.update(dt, this.rig.camera, p.object.position);
    // particles: contrails / vortices follow the aircraft, then everything integrates and is sized for this view
    if (dt > 0 && !this.crashed) this.trails.update(p, this.quality.trails);
    const h = this.renderer.drawingHeight;
    this.smoke.setView(h, this.rig.camera.fov);
    this.fire.setView(h, this.rig.camera.fov);
    this.smoke.update(dt);
    this.fire.update(dt);
    this.renderer.render(this.world.scene, this.rig.camera, dt);
    this.drawHud(dt);
  }

  private renderHangar(dt: number): void {
    this.hangar.update(dt);
    this.renderer.render(this.hangar.scene, this.hangar.camera, dt);
  }

  /** Screen position and strength of the sun glare, or null if the sun is off-screen / hidden behind terrain. */
  private sunGlare(): { x: number; y: number; a: number } | null {
    if (!this.quality.screenFx || this.state === 'ready') return null;
    const cam = this.rig.camera;
    const sd = this.world.sky.sunDir;
    cam.getWorldDirection(_cam);
    const d = _cam.dot(sd);
    if (d < 0.25) return null;
    for (const t of [500, 1400, 3200, 7000]) {
      _sunP.copy(cam.position).addScaledVector(sd, t);
      if (_sunP.y < this.groundAt(_sunP.x, _sunP.z)) return null; // terrain / sea blocks the sun
    }
    _sunP.copy(cam.position).addScaledVector(sd, 1000).project(cam);
    return { x: (_sunP.x * 0.5 + 0.5) * window.innerWidth, y: (-_sunP.y * 0.5 + 0.5) * window.innerHeight, a: Math.pow(d, 8) * 0.55 * (1 - this.world.cloudInside) };
  }

  private rigTarget() {
    const p = this.player;
    const def = p.def;
    const cf = cameraFor(def);
    return {
      pos: p.object.position,
      quat: p.object.quaternion,
      speedNorm: p.flight.speed / def.flight.maxSpeed,
      ab: p.flight.abLevel,
      distance: cf.distance,
      height: cf.height,
      cockpit: cf.cockpit,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // input -> controls
  // ---------------------------------------------------------------------------------------------

  private processInput(dt: number): void {
    const inp = this.input;
    const s = this.settings.value;
    const f = this.player.flight;
    const c = this.player.controls;

    if (inp.pressed('pause')) { this.pause(); return; }
    if (inp.pressed('toggleFps')) this.settings.set('showFps', !s.showFps), this.applySetting('showFps');
    if (inp.pressed('map')) this.hud.minimap.toggleOpen();
    if (inp.pressed('camera')) {
      this.rig.cycleMode();
      this.say(this.rig.mode === 'chase' ? 'CHASE VIEW' : 'COCKPIT VIEW', 1.4);
    }
    if (inp.pressed('gear') && !this.crashed) {
      c.gearDown = !c.gearDown;
      this.say(c.gearDown ? 'GEAR DOWN' : 'GEAR UP', 1.4);
    }
    this.processWeaponInput();

    // throttle: keys + wheel. The alternate scheme puts throttle on W/S.
    const alt = s.controlScheme === 'mouse-throttle-ws';
    let thrAxis = inp.axis('throttleDown', 'throttleUp');
    if (alt) thrAxis += inp.axis('pitchDown', 'pitchUp');
    c.throttle = clamp(c.throttle + thrAxis * FLIGHT.throttleRate * dt - inp.consumeWheel() * FLIGHT.throttleWheelStep, 0, 1);
    c.afterburner = inp.isDown('afterburner') && !this.crashed;
    c.airbrake = inp.isDown('airbrake');

    this.kb.pitch = alt ? 0 : inp.axis('pitchDown', 'pitchUp');
    this.kb.roll = inp.axis('rollLeft', 'rollRight');
    this.kb.yaw = inp.axis('yawLeft', 'yawRight');

    // mouse: look around, or move the aim reticle
    inp.consumeMouse(_mouse);
    this.rig.looking = inp.isDown('lookAround');
    if (this.rig.looking) {
      this.rig.addLook(_mouse.x, _mouse.y);
    } else if (!this.recovering && !this.crashed) {
      this.aim.addMouse(_mouse.x, _mouse.y, this.rig.right, this.rig.up, s.mouseSensitivity, s.invertY);
    }
    if (this.kb.pitch !== 0 || this.kb.roll !== 0 || this.kb.yaw !== 0) this.aim.relaxToNose(f, 1 - Math.exp(-6 * dt));
    this.aim.clampToNose(f);
  }

  private stepPhysics(dt: number): void {
    const p = this.player;
    const f = p.flight;
    const c = p.controls;
    const diff = f.difficulty;
    const s = this.settings.value;
    const fg = this.fighter;

    fg.prePhysics(dt); // damage ticks, fuel burn, store drag -> flight multipliers
    if (fg.state === 'wreck') f.step(dt, c, this.world); // tumbling to the ground; Combat explodes it on impact

    if (!this.crashed && fg.state === 'alive') {
      // ---- terrain avoidance ----
      this.terrainAssist(dt);

      // ---- control law ----
      this.aim.compute(f, diff, this.cmd);
      c.pitch = this.kb.pitch !== 0 ? this.kb.pitch : this.cmd.pitch;
      c.roll = this.kb.roll !== 0 ? this.kb.roll : this.cmd.roll;
      c.yaw = clamp(this.cmd.yaw + this.kb.yaw, -1, 1);
      void s;

      // arcade quality of life: tuck the gear away once clearly airborne and fast. Never near an airstrip: that is where you
      // want it down (a landing approach, or a touch-and-go), and it must stay down until you raise it yourself.
      if (diff.id === 'arcade' && c.gearDown && f.gearPos > 0.99 && !f.grounded && f.agl > 120 && f.speed > 130 && this.distToStrip() > 5000) {
        c.gearDown = false;
        this.say('GEAR UP', 1.4);
      }

      f.step(dt, c, this.world);

      if (f.touchdown) { this.say('TOUCHDOWN', 2); this.rig.addShake(0.35); }
      if (f.crashed) this.crash(f.crashed);
      this.checkBoundary(dt);
      this.checkService(dt);
      if (!this.crashed) {
        if (this.firing) this.combat.fireGun(fg, dt);
        if (this.rocketsHeld) this.combat.fireRockets(fg, dt);
      }
    }

    this.combat.update(dt);
    this.range.update();
    this.skirmish?.update();
    if (this.match) {
      if (!this.match.over) this.match.update(dt);
      if (this.match.over && this.state !== 'results') this.endMatch();
    }
  }

  private terrainAssist(dt: number): void {
    const f = this.player.flight;
    const mode = this.settings.value.terrainAssist;
    // don't fight a deliberate landing approach
    const near = this.world.nearestAirstrip(f.pos.x, f.pos.z);
    const dNear = Math.hypot(near.def.x - f.pos.x, near.def.z - f.pos.z);
    // (also when the gear is still up but we are slow and low near a runway: that is a landing in the making)
    const landing = f.grounded || (f.gearPos > 0.5 && dNear < 3500 && f.agl < 400) || (dNear < 2500 && f.agl < 250 && f.speed < 170);
    if (mode === 'off' || landing) {
      this.pullUp = 0;
      this.recovering = false;
      return;
    }
    scanTerrain(f, this.world, TERRAIN_ASSIST.warnTime, this.threat);
    const warn = this.threat.time < TERRAIN_ASSIST.warnTime;
    if (mode === 'auto' && this.threat.time < TERRAIN_ASSIST.autoTime && !this.recovering) {
      this.recovering = true;
      this.recoverClear = 0;
    }
    if (this.recovering) {
      // steer the reticle up and level; the normal control law does the rolling and pulling
      _vel.copy(f.vel);
      _vel.y = 0;
      if (_vel.lengthSq() < 1) f.forward(_vel), (_vel.y = 0);
      _vel.normalize();
      this.aim.aim.copy(_vel).multiplyScalar(Math.cos(TERRAIN_ASSIST.recoverPitch));
      this.aim.aim.y = Math.sin(TERRAIN_ASSIST.recoverPitch);
      this.aim.aim.normalize();
      this.recoverClear = warn ? 0 : this.recoverClear + dt;
      if (this.recoverClear > 0.7) {
        // hand control back with the reticle gently above the horizon, so the jet levels off instead of climbing on
        this.recovering = false;
        this.aim.aim.copy(_vel).multiplyScalar(Math.cos(TERRAIN_ASSIST.exitPitch));
        this.aim.aim.y = Math.sin(TERRAIN_ASSIST.exitPitch);
        this.aim.aim.normalize();
      }
    }
    this.pullUp = this.recovering ? 2 : warn ? 1 : 0;
  }

  private checkBoundary(dt: number): void {
    const f = this.player.flight;
    const b = this.world.map.boundary;
    this.outside = Math.abs(f.pos.x) > b || Math.abs(f.pos.z) > b;
    if (this.outside) {
      this.boundaryTimer -= dt;
      if (this.boundaryTimer <= 0) this.crash('Left combat zone');
    } else this.boundaryTimer = WORLD_BOUNDARY.countdown;
  }

  private updateCrash(dt: number): void {
    if (!this.crashed) return;
    this.crashTimer -= dt;
    this.menus.updateCrash(`Respawning in ${Math.max(0, Math.ceil(this.crashTimer))}`);
    if (this.crashTimer <= 0) this.spawnAir();
  }

  // ---------------------------------------------------------------------------------------------
  // weapons, targeting, combat feedback
  // ---------------------------------------------------------------------------------------------

  private processWeaponInput(): void {
    const inp = this.input;
    const fg = this.fighter;
    const w = fg.weapons;
    const live = fg.state === 'alive' && !this.crashed;
    this.firing = false;
    this.rocketsHeld = false;
    this.rig.focus = null;
    if (!live) return;

    for (let i = 0; i < 4; i++) {
      if (inp.pressed(('weapon' + (i + 1)) as 'weapon1')) {
        w.selectGroup(i);
        const left = w.remaining(GROUPS[i]);
        this.say(left > 0 ? GROUP_LABEL[i] : `${GROUP_LABEL[i]}: EMPTY`, 1.2);
      }
    }
    if (inp.pressed('cycleTarget')) {
      this.combat.cycleTarget(fg);
      this.say(w.target ? `TARGET  ${w.target.name.toUpperCase()}` : 'NO TARGETS IN VIEW', 1.4);
    }
    if (inp.pressed('lockTarget')) {
      this.combat.pickToward(fg, this.aim.aim);
      this.say(w.target ? `TARGET  ${w.target.name.toUpperCase()}` : 'NOTHING AT RETICLE', 1.4);
    }
    if (inp.pressed('flares') && !this.combat.dispense(fg, 'flare', 3)) this.say('OUT OF FLARES', 1.2);
    if (inp.pressed('chaff') && !this.combat.dispense(fg, 'chaff', 1)) this.say('OUT OF CHAFF', 1.2);
    if (w.target && inp.isDown('targetCam')) this.rig.focus = w.target.pos;

    this.firing = inp.isDown('fireGun') && w.gunAmmo > 0;
    const kind = w.kind;
    if (kind === 'rocket') {
      this.rocketsHeld = inp.isDown('fireMissile') && w.remaining('rocket') > 0;
      if (inp.pressed('fireMissile') && w.remaining('rocket') === 0) this.say('NO ROCKETS', 1.2);
    } else if (inp.pressed('fireMissile')) {
      if (w.remaining(kind) === 0) {
        this.say(`NO ${GROUP_LABEL[w.group]}`, 1.2);
      } else if (kind === 'bomb') {
        this.combat.dropBomb(fg);
      } else {
        if (!w.target) this.combat.pickToward(fg, fg.aircraft.flight.forward(_fwd));
        if (kind === 'radar' && !(w.target && w.lock.locked)) this.say(w.target ? 'NO RADAR LOCK' : 'NO TARGET', 1.2);
        else if (!this.combat.fireMissile(fg) && w.cooldown <= 0) this.say('CANNOT FIRE', 1);
      }
    }
  }

  /** Landing and stopping on a friendly runway repairs, refuels and rearms. */
  private checkService(dt: number): void {
    const f = this.player.flight;
    const fg = this.fighter;
    this.serviceTimer = f.grounded && f.speed < 6 ? this.serviceTimer + dt : 0;
    if (this.serviceTimer < 0.2 || !fg.needsService()) return;
    const near = this.world.nearestAirstrip(f.pos.x, f.pos.z);
    const apron = this.world.surfaceAt(f.pos.x, f.pos.z, _surf).onApron;
    if (near.def.team !== 'blue' || !apron) return;
    if (this.serviceTimer < 3) {
      const n = Math.floor(this.serviceTimer);
      this.say(`SERVICING  ${'■'.repeat(n)}${'□'.repeat(3 - n)}`, 0.4);
      return;
    }
    fg.service();
    this.say('REARMED  ·  REFUELED  ·  REPAIRED', 3);
  }

  private onCombatEvent(e: CombatEvent): void {
    const me = this.fighter;
    const dmgNumbers = this.settings.value.damageNumbers;
    switch (e.type) {
      case 'hit': {
        if (e.attacker && e.attacker.id === me.id && e.victim !== me) {
          this.hitK = 1;
          if (dmgNumbers && e.damage >= 0.5) {
            // merge a burst of cannon hits into one growing number
            const n = this.numbers.find((x) => x.victim === e.victim.id && x.age < 0.45 && !x.kill);
            if (n) {
              n.value += e.damage;
              n.text = String(Math.round(n.value));
              n.age = 0;
              n.pos.copy(e.point);
            } else this.numbers.push({ pos: e.point.clone(), text: String(Math.round(e.damage)), age: 0, kill: false, value: e.damage, victim: e.victim.id });
            if (this.numbers.length > 24) this.numbers.shift();
          }
        }
        if (e.victim === me) {
          this.hurtK = Math.min(1, this.hurtK + e.damage / 22);
          this.rig.addShake(Math.min(0.9, 0.12 + e.damage / 30));
        }
        break;
      }
      case 'kill': {
        const mine = !!e.killer && e.killer.id === me.id;
        const theirs = e.victim === me;
        const who = e.killer ? e.killer.name : 'Crash';
        if (this.match && 'damage' in e.victim) this.match.onKill(e.killer ? e.killer.team : null, e.victim.team);
        this.feed.unshift({ text: `${who}  ▸  ${e.victim.name}  [${e.weapon}]`, age: 0, mine, theirs });
        if (this.feed.length > 5) this.feed.pop();
        if (mine) {
          this.killK = 1;
          this.say(`SPLASH  ${e.victim.name.toUpperCase()}`, 2.4);
          if (dmgNumbers) this.numbers.push({ pos: e.victim.pos.clone(), text: 'KILL', age: 0, kill: true, value: 0, victim: e.victim.id });
        }
        break;
      }
      case 'damage-events': {
        if (e.victim !== me) break;
        for (const ev of e.events) {
          if (ev.type === 'rip') this.say(ev.part === 'tail' ? 'TAIL LOST' : ev.part === 'wingL' ? 'LEFT WING LOST' : 'RIGHT WING LOST', 2.6);
          else if (ev.type === 'engine-fire') this.say('ENGINE FIRE', 2.4);
          else if (ev.type === 'fire') this.say('FIRE', 2.2);
          else if (ev.type === 'leak') this.say('FUEL LEAK', 2.4);
          else if (ev.type === 'extinguished') this.say('FIRE OUT', 1.8);
        }
        break;
      }
      case 'explosion': {
        const d = e.point.distanceTo(this.player.flight.pos);
        if (d < 1600) this.rig.addShake((e.size * 0.045) / (1 + d / 160));
        break;
      }
      default: break;
    }
  }

  // ---- matches, scoreboard, music ---------------------------------------------------------------

  private scoreData(): ScoreData {
    const m = this.match;
    const s = this.settings.value;
    const fighters = this.combat.fighters;
    const sum = (team: 'blue' | 'red') => fighters.filter((f) => f.team === team).reduce((n, f) => n + f.stats.kills, 0);
    return {
      title: s.sortie === 'training' ? 'TRAINING RANGE' : s.sortie === 'freeflight' ? 'FREE FLIGHT' : 'TEAM DEATHMATCH',
      score: m ? m.score : { blue: sum('blue'), red: sum('red') },
      info: m ? `FIRST TO ${m.cfg.scoreLimit}${m.remaining !== null ? '   ·   ' + formatClock(m.remaining) : ''}` : '',
      rows: fighters.map((f) => ({
        name: f.isPlayer ? 'You' : f.name,
        aircraft: f.aircraft.def.name,
        team: f.team,
        kills: f.stats.kills,
        assists: f.stats.assists,
        deaths: f.stats.deaths,
        accuracy: f.stats.shots > 0 ? f.stats.hits / f.stats.shots : null,
        you: f === this.fighter,
        alive: f.state === 'alive',
      })),
    };
  }

  /** The match is decided: stop the sim and show the results. */
  private endMatch(): void {
    const m = this.match!;
    this.state = 'results';
    this.input.captureKeys = false;
    this.input.exitLock();
    document.body.classList.remove('playing');
    this.audio.setPaused(true);
    this.audio.lockTone('off', 0);
    this.scoreboard.hide();
    this.menus.hideCrash();
    this.hud.setVisible(false);
    const outcome = m.winner === 'draw' ? 'draw' : m.winner === 'blue' ? 'win' : 'loss';
    this.menus.showResults({ outcome, reason: `${m.reason}  ·  ${m.score.blue} to ${m.score.red}`, data: this.scoreData() });
  }

  /** Top-of-screen score line for team deathmatch. */
  private briefed = false;

  /** A short "what is going on" card at the start of a sortie: the objective and the three things to do first. */
  private showBrief(): void {
    this.briefed = true;
    const s = this.settings.value;
    const keys = (a: Parameters<Input['codes']>[0]) => this.input.codes(a).map(codeLabel).join('/');
    let title: string;
    let goal: string;
    if (s.sortie === 'tdm') {
      title = 'TEAM DEATHMATCH';
      goal = `Shoot down the RED team. First side to ${s.scoreLimit} kills wins${s.timeLimit ? ' (or most kills in ' + s.timeLimit + ' min)' : ''}.`;
    } else if (s.sortie === 'training') {
      title = 'TRAINING RANGE';
      goal = 'Balloons dead ahead, a ground-target site and three Red drones. Nothing here is trying to kill you unless you set the drones to hostile.';
    } else {
      title = 'FREE FLIGHT';
      goal = 'An empty sky. Lower the gear (' + keys('gear') + ') and land on a runway to practise.';
    }
    const find = s.sortie === 'tdm' ? 'Red markers on the HUD and the minimap show where the enemy is. The arrow at the screen edge points to the nearest one.' : 'Red markers show enemy aircraft; the minimap (top left) shows everything nearby.';
    this.briefEl.innerHTML =
      `<b>${title}</b><span>${goal}</span><span>${find}</span>` +
      `<i>${keys('cycleTarget')} pick a target  ·  hold ${keys('fireGun')} cannon  ·  ${keys('fireMissile')} fire missile (let the ring fill first)  ·  ${keys('flares')} flares  ${keys('chaff')} chaff  ·  ${keys('map')} map</i>`;
    this.briefUntil = this.clock + 22;
  }

  private updateMatchHud(): void {
    this.briefEl.style.opacity = this.clock < this.briefUntil ? String(Math.min(1, (this.briefUntil - this.clock) / 2)) : '0';
    const m = this.match;
    if (!m || this.state === 'results') {
      if (this.matchEl.style.display !== 'none') this.matchEl.style.display = 'none';
      return;
    }
    const rem = m.remaining;
    const text = `${m.score.blue}|${rem === null ? 'x' : formatClock(rem)}|${m.score.red}`;
    this.matchEl.style.display = '';
    if (text === this.matchText) return;
    this.matchText = text;
    this.matchEl.innerHTML = `<span class="b">${m.score.blue}</span><span class="t">${rem === null ? '∞' : formatClock(rem)}</span><span class="r">${m.score.red}</span><span class="lim">FIRST TO ${m.cfg.scoreLimit}</span>`;
  }

  /** Menu music in the menus; in flight, a score that heats up when enemies are close or something is shooting at you. */
  private updateMusic(dt: number): void {
    const m = this.music;
    const playing = this.state === 'playing';
    m.setTheme(playing ? 'flight' : 'menu');
    let I = 0.3;
    if (playing) {
      const fg = this.fighter;
      I = fg.state === 'alive' ? 0.25 : 0.12;
      if (fg.state === 'alive') {
        let near = 1e9;
        for (const o of this.combat.fighters) if (o.team !== fg.team && o.alive) near = Math.min(near, o.pos.distanceTo(fg.pos));
        if (near < 14000) I += (1 - near / 14000) * 0.35;
        if (this.combat.threats(fg).length) I += 0.3;
        else if (this.combat.radarLocks(fg).length) I += 0.12;
        if (fg.damage.health() < 0.5) I += 0.1;
        if (this.hurtK > 0.2) I += 0.1;
      }
    }
    m.setIntensity(I);
    m.update(dt);
  }

  /** Fade the hit markers, age the kill feed and floating numbers. */
  private updateFeedback(dt: number): void {
    this.hitK = Math.max(0, this.hitK - dt * 4);
    this.killK = Math.max(0, this.killK - dt * 1.4);
    this.hurtK = Math.max(0, this.hurtK - dt * 0.9);
    this.updateMatchHud();
    if (this.input.isDown('scoreboard')) this.scoreboard.show(this.scoreData());
    else this.scoreboard.hide();
    for (const f of this.feed) f.age += dt;
    while (this.feed.length && this.feed[this.feed.length - 1].age > 8) this.feed.pop();
    for (const n of this.numbers) n.age += dt;
    this.numbers = this.numbers.filter((n) => n.age < 1.1);
  }

  /** Engine drone, lock tone, missile alarm and RWR chirps. */
  private updateAudio(dt: number): void {
    const a = this.audio;
    const fg = this.fighter;
    const f = this.player.flight;
    a.setListener(this.rig.camera.position, this.rig.camera.quaternion);
    a.setEngine(f.power, f.abLevel, f.speed / this.player.def.flight.maxSpeed, fg.state === 'alive' && fg.damage.fuel > 0);
    if (fg.state !== 'alive') {
      a.lockTone('off', 0);
      return;
    }
    const L = fg.weapons.lock;
    const seeking = (fg.weapons.kind === 'ir' || fg.weapons.kind === 'radar') && fg.weapons.target;
    a.lockTone(!seeking ? 'off' : L.locked ? 'locked' : L.tracking ? 'search' : 'off', L.progress);
    const th = this.combat.threats(fg);
    if (th.length) a.missileAlert(th[0].eta, dt);
    const locks = this.combat.radarLocks(fg);
    this.rwrTimer -= dt;
    if (locks.length && this.rwrTimer <= 0) {
      const hard = locks.some((l) => l.locked);
      a.rwr(hard);
      this.rwrTimer = hard ? 0.5 : 1.6;
    }
  }

  /** Where a bomb released now would land (simple ballistic integration), or null if there is no ground in 40 s. */
  private bombImpact(out: Vector3): boolean {
    const f = this.player.flight;
    let x = f.pos.x, y = f.pos.y, z = f.pos.z;
    let vx = f.vel.x, vy = f.vel.y, vz = f.vel.z;
    const step = 0.2;
    for (let i = 0; i < 200; i++) {
      vy -= GRAVITY * step;
      const nx = x + vx * step, ny = y + vy * step, nz = z + vz * step;
      const g = this.groundAt(nx, nz);
      if (ny < g) {
        out.set(nx, g, nz);
        return true;
      }
      x = nx; y = ny; z = nz;
    }
    return false;
  }

  private contacts: Contact[] = [];

  /** Positions of every aircraft, target and missile for the minimap (enemy visibility is applied by the minimap). */
  private minimapData(): MinimapData | null {
    const fg = this.fighter;
    const f = this.player.flight;
    this.hud.minimap.enabled = this.settings.value.minimap;
    const list = this.contacts;
    list.length = 0;
    const sel = fg.weapons.target;
    for (const o of this.combat.fighters) {
      if (o === fg || !o.alive) continue;
      list.push({ x: o.pos.x, z: o.pos.z, team: o.team, kind: 'air', heading: o.aircraft.flight.heading(), selected: o === sel });
    }
    for (const d of this.combat.dummies) if (d.alive) list.push({ x: d.pos.x, z: d.pos.z, team: d.team, kind: 'air', heading: 0, selected: d === sel });
    for (const t of this.combat.ground) if (t.alive) list.push({ x: t.pos.x, z: t.pos.z, team: t.team, kind: 'ground', heading: 0, selected: t === sel });
    for (const th of this.combat.threats(fg)) list.push({ x: th.missile.pos.x, z: th.missile.pos.z, team: 'red', kind: 'missile', heading: 0, selected: false });
    return { x: f.pos.x, z: f.pos.z, heading: f.heading(), contacts: list };
  }

  /** Gather the weapon / target / damage state for the combat HUD. */
  private combatHud(): CombatHud | null {
    const fg = this.fighter;
    if (fg.state !== 'alive' || !fg.damage.pilotAlive) return null;
    const w = fg.weapons;
    const dm = fg.damage;
    const fl = this.player.flight;
    const def = this.player.def;
    const kind = w.kind;

    for (let i = 0; i < 4; i++) this.hudGroups[i].count = w.remaining(GROUPS[i]);
    let storeName = '';
    for (const id of w.items) if (id && STORES[id].kind === kind) { storeName = STORES[id].name; break; }

    for (let i = 0; i < dm.modules.length; i++) {
      this.hudModules[i].ratio = dm.ratio(dm.modules[i].id);
      this.hudModules[i].gone = dm.modules[i].gone;
    }

    // target block and the gun lead pipper
    const tg = w.target;
    let target: CombatHud['target'] = null;
    let lead: Vector3 | null = null;
    if (tg && tg.alive) {
      const dist = tg.pos.distanceTo(fl.pos);
      _h1.copy(tg.pos).sub(fl.pos).normalize();
      target = {
        name: tg.name, kind: tg.kind, pos: tg.pos, dist, closing: -(_h2.copy(tg.vel).sub(fl.vel).dot(_h1)),
        health: tg.health(), progress: w.lock.progress, locked: w.lock.locked, tracking: w.lock.tracking,
      };
      if (dist < 2600) {
        const gp = w.gun;
        // time of flight solving |P + vr t| = muzzleVelocity * t, plus bullet drop
        const P = _h1.copy(tg.pos).sub(fl.pos);
        const vr = _h2.copy(tg.vel).sub(fl.vel);
        const a = vr.dot(vr) - gp.muzzleVelocity * gp.muzzleVelocity;
        const b = 2 * P.dot(vr);
        const cc = P.dot(P);
        const disc = b * b - 4 * a * cc;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / (2 * a);
          if (t > 0 && t < 3) {
            P.addScaledVector(vr, t);
            P.y += 0.5 * GRAVITY * t * t;
            lead = this.lead.copy(fl.pos).addScaledVector(P.normalize(), 1500);
          }
        }
      }
    }

    let impact: Vector3 | null = null;
    if (kind === 'bomb' && w.remaining('bomb') > 0 && this.bombImpact(this.impact)) impact = this.impact;

    const missiles = this.combat.threats(fg).slice(0, 4).map((t) => ({ bearing: this.combat.bearingTo(fg, t.missile.pos).bearing, eta: t.eta, kind: t.missile.kind }));
    const rwr = this.combat.radarLocks(fg).map((l) => ({ bearing: this.combat.bearingTo(fg, l.by.pos).bearing, locked: l.locked }));

    // radar picture: hostile aircraft in range, nearest first
    const contacts: CombatHud['contacts'] = [];
    for (const o of this.combat.fighters) {
      if (o.team === fg.team || !o.alive) continue;
      const dist = o.pos.distanceTo(fl.pos);
      if (dist < 16000) contacts.push({ pos: o.pos, dist, selected: o === tg });
    }
    for (const o of this.combat.dummies) {
      if (!o.alive) continue;
      const dist = o.pos.distanceTo(fl.pos);
      if (dist < 9000) contacts.push({ pos: o.pos, dist, selected: o === tg });
    }
    contacts.sort((a, b) => a.dist - b.dist);
    let nearest: CombatHud['nearest'] = null;
    if (contacts.length) {
      const n = contacts[0];
      const brg = this.combat.bearingTo(fg, n.pos);
      nearest = { name: '', dist: n.dist, bearing: brg.bearing, elevation: brg.elevation };
    }

    return {
      contacts: contacts.slice(0, 8),
      nearest,
      group: w.group,
      groupLabel: GROUP_LABEL[w.group],
      storeName,
      count: w.remaining(kind),
      groups: this.hudGroups,
      gunAmmo: w.gunAmmo,
      gunMax: def.gun.rounds,
      flares: w.flares,
      flaresMax: def.countermeasures.flares,
      chaff: w.chaff,
      chaffMax: def.countermeasures.chaff,
      fuel: dm.fuel,
      bingo: dm.fuel < 0.2,
      health: dm.health(),
      modules: this.hudModules,
      fire: dm.fire > 0,
      leaking: dm.leaking,
      target,
      lead,
      impact,
      missiles,
      rwr,
      feed: this.feed,
      hit: this.hitK,
      kill: this.killK,
      hurt: this.hurtK,
      numbers: this.numbers,
      kills: fg.stats.kills,
      deaths: fg.stats.deaths,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // HUD, stats, adaptive resolution
  // ---------------------------------------------------------------------------------------------

  private drawHud(dt: number): void {
    const p = this.player;
    const f = p.flight;
    const visible = (this.state === 'playing' || this.state === 'paused') && !this.crashed;
    if (!visible) { this.hud.setVisible(false); return; }
    f.forward(_fwd);
    _vel.copy(f.vel);
    const sp = f.speed > 0.1 ? _vel.multiplyScalar(1 / f.speed) : null;
    const near = this.world.nearestAirstrip(f.pos.x, f.pos.z);
    const dNear = Math.hypot(near.def.x - f.pos.x, near.def.z - f.pos.z);
    const msg = this.message && this.message.until > this.clock ? this.message.text : null;
    const d: HudData = {
      speed: f.speed,
      mach: f.speed / Math.max(295, 340.3 - 0.0041 * f.pos.y),
      altMsl: f.pos.y,
      agl: f.agl,
      throttle: p.controls.throttle,
      power: f.power,
      ab: f.abLevel,
      g: f.gLoad,
      aoaDeg: f.aoa / DEG,
      heading: f.heading(),
      pitch: Math.asin(clamp(_fwd.y, -1, 1)),
      gearPos: f.gearPos,
      grounded: f.grounded,
      stall: !f.grounded && f.speed < f.stallSpeedNow * 1.05 || f.stallLevel > 0.15,
      pullUp: this.pullUp,
      boundaryCountdown: this.outside ? this.boundaryTimer : null,
      message: msg,
      nose: _fwd,
      aim: this.aim.aim,
      velocity: sp,
      origin: p.object.position,
      nearestStrip: dNear < 7000 ? { name: near.def.name, dist: dNear } : null,
      cameraMode: this.rig.mode,
      visible: true,
      glare: this.settings.value.reduceMotion ? null : this.sunGlare(),
      veil: this.world.cloudInside,
      speedFx: this.quality.screenFx && !this.settings.value.reduceMotion && this.state === 'playing' ? smoothstep(0.5, 1, f.speed / p.def.flight.maxSpeed) * 0.55 + f.abLevel * 0.3 : 0,
      combat: this.combatHud(),
      minimap: this.minimapData(),
    };
    this.hud.update(d, this.rig.camera, dt);
  }

  private updateFps(dt: number): void {
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum < 0.5) return;
    if (this.settings.value.showFps) {
      const fps = this.fpsFrames / this.fpsAccum;
      const info = this.renderer.gl.info;
      this.fpsText =
        `${fps.toFixed(0)} fps  ${(1000 / fps).toFixed(1)} ms\n` +
        `${info.render.calls} calls  ${(info.render.triangles / 1000).toFixed(0)}k tris\n` +
        `${this.quality.level}  res ${(this.renderer.pixelRatio).toFixed(2)}x`;
      this.fpsEl.textContent = this.fpsText;
    }
    this.fpsAccum = 0;
    this.fpsFrames = 0;
  }

  /**
   * Adaptive resolution: if the frame rate sags, trim render resolution; if it is rock solid for a
   * while, creep back up. Hysteresis (growing wait after a failed upscale) prevents oscillation.
   */
  private governResolution(dt: number): void {
    if (!this.settings.value.adaptiveResolution || dt > 0.09) return;
    this.avgDt += (dt - this.avgDt) * 0.05;
    this.adaptTimer += dt;
    this.adaptCooldown -= dt;
    if (this.adaptTimer < 1) return;
    this.adaptTimer = 0;
    const r = this.renderer;
    if (this.avgDt > 1 / 46 && this.adaptCooldown <= 0 && r.adaptiveScale > 0.6) {
      r.adaptiveScale = Math.max(0.6, r.adaptiveScale - 0.08);
      r.applySize();
      this.adaptCooldown = 3;
      this.stableTime = 0;
      if (this.clock - this.lastDownscale < 20) this.upscaleWait = Math.min(120, this.upscaleWait * 2);
      this.lastDownscale = this.clock;
    } else if (this.avgDt < 1 / 55) {
      this.stableTime += 1;
      if (this.stableTime >= this.upscaleWait && r.adaptiveScale < 1) {
        r.adaptiveScale = Math.min(1, r.adaptiveScale + 0.05);
        r.applySize();
        this.stableTime = 0;
      }
    } else this.stableTime = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // debug access (dev builds only)
  // ---------------------------------------------------------------------------------------------

  get debug() {
    const f = this.player.flight;
    const c = this.player.controls;
    const right = new Vector3();
    const up = new Vector3();
    const fwd = new Vector3();
    return {
      player: this.player, world: this.world, rig: this.rig, input: this.input, aim: this.aim,
      combat: this.combat, fighter: this.fighter, range: this.range, skirmish: this.skirmish, audio: this.audio,
      /** Open the hangar on an aircraft with a fixed camera (for screenshots). */
      hangarView: async (id: string, yaw = 0.9, pitch = 0.25, ab = false, gear = true, panels = false, wait = 1300) => {
        if (this.state !== 'hangar') this.openHangar();
        (this.hangarUi as unknown as { preview(id: string): void }).preview(id);
        const h = this.hangar;
        h.autoRotate = false; h.animate = false; h.yaw = yaw; h.pitch = pitch; h.gearDown = gear; h.afterburner = ab;
        for (const sel of ['.hg-list', '.hg-info', '.hg-toolbar']) (document.querySelector(sel) as HTMLElement).style.display = panels ? '' : 'none';
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      },
      step: (n = 1) => { for (let i = 0; i < n; i++) this.stepPhysics(FLIGHT.fixedDt); },
      spawnAir: () => this.spawnAir(),
      spawnRunway: () => this.spawnRunway(),
      state: () => this.state,
      enterPlay: () => { this.enterPlay(); },
      /** Put the aircraft somewhere in free air (no input needed): position, heading (deg), speed, throttle. */
      setup: (x: number, y: number, z: number, hdgDeg: number, spd: number, thr: number) => {
        this.spawnAir();
        f.reset(_tmp.set(x, y, z), hdgDeg * DEG, spd, false, thr);
        c.throttle = thr;
        c.afterburner = false;
        c.gearDown = false;
        this.aim.snapTo(f);
      },
      /** Point the reticle at a world heading / elevation (degrees). */
      aimAt: (hdgDeg: number, elDeg: number) => {
        const h = hdgDeg * DEG;
        const e = elDeg * DEG;
        this.aim.aim.set(Math.sin(h) * Math.cos(e), Math.sin(e), -Math.cos(h) * Math.cos(e));
      },
      stats: (t: number) => {
        f.forward(fwd);
        const bank = Math.atan2(-f.rightVec(right).y, f.upVec(up).y);
        return `t=${t} alt=${f.pos.y.toFixed(0)} agl=${f.agl.toFixed(0)} spd=${f.speed.toFixed(0)} hdg=${((f.heading() / DEG + 360) % 360).toFixed(0)} pitch=${(Math.asin(fwd.y) / DEG).toFixed(0)} g=${f.gLoad.toFixed(1)} aoa=${(f.aoa / DEG).toFixed(1)} bank=${(bank / DEG).toFixed(0)} stall=${f.stallLevel.toFixed(2)} gnd=${f.grounded} crash=${f.crashed}`;
      },
    };
  }
}
