/**
 * ALL the flight-feel knobs live here (plus difficulty.ts and each aircraft's `flight` block).
 * Units: metres, seconds, radians unless noted.
 */
export const FLIGHT = {
  fixedDt: 1 / 60,
  maxSubSteps: 5,

  // --- atmosphere ---------------------------------------------------------------------
  /** Air density falls off as exp(-alt / scale). Lower => thinner air up high. */
  densityScaleHeight: 9500,
  /** Density never drops below this fraction of sea level (keeps high altitude flyable). */
  densityFloor: 0.45,
  /** Thrust falls with density^this (<1: engines lose thrust slower than wings lose lift). */
  thrustDensityExp: 0.7,

  // --- control response (higher = snappier) ---------------------------------------------
  pitchResponse: 9,
  rollResponse: 11,
  yawResponse: 5,
  /** Negative-G pushing is weaker than pulling. */
  negGLimit: 7,
  negPitchFraction: 0.85,

  // --- control authority vs airspeed (multiples of stall speed) --------------------------
  authorityMin: 0.22,
  authorityStart: 0.4,
  authorityFull: 1.5,

  // --- rudder (the keyboard pedals: A / D) -------------------------------------------------------------
  /** rad/s of direct heading change at full pedal (on top of the difficulty's flat turn) and the extra yaw-rate gain. */
  rudderTurn: 0.42,
  rudderYawBoost: 0.9,

  // --- stability ("weathervane": nose wants to line up with the velocity vector) ---------
  stabilityPitch: 1.5,
  stabilityYaw: 1.8,

  // --- stall -------------------------------------------------------------------------
  /** Nose-drop rate (rad/s) at full stall. Soft: it never spins, it just falls through. */
  stallBreakRate: 0.9,
  stallBand: 0.3, // stall level ramps from 0 at stall speed to 1 at stall speed * (1 - band)

  // --- drag ----------------------------------------------------------------------------
  /** Induced drag at max lift, as a multiple of parasitic drag. Bleeds energy in hard turns. */
  inducedDrag: 5,
  /** Gear (and the landing flaps that go with it) down: a landing configuration that can actually be flown slow. */
  gearDrag: 2.2,
  airbrakeDrag: 4.2,

  // --- engine ---------------------------------------------------------------------------
  /** Fraction of military thrust at a closed throttle (low, so a jet can bleed speed on a descent). */
  idleThrust: 0.03,
  spoolUp: 1.6, // throttle fraction per second (a closed throttle to full power in well under a second)
  spoolDown: 1.2,
  abSpool: 3.2,
  /** Multiplies every aircraft's thrust-to-weight (top speed is unchanged: parasitic drag is rebalanced to match). */
  thrustScale: 1.7,
  /**
   * Parasitic drag at top speed as a share of full afterburner thrust. Thrust fades toward that share as speed approaches the
   * top speed (power 8), so the jet keeps pulling hard until it is close to its limit instead of creeping up to it.
   */
  parasiticShare: 0.4,
  thrustFadePower: 8,
  throttleRate: 0.45, // player throttle change per second while a key is held
  throttleWheelStep: 0.05,
  gearTime: 2.2,

  // --- ground ---------------------------------------------------------------------------
  rollingFriction: 0.06,
  /** Carrier catapult: acceleration (m/s^2) and the speed (m/s) at which the shuttle lets go. */
  catapultAccel: 46,
  catapultSpeed: 122,
  /** Throttle closed on the ground: engine drag and light brake drag, in g, so a rollout always ends inside a runway. */
  idleRollFriction: 0.3,
  brakeFriction: 1.6,
  groundSteer: 0.85, // rad/s of nosewheel steering
  /** Touchdown severity (1 = the limits of the difficulty) up to which a landing on a runway is still "good" and breaks nothing. */
  firmLanding: 1.3,
  maxRotatePitch: 15 * Math.PI / 180,
  runwayMargin: 24, // extra metres beyond the painted runway that still count as "on the runway"
  apronMargin: 70,
};

export const CAMERA = {
  chase: {
    followLambda: 7.5, // how fast the camera swings behind the nose
    rollFollow: 0.35, // 0 = horizon locked, 1 = rolls with the plane
    rollLambda: 4,
    lead: 55,
    fovKick: 9, // degrees added at top speed
    abFov: 3,
    lookReturn: 6,
    lookYawMax: 2.6,
    lookPitchMax: 1.1,
    lookSens: 0.0032,
  },
  cockpit: { near: 0.35 },
  near: 1.5,
  far: 42000,
  shakeDecay: 3.2,
};

export const AIM = {
  /** Mouse counts -> radians for the mouse-aim reticle (before the sensitivity setting). */
  radiansPerCount: 0.0021,
  /** Max angular separation between the nose and the aim point. Keeps the reticle on screen. */
  maxOffset: 40 * Math.PI / 180,
  /** Proportional gains: error (rad) at which the control saturates. */
  pitchFullError: 0.28,
  rollFullError: 0.9,
  yawFullError: 0.4,
  /** Multiplier on the 1G trim angle of attack fed forward into the pitch loop (>1 also cancels weathervane sag). */
  trimGain: 1.6,
  /** ...but never more than this (rad), so slow-speed rotation does not over-pitch. */
  trimMax: 8 * Math.PI / 180,
  /** Scale on the roll command produced by the aim controller (keyboard roll is not affected). */
  rollScale: 0.7,
  /** Bank allowed for a correction of th radians: maxBank * clamp((th / bankRef)^bankExp, bankMin, 1). */
  bankRef: 0.6,
  bankExp: 0.8,
  bankMin: 0.14,
  /** rad/s: how fast the remembered "big error" fades after a large turn starts to close. */
  errDecay: 0.45,
  /** How much of the rudder is given up once the controller starts rolling (0 = keep all). */
  yawSuppress: 0.2,
  rollEngageMin: 0.035,
  rollEngageMax: 0.22,
  yawWeight: 1,
  /** Below this angle the aim may "push" (negative G) instead of rolling inverted. */
  pushLimit: 0.42,
  pushRelease: 0.58,
};

export const TERRAIN_ASSIST = {
  warnTime: 5.5,
  autoTime: 2.6,
  margin: 45,
  /** G we assume the recovery pull-up can sustain. */
  recoverG: 6.5,
  recoverPitch: 22 * Math.PI / 180,
  /** Reticle elevation handed back to the pilot when the recovery ends. */
  exitPitch: 5 * Math.PI / 180,
};

export const WORLD_BOUNDARY = {
  countdown: 30,
};
