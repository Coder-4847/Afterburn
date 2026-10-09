import { Quaternion, Vector3 } from 'three';
import type { CombatAudio } from '../weapons/Combat';

const _l = new Vector3();
const _q = new Quaternion();

/**
 * Procedural WebAudio: every sound is synthesised from noise and oscillators, nothing is downloaded.
 * Positional sounds use distance falloff and a stereo pan taken from the camera's orientation.
 * The context is created lazily on the first user gesture (browsers refuse to start audio before that).
 */
export class GameAudio implements CombatAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;
  private camPos = new Vector3();
  private camQuat: Quaternion | null = null;

  // looping voices
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; noise: AudioBufferSourceNode; gOsc: GainNode; gNoise: GainNode; filt: BiquadFilterNode } | null = null;
  private lockOsc: { osc: OscillatorNode; gain: GainNode } | null = null;
  private alertT = 0;
  private lastGun = 0;
  private lastHit = 0;

  /** Call from a user gesture (the start button). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master.connect(comp).connect(this.ctx.destination);
        // one shared second of white noise
        const n = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        this.startEngine();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Suspend everything while the game is paused. */
  setPaused(p: boolean): void {
    if (!this.ctx) return;
    if (p) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  setListener(pos: Vector3, quat: Quaternion): void {
    this.camPos.copy(pos);
    this.camQuat = quat;
  }

  // ---- helpers -------------------------------------------------------------------------------

  private get t(): number {
    return this.ctx!.currentTime;
  }

  /** Gain and pan node for a world position (returns null if inaudible or audio is off). */
  private spatial(pos: Vector3 | null, ref = 400): { out: AudioNode; gain: number } | null {
    const c = this.ctx;
    if (!c || !this.master || c.state !== 'running') return null;
    if (!pos) return { out: this.master, gain: 1 };
    const d = pos.distanceTo(this.camPos);
    const g = ref / (ref + d * 1.0);
    if (g < 0.01) return null;
    const pan = c.createStereoPanner();
    if (this.camQuat) {
      _l.copy(pos).sub(this.camPos).applyQuaternion(_q.copy(this.camQuat).invert());
      pan.pan.value = Math.max(-1, Math.min(1, _l.x / (Math.hypot(_l.x, _l.z) + 30)));
    }
    pan.connect(this.master);
    return { out: pan, gain: g };
  }

  private noiseSrc(loop = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  /** A filtered noise burst with an exponential decay. */
  private burst(pos: Vector3 | null, o: { dur: number; gain: number; f0: number; f1: number; q?: number; type?: BiquadFilterType; delay?: number; ref?: number }): void {
    const sp = this.spatial(pos, o.ref);
    if (!sp) return;
    const c = this.ctx!;
    const t0 = this.t + (o.delay ?? 0);
    const src = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(o.f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t0 + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(o.gain * sp.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + o.dur);
    src.connect(f).connect(g).connect(sp.out);
    src.start(t0, Math.random());
    src.stop(t0 + o.dur + 0.05);
  }

  private tone(pos: Vector3 | null, o: { f0: number; f1: number; dur: number; gain: number; type?: OscillatorType; delay?: number; ref?: number }): void {
    const sp = this.spatial(pos, o.ref);
    if (!sp) return;
    const c = this.ctx!;
    const t0 = this.t + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(o.gain * sp.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + o.dur);
    osc.connect(g).connect(sp.out);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  // ---- combat sounds -------------------------------------------------------------------------

  gun(pos: Vector3): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGun < 0.045) return; // the cannon fires every tick: voice-limit it
    this.lastGun = now;
    this.burst(pos, { dur: 0.09, gain: 0.5, f0: 3800, f1: 500, type: 'lowpass', ref: 250 });
    this.tone(pos, { f0: 150, f1: 55, dur: 0.1, gain: 0.55, type: 'triangle', ref: 250 });
  }

  missileLaunch(pos: Vector3): void {
    this.burst(pos, { dur: 1.4, gain: 0.5, f0: 2500, f1: 300, type: 'bandpass', q: 0.8, ref: 700 });
    this.tone(pos, { f0: 120, f1: 50, dur: 0.5, gain: 0.5, type: 'sawtooth', ref: 600 });
  }

  rocket(pos: Vector3): void {
    this.burst(pos, { dur: 0.45, gain: 0.32, f0: 3200, f1: 500, type: 'bandpass', q: 0.9, ref: 400 });
  }

  explosion(pos: Vector3, size: number): void {
    const s = Math.min(1, size / 24);
    const delay = Math.min(1.8, pos.distanceTo(this.camPos) / 700); // the speed of sound, softened
    this.burst(pos, { dur: 0.5 + s * 1.4, gain: 0.8 + s * 0.5, f0: 1800 + s * 800, f1: 90, delay, ref: 900 + s * 900 });
    this.tone(pos, { f0: 90, f1: 28, dur: 0.6 + s * 0.9, gain: 0.9, type: 'sine', delay, ref: 900 + s * 900 });
  }

  hit(pos: Vector3): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.03) return;
    this.lastHit = now;
    this.burst(pos, { dur: 0.06, gain: 0.32, f0: 6000, f1: 1400, type: 'highpass', ref: 300 });
    this.tone(pos, { f0: 1500 + Math.random() * 900, f1: 600, dur: 0.05, gain: 0.12, type: 'square', ref: 300 });
  }

  flare(pos: Vector3): void {
    this.burst(pos, { dur: 0.3, gain: 0.25, f0: 5000, f1: 1500, type: 'bandpass', q: 1.5, ref: 250 });
  }

  rip(pos: Vector3): void {
    this.burst(pos, { dur: 0.7, gain: 0.8, f0: 900, f1: 120, type: 'lowpass', ref: 600 });
    this.tone(pos, { f0: 480, f1: 110, dur: 0.6, gain: 0.35, type: 'sawtooth', ref: 600 });
  }

  // ---- cockpit sounds (not positional) --------------------------------------------------------

  /** A short blip: lock acquired, UI click, etc. */
  beep(freq: number, dur = 0.08, gain = 0.18): void {
    if (!this.ctx) return;
    this.tone(null, { f0: freq, f1: freq, dur, gain, type: 'square' });
  }

  /** The seeker growl / lock tone, a continuous tone that rises with lock progress. */
  lockTone(state: 'off' | 'search' | 'locked', progress: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    if (state === 'off') {
      if (this.lockOsc) {
        this.lockOsc.gain.gain.setTargetAtTime(0, c.currentTime, 0.03);
        const o = this.lockOsc;
        setTimeout(() => { try { o.osc.stop(); } catch { /* already stopped */ } }, 200);
        this.lockOsc = null;
      }
      return;
    }
    if (!this.lockOsc) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      const gain = c.createGain();
      gain.gain.value = 0;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      osc.connect(f).connect(gain).connect(this.master);
      osc.start();
      this.lockOsc = { osc, gain };
    }
    const o = this.lockOsc;
    if (state === 'locked') {
      o.osc.frequency.setTargetAtTime(1240, c.currentTime, 0.02);
      o.gain.gain.setTargetAtTime(0.09, c.currentTime, 0.02);
    } else {
      // a warble that climbs while the seeker acquires
      const wob = 0.5 + 0.5 * Math.sin(c.currentTime * (8 + progress * 24));
      o.osc.frequency.setTargetAtTime(420 + progress * 520, c.currentTime, 0.02);
      o.gain.gain.setTargetAtTime(0.03 + 0.05 * wob, c.currentTime, 0.02);
    }
  }

  /** Missile-inbound alarm: beeps faster as the missile gets closer. */
  missileAlert(eta: number, dt: number): void {
    if (!this.ctx) return;
    this.alertT -= dt;
    if (this.alertT > 0) return;
    this.alertT = Math.max(0.1, Math.min(0.7, eta * 0.085));
    this.tone(null, { f0: 1700, f1: 1700, dur: 0.07, gain: 0.2, type: 'square' });
  }

  /** Radar-warning chirp (someone is painting us). */
  rwr(locked: boolean): void {
    if (!this.ctx) return;
    if (locked) {
      this.tone(null, { f0: 900, f1: 900, dur: 0.05, gain: 0.12, type: 'square' });
      this.tone(null, { f0: 1300, f1: 1300, dur: 0.05, gain: 0.12, type: 'square', delay: 0.07 });
    } else {
      this.tone(null, { f0: 700, f1: 1100, dur: 0.12, gain: 0.1, type: 'triangle' });
    }
  }

  /** Engine drone, continuously driven by throttle / afterburner / speed. */
  private startEngine(): void {
    const c = this.ctx!;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const osc2 = c.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 31;
    const noise = this.noiseSrc(true);
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 500;
    const gOsc = c.createGain();
    gOsc.gain.value = 0;
    const gNoise = c.createGain();
    gNoise.gain.value = 0;
    osc.connect(gOsc);
    osc2.connect(gOsc);
    noise.connect(gNoise);
    gOsc.connect(filt);
    gNoise.connect(filt);
    filt.connect(this.master!);
    osc.start();
    osc2.start();
    noise.start();
    this.engine = { osc, osc2, noise, gOsc, gNoise, filt };
  }

  setEngine(power: number, ab: number, speedNorm: number, alive: boolean): void {
    const c = this.ctx;
    const e = this.engine;
    if (!c || !e) return;
    const t = c.currentTime;
    const a = alive ? 1 : 0;
    e.osc.frequency.setTargetAtTime(48 + power * 70 + ab * 20, t, 0.1);
    e.osc2.frequency.setTargetAtTime(24 + power * 36, t, 0.1);
    e.filt.frequency.setTargetAtTime(260 + power * 900 + ab * 1500 + speedNorm * 700, t, 0.1);
    e.gOsc.gain.setTargetAtTime((0.05 + power * 0.06) * a, t, 0.1);
    e.gNoise.gain.setTargetAtTime((0.04 + power * 0.1 + ab * 0.2 + speedNorm * 0.12) * a, t, 0.1);
  }
}
