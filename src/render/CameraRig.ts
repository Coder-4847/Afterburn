import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { CAMERA } from '../data/tuning';
import { clamp, damp, smoothstep, wrapPi } from '../core/math';

export type CameraMode = 'chase' | 'cockpit';

export interface RigTarget {
  pos: Vector3;
  quat: Quaternion;
  /** 0..1 fraction of top speed (drives FOV kick). */
  speedNorm: number;
  ab: number;
  distance: number;
  height: number;
  cockpit: [number, number, number];
  /** A signature move in progress: the camera pulls out and swings round to watch it from a stable frame. */
  cine?: { active: boolean; vel: Vector3; side: number; dist: number; azim: number; fov: number };
}

const WORLD_UP = new Vector3(0, 1, 0);
const _tf = new Vector3();
const _tu = new Vector3();
const _right = new Vector3();
const _m = new Matrix4();
const _qb = new Quaternion();
const _ql = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _off = new Vector3();
const _look = new Vector3();
const _u2 = new Vector3();
const _cp = new Vector3();
const _cq = new Quaternion();
const _fq = new Quaternion();
const _fe = new Euler(0, 0, 0, 'YXZ');

/** Third-person chase camera with lag and FOV kick, a cockpit view, and hold-to-look-around. */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'chase';
  baseFov = 72;
  /** Smoothed camera basis (the "lag"). */
  readonly fwd = new Vector3(0, 0, -1);
  readonly up = new Vector3(0, 1, 0);
  readonly right = new Vector3(1, 0, 0);
  lookYaw = 0;
  lookPitch = 0;
  looking = false;
  /** When set, the view swings round to keep this world point in sight (target view). */
  focus: Vector3 | null = null;
  shake = 0;
  shakeEnabled = true;
  /** 0..1 multiplier on the speed / afterburner FOV push (reduce-motion lowers it). */
  fovKickScale = 1;
  private fov = 72;
  /** The chase camera's lagged orientation (before the look offset), kept for the target view. */
  private basis = new Quaternion();
  private t = 0;
  private lastMode: CameraMode = 'chase';
  /** 0..1: how far the cinematic signature-move view has taken over (eased in and out). */
  cineW = 0;
  private cineRaw = 0;
  private cineHead = 0;
  private cinePitch = 0;
  private cineSide = 1;
  private cineDist = 1.6;
  private cineAzim = 1;
  private cineFov = 8;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(72, aspect, CAMERA.near, CAMERA.far);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Snap the lag state to the aircraft (spawn / respawn). */
  snap(quat: Quaternion): void {
    this.fwd.set(0, 0, -1).applyQuaternion(quat);
    this.up.set(0, 1, 0);
    this.lookYaw = this.lookPitch = 0;
    this.fov = this.baseFov;
    this.cineW = this.cineRaw = 0;
  }

  cycleMode(): void {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  addLook(dx: number, dy: number): void {
    this.lookYaw = clamp(this.lookYaw - dx * CAMERA.chase.lookSens, -CAMERA.chase.lookYawMax, CAMERA.chase.lookYawMax);
    this.lookPitch = clamp(this.lookPitch - dy * CAMERA.chase.lookSens, -CAMERA.chase.lookPitchMax, CAMERA.chase.lookPitchMax);
  }

  update(dt: number, tg: RigTarget, groundHeightAt: (x: number, z: number) => number): void {
    const cam = this.camera;
    const C = CAMERA.chase;
    this.t += dt;

    // ---- cinematic signature-move view: eased in and out, built on a steady frame (the flight path, not the swinging nose) ----
    const cin = tg.cine;
    if (cin?.active) {
      this.cineDist = cin.dist;
      this.cineAzim = cin.azim;
      this.cineFov = cin.fov;
      this.cineSide = cin.side;
    }
    this.cineRaw = clamp(this.cineRaw + (cin?.active ? dt / 0.5 : -dt / 0.8), 0, 1);
    const w = (this.cineW = this.cineRaw * this.cineRaw * (3 - 2 * this.cineRaw));
    let qFrame = tg.quat;
    if (cin && w > 0.0005) {
      // heading follows the velocity (held through a vertical stretch where it is undefined), pitch is a damped share of it
      const sp = cin.vel.length();
      const hor = Math.hypot(cin.vel.x, cin.vel.z);
      if (sp > 4 && hor > 0.25 * sp) this.cineHead += wrapPi(Math.atan2(cin.vel.x, -cin.vel.z) - this.cineHead) * (1 - Math.exp(-5 * dt));
      const gp = sp > 4 ? Math.asin(clamp(cin.vel.y / sp, -1, 1)) * 0.4 : 0;
      this.cinePitch = damp(this.cinePitch, gp, 4, dt);
      _fq.setFromEuler(_fe.set(this.cinePitch, -this.cineHead, 0));
      qFrame = _cq.copy(tg.quat).slerp(_fq, w);
    } else {
      // idle: keep the stored heading glued to the aircraft so the view never jumps when a move starts
      _tf.set(0, 0, -1).applyQuaternion(tg.quat);
      this.cineHead = Math.atan2(_tf.x, -_tf.z);
      this.cinePitch = 0;
    }

    // return the head to centre when not looking
    if (this.focus) {
      // express the direction to the focus point in the aircraft's frame, then ease the head toward it
      _off.copy(this.focus).sub(tg.pos).applyQuaternion(_qb.copy(this.mode === 'cockpit' ? tg.quat : this.basis).invert());
      const ty = Math.atan2(-_off.x, -_off.z);
      const tp = clamp(Math.atan2(_off.y, Math.hypot(_off.x, _off.z)), -C.lookPitchMax, C.lookPitchMax);
      this.lookYaw += wrapPi(ty - this.lookYaw) * (1 - Math.exp(-7 * dt));
      this.lookPitch = damp(this.lookPitch, tp, 7, dt);
    } else if (!this.looking) {
      this.lookYaw = damp(this.lookYaw, 0, C.lookReturn, dt);
      this.lookPitch = damp(this.lookPitch, 0, C.lookReturn, dt);
    }

    // FOV kick with speed and afterburner, plus the cinematic widening
    const targetFov = this.baseFov + this.fovKickScale * (C.fovKick * Math.pow(clamp(tg.speedNorm, 0, 1), 1.5) + C.abFov * tg.ab) + (this.mode === 'cockpit' ? 4 * (1 - w) : 0) + this.cineFov * w;
    this.fov = damp(this.fov, targetFov, 4, dt);
    const cockpitNear = this.mode === 'cockpit' && w < 0.02;
    if (Math.abs(cam.fov - this.fov) > 0.01 || this.mode !== this.lastMode || cockpitNear !== (cam.near === CAMERA.cockpit.near)) {
      cam.fov = this.fov;
      cam.near = cockpitNear ? CAMERA.cockpit.near : CAMERA.near;
      cam.updateProjectionMatrix();
    }
    this.lastMode = this.mode;

    this.shake = damp(this.shake, 0, CAMERA.shakeDecay, dt);
    const shakeAmt = (this.shakeEnabled ? this.shake + tg.ab * 0.05 + Math.pow(clamp(tg.speedNorm, 0, 1), 3) * 0.03 : 0) * (1 - 0.7 * w);

    // the cockpit view is computed first; during a move the exterior shot is blended over it
    const inCockpit = this.mode === 'cockpit';
    if (inCockpit) {
      _tf.set(0, 0, -1).applyQuaternion(tg.quat);
      _tu.set(0, 1, 0).applyQuaternion(tg.quat);
      this.fwd.copy(_tf);
      this.up.copy(_tu);
      _ql.setFromEuler(_e.set(this.lookPitch, this.lookYaw, 0));
      cam.quaternion.copy(tg.quat).multiply(_ql);
      _off.set(tg.cockpit[0], tg.cockpit[1], tg.cockpit[2]).applyQuaternion(tg.quat);
      cam.position.copy(tg.pos).add(_off);
      this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      if (w < 0.0005) {
        this.applyShake(shakeAmt * 0.6);
        return;
      }
      _cp.copy(cam.position);
      _fq.copy(cam.quaternion);
    }

    // --- chase: the camera basis lags the aircraft's, and only partly follows its roll ---
    _tf.set(0, 0, -1).applyQuaternion(qFrame);
    _tu.set(0, 1, 0).applyQuaternion(qFrame);
    const kf = 1 - Math.exp(-(C.followLambda + (3.4 - C.followLambda) * w) * dt);
    this.fwd.lerp(_tf, kf);
    // a lagged direction that has been dragged through zero (a very fast flip) is re-seeded instead of normalised noise
    if (this.fwd.lengthSq() < 0.04) this.fwd.copy(_tf);
    this.fwd.normalize();
    _u2.copy(WORLD_UP).lerp(_tu, C.rollFollow * (1 - w));
    this.up.lerp(_u2.normalize(), 1 - Math.exp(-C.rollLambda * dt));
    // re-orthogonalise: up must be perpendicular to fwd
    this.up.addScaledVector(this.fwd, -this.up.dot(this.fwd));
    if (this.up.lengthSq() < 1e-6) this.up.copy(WORLD_UP);
    this.up.normalize();
    this.right.crossVectors(this.fwd, this.up).normalize();

    _m.lookAt(_look.set(0, 0, 0), this.fwd, this.up);
    _qb.setFromRotationMatrix(_m);
    this.basis.copy(_qb);
    _ql.setFromEuler(_e.set(this.lookPitch * (1 - w), this.lookYaw * (1 - w), 0));
    _qb.multiply(_ql);

    // orbit position about the aircraft (looking around swings the camera around it); a move pulls out and swings to one side
    _off.set(0, tg.height * (1 + 0.2 * w), tg.distance * (1 + (this.cineDist - 1) * w)).applyQuaternion(_qb);
    if (w > 0.0005) _off.applyAxisAngle(this.up, this.cineSide * this.cineAzim * w);
    cam.position.copy(tg.pos).add(_off);
    const gh = groundHeightAt(cam.position.x, cam.position.z);
    if (cam.position.y < gh + 3) cam.position.y = gh + 3;

    // aim a little ahead of the aircraft so it sits slightly below centre (centred on it during a move)
    _look.set(0, 0, -C.lead * (1 - 0.8 * w)).applyQuaternion(_qb).add(tg.pos);
    _u2.set(0, 1, 0).applyQuaternion(_qb);
    _m.lookAt(cam.position, _look, _u2);
    cam.quaternion.setFromRotationMatrix(_m);
    this.applyShake(shakeAmt);

    if (inCockpit) {
      // cockpit -> exterior shot and back, with the same easing as the shot itself
      const k = smoothstep(0, 1, w);
      cam.position.lerpVectors(_cp, cam.position, k);
      cam.quaternion.slerpQuaternions(_fq, cam.quaternion, k);
    }
  }

  private applyShake(a: number): void {
    if (a < 1e-4) return;
    const t = this.t;
    const cam = this.camera;
    const dx = Math.sin(t * 47.3) * 0.5 + Math.sin(t * 91.7) * 0.5;
    const dy = Math.sin(t * 53.1 + 1.3) * 0.5 + Math.sin(t * 83.9) * 0.5;
    cam.position.addScaledVector(this.right, dx * a * 0.35);
    cam.position.addScaledVector(this.up, dy * a * 0.35);
    _ql.setFromEuler(_e.set(dy * a * 0.004, dx * a * 0.004, 0));
    cam.quaternion.multiply(_ql);
  }
}
