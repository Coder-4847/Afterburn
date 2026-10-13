import { Quaternion, Vector3 } from 'three';
import { DEG, clamp, smoothstep } from '../core/math';

/**
 * Signature moves: scripted, one-button manoeuvres every airframe has (the Pugachev Cobra, the Kvochur Bell, the Kulbit...).
 *
 * A move is a short script the flight model plays in place of the normal control law:
 *   - the nose follows a prescribed pitch / roll / yaw sequence, relative to the attitude the move started from;
 *   - the speed follows a prescribed profile (a fraction of the entry speed);
 *   - the velocity direction shares `track` of the nose's rotation (1 = flying a loop on rails, 0 = the nose swings but the
 *     flight path does not change, as in a cobra or a kulbit).
 * Every script ends in a sane state (nose roughly on the flight path, enough speed) and normal flight takes over.
 */
export type ManeuverId = 'cobra' | 'bell' | 'kulbit' | 'immelmann' | 'splitS' | 'hammerhead' | 'jTurn' | 'tailslide' | 'barrelRoll';

/** Builds an attitude as a chain of body-frame rotations applied to the attitude the move started from. */
export class Pose {
  readonly q = new Quaternion();
  private r = new Quaternion();
  private static X = new Vector3(1, 0, 0);
  private static Y = new Vector3(0, 1, 0);
  private static Z = new Vector3(0, 0, 1);

  start(q0: Quaternion): this {
    this.q.copy(q0);
    return this;
  }

  /** Nose up (+) about the wings. */
  pitch(a: number): this {
    if (a !== 0) this.q.multiply(this.r.setFromAxisAngle(Pose.X, a));
    return this;
  }

  /** Right wing down (+) about the nose. */
  roll(a: number): this {
    if (a !== 0) this.q.multiply(this.r.setFromAxisAngle(Pose.Z, -a));
    return this;
  }

  /** Nose right (+) about the vertical axis of the aircraft. */
  yaw(a: number): this {
    if (a !== 0) this.q.multiply(this.r.setFromAxisAngle(Pose.Y, -a));
    return this;
  }
}

/** What a move asks of the aircraft at time t. All curves are plain functions of the elapsed seconds. */
export interface ManeuverDef {
  id: ManeuverId;
  name: string;
  /** One line shown in the hangar. */
  blurb: string;
  duration: number;
  /** Entry limits: speed (m/s) window and the least height above ground (m). */
  minSpeed: number;
  maxSpeed: number;
  minAgl: number;
  /** Seconds before it can be used again. */
  cooldown: number;
  /** The attitude, built relative to the start attitude. */
  pose(t: number, p: Pose): void;
  /** Speed as a multiple of the entry speed. */
  speed(t: number): number;
  /** 0..1: how much of the nose's rotation the velocity direction follows. */
  track(t: number): number;
  /** Engine for the sound, flame and fuel burn: 0..1 power, above 0.9 lights the afterburner. */
  thrust(t: number): number;
  /** Stick for the control-surface animation: pitch, roll, yaw. */
  stick(t: number, out: number[]): void;
  /** 0..1: how much to blend the nose toward "along the flight path" (for a clean hand-back). */
  align?(t: number): number;
}

const seg = (t: number, a: number, b: number): number => clamp((t - a) / (b - a), 0, 1);
const ease = (x: number): number => x * x * (3 - 2 * x);
const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);
const hold = (t: number, a: number, b: number): number => (t >= a && t <= b ? 1 : 0);

