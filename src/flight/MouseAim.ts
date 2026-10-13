import { Quaternion, Vector3 } from 'three';
import type { FlightModel } from './FlightModel';
import type { DifficultyDef } from '../data/difficulty';
import { AIM } from '../data/tuning';
import { clamp, smoothstep } from '../core/math';

const _a = new Vector3();
const _qi = new Quaternion();
const _fwd = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _ax = new Vector3();
const _x = new Vector3(1, 0, 0);

export interface AimCommand {
  pitch: number;
  roll: number;
  yaw: number;
}

/**
 * Mouse-aim flight ("Ace Combat" style).
 * The mouse moves a world-space reticle direction; the aircraft rolls and pulls to bring the nose onto it.
 * Because the reticle rotates about the *camera's* axes, loops and rolls through the vertical work naturally.
 */
export class MouseAim {
  /** World-space unit vector the pilot is aiming at. */
  aim = new Vector3(0, 0, -1);
  private pushMode = false;
  /** The biggest recent aim error (rad): the bank allowance falls off slowly behind it, so a turn is finished at speed. */
  private errPeak = 0;
  /** Which way to turn when the aim point is directly behind us (kept between frames so it never flip-flops). */
  private turnSide = 1;

  /** Reset to the aircraft's nose (spawn, respawn, assist hand-off). */
  snapTo(fm: FlightModel): void {
    fm.forward(this.aim);
  }

  /** Rotate the aim about the camera's up/right axes by a mouse delta, then keep it within range of the nose. */
  addMouse(dx: number, dy: number, camRight: Vector3, camUp: Vector3, sens: number, invertY: boolean, sensY = 1): void {
    const k = AIM.radiansPerCount * sens;
    if (dx !== 0) this.aim.applyAxisAngle(camUp, -dx * k);
    if (dy !== 0) this.aim.applyAxisAngle(camRight, -dy * k * sensY * (invertY ? -1 : 1));
    this.aim.normalize();
  }

  /** Keep the reticle within AIM.maxOffset of the nose (dragging it along if the plane can't keep up). */
  clampToNose(fm: FlightModel): void {
    fm.forward(_fwd);
    const ang = Math.acos(clamp(_fwd.dot(this.aim), -1, 1));
    if (ang > AIM.maxOffset) {
      _ax.crossVectors(_fwd, this.aim);
      if (_ax.lengthSq() < 1e-8) return;
      _ax.normalize();
      this.aim.copy(_fwd).applyAxisAngle(_ax, AIM.maxOffset);
    }
  }

  /** Smoothly bring the aim back to the nose (used when manual keys take over). */
  relaxToNose(fm: FlightModel, amount: number): void {
    fm.forward(_fwd);
    this.aim.lerp(_fwd, amount).normalize();
  }

