import { Vector3 } from 'three';
import { Aircraft } from '../aircraft/Aircraft';
import { F16C } from '../data/aircraft/f16c';
import { DIFFICULTIES } from '../data/difficulty';
import { MAPS } from '../data/maps';
import { FLIGHT, TERRAIN_ASSIST, WORLD_BOUNDARY } from '../data/tuning';
import { MouseAim } from '../flight/MouseAim';
import { scanTerrain, type TerrainThreat } from '../flight/TerrainAssist';
import type { SurfaceInfo } from '../flight/FlightModel';
import { CameraRig } from '../render/CameraRig';
import { GameRenderer } from '../render/GameRenderer';
import { QUALITY, detectQuality, type QualityPreset } from '../render/quality';
import { Hud, type HudData } from '../ui/Hud';
import { Menus } from '../ui/Menus';
import { World } from '../world/World';
import { clamp, DEG, yieldToMain } from './math';
import { Input } from './Input';
import { SettingsStore, type QualityLevel, type Settings } from './Settings';

type GameState = 'loading' | 'ready' | 'playing' | 'paused';

const TEAM_BLUE = 0x3aa0ff;
const _fwd = new Vector3();
const _vel = new Vector3();
const _tmp = new Vector3();
const _surf: SurfaceInfo = { height: 0, onRunway: false, onApron: false };
const _mouse = { x: 0, y: 0 };

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
      changed: (k) => this.applySetting(k),
    });

    window.addEventListener('resize', () => this.onResize());
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

    const diff = DIFFICULTIES[this.settings.value.difficulty];
    this.player = new Aircraft(F16C, diff, TEAM_BLUE);
    this.world.scene.add(this.player.object);
    this.spawnAir();
    this.applyAllSettings();
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
    this.menus.showCrash(reason === 'Left combat zone' ? 'OUT OF BOUNDS' : 'CRASHED', reason, 'Respawning in 3');
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

    this.renderFrame(this.state === 'playing' ? dt : 0);
    this.input.endFrame();
    this.updateFps(dt);
  };

  private renderFrame(dt: number): void {
    const p = this.player;
    p.syncVisual(this.alpha, dt);
    if (this.state === 'playing') this.rig.update(dt, this.rigTarget(), this.groundAt);
    this.world.update(dt, this.rig.camera, p.object.position);
    this.renderer.render(this.world.scene, this.rig.camera);
    this.drawHud(dt);
  }

  private rigTarget() {
    const p = this.player;
    const def = p.def;
    return {
      pos: p.object.position,
      quat: p.object.quaternion,
      speedNorm: p.flight.speed / def.flight.maxSpeed,
      ab: p.flight.abLevel,
      distance: def.camera.distance,
      height: def.camera.height,
      cockpit: def.camera.cockpit,
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
