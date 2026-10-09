import { Vector3 } from 'three';
import { Aircraft } from '../aircraft/Aircraft';
import { cameraFor } from '../aircraft/AircraftDef';
import { TrailEmitter } from '../aircraft/Trails';
import { getAircraft } from '../data/aircraft';
import { DIFFICULTIES } from '../data/difficulty';
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
import { Hud, type HudData } from '../ui/Hud';
import { HangarUI } from '../ui/Hangar';
import { Menus } from '../ui/Menus';
import { World } from '../world/World';
import { clamp, DEG, smoothstep, yieldToMain } from './math';
import { Input } from './Input';
import { SettingsStore, type QualityLevel, type Settings } from './Settings';

type GameState = 'loading' | 'ready' | 'playing' | 'paused' | 'hangar';

const TEAM_BLUE = 0x3aa0ff;
const _fwd = new Vector3();
const _vel = new Vector3();
const _tmp = new Vector3();
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
      aircraftName: () => getAircraft(this.settings.value.aircraftId).fullName,
      changed: (k) => this.applySetting(k),
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

    const map = MAPS.coral;
    this.world = await World.create(map, this.renderer.gl, this.quality, this.settings.value.timeOfDay, progress);

    this.smoke = new ParticleSystem(9000, false, true);
    this.fire = new ParticleSystem(3500, true, false);
    this.world.scene.add(this.smoke.points, this.fire.points);
    this.trails = new TrailEmitter(this.smoke);
    this.world.fogToneMapped = !this.renderer.postActive;
    this.setAircraft(this.settings.value.aircraftId);
    this.applyAllSettings();

    this.hangar = new HangarScene(this.renderer.gl);
    this.hangarUi = new HangarUI(this.root.querySelector('#ui') as HTMLElement, this.hangar, this.canvas, {
      select: (id) => { this.settings.set('aircraftId', id); this.setAircraft(id); this.closeHangar(); },
      back: () => this.closeHangar(),
    });
    this.hangarUi.onPreview = (def) => this.hangar.setAircraft(def, TEAM_BLUE);
    this.hangar.resize(window.innerWidth / window.innerHeight);
    this.world.terrain.prewarm(this.rig.camera.position);
    // two warm-up frames so shaders compile before the menu appears
    this.renderFrame(0);
    this.renderFrame(0);

    this.state = 'ready';
    this.menus.showReady();
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private resolveQuality(): QualityPreset {
    const q = this.settings.value.quality;
    return QUALITY[q === 'auto' ? this.detected : q];
  }

  private applyAllSettings(): void {
    for (const k of ['fov', 'difficulty', 'cameraShake', 'hudPitchLadder', 'speedUnit', 'showFps'] as (keyof Settings)[]) this.applySetting(k, true);
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
      case 'difficulty': if (this.player) this.player.flight.difficulty = DIFFICULTIES[s.difficulty]; break;
      case 'cameraShake': this.rig.shakeEnabled = s.cameraShake; break;
      case 'showFps': this.fpsEl.style.display = s.showFps ? '' : 'none'; break;
      default: break;
    }
    this.hud.options = { unit: s.speedUnit, ladder: s.hudPitchLadder, tape: s.hudHeadingTape, flightPath: s.hudFlightPath };
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
    if (await this.acquireLock()) this.enterPlay();
  }

  private async resume(): Promise<void> {
    if (this.state === 'playing') return;
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
    if (!this.settings.value.seenIntro) this.settings.set('seenIntro', true);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.captureKeys = false;
    this.input.exitLock();
    document.body.classList.remove('playing');
    this.menus.showPause();
  }

  // ---- aircraft selection / hangar ------------------------------------------------------------

  /** Swap the player's aircraft (new flight model + model) and respawn in the air. */
  private setAircraft(id: string): void {
    const def = getAircraft(id);
    if (this.player && this.player.def.id === def.id) return;
    const old = this.player;
    const p = new Aircraft(def, DIFFICULTIES[this.settings.value.difficulty], TEAM_BLUE);
    this.player = p;
    this.world.scene.add(p.object);
    old?.dispose();
    void p.loadOverride(); // swaps in public/models/<id>.glb if one exists
    this.trails?.reset();
    this.spawnAir();
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
    this.state = this.hangarReturn;
    if (this.hangarReturn === 'paused') this.menus.showPause();
    else this.menus.showReady();
  }

  private say(text: string, seconds = 2.2): void {
    this.message = { text, until: this.clock + seconds };
  }

  private groundAt = (x: number, z: number): number => this.world.surfaceAt(x, z, _surf).height;

  spawnAir(): void {
    const m = this.world.map.spawn;
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
    this.player.object.visible = true;
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
    this.player.object.visible = false;
    this.rig.addShake(1.2);
    this.explode(reason);
    this.menus.showCrash(reason === 'Left combat zone' ? 'OUT OF BOUNDS' : 'CRASHED', reason, 'Respawning in 3');
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

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
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
      this.updateCrash(dt);
      this.governResolution(dt);
    } else if (this.state === 'paused') {
      // keep the Esc key responsive when pointer lock isn't available
      this.input.endFrame();
    }

    if (this.state === 'hangar') this.renderHangar(dt);
    else this.renderFrame(this.state === 'playing' ? dt : 0);
    this.input.endFrame();
    this.updateFps(dt);
  };

  private renderFrame(dt: number): void {
    const p = this.player;
    p.syncVisual(this.alpha, dt);
    p.model.root.visible = this.rig.mode !== 'cockpit' || this.crashed; // cockpit-lite: no airframe in view
    if (this.state === 'playing') this.rig.update(dt, this.rigTarget(), this.groundAt);
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
    if (inp.pressed('camera')) {
      this.rig.cycleMode();
      this.say(this.rig.mode === 'chase' ? 'CHASE VIEW' : 'COCKPIT VIEW', 1.4);
    }
    if (inp.pressed('gear') && !this.crashed) {
      c.gearDown = !c.gearDown;
      this.say(c.gearDown ? 'GEAR DOWN' : 'GEAR UP', 1.4);
    }

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
    if (this.kb.pitch !== 0 || this.kb.roll !== 0) this.aim.relaxToNose(f, 1 - Math.exp(-6 * dt));
    this.aim.clampToNose(f);
  }

  private stepPhysics(dt: number): void {
    const p = this.player;
    const f = p.flight;
    const c = p.controls;
    const diff = f.difficulty;
    const s = this.settings.value;

    if (!this.crashed) {
      // ---- terrain avoidance ----
      this.terrainAssist(dt);

      // ---- control law ----
      this.aim.compute(f, diff, this.cmd);
      c.pitch = this.kb.pitch !== 0 ? this.kb.pitch : this.cmd.pitch;
      c.roll = this.kb.roll !== 0 ? this.kb.roll : this.cmd.roll;
      c.yaw = clamp(this.cmd.yaw + this.kb.yaw, -1, 1);
      void s;

      // arcade quality of life: tuck the gear away once clearly airborne and fast
      if (diff.id === 'arcade' && c.gearDown && f.gearPos > 0.99 && !f.grounded && f.agl > 45 && f.speed > 105) {
        c.gearDown = false;
        this.say('GEAR UP', 1.4);
      }

      f.step(dt, c, this.world);

      if (f.touchdown) { this.say('TOUCHDOWN', 2); this.rig.addShake(0.35); }
      if (f.crashed) this.crash(f.crashed);
      this.checkBoundary(dt);
    }
  }

  private terrainAssist(dt: number): void {
    const f = this.player.flight;
    const mode = this.settings.value.terrainAssist;
    // don't fight a deliberate landing approach
    const near = this.world.nearestAirstrip(f.pos.x, f.pos.z);
    const dNear = Math.hypot(near.def.x - f.pos.x, near.def.z - f.pos.z);
    const landing = f.grounded || (f.gearPos > 0.5 && dNear < 3500 && f.agl < 400);
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
      glare: this.sunGlare(),
      veil: this.world.cloudInside,
      speedFx: this.quality.screenFx && this.state === 'playing' ? smoothstep(0.5, 1, f.speed / p.def.flight.maxSpeed) * 0.55 + f.abLevel * 0.3 : 0,
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