  /** Compute pitch/roll/yaw commands (-1..1) from the aim error. */
  compute(fm: FlightModel, diff: DifficultyDef, out: AimCommand): AimCommand {
    // aim direction in the aircraft's own axes: x right, y up, -z forward
    _a.copy(this.aim).applyQuaternion(_qi.copy(fm.quat).invert());
    // feed-forward: hold the nose a little above the aim so the *flight path* ends up on it
    _a.applyAxisAngle(_x, Math.min(fm.trimAoa * AIM.trimGain, AIM.trimMax));
    // an aim point behind us: turn level toward whichever side it is on, instead of pulling up and over the top
    if (_a.z > 0.15) {
      if (Math.abs(_a.x) > 0.05) this.turnSide = Math.sign(_a.x);
      if (!(_a.y > 0.45 && _a.y > Math.abs(_a.x) * 1.4)) {
        _a.set(this.turnSide * 0.93, clamp(_a.y, -0.25, 0.25), -0.25).normalize();
      }
    }
    const th = Math.acos(clamp(-_a.z, -1, 1)); // total angle between nose and aim
    const behind = _a.z > 0;

    // choose between "push" (aim slightly below: just unload) and "roll then pull"
    const below = _a.y < 0;
    if (!below) this.pushMode = false;
    else if (!this.pushMode && th < AIM.pushLimit && !behind) this.pushMode = true;
    else if (this.pushMode && th > AIM.pushRelease) this.pushMode = false;
    const push = below && this.pushMode;

    const rollE = push ? Math.atan2(_a.x, -_a.y) : Math.atan2(_a.x, _a.y);
    const w = smoothstep(AIM.rollEngageMin, AIM.rollEngageMax, th);
    let roll = clamp(rollE / AIM.rollFullError, -1, 1) * w;

    const mag = clamp(th / AIM.pitchFullError, 0, 1);
    let pitch = mag * Math.max(0, Math.cos(rollE));
    if (push) pitch = -pitch;
    if (behind) pitch = 1 * Math.max(0, Math.cos(rollE)); // aim fell behind: just pull

    // rudder takes care of small lateral errors without banking
    const yawE = Math.atan2(_a.x, -_a.z);
    let yaw = clamp(yawE / AIM.yawFullError, -1, 1) * (1 - w * AIM.yawSuppress) * AIM.yawWeight;
    if (behind) yaw = 0;

    fm.forward(_fwd);
    fm.upVec(_up);
    fm.rightVec(_right);
    const bank = Math.atan2(-_right.y, _up.y); // + = right wing down

    // a small correction must not snap the jet onto its side: allow only as much bank as the angle to the aim point earns
    // (see AIM.bankBase / bankGain: a small correction banks less than a big one, up to the difficulty limit)
    this.errPeak = Math.max(th, this.errPeak - AIM.errDecay * (1 / 60));
    const maxBank = diff.maxBank * clamp(Math.pow(Math.max(th, this.errPeak * 0.85) / AIM.bankRef, AIM.bankExp), AIM.bankMin, 1);
    // bank limit: in a level-ish turn, stop rolling past the limit (otherwise lift cannot also hold the weight up)
    const aimElev = Math.asin(clamp(this.aim.y, -1, 1));
    const noseElev = Math.asin(clamp(_fwd.y, -1, 1));
    // 'bank' and 'elevation' stop meaning anything near vertical, so the whole limiter fades out there
    const levelish = 1 - smoothstep(0.45, 0.85, Math.abs(noseElev));
    if (aimElev < 0.6 && aimElev > -0.45 && roll * bank > 0) {
      roll *= 1 - smoothstep(maxBank - 0.14, maxBank, Math.abs(bank)) * levelish;
    }
    if (aimElev < 0.6 && aimElev > -0.45) {
      if (Math.abs(bank) > maxBank) roll -= Math.sign(bank) * clamp((Math.abs(bank) - maxBank) / 0.25, 0, 1) * 0.8 * levelish;
      // while banked near the limit, the pull would otherwise just climb: regulate the nose *elevation* toward the reticle's
      const nearLimit = smoothstep(maxBank * 0.55, maxBank * 0.9, Math.abs(bank)) * levelish;
      pitch -= nearLimit * clamp((noseElev - aimElev) / 0.1, -1, 1) * 1.3;
    }

    // auto-level: when the reticle is on the nose, bring the wings back to the horizon
    if (diff.autoLevel > 0) {
      const notVertical = smoothstep(0.3, 0.7, Math.sqrt(Math.max(0, 1 - _fwd.y * _fwd.y)));
      const levelErr = Math.atan2(_right.y, _up.y); // + => right wing high => roll right to level
      const lw = diff.autoLevel * (1 - w) * notVertical;
      roll += clamp(levelErr / 0.7, -1, 1) * lw;
    }

    out.pitch = clamp(pitch, -1, 1);
    // the roll axis is very quick on these jets; a calmer roll reads as flying, a full-rate one as a barrel roll
    out.roll = clamp(roll, -1, 1) * AIM.rollScale;
    out.yaw = clamp(yaw, -1, 1);
    return out;
  }
}
