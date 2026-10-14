import { Matrix4, Quaternion, Vector3 } from 'three';
import type { AircraftDef } from '../aircraft/AircraftDef';
import type { DifficultyDef } from '../data/difficulty';
import { FLIGHT } from '../data/tuning';
import { DEG, G0, clamp, damp, lerp, moveToward, smoothstep } from '../core/math';
import { Pose, aglNeeded, type ManeuverDef } from './Maneuvers';

/** What the pilot (human or AI) asks for. Axes are -1..1; throttle 0..1. */
export interface FlightInput {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  afterburner: boolean;
  airbrake: boolean;
  gearDown: boolean;
  /** Pedals (keyboard rudder), -1..1: a stronger, direct yaw on top of `yaw`. */
  rudder: number;
}

export function makeFlightInput(): FlightInput {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, afterburner: false, airbrake: false, gearDown: false, rudder: 0 };
}

/** Multipliers the damage model (Phase 3) will drive. 1 = healthy. */
export interface FlightMods {
  thrust: number;
  lift: number;
  drag: number;
  pitch: number;
  roll: number;
  yaw: number;
  /** Constant roll rate added (rad/s), e.g. a missing wing. */
  rollDrift: number;
  /** Random body-rate noise (rad/s) from a damaged tail. */
  wobble: number;
  /** Multiplier on the G limit (damaged wings). */
  gLimit: number;
  /** Landing gear destroyed: it cannot be lowered. */
  gearBroken: boolean;
}

export interface SurfaceInfo {
  /** Collision height: max(terrain, sea level). */
  height: number;
  onRunway: boolean;
  onApron: boolean;
  /** On a carrier's flight deck (which team owns it), else unset. */
  onDeck?: boolean;
  deckTeam?: 'blue' | 'red';
}

export interface FlightEnv {
  surfaceAt(x: number, z: number, out: SurfaceInfo): SurfaceInfo;
}

// scratch objects (the flight model runs for every aircraft, every tick: no allocations)
const _fwd = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _vhat = new Vector3();
const _vb = new Vector3();
const _lift = new Vector3();
const _side = new Vector3();
const _acc = new Vector3();
const _w = new Vector3();
const _ws = new Vector3();
const _axis = new Vector3();
const _tgt = new Vector3();
const _pt = new Vector3();
const _qi = new Quaternion();
const _dq = new Quaternion();
const _m = new Matrix4();
const _surf: SurfaceInfo = { height: 0, onRunway: false, onApron: false };
const DOWN = new Vector3(0, -1, 0);
const _pose = new Pose();
const _qn = new Quaternion();
const _qp = new Quaternion();
const _qd = new Quaternion();
const _qo = new Quaternion();
const _qt = new Quaternion();
const _stick = [0, 0, 0];
const _vold = new Vector3();
const ease01 = (x: number): number => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
const WORLD_UP = new Vector3(0, 1, 0);

/** Why a signature move could not start (null = it started). */
export type ManeuverRefusal = 'busy' | 'ground' | 'cooldown' | 'slow' | 'fast' | 'low' | 'damaged';

/**
 * Normalised lift curve: 1.0 at the stall angle, linear below it, a soft drop-off (not a cliff) above.
 * Signed. Beyond ~70 degrees (tail slides) lift fades out entirely.
 */
function liftCurve(a: number, aStall: number): number {
  const s = Math.sign(a);
  a = Math.abs(a);
  let c: number;
  if (a <= aStall) c = a / aStall;
  else c = 1 - 0.5 * smoothstep(aStall, aStall * 1.9, a);
  if (a > 1.2) c *= clamp(1 - (a - 1.2) / 0.8, 0, 1);
  return s * c;
}

export class FlightModel {
  pos = new Vector3();
  vel = new Vector3();
  quat = new Quaternion();
  prevPos = new Vector3();
  prevQuat = new Quaternion();

  // smoothed body rates the controls drive (rad/s)
  pitchRate = 0;
  rollRate = 0;
  yawRate = 0;

  power = 0.7; // engine spool 0..1
  abLevel = 0; // afterburner 0..1
  gearPos = 0; // 0 up .. 1 down