export const MANEUVERS: Record<ManeuverId, ManeuverDef> = {
  // The nose snaps up past the vertical, hangs there while the air brakes the jet, then drops back onto the flight path.
  cobra: {
    id: 'cobra', name: 'Cobra', blurb: 'Pugachev\'s Cobra: the nose snaps past vertical, the jet hangs and bleeds speed, then drops back. Anything behind you overshoots.',
    duration: 3.0, minSpeed: 95, maxSpeed: 420, minAgl: 140, cooldown: 7,
    pose(t, p) {
      const up = easeOut(seg(t, 0, 0.7));
      const down = ease(seg(t, 1.9, 2.8));
      const wob = Math.sin(t * 9) * 2.5 * DEG * hold(t, 0.8, 1.9);
      p.pitch(112 * DEG * (up - down) + wob);
    },
    speed: (t) => 1 - 0.42 * ease(seg(t, 0.1, 1.1)) + 0.17 * ease(seg(t, 2.0, 3.0)),
    track: () => 0.05,
    thrust: (t) => (t < 0.5 ? 1 : t < 2.2 ? 0.45 : 1),
    stick: (t, o) => { o[0] = hold(t, 0.05, 1.9); o[1] = 0; o[2] = 0; },
  },

  // Zoom up, hover at the top, then tumble forward over the nose and out in a dive. The "bell" is the swing of the nose.
  bell: {
    id: 'bell', name: 'Kvochur Bell', blurb: 'Kvochur\'s Bell: a zoom to near-zero airspeed, a hang, then the jet swings its nose over like a bell and falls out in a dive.',
    duration: 5.0, minSpeed: 110, maxSpeed: 340, minAgl: 560, cooldown: 12,
    pose(t, p) {
      const up = easeOut(seg(t, 0, 1.15));
      const sway = Math.sin(t * 7) * 3 * DEG * hold(t, 1.15, 2.4);
      const swing = ease(seg(t, 2.4, 4.2));
      p.pitch(96 * DEG * up + sway + (360 * DEG - 96 * DEG) * swing);
    },
    speed: (t) => 1 - 0.85 * ease(seg(t, 0.2, 1.3)) + 0.4 * ease(seg(t, 2.3, 4.2)) + 0.05 * seg(t, 4.2, 5),
    track: (t) => (t < 1.15 ? 0.5 : t < 2.4 ? 0 : 1),
    thrust: (t) => (t < 1.15 ? 1 : t < 2.4 ? 0.1 : t < 4.2 ? 0.55 : 1),
    stick: (t, o) => { o[0] = t < 4.4 ? 1 : 0; o[1] = 0; o[2] = hold(t, 1.2, 2.3) * Math.sin(t * 5); },
    align: (t) => smoothstep(4.2, 4.95, t) * 0.85,
  },

  // A flat somersault: the nose goes all the way round in pitch while the jet keeps flying forward.
  kulbit: {
    id: 'kulbit', name: 'Kulbit', blurb: 'A flat somersault: 360 degrees of pitch with the jet still moving forward. Pure showmanship, and a free gun pass if you are lucky.',
    duration: 3.4, minSpeed: 90, maxSpeed: 390, minAgl: 340, cooldown: 9,
    pose(t, p) {
      p.pitch(360 * DEG * ease(seg(t, 0.15, 3.0)));
    },
    speed: (t) => 1 - 0.3 * ease(seg(t, 0.2, 1.7)) + 0.12 * ease(seg(t, 2.2, 3.4)),
    track: () => 0,
    thrust: (t) => (t < 0.3 ? 1 : t < 2.9 ? 0.5 : 1),
    stick: (t, o) => { o[0] = hold(t, 0.1, 3.0); o[1] = 0; o[2] = 0; },
  },

  // Half loop up and over, then a half roll: the textbook reversal, an exchange of speed for height.
  immelmann: {
    id: 'immelmann', name: 'Immelmann', blurb: 'A half loop and a half roll: you leave heading the other way, higher and slower, on top of whoever was behind you.',
    duration: 4.0, minSpeed: 130, maxSpeed: 520, minAgl: 300, cooldown: 8,
    pose(t, p) {
      p.pitch(180 * DEG * ease(seg(t, 0, 2.5)));
      p.roll(180 * DEG * ease(seg(t, 2.35, 3.6)));
    },
    speed: (t) => 1 - 0.25 * ease(seg(t, 0, 2.5)) - 0.03 * seg(t, 2.5, 4),
    track: (t) => (t < 2.5 ? 1 : 0),
    thrust: () => 1,
    stick: (t, o) => { o[0] = t < 2.5 ? 1 : 0; o[1] = hold(t, 2.3, 3.7); o[2] = 0; },
    align: (t) => smoothstep(3.4, 4.0, t),
  },

  // Roll inverted, then pull through: the fast, hard reversal and escape downhill.
  splitS: {
    id: 'splitS', name: 'Split-S', blurb: 'Roll inverted and pull through: a half loop toward the ground that reverses you and trades height for speed.',
    duration: 3.8, minSpeed: 100, maxSpeed: 520, minAgl: 800, cooldown: 8,
    pose(t, p) {
      p.roll(180 * DEG * ease(seg(t, 0, 0.8)));
      p.pitch(180 * DEG * ease(seg(t, 0.7, 3.2)));
    },
    speed: (t) => 1 + 0.3 * ease(seg(t, 0.7, 3.2)),
    track: (t) => (t < 0.7 ? 0 : t < 3.2 ? 1 : 0),
    thrust: () => 1,
    stick: (t, o) => { o[0] = hold(t, 0.7, 3.2); o[1] = hold(t, 0, 0.8); o[2] = 0; },
    align: (t) => smoothstep(3.2, 3.8, t),
  },

  // Zoom to the vertical, pivot on the spot, fall back through the way you came: a stall turn.
  hammerhead: {
    id: 'hammerhead', name: 'Hammerhead', blurb: 'A stall turn: straight up until the speed is gone, a pivot about the nose, and a dive back down the other way.',
    duration: 5.0, minSpeed: 140, maxSpeed: 430, minAgl: 560, cooldown: 11,
    pose(t, p) {
      p.pitch(90 * DEG * easeOut(seg(t, 0, 1.0)));
      p.roll(180 * DEG * ease(seg(t, 1.9, 2.8)));
      p.pitch(-90 * DEG * ease(seg(t, 2.8, 4.2)));
    },
    speed: (t) => 1 - 0.9 * ease(seg(t, 0, 1.9)) + 0.75 * ease(seg(t, 2.8, 4.4)),
    track: (t) => (t < 1.0 ? 1 : t < 2.8 ? 0 : 1),
    thrust: (t) => (t < 1.1 ? 1 : t < 2.9 ? 0.3 : 1),
    stick: (t, o) => { o[0] = hold(t, 0, 1.1) - hold(t, 2.8, 4.2); o[1] = hold(t, 1.9, 2.8); o[2] = hold(t, 1.9, 2.8); },
    align: (t) => smoothstep(4.2, 5.0, t),
  },

  // A short, low-slung reversal: up to about 70 degrees, snap round on the rudder, drop the nose onto the new heading.
  jTurn: {
    id: 'jTurn', name: 'J-turn', blurb: 'The Herbst manoeuvre: a high-alpha reversal that turns the jet around in a fraction of the room a turn needs.',
    duration: 3.6, minSpeed: 100, maxSpeed: 400, minAgl: 420, cooldown: 8,
    pose(t, p) {
      p.pitch(72 * DEG * easeOut(seg(t, 0, 0.8)));
      p.roll(180 * DEG * ease(seg(t, 0.95, 1.9)));
      p.pitch(-108 * DEG * ease(seg(t, 1.9, 3.1)));
    },
    speed: (t) => 1 - 0.62 * ease(seg(t, 0, 1.5)) + 0.5 * ease(seg(t, 1.9, 3.2)),
    track: (t) => (t < 0.9 ? 1 : t < 1.9 ? 0 : 1),
    thrust: (t) => (t < 0.9 ? 1 : t < 2.0 ? 0.4 : 1),
    stick: (t, o) => { o[0] = hold(t, 0, 0.9) - hold(t, 1.9, 3.1); o[1] = 0; o[2] = hold(t, 0.9, 1.9); },
    align: (t) => smoothstep(3.0, 3.6, t),
  },

  // Vertical climb, the jet stops, slides back on its tail, then the nose falls through and the jet dives out.
  tailslide: {
    id: 'tailslide', name: 'Tail slide', blurb: 'Straight up until it stops, a slide backward on the tail, then the nose falls through into a dive. The MiG special.',
    duration: 4.6, minSpeed: 120, maxSpeed: 400, minAgl: 620, cooldown: 11,
    pose(t, p) {
      const up = easeOut(seg(t, 0, 1.0));
      const fall = ease(seg(t, 2.5, 3.9));
      p.pitch(88 * DEG * up - (88 + 62) * DEG * fall + Math.sin(t * 6) * 2 * DEG * hold(t, 1.0, 2.5));
    },
    speed: (t) => 1 - 0.88 * ease(seg(t, 0, 1.7)) + 0.6 * ease(seg(t, 2.5, 4.2)),
    track: (t) => (t < 1.0 ? 1 : t < 2.5 ? 0 : 0.9),
    thrust: (t) => (t < 1.1 ? 1 : t < 2.9 ? 0.05 : 1),
    stick: (t, o) => { o[0] = hold(t, 0, 1.0) - hold(t, 2.5, 3.9); o[1] = 0; o[2] = 0; },
    align: (t) => smoothstep(3.6, 4.6, t),
  },

  // A rolling spiral around the line of flight: a barrel roll that corkscrews the jet clear of a pursuer's gun line.
  barrelRoll: {
    id: 'barrelRoll', name: 'Barrel roll', blurb: 'A full rolling corkscrew around the line of flight: loses a tail-chaser\'s aim without giving up any speed or height.',
    duration: 2.6, minSpeed: 70, maxSpeed: 500, minAgl: 220, cooldown: 5,
    pose(t, p) {
      const s = ease(seg(t, 0, 2.3));
      const a = 360 * DEG * s;
      // the nose sweeps a cone of half-angle 20 degrees once around the line of flight while the jet rolls through it
      p.roll(-a).pitch(20 * DEG * Math.sin(Math.PI * s)).roll(a * 2);
    },
    speed: (t) => 1 - 0.1 * Math.sin(Math.PI * seg(t, 0, 2.3)),
    track: () => 1,
    thrust: () => 1,
    stick: (t, o) => { o[0] = 0; o[1] = hold(t, 0, 2.3); o[2] = 0; },
  },
};

export const MANEUVER_LIST: ManeuverDef[] = Object.values(MANEUVERS);
