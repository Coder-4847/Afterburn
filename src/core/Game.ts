import { Vector3 } from 'three';
import { TrainingRange } from '../ai/Range';
import { Skirmish } from '../ai/Skirmish';
import { Fleet } from '../naval/Fleet';
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
import { MAPS, mapIdFor } from '../data/maps';
import { AIM, FLIGHT, TERRAIN_ASSIST, WORLD_BOUNDARY } from '../data/tuning';
import { MouseAim } from '../flight/MouseAim';
import { MANEUVERS } from '../flight/Maneuvers';
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
import type { CombatEvent, Target } from '../weapons/types';
import type { CombatHud } from '../ui/CombatHud';
import type { Contact, MinimapData } from '../ui/Minimap';
import { Hud, type HudData } from '../ui/Hud';
import { HangarUI } from '../ui/Hangar';
import { Menus } from '../ui/Menus';
import { World } from '../world/World';
import { clamp, DEG, smoothstep, yieldToMain } from './math';
import { Input } from './Input';
import { SettingsStore, type QualityLevel, type Settings, type SortieMode } from './Settings';

type GameState = 'loading' | 'ready' | 'playing' | 'paused' | 'hangar' | 'results';

const TEAM_BLUE = 0x3aa0ff;
/** Lives per pilot in Last Stand. */
const LIVES = 3;
/** Seconds stopped on a friendly apron: refuel and rearm, or repair as well. */
const SERVICE_REARM = 10;
const SERVICE_REPAIR = 20;
const _fwd = new Vector3();
const _vel = new Vector3();
const _tmp = new Vector3();
const _h1 = new Vector3();
const _h2 = new Vector3();
const _hr = new Vector3();
const _hu = new Vector3();
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
  private fleet: Fleet | null = null;
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
      respawnCarrier: () => { this.spawnCarrier(); void this.resume(); },
      hangar: () => this.openHangar(),
      setup: () => { this.builtSig = ''; this.state = 'ready'; this.hud.setVisible(false); this.menuBackdrop(); this.menus.showReady(); },
      mainMenu: () => this.toMainMenu(),
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
    this.serviceEl = document.createElement('div');
    this.serviceEl.className = 'hud-service';
    this.hud.root.appendChild(this.serviceEl);
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

    await this.loadWorld(mapIdFor(this.settings.value.sortie, this.settings.value.mapId), progress);
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
    this.hangar.setAircraft(getAircraft(this.settings.value.aircraftId), TEAM_BLUE);
    this.renderHangar(0);

    this.state = 'ready';
    this.menuBackdrop();
    this.menus.showMain();
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  // ---- maps and sorties ---------------------------------------------------------------------

  /** The part of the settings that needs the world or the aircraft rebuilt when it changes. */
  private sortieSig(): string {
    const s = this.settings.value;
    return [mapIdFor(s.sortie, s.mapId), s.sortie, s.teamSize, s.aiSkill, s.scoreLimit, s.timeLimit, s.colorblind].join('|');
  }

  /** Take the sortie apart: every aircraft, the training range and the combat layer (before the world goes away). */
  private teardownSortie(): void {
    if (!this.combat) return;
    this.range?.clear();
    this.skirmish?.clear();
    this.skirmish = null;
    this.fleet?.clear();
    this.fleet = null;
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
    this.briefNote = '';
    let mode = s.sortie;
    if (mode === 'carrier') {
      const fleet = new Fleet(this.combat, this.world, this.world.map, s.aiSkill);
      if (fleet.build()) this.fleet = fleet;
      else {
        fleet.clear();
        mode = 'tdm';
        this.briefNote = 'This map has no open sea for a carrier group, so this is Team Deathmatch.';
      }
    }
    this.mode = mode;
    if (mode === 'training') this.range.build(s.drones === 'hostile', this.world.map);
    else if (mode === 'tdm' || mode === 'elimination' || mode === 'carrier') {
      this.skirmish = new Skirmish(this.combat, this.world.scene, this.smoke, this.world.map, s.aiSkill);
      this.skirmish.setFleet(this.fleet);
      this.skirmish.build(s.teamSize - 1, s.teamSize);
      const lives = mode === 'elimination' ? LIVES : 0;
      this.match = new Match({ scoreLimit: s.scoreLimit, timeLimit: s.timeLimit * 60, teamSize: s.teamSize, lives, strike: mode === 'carrier' });
      if (lives) for (const f of this.combat.fighters) f.lives = lives;
      if (mode === 'carrier') {
        this.match.setCarriers(1, 1);
        this.carrierWarn = 1;
        this.endTimer = 0;
        this.respawn();
      }
    }
    this.spectating = false;
    this.ejected = null;
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
    const want = mapIdFor(this.settings.value.sortie, this.settings.value.mapId);
    if (want !== this.mapId) await this.loadWorld(want, progress);
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
    this.menuBackdrop();
    this.menus.showLaunch();
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
        this.hud.options = { ...this.hud.options, gVignette: s.difficulty === 'arcade' ? 0.25 : s.difficulty === 'standard' ? 0.6 : 1 };
        if (this.player) this.player.flight.difficulty = DIFFICULTIES[s.difficulty];
        if (this.fighter) this.applyAssists();
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
    this.hud.options = { unit: s.speedUnit, ladder: s.hudPitchLadder, tape: s.hudHeadingTape, flightPath: s.hudFlightPath, contrast: s.highContrast, reduceMotion: s.reduceMotion, scale: s.hudScale, gVignette: s.difficulty === 'arcade' ? 0.25 : s.difficulty === 'standard' ? 0.6 : 1 };
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
    const prevLives = this.fighter?.lives;
    this.fighter = new Fighter('You', 'blue', p, true);
    if (prevLives !== undefined && this.match?.cfg.lives) this.fighter.lives = prevLives;
    this.applyAssists();
    if (prev) this.fighter.stats = prev;
    this.combat.addFighter(this.fighter);
    this.buildHudModules();
    this.trails?.reset();
    this.respawn();
  }

  /** Copy the difficulty's player assists onto the player's fighter. */
  private applyAssists(): void {
    const d = DIFFICULTIES[this.settings.value.difficulty];
    this.fighter.damageScale = d.damageTaken;
    this.fighter.aimAssist = d.aimAssist;
    this.fighter.lockSpeed = d.lockSpeed;
  }

  private brakeHinted = false;
  private serviceInfo: { label: string; left: number; total: number } | null = null;
  private serviceHint = 0;
  private serviceEl!: HTMLElement;
  private autoCmTimer = 0;
  private autoTargetTimer = 0;

  /** Arcade: flares or chaff go out on their own when a missile is about to hit. */
  private autoCountermeasures(dt: number): void {
    this.autoCmTimer -= dt;
    if (this.autoCmTimer > 0 || !DIFFICULTIES[this.settings.value.difficulty].autoCountermeasures) return;
    const th = this.combat.threats(this.fighter);
    if (!th.length || th[0].eta > 2.6) return;
    const kind = th[0].missile.kind === 'ir' ? 'flare' : 'chaff';
    if (this.combat.dispense(this.fighter, kind, kind === 'flare' ? 2 : 1)) {
      this.autoCmTimer = kind === 'flare' ? 0.7 : 1.4;
      this.say(kind === 'flare' ? 'AUTO FLARES' : 'AUTO CHAFF', 0.8);
    }
  }

  /** Always have the nearest enemy selected unless the player picked something, so the target box and arrow are on screen. */
  private autoTarget(dt: number): void {
    this.autoTargetTimer -= dt;
    if (this.autoTargetTimer > 0) return;
    this.autoTargetTimer = 0.6;
    const fg = this.fighter;
    const w = fg.weapons;
    if (fg.state !== 'alive' || w.group >= 2) return;
    if (w.target && w.target.alive) return;
    let best: Target | null = null;
    let bd = Infinity;
    for (const t of this.combat.targets(fg.team)) {
      if (t.kind !== 'air') continue;
      const d = t.pos.distanceToSquared(fg.pos);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best && bd < 16000 * 16000) {
      w.target = best;
      w.lock.progress = 0;
      w.lock.locked = false;
    }
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

  /** The menu screens sit over a slow orbit around the selected jet, afterburner lit. */
  private menuBackdrop(): void {
    if (!this.hangar) return;
    this.hangar.menu = true;
    this.hangar.setAircraft(getAircraft(this.settings.value.aircraftId), TEAM_BLUE);
    this.hangar.setLoadout(this.fighter.loadout.items, this.fighter.loadout.arm);
  }

  /** Abandon whatever is running and go to the title screen. */
  private toMainMenu(): void {
    this.builtSig = ''; // a sortie that was left is never resumed
    this.state = 'ready';
    this.input.captureKeys = false;
    this.input.exitLock();
    document.body.classList.remove('playing');
    this.hud.setVisible(false);
    this.audio.lockTone('off', 0);
    this.menuBackdrop();
    this.menus.showMain();
  }

  private openHangar(): void {
    this.hangarReturn = this.state === 'paused' ? 'paused' : 'ready';
    if (this.hangar) this.hangar.menu = false;
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
    else {
      this.menuBackdrop();
      this.menus.showMain();
    }
  }

  private say(text: string, seconds = 2.2): void {
    this.message = { text, until: this.clock + seconds };
  }

  private groundAt = (x: number, z: number): number => this.world.surfaceAt(x, z, _surf).height;

  /** Where the player starts and respawns in the air. Team deathmatch starts out toward the middle, a few km from the enemy. */
  private spawnPoint(): { x: number; z: number; heading: number; altitude: number; speed: number } {
    const map = this.world.map;
    const sp = map.spawn;
    const own = this.fleet?.carriers.blue;
    const foe = this.fleet?.carriers.red;
    if (own && foe) {
      // above the carrier group, pointed at the enemy
      const dx = foe.pos.x - own.pos.x;
      const dz = foe.pos.z - own.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: own.pos.x + (dx / len) * 500, z: own.pos.z + (dz / len) * 500, heading: Math.atan2(dx, -dz) / DEG, altitude: 450, speed: sp.speed };
    }
    if (this.skirmish) {
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

  /** Distance to the nearest place an aircraft can land: an airstrip, or an active carrier deck on a carrier map. */
  private distToStrip(): number {
    const p = this.player.flight.pos;
    const a = this.world.nearestAirstrip(p.x, p.z);
    let d = Math.hypot(a.def.x - p.x, a.def.z - p.z);
    for (const k of this.world.decks) if (k.active) d = Math.min(d, Math.hypot(k.x - p.x, k.z - p.z));
    return d;
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

  /** Respawn the way the player chose: from the carrier's deck (if it still has one), else in the air. */
  private respawn(): void {
    if (this.fleet && this.settings.value.carrierSpawn === 'deck' && this.fleet.deckSpawn('blue')) this.spawnCarrier();
    else this.spawnAir();
  }

  /** On the carrier's stern, nose to the bow, throttle closed: open it fully and the catapult does the rest. */
  spawnCarrier(): void {
    const d = this.fleet?.deckSpawn('blue');
    if (!d) {
      this.spawnAir();
      return;
    }
    const f = this.player.flight;
    const c = this.player.controls;
    _tmp.set(d.x, d.y + f.def.flight.gearHeight, d.z);
    f.reset(_tmp, d.heading, 0, true, 0);
    f.grounded = true;
    c.throttle = 0;
    c.gearDown = true;
    c.afterburner = false;
    c.airbrake = false;
    this.afterSpawn();
    const alt = this.settings.value.controlScheme === 'mouse-throttle-ws';
    const key = this.input.codes(alt ? 'pitchUp' : 'throttleUp').map(codeLabel)[0] ?? 'throttle up';
    this.say(`HOLD ${key} TO FULL THROTTLE  =  CATAPULT LAUNCH`, 5);
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
    this.menus.showCrash(title, reason, this.livesNote() || 'Respawning in 6');
  }

  private livesNote(): string {
    const fg = this.fighter;
    if (!this.match?.cfg.lives) return '';
    return fg.lives > 0 ? `${fg.lives} ${fg.lives === 1 ? 'life' : 'lives'} left` : 'no lives left';
  }

  // ---- eject -----------------------------------------------------------------------------------

  private ejectHold = 0;
  private ejected: { survived: boolean } | null = null;

  private processEject(dt: number): void {
    const fg = this.fighter;
    const can = (fg.state === 'alive' || fg.state === 'wreck') && fg.damage.pilotAlive && !this.ejected && !this.spectating;
    if (!(can && this.input.isDown('eject'))) {
      this.ejectHold = 0;
      return;
    }
    this.ejectHold += dt;
    if (this.ejectHold < 0.9) {
      this.say('EJECTING' + '.'.repeat(1 + Math.floor(this.ejectHold * 4)), 0.3);
      return;
    }
    this.ejectNow();
  }

  /**
   * Ejecting on the ground (landed and rolling slowly or stopped) always works. In the air it is a coin toss: half the time the
   * pilot is recovered and keeps the life, half the time not and a life is lost.
   */
  private ejectChance(): number {
    const f = this.player.flight;
    return f.grounded && f.speed < 20 ? 1 : 0.5;
  }

  private ejectNow(): void {
    const fg = this.fighter;
    const p = this.ejectChance();
    const survived = Math.random() < p;
    const wasWreck = fg.state === 'wreck';
    this.ejected = { survived };
    this.combat.ejectFighter(fg, survived);
    if (wasWreck && survived) {
      // the aircraft was already lost (and the life spent): getting out of it gives the life back
      if (Number.isFinite(fg.lives)) fg.lives++;
      fg.stats.deaths = Math.max(0, fg.stats.deaths - 1);
    }
    this.crashed = true;
    this.crashTimer = 4.5;
    this.audio.beep(900, 0.15, 0.25);
    this.menus.showCrash(survived ? 'EJECTED' : 'EJECTION FAILED', survived ? 'Pilot recovered  ·  aircraft lost' : 'The pilot did not survive', this.livesNote() || 'Respawning in 4');
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

    if (this.state === 'hangar' || this.state === 'ready') this.renderHangar(dt);
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
    this.world.update(dt, this.rig.camera, this.spectating ? this.viewAircraft().object.position : p.object.position);
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
    const p = this.viewAircraft();
    const def = p.def;
    const cf = cameraFor(def);
    return {
      pos: p.object.position,
      quat: p.object.quaternion,
      speedNorm: p.flight.speed / def.flight.maxSpeed,
      ab: p.flight.abLevel,
      distance: cf.distance * this.settings.value.cameraDistance,
      height: cf.height * (0.6 + 0.4 * this.settings.value.cameraDistance),
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
      if (this.fighter.damage.get('gear').gone) this.say('LANDING GEAR DESTROYED  ·  BELLY LANDING ONLY', 2);
      else {
        c.gearDown = !c.gearDown;
        this.say(c.gearDown ? 'GEAR DOWN' : 'GEAR UP', 1.4);
      }
    }
    if (inp.pressed('maneuver') && !this.crashed && !this.spectating && this.fighter.state === 'alive') this.signatureMove();
    if (this.spectating && inp.pressed('cycleTarget')) this.specIndex++;
    this.processEject(dt);
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
      this.aim.addMouse(_mouse.x, _mouse.y, this.rig.right, this.rig.up, s.mouseSensitivity, s.invertY, s.mouseSensitivityY);
    }
    if (this.kb.pitch !== 0 || this.kb.roll !== 0 || this.kb.yaw !== 0) this.aim.relaxToNose(f, 1 - Math.exp(-6 * dt));
    this.aim.clampToNose(f);
    // a signature move flies itself: the reticle rides on the nose until it is over
    if (f.maneuver) this.aim.snapTo(f);
  }

  /** The signature-move key: start the airframe's move, or say why it cannot. */
  private signatureMove(): void {
    const f = this.player.flight;
    const def = MANEUVERS[this.player.def.maneuver];
    const name = def.name.toUpperCase();
    const unit = this.settings.value.speedUnit;
    const spd = (v: number): string => (unit === 'kmh' ? `${Math.round(v * 3.6)} km/h` : unit === 'kt' ? `${Math.round(v * 1.94384)} kt` : `${Math.round(v)} m/s`);
    const why = f.startManeuver(def);
    if (!why) {
      this.say(name, 1.8);
      this.rig.addShake(0.45);
      this.audio.whoosh(f.pos);
      this.recovering = false;
      this.aim.snapTo(f);
      return;
    }
    switch (why) {
      case 'slow': this.say(`${name}: TOO SLOW  ·  NEED ${spd(def.minSpeed)}`, 1.8); break;
      case 'fast': this.say(`${name}: TOO FAST  ·  UNDER ${spd(def.maxSpeed)}`, 1.8); break;
      case 'low': this.say(`${name}: TOO LOW  ·  NEED ${Math.round(def.minAgl)} m`, 1.8); break;
      case 'cooldown': this.say(`${name}: READY IN ${Math.ceil(f.maneuverCool)} s`, 1.2); break;
      case 'ground': this.say(`${name}: AIRBORNE ONLY`, 1.2); break;
      case 'damaged': this.say(`${name}: AIRFRAME TOO DAMAGED`, 1.8); break;
      default: break;
    }
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
      if (!f.maneuver) {
        // ---- terrain avoidance ----
        this.terrainAssist(dt);

        // ---- control law ----
        this.aim.compute(f, diff, this.cmd);
        c.pitch = this.kb.pitch !== 0 ? this.kb.pitch : this.cmd.pitch;
        c.roll = this.kb.roll !== 0 ? this.kb.roll : this.cmd.roll;
        c.yaw = clamp(this.cmd.yaw + this.kb.yaw, -1, 1);
        c.rudder = this.kb.yaw;
      }
      void s;

      // carrier catapult launch: shake and a call-out when the shuttle fires, then the nose is steered up through the climb-out
      // with full power, and the gear is raised once clear of the deck. (All difficulties: launching should be easy.)
      if (f.catapultStart) {
        this.say('CATAPULT LAUNCH', 2);
        this.rig.addShake(0.7);
        this.audio.explosion(f.pos, 8);
        this.deckLaunched = true;
      }
      if (f.catapult || f.launchAssist > 0) {
        c.throttle = 1;
        c.afterburner = true;
        if (f.speed > 70 || f.launchAssist > 0) {
          f.forward(_fwd);
          _fwd.y = 0;
          if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
          _fwd.normalize();
          const a = f.launchAssist > 0 ? 13 * DEG : 6 * DEG;
          this.aim.aim.set(_fwd.x * Math.cos(a), Math.sin(a), _fwd.z * Math.cos(a));
          this.aim.compute(f, diff, this.cmd);
          c.pitch = this.cmd.pitch;
          c.roll = this.cmd.roll;
          c.yaw = this.cmd.yaw;
        }
      }
      if (this.deckLaunched && !f.grounded && !f.catapult && f.agl > 30 && f.speed > 95 && c.gearDown) {
        c.gearDown = false;
        this.deckLaunched = false;
        this.say('GEAR UP', 1.4);
      }
      if (this.deckLaunched && f.grounded && !f.catapult && f.speed < 20 && f.launchAssist <= 0) this.deckLaunched = false;

      // arcade quality of life: tuck the gear away once clearly airborne and fast. Never near an airstrip: that is where you
      // want it down (a landing approach, or a touch-and-go), and it must stay down until you raise it yourself.
      const dStrip = this.distToStrip();
      if (diff.id === 'arcade' && c.gearDown && f.gearPos > 0.99 && !f.grounded && f.agl > 120 && f.speed > 130 && dStrip > 5000) {
        c.gearDown = false;
        this.say('GEAR UP', 1.4);
      }
      // Arcade landing assist: slow, low, descending and close to a runway or deck with the wheels still up: put them down
      // (a belly landing is the one thing that reliably wrecks the undercarriage)
      if (diff.id === 'arcade' && !c.gearDown && !f.grounded && !f.mods.gearBroken && f.agl < 110 && f.speed < 125 && f.vel.y < -1.5 && dStrip < 1800 && f.launchAssist <= 0 && !this.deckLaunched) {
        c.gearDown = true;
        this.say('GEAR DOWN  ·  LANDING ASSIST', 1.8);
      }

      f.step(dt, c, this.world);
      if (f.maneuverEnd) this.aim.snapTo(f);

      if (f.touchdown) { this.say('GOOD LANDING', 2); this.rig.addShake(0.35); }
      if (f.impact) {
        const im = f.impact;
        fg.landingDamage(im.severity, im.belly, im.rough);
        this.rig.addShake(0.5 + Math.min(0.8, im.severity * 0.3));
        this.audio.hit(f.pos);
        this.say(im.belly ? 'BELLY LANDING  ·  AIRCRAFT DAMAGED' : im.rough ? 'ROUGH FIELD LANDING  ·  AIRCRAFT DAMAGED' : 'HARD LANDING  ·  AIRCRAFT DAMAGED', 3);
      }
      // a reminder that there are brakes, once per landing roll
      if (f.grounded && f.speed > 25 && !c.airbrake && !this.brakeHinted && this.distToStrip() < 600) {
        this.brakeHinted = true;
        this.say(`${this.input.codes('airbrake').map(codeLabel).join('/')}  =  WHEEL BRAKES`, 2.5);
      }
      if (!f.grounded) this.brakeHinted = false;
      if (f.crashed) this.crash(f.crashed);
      this.checkBoundary(dt);
      this.checkService(dt);
      if (!this.crashed) {
        if (this.firing) this.combat.fireGun(fg, dt);
        if (this.rocketsHeld) this.combat.fireRockets(fg, dt);
      }
    }

    this.autoCountermeasures(dt);
    this.fleet?.update(dt);
    this.combat.update(dt);
    this.range.update();
    this.skirmish?.update();
    if (this.match?.cfg.strike && this.fleet) {
      const bc = this.fleet.carriers.blue;
      const rc = this.fleet.carriers.red;
      const bf = bc ? bc.healthFraction : 0;
      this.match.setCarriers(bf, rc ? rc.healthFraction : 0);
      // tell the player when their carrier is taking a beating
      if (bf < this.carrierWarn - 0.08 && bf > 0 && this.state === 'playing') {
        this.say(`YOUR CARRIER IS UNDER ATTACK  ·  ${Math.ceil(bf * 100)}%`, 3);
        this.audio.beep(520, 0.2, 0.25);
      }
      this.carrierWarn = Math.min(this.carrierWarn, bf + 0.08);
    }
    if (this.match) {
      if (this.match.cfg.lives) {
        let b = 0;
        let r = 0;
        let bl = 0;
        let rl = 0;
        for (const f of this.combat.fighters) {
          if (!(f.alive || f.lives > 0)) continue;
          const l = Math.max(0, f.lives);
          if (f.team === 'blue') {
            b++;
            bl += l;
          } else {
            r++;
            rl += l;
          }
        }
        this.match.setRemaining(b, r, bl, rl);
      }
      if (!this.match.over) this.match.update(dt);
      if (this.match.over && this.state !== 'results') {
        // a sunk carrier gets a few seconds to go down before the results screen
        if (this.match.cfg.strike && this.endTimer < 5) {
          if (this.endTimer === 0) this.say(this.match.winner === 'blue' ? 'ENEMY CARRIER DESTROYED' : this.match.winner === 'red' ? 'YOUR CARRIER IS LOST' : 'BOTH CARRIERS LOST', 4);
          this.endTimer += dt || 0.0001;
          if (this.endTimer < 4.5) return;
        }
        this.endMatch();
      }
    }
  }

  private terrainAssist(dt: number): void {
    const f = this.player.flight;
    const mode = this.settings.value.terrainAssist;
    // don't fight a deliberate landing approach (a carrier deck is a landing site too)
    const dNear = this.distToStrip();
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
    if (this.spectating) {
      const m = this.match;
      this.menus.updateCrash(m ? `Blue ${m.score.blue} pilots  ·  Red ${m.score.red} pilots  ·  ${this.input.codes('cycleTarget').map(codeLabel).join('/')} switches view` : '');
      return;
    }
    const note = this.livesNote();
    let pick = '';
    if (this.fleet) {
      // carrier strike: choose where the next sortie starts
      if (this.input.pressed('weapon1')) this.settings.set('carrierSpawn', 'air');
      if (this.input.pressed('weapon2')) this.settings.set('carrierSpawn', 'deck');
      const deck = this.settings.value.carrierSpawn === 'deck' && !!this.fleet.deckSpawn('blue');
      pick = `  ·  1 air  ·  2 carrier  (next: ${deck ? 'CARRIER' : 'AIR'})`;
    }
    this.menus.updateCrash(`${note ? note + '  ·  ' : ''}Respawning in ${Math.max(0, Math.ceil(this.crashTimer))}${pick}`);
    if (this.crashTimer <= 0) {
      if (this.match?.cfg.lives && this.fighter.lives <= 0) this.enterSpectate();
      else {
        this.ejected = null;
        this.respawn();
      }
    }
  }

  // ---- spectating (out of lives) -------------------------------------------------------------

  /** What is actually being played (a carrier sortie on a map with no sea runs as team deathmatch). */
  private mode: SortieMode = 'training';
  private deckLaunched = false;
  private carrierWarn = 1;
  private endTimer = 0;
  private briefNote = '';
  private spectating = false;
  private specIndex = 0;
  private specCurrent: Aircraft | null = null;

  private enterSpectate(): void {
    this.spectating = true;
    this.ejected = null;
    this.menus.showCrash('ELIMINATED', 'You are out of lives', '');
  }

  /** What the camera follows: the player, or (once eliminated) someone still in the fight. */
  private viewAircraft(): Aircraft {
    if (!this.spectating) return this.player;
    const alive = this.combat.fighters.filter((f) => f !== this.fighter && f.alive);
    if (alive.length === 0) return this.specCurrent ?? this.player;
    alive.sort((a, b) => (a.team === 'blue' ? 0 : 1) - (b.team === 'blue' ? 0 : 1) || a.id - b.id);
    const pick = alive[((this.specIndex % alive.length) + alive.length) % alive.length].aircraft;
    if (pick !== this.specCurrent) {
      this.specCurrent = pick;
      this.rig.snap(pick.flight.quat);
    }
    return pick;
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
    const stopped = f.grounded && f.speed < 6;
    const surf = this.world.surfaceAt(f.pos.x, f.pos.z, _surf);
    const near = this.world.nearestAirstrip(f.pos.x, f.pos.z);
    // service needs the aircraft stopped ON a friendly runway or carrier deck (the apron and open ground do not count)
    const onStrip = stopped && surf.onRunway && (surf.onDeck ? surf.deckTeam === 'blue' : near.def.team === 'blue');
    this.serviceInfo = null;
    if (!onStrip || !fg.needsService()) {
      this.serviceTimer = 0;
      fg.invulnerable = false;
      if (stopped && fg.needsService()) {
        this.serviceHint -= dt;
        if (this.serviceHint <= 0) {
          this.serviceHint = 6;
          this.say(surf.onDeck ? 'THIS IS THE ENEMY CARRIER' : surf.onApron && !surf.onRunway ? 'MOVE ONTO THE RUNWAY TO BE SERVICED' : this.fleet ? 'STOP ON YOUR CARRIER DECK OR A BLUE RUNWAY TO REARM AND REPAIR' : 'STOP ON A BLUE RUNWAY TO REARM AND REPAIR', 2.5);
        }
      }
      return;
    }
    this.serviceTimer += dt;
    const repair = fg.needsRepair();
    const need = repair ? SERVICE_REPAIR : SERVICE_REARM;
    // nobody can shoot you while the crew is working
    fg.invulnerable = true;
    if (this.serviceTimer < need) {
      this.serviceInfo = { label: repair ? 'REPAIRING AND REARMING' : 'REARMING AND REFUELING', left: need - this.serviceTimer, total: need };
      return;
    }
    fg.service();
    this.serviceTimer = 0;
    this.serviceInfo = null;
    this.say(repair ? 'REPAIRED  ·  REARMED  ·  REFUELED' : 'REARMED  ·  REFUELED', 3);
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
        if (this.match && 'damage' in e.victim) {
          this.match.onKill(e.killer ? e.killer.team : null, e.victim.team);
          // a destroyed aircraft with its pilot aboard costs a life in Last Stand
          if (this.match.cfg.lives) (e.victim as Fighter).lives = Math.max(0, (e.victim as Fighter).lives - 1);
        }
        this.feed.unshift({ text: `${who}  ▸  ${e.victim.name}  [${e.weapon}]`, age: 0, mine, theirs });
        if (this.feed.length > 5) this.feed.pop();
        if (mine) {
          this.killK = 1;
          this.say(`SPLASH  ${e.victim.name.toUpperCase()}`, 2.4);
          if (dmgNumbers) this.numbers.push({ pos: e.victim.pos.clone(), text: 'KILL', age: 0, kill: true, value: 0, victim: e.victim.id });
        }
        break;
      }
      case 'eject': {
        const who = e.who.name;
        this.feed.unshift({ text: `${who}  ejected  [${e.survived ? 'pilot safe' : 'ejection failed'}]`, age: 0, mine: e.who.id === me.id && e.survived, theirs: false });
        if (this.feed.length > 5) this.feed.pop();
        break;
      }
      case 'damage-events': {
        if (e.victim !== me) break;
        for (const ev of e.events) {
          if (ev.type === 'gear-lost') this.say('LANDING GEAR DESTROYED', 2.4);
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
      title: this.mode === 'training' ? 'TRAINING RANGE' : this.mode === 'freeflight' ? 'FREE FLIGHT' : this.mode === 'elimination' ? 'LAST STAND' : this.mode === 'carrier' ? 'CARRIER STRIKE' : 'TEAM DEATHMATCH',
      score: m ? m.score : { blue: sum('blue'), red: sum('red') },
      info: m ? (m.cfg.strike ? `CARRIER INTEGRITY   ·   BLUE ${m.score.blue}%   RED ${m.score.red}%${m.remaining !== null ? '   ·   ' + formatClock(m.remaining) : ''}` : m.cfg.lives ? `PILOTS LEFT   ·   3 LIVES EACH${m.remaining !== null ? '   ·   ' + formatClock(m.remaining) : ''}` : `FIRST TO ${m.cfg.scoreLimit}${m.remaining !== null ? '   ·   ' + formatClock(m.remaining) : ''}`) : '',
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
        lives: m?.cfg.lives ? Math.max(0, f.lives) : null,
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
    const reason = m.cfg.strike ? `${m.reason}  ·  Blue carrier ${m.score.blue}%  ·  Red carrier ${m.score.red}%` : `${m.reason}  ·  ${m.score.blue} to ${m.score.red}`;
    this.menus.showResults({ outcome, reason, data: this.scoreData() });
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
    if (this.mode === 'carrier') {
      title = 'CARRIER STRIKE';
      goal = `Sink the RED carrier before they sink yours. Lives are unlimited. Launch from your deck (full throttle, the catapult flings you off) or from the air; on the respawn screen press 1 for air, 2 for carrier. Select bombs (${keys('weapon4')}) or rockets (${keys('weapon3')}), then ${keys('cycleTarget')} to pick a ship. Destroyers and submarines screen the carrier with guns and missiles: come in fast and low, throw flares, and leave. Land on your own deck (gear down, close the throttle: the wire catches you) to rearm and repair${s.timeLimit ? '. When ' + s.timeLimit + ' minutes are up, the carrier in better shape wins' : ''}.`;
    } else if (this.mode === 'elimination') {
      title = 'LAST STAND';
      goal = `Three lives each. Destroy every pilot on the RED team before they do the same to you${s.timeLimit ? ' (or have more pilots left when ' + s.timeLimit + ' minutes are up)' : ''}. Ejecting (hold ${keys('eject')}) on the ground always saves the life; in the air it is 50/50.`;
    } else if (this.mode === 'tdm') {
      title = 'TEAM DEATHMATCH';
      goal = `Shoot down the RED team. First side to ${s.scoreLimit} kills wins${s.timeLimit ? ' (or most kills in ' + s.timeLimit + ' min)' : ''}.`;
    } else if (this.mode === 'training') {
      title = 'TRAINING RANGE';
      goal = 'Balloons dead ahead, a ground-target site and three Red drones. Nothing here is trying to kill you unless you set the drones to hostile.';
    } else {
      title = 'FREE FLIGHT';
      goal = 'An empty sky. Lower the gear (' + keys('gear') + ') and land on a runway to practise.';
    }
    if (this.briefNote) goal = this.briefNote + ' ' + goal;
    const find = this.mode === 'carrier' ? 'The Red carrier and its escorts are the red squares on the minimap; the line at the top of the screen gives its range and bearing. Enemy fighters are red markers.' : this.mode === 'tdm' || this.mode === 'elimination' ? 'Red markers on the HUD and the minimap show where the enemy is. The arrow at the screen edge points to the nearest one.' : 'Red markers show enemy aircraft; the minimap (top left) shows everything nearby.';
    this.briefEl.innerHTML =
      `<b>${title}</b><span>${goal}</span><span>${find}</span>` +
      `<i>${keys('cycleTarget')} pick a target  ·  hold ${keys('fireGun')} cannon  ·  ${keys('fireMissile')} fire missile (let the ring fill first)  ·  ${keys('flares')} flares  ${keys('chaff')} chaff  ·  ${keys('maneuver')} ${MANEUVERS[this.player.def.maneuver].name.toLowerCase()}  ·  ${keys('map')} map</i>`;
    this.briefUntil = this.clock + 22;
  }

  private serviceText = '';

  /** The big repair / rearm countdown. */
  private updateServiceHud(): void {
    if (this.crashed) this.serviceInfo = null;
    const s = this.serviceInfo;
    if (!s) {
      if (this.serviceText) {
        this.serviceEl.style.display = 'none';
        this.serviceText = '';
      }
      return;
    }
    const left = Math.ceil(s.left);
    const text = `${s.label}|${left}`;
    this.serviceEl.style.display = 'flex';
    if (text !== this.serviceText) {
      this.serviceText = text;
      this.serviceEl.innerHTML = `<span>${s.label}</span><b>${left}</b><i>seconds  ·  protected while the crew works  ·  stay stopped</i>`;
    }
    this.serviceEl.style.setProperty('--p', String(1 - s.left / s.total));
  }

  private updateMatchHud(): void {
    this.updateServiceHud();
    this.briefEl.style.opacity = this.clock < this.briefUntil ? String(Math.min(1, (this.briefUntil - this.clock) / 2)) : '0';
    const m = this.match;
    if (!m || this.state === 'results') {
      if (this.matchEl.style.display !== 'none') this.matchEl.style.display = 'none';
      return;
    }
    const rem = m.remaining;
    let target = '';
    if (m.cfg.strike) {
      const rc = this.fleet?.carriers.red;
      if (rc && rc.alive) {
        const p = this.player.flight.pos;
        const dx = rc.pos.x - p.x;
        const dz = rc.pos.z - p.z;
        const brg = Math.round(((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360) % 360;
        target = `RED CARRIER  ${(Math.hypot(dx, dz) / 1000).toFixed(1)} KM  ·  BRG ${String(brg).padStart(3, '0')}`;
      }
    }
    const text = `${m.score.blue}|${rem === null ? 'x' : formatClock(rem)}|${m.score.red}|${this.fighter.lives}|${target}`;
    this.matchEl.style.display = '';
    if (text === this.matchText) return;
    this.matchText = text;
    if (m.cfg.strike) {
      this.matchEl.innerHTML = `<span class="b">${m.score.blue}%</span><span class="t">${rem === null ? '∞' : formatClock(rem)}</span><span class="r">${m.score.red}%</span><span class="lim">CARRIER INTEGRITY${target ? '   ·   ' + target : ''}</span>`;
      return;
    }
    if (m.cfg.lives) {
      const l = Math.max(0, this.fighter.lives);
      this.matchEl.innerHTML = `<span class="b">${m.score.blue}</span><span class="t">${rem === null ? '∞' : formatClock(rem)}</span><span class="r">${m.score.red}</span><span class="lim">PILOTS LEFT   ·   YOUR LIVES ${'♥'.repeat(l)}${'♡'.repeat(Math.max(0, LIVES - l))}</span>`;
      return;
    }
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
    this.autoTarget(dt);
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

    // the airframe's signature move: ready, cooling down, being flown, or blocked (and why)
    const mv = MANEUVERS[def.maneuver];
    const why = fl.maneuverBlock(mv);
    const blocked: Record<string, string> = { slow: 'TOO SLOW', fast: 'TOO FAST', low: 'TOO LOW', ground: 'AIRBORNE', damaged: 'DAMAGED' };
    const maneuver: CombatHud['maneuver'] = {
      name: mv.name,
      key: this.input.codes('maneuver').map(codeLabel)[0] ?? '',
      state: fl.maneuver ? 'active' : fl.maneuverCool > 0 ? 'cooling' : why ? 'blocked' : 'ready',
      note: fl.maneuver ? 'ACTIVE' : fl.maneuverCool > 0 ? Math.ceil(fl.maneuverCool) + ' s' : why ? (blocked[why] ?? '') : 'READY',
    };
    return {
      report: dm.report().slice(0, 4),
      contacts: contacts.slice(0, 8),
      maneuver,
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
    f.rightVec(_hr);
    f.upVec(_hu);
    const lim = f.difficulty.landing;
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
      gMax: p.def.flight.gLimit * f.difficulty.gMul,
      aoaDeg: f.aoa / DEG,
      aoaStallDeg: p.def.flight.aoaStall,
      roll: Math.atan2(-_hr.y, _hu.y),
      vs: f.vel.y,
      landing: { sink: lim.sink, speed: lim.speed },
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
      nearestStrip: dNear < 7000 ? { name: near.def.name, dist: dNear, bearing: Math.atan2(near.def.x - f.pos.x, -(near.def.z - f.pos.z)) } : null,
      cameraMode: this.rig.mode,
      visible: true,
      glare: this.settings.value.reduceMotion ? null : this.sunGlare(),
      veil: this.world.cloudInside,
      speedFx: this.quality.screenFx && !this.settings.value.reduceMotion && this.state === 'playing' ? smoothstep(0.5, 1, f.speed / p.def.flight.maxSpeed) * 0.55 + f.abLevel * 0.3 : 0,
      combat: this.combatHud(),
      minimap: this.minimapData(),
      maxSpeed: p.def.flight.maxSpeed,
      stallSpeed: f.stallSpeedNow,
      stick: { pitch: p.controls.pitch, roll: p.controls.roll, yaw: p.controls.yaw },
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
      tuning: { AIM, FLIGHT }, combat: this.combat, fighter: this.fighter, range: this.range, skirmish: this.skirmish, fleet: this.fleet, match: this.match, audio: this.audio,
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
