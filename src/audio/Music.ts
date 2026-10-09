import type { GameAudio } from './Audio';

export type Theme = 'menu' | 'flight';

/** Note frequency from a MIDI number. */
const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface ThemeDef {
  bpm: number;
  /** Chords as root MIDI notes (minor triads / sevenths are built from `quality`). */
  roots: number[];
  minor: boolean[];
}

const THEMES: Record<Theme, ThemeDef> = {
  // calm, wide, in A minor: Am - F - C - G
  menu: { bpm: 72, roots: [57, 53, 60, 55], minor: [true, false, false, false] },
  // driving, in D minor: Dm - Bb - F - C
  flight: { bpm: 104, roots: [50, 46, 53, 48], minor: [true, false, false, false] },
};

/**
 * Procedural score, built from oscillators and noise. A look-ahead scheduler places notes a fraction of a second ahead of the
 * audio clock, so timing stays tight even when frames stutter. Layers fade in with `intensity` (0..1): pad and arpeggio at
 * rest, then bass, hats, kick, and finally a lead line as the fight heats up.
 */
export class Music {
  private theme: Theme = 'menu';
  private intensity = 0.3;
  private target = 0.3;
  private next = 0;
  private step = 0;
  private started = false;
  private bus: GainNode | null = null;

  constructor(private audio: GameAudio) {}

  setTheme(t: Theme): void {
    if (t === this.theme) return;
    this.theme = t;
    this.step = 0;
  }

  setIntensity(v: number): void {
    this.target = Math.max(0, Math.min(1, v));
  }

  /** Call every frame. */
  update(dt: number): void {
    const c = this.audio.context;
    const bus = this.audio.musicBus;
    if (!c || !bus || c.state !== 'running') return;
    this.bus = bus;
    this.intensity += (this.target - this.intensity) * Math.min(1, dt * 0.8);
    if (!this.started || this.next < c.currentTime - 0.5) {
      this.started = true;
      this.next = c.currentTime + 0.1;
      this.step = 0;
    }
    const th = THEMES[this.theme];
    const stepDur = 60 / th.bpm / 4; // sixteenth notes
    while (this.next < c.currentTime + 0.3) {
      this.schedule(this.step, this.next, stepDur, th);
      this.next += stepDur;
      this.step++;
    }
  }

  private schedule(step: number, t: number, dur: number, th: ThemeDef): void {
    const inBar = step % 16;
    const bar = Math.floor(step / 16);
    const chord = bar % th.roots.length;
    const root = th.roots[chord];
    const minor = th.minor[chord];
    const third = root + (minor ? 3 : 4);
    const fifth = root + 7;
    const I = this.intensity;
    const flight = this.theme === 'flight';

    // pad: one chord per bar, always present
    if (inBar === 0) {
      const len = dur * 16;
      for (const n of [root + 12, third + 12, fifth + 12, root + 24]) this.pad(hz(n), t, len, flight ? 0.035 : 0.05);
    }

    // arpeggio: eighth notes through the chord
    if (inBar % 2 === 0 && (flight ? I > 0.15 : true)) {
      const seq = [root + 24, third + 24, fifth + 24, third + 24 + 12, fifth + 24, third + 24, root + 24 + 12, fifth + 24];
      this.pluck(hz(seq[(inBar / 2) % seq.length]), t, dur * 3, (flight ? 0.045 : 0.05) * (0.6 + 0.4 * I));
    }

    if (!flight) return;

    // bass: eighth-note pulse from a moderate intensity
    if (I > 0.3 && inBar % 2 === 0) this.bass(hz(root - 12 + (inBar === 6 || inBar === 14 ? 7 : 0)), t, dur * 1.8, 0.16 * Math.min(1, I * 1.4));
    // hats: offbeat sixteenths
    if (I > 0.4 && (inBar % 4 === 2 || (I > 0.7 && inBar % 2 === 1))) this.hat(t, 0.05 + 0.05 * I);
    // kick: four on the floor once things are tense
    if (I > 0.55 && inBar % 4 === 0) this.kick(t, 0.5);
    // snare on 2 and 4 at high intensity
    if (I > 0.75 && (inBar === 4 || inBar === 12)) this.snare(t, 0.22);
    // lead: a rising figure in the last bars of the progression at full intensity
    if (I > 0.8 && inBar % 4 === 0) {
      const lead = [fifth + 24, root + 31, third + 31, fifth + 31][(inBar / 4) % 4];
      this.lead(hz(lead), t, dur * 3.6, 0.05);
    }
  }

  // ---- voices ------------------------------------------------------------------------------------

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private pad(f: number, t: number, len: number, vol: number): void {
    const c = this.audio.context!;
    const g = c.createGain();
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900 + 700 * this.intensity;
    this.env(g, t, len * 0.35, vol, len * 0.7);
    filt.connect(g).connect(this.bus!);
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(filt);
      o.start(t);
      o.stop(t + len * 1.1);
    }
  }

  private pluck(f: number, t: number, len: number, vol: number): void {
    const c = this.audio.context!;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = c.createGain();
    this.env(g, t, 0.01, vol, len);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + len + 0.1);
  }

  private bass(f: number, t: number, len: number, vol: number): void {
    const c = this.audio.context!;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(700, t);
    filt.frequency.exponentialRampToValueAtTime(160, t + len);
    const g = c.createGain();
    this.env(g, t, 0.01, vol, len);
    o.connect(filt).connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + len + 0.1);
  }

  private lead(f: number, t: number, len: number, vol: number): void {
    const c = this.audio.context!;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 2200;
    const g = c.createGain();
    this.env(g, t, 0.02, vol, len);
    o.connect(filt).connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + len + 0.1);
  }

  private noiseHit(t: number, len: number, vol: number, type: BiquadFilterType, freq: number): void {
    const c = this.audio.context!;
    const buf = this.audio.noiseBuffer;
    if (!buf) return;
    const s = c.createBufferSource();
    s.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    const g = c.createGain();
    this.env(g, t, 0.002, vol, len);
    s.connect(filt).connect(g).connect(this.bus!);
    s.start(t, Math.random());
    s.stop(t + len + 0.05);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, 0.05, vol, 'highpass', 7000);
  }

  private snare(t: number, vol: number): void {
    this.noiseHit(t, 0.16, vol, 'bandpass', 1900);
  }

  private kick(t: number, vol: number): void {
    const c = this.audio.context!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain();
    this.env(g, t, 0.004, vol, 0.22);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.3);
  }
}
