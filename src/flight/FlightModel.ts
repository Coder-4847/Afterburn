import { Matrix4, Quaternion, Vector3 } from 'three';
import type { AircraftDef } from '../aircraft/AircraftDef';
import type { DifficultyDef } from '../data/difficulty';
import { FLIGHT } from '../data/tuning';
import { DEG, G0, clamp, damp, lerp, moveToward, smoothstep } from '../core/math';

/** What the pilot (human or AI) asks for. Axes are -1..1; throttle 0..1. */
export interface FlightInput {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  afterburner: boolean;
  airbrake: boolean;
  gearDown: boolean;
}

export function makeFlightInput(): FlightInput {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, afterburner: false, airbrake: false, gearDown: false };
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
}

export interface SurfaceInfo {
  /** Collision height: max(terrain, sea level). */
  height: number;
  onRunway: boolean;
  onApron: boolean;
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

  mods: FlightMods = { thrust: 1, lift: 1, drag: 1, pitch: 1, roll: 1, yaw: 1, rollDrift: 0 };

  constructor(public def: AircraftDef, public difficulty: DifficultyDef) {}

  reset(pos: Vector3, headingRad: number, speed: number, gearDown: boolean, throttle = 0.75): void {
    this.pos.copy(pos);
    this.quat.setFromAxisAngle(new Vector3(0, 1, 0), -headingRad);
    _fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.vel.copy(_fwd).multiplyScalar(speed);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.pitchRate = this.rollRate = this.yawRate = 0;
    this.power = throttle;
    this.abLevel = 0;
    this.gearPos = gearDown ? 1 : 0;
    this.grounded = false;
    this.crashed = null;
    this.gLoad = 1;
    this.mods = { thrust: 1, lift: 1, drag: 1, pitch: 1, roll: 1, yaw: 1, rollDrift: 0 };
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
    if (this.crashed) return;

    const f = this.def.flight;
    const diff = this.difficulty;
    const mods = this.mods;

    // ---- engine, gear -------------------------------------------------------------------
    const thrTarget = c.afterburner ? 1 : c.throttle;
    this.power = moveToward(this.power, thrTarget, (thrTarget > this.power ? FLIGHT.spoolUp : FLIGHT.spoolDown) * dt);
    this.abLevel = moveToward(this.abLevel, c.afterburner && this.power > 0.9 ? 1 : 0, FLIGHT.abSpool * dt);
    this.gearPos = moveToward(this.gearPos, c.gearDown ? 1 : 0, dt / FLIGHT.gearTime);

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

    // ---- forces (all as accelerations, m/s^2) ----------------------------------------------
    const q2 = speed * speed;
    const clA = liftCurve(this.aoa, aStall);
    const liftBase = (G0 / (f.stallSpeed * f.stallSpeed)) * rho * diff.liftMul * mods.lift;
    const liftAcc = liftBase * q2 * clA;
    _lift.copy(_up).addScaledVector(_vhat, -_up.dot(_vhat));
    const ll = _lift.length();
    if (ll > 1e-3) _lift.multiplyScalar(1 / ll);
    else _lift.copy(_up);

    const sideAcc = -liftBase * 0.6 * q2 * liftCurve(this.beta, aStall);
    _side.copy(_right).addScaledVector(_vhat, -_right.dot(_vhat)).normalize();

    // parasitic drag is derived so that max thrust balances drag at maxSpeed (sea level)
    const k0 = (f.twAb * G0) / (f.maxSpeed * f.maxSpeed);
    const dragFactor =
      1 + FLIGHT.inducedDrag * clA * clA + 4 * this.beta * this.beta + FLIGHT.gearDrag * this.gearPos + (c.airbrake ? FLIGHT.airbrakeDrag : 0);
    const dragAcc = k0 * rho * q2 * dragFactor * mods.drag;

    const tw = lerp(f.twMil * (FLIGHT.idleThrust + (1 - FLIGHT.idleThrust) * this.power), f.twAb, this.abLevel);
    const thrustAcc = G0 * tw * Math.pow(rho, FLIGHT.thrustDensityExp) * mods.thrust;

    _acc.set(0, 0, 0).addScaledVector(_fwd, thrustAcc).addScaledVector(_lift, liftAcc).addScaledVector(_side, sideAcc).addScaledVector(_vhat, -dragAcc);
    // load factor along the pilot's "up" (specific force: gravity excluded)
    const gInst = _acc.dot(_up) / G0;
    this.gLoad += (gInst - this.gLoad) * Math.min(1, dt * 8);
    _acc.y -= G0;

    this.vel.addScaledVector(_acc, dt);
    this.pos.addScaledVector(this.vel, dt);

    // ---- rotation -------------------------------------------------------------------
    // authority grows with airspeed; pitch rate is also capped by the G limit at high speed
    const auth = lerp(FLIGHT.authorityMin, 1, smoothstep(vs * FLIGHT.authorityStart, vs * FLIGHT.authorityFull, speed));
    const gAvail = f.gLimit * diff.gMul;
    const vref = Math.max(speed, 50);
    const pitchPos = Math.min(f.pitchRate, (gAvail * G0) / vref);
    const pitchNeg = Math.min(f.pitchRate * FLIGHT.negPitchFraction, (FLIGHT.negGLimit * G0) / vref);
    let pTarget = c.pitch >= 0 ? c.pitch * pitchPos : c.pitch * pitchNeg;

    // angle-of-attack limiter: fades out pitch commands that would drive AoA past stall
    const aLim = c.pitch >= 0 ? aStall : aStall * 0.7;
    if (c.pitch * this.aoa > 0) {
      pTarget *= 1 - diff.aoaLimiter * smoothstep(0.7 * aLim, aLim, Math.abs(this.aoa));
    }
    // on the ground the nose only rotates once there is enough airspeed
    const groundPitchGate = this.grounded ? smoothstep(vs * 0.6, vs * 1.0, speed) : 1;
    this.pitchRate = damp(this.pitchRate, pTarget * auth * mods.pitch * (c.pitch > 0 ? groundPitchGate : 1), FLIGHT.pitchResponse, dt);
    this.rollRate = damp(this.rollRate, c.roll * f.rollRate * auth * mods.roll + mods.rollDrift, FLIGHT.rollResponse, dt);
    this.yawRate = damp(this.yawRate, c.yaw * f.yawRate * auth * mods.yaw, FLIGHT.yawResponse, dt);

    // weathervane stability: with the stick centred the nose drifts toward the velocity vector
    const stabSpeed = 0.25 + 0.75 * smoothstep(0, vs * 1.5, speed);
    const wPitch = this.pitchRate - FLIGHT.stabilityPitch * clamp(this.aoa, -0.6, 0.6) * stabSpeed * (1 - Math.min(1, Math.abs(c.pitch)));
    const wYaw = this.yawRate + FLIGHT.stabilityYaw * clamp(this.beta, -0.6, 0.6) * stabSpeed * (1 - Math.min(1, Math.abs(c.yaw)));

    _w.set(wPitch, -wYaw, -this.rollRate);

    // soft stall: below stall speed (or far past stall AoA) the nose falls through toward the
    // velocity / the ground. World-aware so it also works when inverted or hanging nose-up.
    let stall = clamp((vs - speed) / (vs * FLIGHT.stallBand), 0, 1);
    const aoaExcess = clamp((Math.abs(this.aoa) - aStall * 1.05) / (aStall * 0.4), 0, 1) * 0.6;
    stall = Math.max(stall, aoaExcess);
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

  /** Ground contact: landing, rolling, takeoff, and crashing into things. */
  private collide(dt: number, c: FlightInput, env: FlightEnv): void {
    const f = this.def.flight;
    const diff = this.difficulty;
    const s = env.surfaceAt(this.pos.x, this.pos.z, _surf);
    this.agl = this.pos.y - s.height;
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
        const gearOk = this.gearPos > 0.85;
        if (!(gearOk && s.onRunway)) {
          this.crashed = !gearOk && s.onRunway ? 'Gear up' : s.height <= 0.01 ? 'Water' : 'Terrain';
          return;
        }
        if (sink > lim.sink || Math.abs(roll) > lim.roll || this.speed > lim.speed || pitch < lim.pitchMin || pitch > lim.pitchMax) {
          this.crashed = 'Hard landing';
          return;
        }
        this.grounded = true;
        this.touchdown = true;
      } else if (!s.onRunway && !s.onApron && this.speed > 22) {
        this.crashed = 'Off runway';
        return;
      }
      this.pos.y = s.height + gearH;
      if (this.vel.y < 0) this.vel.y = 0;
      this.constrainToGround(dt, c);
    } else {
      if (clearance > 0.4) this.grounded = false;
      // wing tips and nose can hit mountains too
      this.forward(_fwd);
      this.rightVec(_right);
      const margin = 0.6;
      for (let i = 0; i < 3; i++) {
        if (i === 0) _pt.copy(this.pos).addScaledVector(_fwd, this.def.model.length * 0.45);
        else _pt.copy(this.pos).addScaledVector(_right, i === 1 ? this.def.model.wing.span * 0.5 : -this.def.model.wing.span * 0.5);
        const h = env.surfaceAt(_pt.x, _pt.z, _surf).height;
        if (_pt.y < h + margin) {
          this.crashed = h <= 0.01 ? 'Water' : 'Terrain';
          return;
        }
      }
      if (this.grounded) this.constrainToGround(dt, c);
    }
  }

  /** While rolling: keep wings level, limit pitch, steer with the nosewheel, apply friction. */
  private constrainToGround(dt: number, c: FlightInput): void {
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
    const decel = (c.airbrake ? FLIGHT.brakeFriction : FLIGHT.rollingFriction) * G0;
    vs = Math.max(0, vs - decel * dt);
    this.vel.x = fx * vs;
    this.vel.z = fz * vs;
  }
}