  grounded = false;
  /** Non-null once the aircraft has hit something; the string is the reason shown to the pilot. */
  crashed: string | null = null;
  /** Set for one tick when a good touchdown happens. */
  touchdown = false;
  /** Dead aircraft: no controls, no thrust, tumbling toward the ground. */
  wreck = false;
  wreckSpin = new Vector3();
  private wobT = 0;

  // derived state for HUD / camera / AI
  speed = 0;
  aoa = 0;
  beta = 0;
  gLoad = 1;
  density = 1;
  stallLevel = 0;
  /** Effective 1G stall speed at the current altitude. */
  stallSpeedNow = 0;
  agl = 0;
  /** AoA (rad) needed to hold 1G right now; the mouse-aim controller uses it as a feed-forward. */
  trimAoa = 0;

  mods: FlightMods = { thrust: 1, lift: 1, drag: 1, pitch: 1, roll: 1, yaw: 1, rollDrift: 0, wobble: 0, gLimit: 1, gearBroken: false };
  /**
   * Set for one tick when the aircraft touched down hard or off a runway but survived: how bad (1 = at the limit of a
   * normal landing, up to ~2.2 before it is a crash), and whether it was a belly landing / on rough ground.
   */
  impact: { severity: number; belly: boolean; rough: boolean } | null = null;
  /** Grounded and sliding over rough ground (speed, else 0). */
  scrape = 0;
  /** Currently over a carrier deck. */
  onDeck = false;
  /** The catapult shuttle is pulling us. */
  catapult = false;
  /** True for one step when a catapult launch starts (the game plays the effects). */
  catapultStart = false;
  /** Seconds left of the automatic climb-out after a catapult launch (the game steers the nose up while it runs). */
  launchAssist = 0;
  /** The signature move being flown (the nose follows its script and the controls are ignored), or null. */
  maneuver: { def: ManeuverDef; t: number; q0: Quaternion; qL: Quaternion; qPrev: Quaternion; dir0: Vector3; v0: number } | null = null;
  /** Seconds until the next signature move may start. */
  maneuverCool = 0;
  /** True for one step when a move starts / ends (the game plays effects and re-centres the reticle). */
  maneuverStart = false;
  maneuverEnd = false;

  constructor(public def: AircraftDef, public difficulty: DifficultyDef) {}

  /** Why a signature move cannot be started right now (null = it can). */
  maneuverBlock(def: ManeuverDef): ManeuverRefusal | null {
    if (this.maneuver) return 'busy';
    if (this.crashed || this.wreck || this.grounded) return 'ground';
    if (this.maneuverCool > 0) return 'cooldown';
    if (this.speed < def.minSpeed) return 'slow';
    if (this.speed > def.maxSpeed) return 'fast';
    // height needed: the move's own sink, plus five seconds of any descent already under way (a dive eats the margin)
    if (this.agl - Math.max(0, -this.vel.y) * 5 < aglNeeded(def, this.speed)) return 'low';
    // a wing or the tail shot away: the airframe will not take it
    if (this.mods.lift < 0.72 || this.mods.pitch < 0.7 || this.mods.thrust < 0.35) return 'damaged';
    return null;
  }

  /** Try to begin a signature move. Returns why not, or null once it has started. */
  startManeuver(def: ManeuverDef): ManeuverRefusal | null {
    const why = this.maneuverBlock(def);
    if (why) return why;
    // the wings-level twin of the entry attitude (same nose direction), which pitch moves roll out onto
    this.forward(_fwd);
    const qL = this.quat.clone();
    if (def.level && Math.abs(_fwd.y) < 0.97) {
      _right.crossVectors(_fwd, WORLD_UP).normalize();
      _up.crossVectors(_right, _fwd);
      _tgt.copy(_fwd).negate();
      _m.makeBasis(_right, _up, _tgt);
      qL.setFromRotationMatrix(_m);
    }
    const dir0 = this.speed > 5 ? this.vel.clone().multiplyScalar(1 / this.speed) : _fwd.clone();
    this.maneuver = { def, t: 0, q0: this.quat.clone(), qL, qPrev: this.quat.clone(), dir0, v0: this.speed };
    this.maneuverStart = true;
    return null;
  }

  reset(pos: Vector3, headingRad: number, speed: number, gearDown: boolean, throttle = 0.75): void {
    this.pos.copy(pos);
    this.quat.setFromAxisAngle(new Vector3(0, 1, 0), -headingRad);
    _fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.vel.copy(_fwd).multiplyScalar(speed);
    this.speed = speed;
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.pitchRate = this.rollRate = this.yawRate = 0;
    this.power = throttle;
    this.abLevel = 0;
    this.gearPos = gearDown ? 1 : 0;
    this.grounded = false;
    this.crashed = null;
    this.gLoad = 1;
    this.mods = { thrust: 1, lift: 1, drag: 1, pitch: 1, roll: 1, yaw: 1, rollDrift: 0, wobble: 0, gLimit: 1, gearBroken: false };
    this.impact = null;
    this.scrape = 0;
    this.wreck = false;
    this.wobT = 0;
    this.catapult = false;
    this.catapultStart = false;
    this.launchAssist = 0;
    this.maneuver = null;
    this.maneuverCool = 0;
    this.maneuverStart = false;
    this.maneuverEnd = false;
  }

  forward(out: Vector3): Vector3 { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  upVec(out: Vector3): Vector3 { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  rightVec(out: Vector3): Vector3 { return out.set(1, 0, 0).applyQuaternion(this.quat); }

  /** Heading in radians, 0 = north (-Z), increasing clockwise (east = +X). */
  heading(): number {
    this.forward(_fwd);
    return Math.atan2(_fwd.x, -_fwd.z);
  }

  step(dt: number, c: FlightInput, env: FlightEnv): void {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.touchdown = false;
    this.impact = null;
    this.maneuverStart = false;
    this.maneuverEnd = false;
    if (this.crashed) {
      this.maneuver = null;
      return;
    }
    if (this.wreck) {
      this.maneuver = null;
      this.stepWreck(dt, env);
      return;
    }
    if (this.maneuverCool > 0) this.maneuverCool = Math.max(0, this.maneuverCool - dt);

    const f = this.def.flight;
    const diff = this.difficulty;
    const mods = this.mods;

    // ---- engine, gear -------------------------------------------------------------------
    const thrTarget = c.afterburner ? 1 : c.throttle;
    this.power = moveToward(this.power, thrTarget, (thrTarget > this.power ? FLIGHT.spoolUp : FLIGHT.spoolDown) * dt);
    this.abLevel = moveToward(this.abLevel, c.afterburner && this.power > 0.8 ? 1 : 0, FLIGHT.abSpool * dt);
    this.gearPos = moveToward(this.gearPos, c.gearDown && !mods.gearBroken ? 1 : 0, dt / FLIGHT.gearTime);

    // ---- frame ----------------------------------------------------------------------
    this.forward(_fwd);
    this.upVec(_up);
    this.rightVec(_right);
    const speed = this.vel.length();
    this.speed = speed;
    if (speed > 0.5) _vhat.copy(this.vel).multiplyScalar(1 / speed);
    else _vhat.copy(_fwd);

    const rho = Math.max(FLIGHT.densityFloor, Math.exp(-Math.max(this.pos.y, 0) / FLIGHT.densityScaleHeight));
    this.density = rho;
    const vs = f.stallSpeed / Math.sqrt(rho);
    this.stallSpeedNow = vs;

    // angle of attack / sideslip from the velocity in body axes
    _qi.copy(this.quat).invert();
    _vb.copy(this.vel).applyQuaternion(_qi);
    if (speed > 3) {
      this.aoa = Math.atan2(-_vb.y, -_vb.z);
      this.beta = Math.asin(clamp(_vb.x / speed, -1, 1));
    } else {
      this.aoa = 0;
      this.beta = 0;
    }
    const aStall = f.aoaStall * DEG;
    {
      const need = G0 / clamp(_up.y, 0.3, 1); // lift needed to hold altitude (more when banked)
      const perUnit = (G0 / (f.stallSpeed * f.stallSpeed)) * rho * diff.liftMul * mods.lift * Math.max(speed * speed, 400);
      this.trimAoa = Math.min(aStall * 0.8, aStall * (need / perUnit));
    }

    // a signature move replaces the control law for its duration
    if (this.maneuver) {
      this.stepManeuver(dt, c, env, speed);
      return;
    }

    // ---- forces (all as accelerations, m/s^2) ----------------------------------------------
    const q2 = speed * speed;
    const clA = liftCurve(this.aoa, aStall);
    // spoilers up on the rollout: with the throttle closed the wings stop lifting once the wheels are down (no ballooning)
    const dump = this.grounded && c.throttle < 0.3 && !c.afterburner ? 0.2 : 1;
    const liftBase = (G0 / (f.stallSpeed * f.stallSpeed)) * rho * diff.liftMul * mods.lift * dump;
    const liftAcc = liftBase * q2 * clA;
    _lift.copy(_up).addScaledVector(_vhat, -_up.dot(_vhat));
    const ll = _lift.length();
    if (ll > 1e-3) _lift.multiplyScalar(1 / ll);
    else _lift.copy(_up);

    const sideAcc = -liftBase * 0.6 * q2 * liftCurve(this.beta, aStall);
    _side.copy(_right).addScaledVector(_vhat, -_right.dot(_vhat)).normalize();

    // Parasitic drag is derived so that the (faded) afterburner thrust balances it at maxSpeed (sea level). It is only a share of
    // the thrust, which makes the other drags (induced, sideslip, gear, brake) divide by that share to keep their old size.
    const share = FLIGHT.parasiticShare;
    const scale = FLIGHT.thrustScale;
    const k0 = (f.twAb * scale * share * G0) / (f.maxSpeed * f.maxSpeed);
    const extra = FLIGHT.inducedDrag * f.energyBleed * clA * clA + 4 * this.beta * this.beta + FLIGHT.gearDrag * this.gearPos + (c.airbrake ? FLIGHT.airbrakeDrag : 0);
    const dragFactor = 1 + extra / (share * scale);
    const dragAcc = k0 * rho * q2 * dragFactor * mods.drag;

    // thrust holds up until the jet nears its top speed, then fades to the drag share
    const xv = Math.min(1.25, speed / f.maxSpeed);
    const fade = Math.max(0, 1 - (1 - share) * Math.pow(xv, FLIGHT.thrustFadePower));
    const tw = lerp(f.twMil * (FLIGHT.idleThrust + (1 - FLIGHT.idleThrust) * this.power), f.twAb, this.abLevel);
    const thrustAcc = G0 * tw * scale * fade * Math.pow(rho, FLIGHT.thrustDensityExp) * mods.thrust;

    _acc.set(0, 0, 0).addScaledVector(_fwd, thrustAcc).addScaledVector(_lift, liftAcc).addScaledVector(_side, sideAcc).addScaledVector(_vhat, -dragAcc);
    // carrier catapult: throttle to the stop on the deck and the shuttle takes over until launch speed, even if the throttle is
    // released. Once it lets go (or the bow is reached) the climb-out assist starts.
    this.catapultStart = false;
    if (this.launchAssist > 0) this.launchAssist = Math.max(0, this.launchAssist - dt);
    if (this.onDeck && this.grounded) {
      if (!this.catapult && c.throttle > 0.9 && speed < 25) {
        this.catapult = true;
        this.catapultStart = true;
      }
      if (this.catapult) {
        if (speed < FLIGHT.catapultSpeed) _acc.addScaledVector(_fwd, FLIGHT.catapultAccel);
        else {
          this.catapult = false;
          this.launchAssist = 3.4;
        }
      }
    } else if (this.catapult) {
      this.catapult = false;
      this.launchAssist = 3.4;
    }
    // load factor along the pilot's "up" (specific force: gravity excluded)
    const gInst = _acc.dot(_up) / G0;
    this.gLoad += (gInst - this.gLoad) * Math.min(1, dt * 8);
    _acc.y -= G0;

    this.vel.addScaledVector(_acc, dt);
    // rudder turns the flight path a little directly (a flat turn), so small corrections need no big bank
    if (diff.flatTurn > 0 && !this.grounded && Math.abs(c.yaw) > 0.01) {
      const flat = -c.yaw * diff.flatTurn * smoothstep(vs, vs * 1.8, speed) * mods.yaw * dt;
      _dq.setFromAxisAngle(_up, flat);
      this.vel.applyQuaternion(_dq);
    }
    // the pedals swing the flight path round directly: a firm rudder really does turn the jet
    if (c.rudder !== 0 && !this.grounded) {
      const turn = -c.rudder * FLIGHT.rudderTurn * smoothstep(vs, vs * 1.6, speed) * mods.yaw * dt;
      _dq.setFromAxisAngle(_up, turn);
      this.vel.applyQuaternion(_dq);
    }
    this.pos.addScaledVector(this.vel, dt);

    // ---- rotation -------------------------------------------------------------------
    // authority grows with airspeed; pitch rate is also capped by the G limit at high speed
    const tv = f.thrustVectoring;
    const auth = lerp(lerp(FLIGHT.authorityMin, 0.8, tv), 1, smoothstep(vs * FLIGHT.authorityStart, vs * FLIGHT.authorityFull, speed));
    const gAvail = f.gLimit * diff.gMul * mods.gLimit;
    const vref = Math.max(speed, 50);
    const pitchPos = Math.min(f.pitchRate, (gAvail * G0) / vref);
    const pitchNeg = Math.min(f.pitchRate * FLIGHT.negPitchFraction, (FLIGHT.negGLimit * G0) / vref);
    let pTarget = c.pitch >= 0 ? c.pitch * pitchPos : c.pitch * pitchNeg;

    // angle-of-attack limiter: fades out pitch commands that would drive AoA past stall
    const aLim = (c.pitch >= 0 ? aStall : aStall * 0.95) * (1 + 0.18 * tv) * diff.aoaHeadroom;
    if (c.pitch * this.aoa > 0) {
      pTarget *= 1 - diff.aoaLimiter * smoothstep(0.7 * aLim, aLim, Math.abs(this.aoa));
    }
    // on the ground the nose only rotates once there is enough airspeed
    const groundPitchGate = this.grounded ? smoothstep(vs * 0.6, vs * 1.0, speed) : 1;
    this.pitchRate = damp(this.pitchRate, pTarget * auth * mods.pitch * (c.pitch > 0 ? groundPitchGate : 1), FLIGHT.pitchResponse, dt);
    this.rollRate = damp(this.rollRate, c.roll * f.rollRate * auth * mods.roll + mods.rollDrift, FLIGHT.rollResponse, dt);
    this.yawRate = damp(this.yawRate, c.yaw * f.yawRate * (1 + FLIGHT.rudderYawBoost * Math.abs(c.rudder)) * auth * mods.yaw, FLIGHT.yawResponse, dt);

    // weathervane stability: with the stick centred the nose drifts toward the velocity vector
    const stabSpeed = 0.25 + 0.75 * smoothstep(0, vs * 1.5, speed);
    const wPitch = this.pitchRate - FLIGHT.stabilityPitch * clamp(this.aoa, -0.6, 0.6) * stabSpeed * (1 - Math.min(1, Math.abs(c.pitch)));
    const wYaw = this.yawRate + FLIGHT.stabilityYaw * clamp(this.beta, -0.6, 0.6) * stabSpeed * (1 - Math.min(1, Math.abs(c.yaw)));

    _w.set(wPitch, -wYaw, -this.rollRate);
    if (mods.wobble > 0) {
      this.wobT += dt;
      const wt = this.wobT;
      _w.x += mods.wobble * (Math.sin(wt * 4.1) + 0.6 * Math.sin(wt * 9.7));
      _w.y += mods.wobble * Math.sin(wt * 3.3 + 1);
      _w.z += mods.wobble * 0.8 * Math.sin(wt * 5.9 + 2);
    }

    // soft stall: below stall speed (or far past stall AoA) the nose falls through toward the
    // velocity / the ground. World-aware so it also works when inverted or hanging nose-up.
    let stall = clamp((vs - speed) / (vs * FLIGHT.stallBand), 0, 1);
    const aoaExcess = clamp((Math.abs(this.aoa) - aStall * 1.05) / (aStall * 0.4), 0, 1) * 0.6;
    stall = Math.max(stall, aoaExcess);
    stall *= 1 - 0.6 * tv; // vectored thrust keeps the nose controllable
    if (this.grounded) stall = 0;
    this.stallLevel = stall;
    if (stall > 0) {
      _tgt.copy(_vhat).lerp(DOWN, stall * 0.7).normalize();
      _axis.crossVectors(_fwd, _tgt);
      const s = _axis.length();
      if (s < 1e-4) _axis.copy(_right);
      else _axis.multiplyScalar(1 / s);
      _ws.copy(_axis).multiplyScalar(FLIGHT.stallBreakRate * stall * diff.stallRecovery * clamp(s * 4, 0.35, 1)).applyQuaternion(_qi);
      _w.add(_ws);
    }

    const wm = _w.length();
    if (wm > 1e-6) {
      _dq.setFromAxisAngle(_w.multiplyScalar(1 / wm), wm * dt);
      this.quat.multiply(_dq).normalize();
    }

    this.collide(dt, c, env);
  }

  /**
   * One tick of a signature move. The attitude and the speed come from the move's script, and the velocity direction
   * shares `track` of the nose's rotation (1 = a loop on rails, 0 = the nose swings, the flight path does not change).
   */
  private stepManeuver(dt: number, c: FlightInput, env: FlightEnv, speed: number): void {
    const m = this.maneuver!;
    const d = m.def;
    m.t += dt;
    const t = Math.min(m.t, d.duration);

    // engine as scripted
    const thr = d.thrust(t);
    const ab = thr > 0.9;
    this.power = moveToward(this.power, ab ? 1 : clamp(thr, 0.12, 0.9), (thr > this.power ? FLIGHT.spoolUp * 2 : FLIGHT.spoolDown * 2) * dt);
    this.abLevel = moveToward(this.abLevel, ab && this.power > 0.8 ? 1 : 0, FLIGHT.abSpool * dt);

    // attitude: the scripted pose (built on the entry attitude, rolled level for the pitch moves), optionally eased toward
    // "nose along the flight path, wings level" for the hand-back
    if (d.level) _qo.slerpQuaternions(m.q0, m.qL, ease01(t / 0.45));
    else _qo.copy(m.q0);
    _pose.start(_qo);
    d.pose(t, _pose);
    _qn.copy(_pose.q).normalize();
    if (_qn.dot(this.quat) < 0) { _qn.x = -_qn.x; _qn.y = -_qn.y; _qn.z = -_qn.z; _qn.w = -_qn.w; }

    // the velocity direction: an explicit flight-path curve, or the scripted pose's own rotation shared out by `track`.
    // (Taken from the pose before any hand-back easing, so the easing can never feed back into the flight path.)
    _vold.copy(this.vel);
    if (d.path) {
      _right.set(1, 0, 0).applyQuaternion(m.qL);
      _qt.setFromAxisAngle(_right, d.path(t));
      this.vel.copy(m.dir0).applyQuaternion(_qt);
    } else {
      _qd.copy(_qn).multiply(_qo.copy(m.qPrev).invert());
      if (_qd.w < 0) { _qd.x = -_qd.x; _qd.y = -_qd.y; _qd.z = -_qd.z; _qd.w = -_qd.w; }
      const track = d.track(t);
      if (track > 0) {
        _qt.set(0, 0, 0, 1).slerp(_qd, track);
        this.vel.applyQuaternion(_qt);
      }
    }
    m.qPrev.copy(_qn);
    this.vel.normalize();

    const al = d.align ? d.align(t) : 0;
    if (al > 0.001 && speed > 8) {
      _right.crossVectors(this.vel, WORLD_UP);
      if (_right.lengthSq() < 1e-4) this.rightVec(_right);
      _right.normalize();
      _up.crossVectors(_right, this.vel);
      _tgt.copy(this.vel).negate();
      _m.makeBasis(_right, _up, _tgt);
      _qp.setFromRotationMatrix(_m);
      if (_qp.dot(_qn) < 0) { _qp.x = -_qp.x; _qp.y = -_qp.y; _qp.z = -_qp.z; _qp.w = -_qp.w; }
      _qn.slerp(_qp, al).normalize();
    }
    this.quat.copy(_qn);

    // speed follows the script (a floor keeps a hang from ever reversing the jet); the engine only drives sound and flame
    this.forward(_fwd);
    const want = Math.max(m.v0 * d.speed(t), 26);
    this.vel.multiplyScalar(want);
    this.pos.addScaledVector(this.vel, dt);
    this.speed = want;

    // load factor from the real bend of the flight path (a hang or a nose swing at constant velocity pulls nothing)
    const bend = _vold.lengthSq() > 1 ? _vold.angleTo(this.vel) / Math.max(dt, 1e-4) : 0;
    this.gLoad += (clamp(1 + (want * bend) / G0, -4, 12) - this.gLoad) * Math.min(1, dt * 8);
    d.stick(t, _stick);
    c.pitch = _stick[0];
    c.roll = _stick[1];
    c.yaw = _stick[2];
    this.pitchRate = this.rollRate = this.yawRate = 0;
    this.stallLevel = 0;

    if (m.t >= d.duration) {
      this.maneuver = null;
      this.maneuverCool = d.cooldown;
      this.maneuverEnd = true;
    }
    this.collide(dt, c, env);
  }

  /** A dead aircraft: ballistic fall with a lazy tumble until it hits something. */
  private stepWreck(dt: number, env: FlightEnv): void {
    const sp = this.vel.length();
    this.vel.y -= G0 * dt;
    if (sp > 1) this.vel.addScaledVector(this.vel, -(0.00004 * sp) * dt);
    this.pos.addScaledVector(this.vel, dt);
    const w = this.wreckSpin.length();
    if (w > 1e-5) {
      _dq.setFromAxisAngle(_axis.copy(this.wreckSpin).multiplyScalar(1 / w), w * dt);
      this.quat.multiply(_dq).normalize();
    }
    const s = env.surfaceAt(this.pos.x, this.pos.z, _surf);
    this.agl = this.pos.y - s.height;
    if (this.pos.y < s.height + 1) {
      this.pos.y = s.height + 1;
      this.crashed = s.height <= 0.01 ? 'Water' : 'Terrain';
    }
  }

  /** Ground contact: landing, rolling, takeoff, and crashing into things. */
  private collide(dt: number, c: FlightInput, env: FlightEnv): void {
    const f = this.def.flight;
    const diff = this.difficulty;
    const s = env.surfaceAt(this.pos.x, this.pos.z, _surf);
    this.agl = this.pos.y - s.height;
    this.onDeck = !!s.onDeck;
    // gear destroyed while rolling: it collapses at once and the aircraft settles onto its belly
    if (this.grounded && this.mods.gearBroken && this.gearPos > 0) {
      this.pos.y -= lerp(f.bellyHeight, f.gearHeight, this.gearPos) - f.bellyHeight;
      this.gearPos = 0;
    }
    const gearH = lerp(f.bellyHeight, f.gearHeight, this.gearPos);
    const clearance = this.pos.y - s.height - gearH;

    if (clearance <= 0) {
      if (!this.grounded) {
        // ---- first contact: is it a landing or a crash? ----
        this.forward(_fwd);
        this.upVec(_up);
        const pitch = Math.asin(clamp(_fwd.y, -1, 1));
        const roll = Math.atan2(-this.rightVec(_right).y, _up.y);
        const sink = -this.vel.y;
        const lim = diff.landing;
        // wheels count as down once they are most of the way (or still travelling down on a command to lower them): a gear
        // that is a moment short of locked must not turn a good touchdown into a belly landing
        const gearDown = !this.mods.gearBroken && (this.gearPos > 0.6 || (c.gearDown && this.gearPos > 0.3));
        const smooth = s.onRunway || s.onApron;
        if (s.height <= 0.01 && this.speed > 25) {
          this.crashed = 'Water';
          return;
        }
        // how far past the limits of a clean landing? 1 = exactly at them. Landings up to ~2.2 are survivable (with damage):
        // that is a crash landing. Beyond that the aircraft is lost.
        let sev = Math.max(sink / lim.sink, Math.abs(roll) / lim.roll, this.speed / lim.speed);
        if (pitch < lim.pitchMin) sev = Math.max(sev, 1 + (lim.pitchMin - pitch) / 0.28);
        if (pitch > lim.pitchMax) sev = Math.max(sev, 1 + (pitch - lim.pitchMax) / 0.3);
        if (!gearDown) sev = Math.max(sev * 1.25, 0.9);
        if (!smooth) sev *= 1.35;
        if (s.height <= 0.01) sev *= 2;
        if (sev > 2.4) {
          this.crashed = s.height <= 0.01 ? 'Water' : !gearDown ? 'Crash landing' : smooth ? 'Hard landing' : 'Terrain';
          return;
        }
        this.grounded = true;
        // up to a quarter over the nominal limits is still a good (if firm) landing: nothing breaks
        if (sev <= FLIGHT.firmLanding && gearDown && smooth) this.touchdown = true;
        else this.impact = { severity: sev, belly: !gearDown, rough: !smooth };
      }
      this.pos.y = s.height + gearH;
      if (this.vel.y < 0) this.vel.y = 0;
      this.constrainToGround(dt, c, s.onRunway || s.onApron);
    } else {
      if (clearance > 0.4) this.grounded = false;
      // wing tips and nose can hit mountains too
      this.forward(_fwd);
      this.rightVec(_right);
      const margin = 0.6;
      // a slow slide that meets a slope just stops; only a fast one is a crash
      for (let i = 0; i < 3 && !(this.grounded && this.speed < 45); i++) {
        if (i === 0) _pt.copy(this.pos).addScaledVector(_fwd, this.def.model.length * 0.45);
        else _pt.copy(this.pos).addScaledVector(_right, i === 1 ? this.def.model.wing.span * 0.5 : -this.def.model.wing.span * 0.5);
        const h = env.surfaceAt(_pt.x, _pt.z, _surf).height;
        if (_pt.y < h + margin) {
          this.crashed = h <= 0.01 ? 'Water' : 'Terrain';
          return;
        }
      }
      if (this.grounded) this.constrainToGround(dt, c, s.onRunway || s.onApron);
    }
  }

  /** While rolling: keep wings level, limit pitch, steer with the nosewheel, apply friction. */
  private constrainToGround(dt: number, c: FlightInput, smooth: boolean): void {
    const diff = this.difficulty;
    this.forward(_fwd);
    let fx = _fwd.x;
    let fz = _fwd.z;
    const hl = Math.hypot(fx, fz) || 1;
    fx /= hl;
    fz /= hl;
    // nosewheel steering
    const steer = -c.yaw * FLIGHT.groundSteer * clamp(this.speed / 14, 0, 1) * dt;
    const cs = Math.cos(steer);
    const sn = Math.sin(steer);
    const nx = fx * cs - fz * sn;
    const nz = fx * sn + fz * cs;
    fx = nx;
    fz = nz;
    const pitch = clamp(Math.asin(clamp(_fwd.y, -1, 1)), 0, FLIGHT.maxRotatePitch);
    const cp = Math.cos(pitch);
    _fwd.set(fx * cp, Math.sin(pitch), fz * cp);
    _up.set(0, 1, 0).addScaledVector(_fwd, -_fwd.y).normalize();
    _right.crossVectors(_fwd, _up).normalize();
    _tgt.copy(_fwd).negate();
    _m.makeBasis(_right, _up, _tgt);
    this.quat.setFromRotationMatrix(_m);

    // velocity follows the wheels; friction
    let vs = this.vel.x * fx + this.vel.z * fz;
    // wheel brakes: B, or automatically (Arcade) once the throttle is closed on a runway
    const braking = c.airbrake || (smooth && diff.id === 'arcade' && c.throttle < 0.08 && !c.afterburner);
    const gearDown = this.gearPos > 0.85;
    // rough ground slows an aircraft hard, a belly slide harder still
    // a carrier deck: the arrestor wire catches us (no brake key needed)
    const decel = this.onDeck && !this.catapult && c.throttle < 0.5 ? 3.2 * G0 : (smooth ? Math.max(braking ? FLIGHT.brakeFriction * (diff.id === 'arcade' ? 1.2 : 1) : c.throttle < 0.08 && !c.afterburner ? FLIGHT.idleRollFriction : FLIGHT.rollingFriction, gearDown ? 0 : 0.55) : gearDown ? (braking ? 0.75 : 0.55) : 0.8) * G0;
    this.scrape = smooth ? 0 : this.speed;
    vs = Math.max(0, vs - decel * dt);
    this.vel.x = fx * vs;
    this.vel.z = fz * vs;
  }
}
