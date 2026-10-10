import { Vector3 } from 'three';
import type { AirstripDef } from '../data/maps/types';
import type { SurfaceInfo } from '../flight/FlightModel';
import { GRAVITY } from '../data/weapons';
import { DEG, clamp } from '../core/math';
import { MouseAim } from '../flight/MouseAim';
import { scanTerrain, type TerrainThreat } from '../flight/TerrainAssist';
import type { Combat } from '../weapons/Combat';
import type { Brain, Fighter } from '../weapons/Fighter';
import type { AiSkillId } from '../core/Settings';

export type AiSkill = AiSkillId;

export interface SkillDef {
  label: string;
  /** Seconds before the pilot reacts to an inbound missile. */
  reaction: number;
  /** Aim error (rad) on the gun pipper. */
  aimErr: number;
  /** Largest angle (rad) between nose and lead point at which the gun is fired. */
  gunAng: number;
  gunRange: number;
  /** Seconds between missile launches. */
  missileCool: number;
  /** 0..1 chance of using a countermeasure when it should. */
  cm: number;
  /** Range (m) inside which radar missiles are launched. */
  bvr: number;
  /** Fraction of full stick used in a turn. */
  g: number;
}

export const SKILLS: Record<AiSkill, SkillDef> = {
  rookie: { label: 'Rookie', reaction: 1.5, aimErr: 0.032, gunAng: 0.05, gunRange: 700, missileCool: 55, cm: 0.35, bvr: 4500, g: 0.7 },
  regular: { label: 'Regular', reaction: 0.8, aimErr: 0.016, gunAng: 0.035, gunRange: 900, missileCool: 40, cm: 0.65, bvr: 7000, g: 0.88 },
  ace: { label: 'Ace', reaction: 0.3, aimErr: 0.006, gunAng: 0.024, gunRange: 1000, missileCool: 24, cm: 0.95, bvr: 10000, g: 1 },
};

type Mode = 'patrol' | 'bvr' | 'wvr' | 'defend' | 'evade' | 'rtb';

const UP = new Vector3(0, 1, 0);
const _d = new Vector3();
const _r = new Vector3();
const _f = new Vector3();
const _p = new Vector3();
const _t = new Vector3();
const _v = new Vector3();
const _surf: SurfaceInfo = { height: 0, onRunway: false, onApron: false };
const RAYS = [0, 25, -25, 50, -50, 80, -80];

/**
 * Combat pilot for skirmishes. A small state machine on top of the same mouse-aim control law the player flies with:
 * patrol, close to missile range (BVR), merge and dogfight (WVR), break when someone is on the tail, beam and
 * dispense when a missile is inbound, and return to an airstrip to rearm when hurt, low on fuel or empty.
 * Skill sets reaction time, aim error, range, stick authority and how well countermeasures are used.
 */
export class PilotBrain implements Brain {
  mode: Mode = 'patrol';
  private aim = new MouseAim();
  private cmd = { pitch: 0, roll: 0, yaw: 0 };
  private threat: TerrainThreat = { time: Infinity };
  private enemy: Fighter | null = null;
  private scanT = Math.random();
  private seen = 0;
  private evadeT = 0;
  private evadeSide = 1;
  private cmCool = 0;
  private missileCool = 14 + Math.random() * 14;
  private crank = 0;
  private crankSide = 1;
  private burst = 0;
  private burstRest = 0.5;
  private rtbBlock = 0;
  private noise = new Vector3();
  private noiseT = 0;
  private patrolAngle = Math.random() * Math.PI * 2;
  private defendT = 0;
  private breakSide: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  /** Horizontal direction toward the missile we are evading (kept per pilot: scratch vectors are shared). */
  private evadeLos = new Vector3(0, 0, -1);

  constructor(
    private combat: Combat,
    private sk: SkillDef,
    private homes: AirstripDef[],
    private center: { x: number; z: number },
    private patrolAlt: number,
    private boundary: number,
  ) {}

  reset(f: Fighter): void {
    this.enemy = null;
    this.mode = 'patrol';
    this.seen = 0;
    this.evadeT = 0;
    this.crank = 0;
    this.rtbBlock = 0;
    this.missileCool = 14 + Math.random() * 14;
    this.aim.snapTo(f.aircraft.flight);
  }

  update(f: Fighter, dt: number): void {
    const fl = f.aircraft.flight;
    const c = f.aircraft.controls;
    const w = f.weapons;
    const sk = this.sk;
    this.cmCool -= dt;
    this.missileCool -= dt;
    this.scanT -= dt;
    this.rtbBlock -= dt;
    this.crank -= dt;
    this.noiseT -= dt;
    this.defendT -= dt;
    if (this.noiseT <= 0) {
      this.noiseT = 0.3;
      this.noise.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(sk.aimErr * 2);
    }

    // ---- inbound missiles ----
    const threats = this.combat.threats(f).filter((t) => t.eta < 10);
    this.seen = threats.length ? this.seen + dt : Math.max(0, this.seen - dt * 2);
    const evading = threats.length > 0 && this.seen >= sk.reaction;
    if (evading) {
      const th = threats[0];
      if (this.evadeT <= 0) this.evadeSide = Math.random() < 0.5 ? -1 : 1;
      this.evadeT = 3;
      if (this.cmCool <= 0 && th.eta < 4.5 + sk.cm * 1.5) {
        if (Math.random() < sk.cm) {
          if (th.missile.kind === 'ir') this.combat.dispense(f, 'flare', 1);
          else this.combat.dispense(f, 'chaff', 1);
        }
        this.cmCool = th.missile.kind === 'ir' ? 1.0 : 1.8;
      }
      this.evadeLos.copy(th.missile.pos).sub(f.pos);
      this.evadeLos.y = 0;
      if (this.evadeLos.lengthSq() < 1) this.evadeLos.set(0, 0, -1);
      this.evadeLos.normalize();
      _d.crossVectors(this.evadeLos, UP).multiplyScalar(this.evadeSide);
      _d.y = Math.sin(f.clock * 1.9) * 0.45 - (th.eta < 3 ? 0.25 : 0);
    }
    this.evadeT -= dt;

    // ---- pick a target (spread out: avoid everyone piling on one jet) ----
    const en = this.pickEnemy(f);

    // ---- what to do ----
    let speed = fl.def.flight.maxSpeed * 0.7;
    let ab = false;
    const needsRtb = f.damage.health() < 0.3 || f.damage.fuel < 0.14 || (w.remaining('ir') + w.remaining('radar') === 0 && w.gunAmmo < 25);
    if (evading || this.evadeT > 0) {
      this.mode = 'evade';
      if (!evading) _d.crossVectors(this.evadeLos, UP).multiplyScalar(this.evadeSide);
      speed = Math.min(fl.def.flight.maxSpeed * 0.8, 400);
      ab = true;
    } else if (needsRtb && this.rtbBlock <= 0) {
      this.mode = 'rtb';
      speed = this.goHome(f, _d);
    } else if (en) {
      speed = this.fight(f, en, dt, _d);
      ab = fl.speed < speed - 35;
    } else {
      this.mode = 'patrol';
      speed = this.patrol(f, dt, _d);
    }

    // ---- ceiling: thin air makes a jet a poor fighter, and the sky is not the arena ----
    if (f.pos.y > 5600) _d.y = Math.min(_d.y, -0.15 - (f.pos.y - 5600) / 2500);

    // ---- stay in the arena ----
    const edge = Math.max(Math.abs(f.pos.x), Math.abs(f.pos.z));
    if (edge > this.boundary * 0.88 && this.mode !== 'evade') {
      _p.set(this.center.x - f.pos.x, 0, this.center.z - f.pos.z).normalize();
      const k = clamp((edge - this.boundary * 0.88) / (this.boundary * 0.1), 0, 1);
      _d.normalize().lerp(_p, k).normalize();
    }

    // ---- a goal behind us: turn level toward it. (The control law pulls "up and over" toward anything directly behind,
    // which sends two jets that have just merged straight up into the sky.) ----
    fl.forward(_f);
    _d.normalize();
    if (_d.dot(_f) < -0.3) {
      const side = Math.sign(_t.crossVectors(_f, _d).y) || this.breakSide;
      const vy = clamp(_d.y, -0.3, 0.3);
      _d.copy(_f);
      _d.y = 0;
      _d.normalize().applyAxisAngle(UP, side * 80 * DEG);
      _d.y = vy;
    }

    // never dive when the ground is already close below
    _d.y = Math.max(_d.y, clamp((700 - fl.agl) / 700, 0, 1) * 0.45);

    // ---- terrain avoidance beats everything ----
    scanTerrain(fl, this.combat.env as never, 10, this.threat);
    this.avoidTerrain(f, _d, this.threat.time);

    // ---- flight controls ----
    _d.normalize();
    this.aim.aim.copy(_d);
    this.aim.clampToNose(fl);
    this.aim.compute(fl, fl.difficulty, this.cmd);
    c.pitch = this.cmd.pitch * (this.mode === 'evade' || this.mode === 'defend' ? 1 : sk.g);
    c.roll = this.cmd.roll;
    c.yaw = this.cmd.yaw;
    c.throttle = clamp(0.6 + (speed - fl.speed) * 0.02, 0.2, 1);
    c.afterburner = ab || fl.speed < speed - 70;
    c.gearDown = false;
    c.airbrake = false;
  }

  // ---- target selection ----------------------------------------------------------------------

  private pickEnemy(f: Fighter): Fighter | null {
    if (this.scanT > 0 && this.enemy?.alive) return this.enemy;
    this.scanT = 0.8 + Math.random() * 0.4;
    const fl = f.aircraft.flight;
    fl.forward(_f);
    let best: Fighter | null = null;
    let bs = 1e12;
    for (const o of this.combat.fighters) {
      if (o.team === f.team || !o.alive) continue;
      _r.copy(o.pos).sub(f.pos);
      const d = _r.length();
      if (d > 17000) continue;
      const ang = Math.acos(clamp(_f.dot(_r) / (d || 1), -1, 1));
      let score = d * (1 + ang / Math.PI);
      // others already on this target make it less attractive
      for (const m of this.combat.fighters) if (m !== f && m.team === f.team && m.weapons.target === o) score += 1800;
      if (o.weapons.target === f) score -= 1500; // someone shooting at us comes first
      if (score < bs) {
        bs = score;
        best = o;
      }
    }
    if (best !== this.enemy) {
      f.weapons.target = best;
      f.weapons.lock.progress = 0;
      f.weapons.lock.locked = false;
    }
    this.enemy = best;
    return best;
  }

  /** Straight ahead, does a modest climb clear every ridge within a few seconds? */
  private rampClear(f: Fighter): boolean {
    const fl = f.aircraft.flight;
    fl.forward(_f);
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) return true;
    _f.normalize();
    const reach = clamp(fl.speed * 7, 1500, 4200);
    for (let k = 1; k <= 8; k++) {
      const d = (reach * k) / 8;
      const h = this.combat.env.surfaceAt(f.pos.x + _f.x * d, f.pos.z + _f.z * d, _surf).height;
      if (f.pos.y + d * 0.3 - h < 250) return false;
    }
    return true;
  }

  /**
   * Mountains are walls at jet speed: fan a few rays out ahead, take the heading with the most clearance and climb.
   * The closer the impact, the harder the climb.
   */
  private avoidTerrain(f: Fighter, out: Vector3, time: number): void {
    const fl = f.aircraft.flight;
    // cheap first look: is the way ahead (and below the horizon) clear of anything a steady 14 degree climb could not clear?
    if (time >= 10 && fl.agl >= 160 && this.rampClear(f)) return;
    fl.forward(_f);
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
    _f.normalize();
    const reach = clamp(fl.speed * 7, 1500, 4200);
    let best = 0;
    let bestClear = -1e9;
    for (const deg of RAYS) {
      _p.copy(_f).applyAxisAngle(UP, deg * DEG);
      let clear = 1e9;
      for (let k = 1; k <= 7; k++) {
        const d = (reach * k) / 7;
        const h = this.combat.env.surfaceAt(f.pos.x + _p.x * d, f.pos.z + _p.z * d, _surf).height;
        // a jet that needs to clear this point must climb: count the shortfall against how far away it is
        clear = Math.min(clear, f.pos.y + d * 0.3 - h);
      }
      // prefer going straight on unless another heading is clearly better
      const score = clear - Math.abs(deg) * 6;
      if (score > bestClear) {
        bestClear = score;
        best = deg;
      }
    }
    out.copy(_f).applyAxisAngle(UP, best * DEG);
    out.y = time < 5 || fl.agl < 160 ? 0.95 : time < 8 ? 0.55 : 0.3;
    out.normalize();
  }

  // ---- behaviours ----------------------------------------------------------------------------

  private patrol(f: Fighter, dt: number, out: Vector3): number {
    const R = this.boundary * 0.45;
    const tx = this.center.x + Math.cos(this.patrolAngle) * R;
    const tz = this.center.z + Math.sin(this.patrolAngle) * R;
    _p.set(tx - f.pos.x, 0, tz - f.pos.z);
    if (_p.length() < 1400) this.patrolAngle += 0.6;
    out.copy(_p).normalize();
    out.y = clamp((this.patrolAlt - f.pos.y) / 400, -0.3, 0.3);
    void dt;
    return f.aircraft.flight.def.flight.maxSpeed * 0.45;
  }

  private goHome(f: Fighter, out: Vector3): number {
    const fl = f.aircraft.flight;
    let best = this.homes[0];
    let bd = Infinity;
    for (const h of this.homes) {
      const d = Math.hypot(h.x - f.pos.x, h.z - f.pos.z);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    out.set(best.x - f.pos.x, 0, best.z - f.pos.z).normalize();
    const target = best.elevation + (bd < 3500 ? 120 : 600);
    out.y = clamp((target - f.pos.y) / 500, -0.25, 0.25);
    // low pass over the strip: serviced
    if (bd < 900 && fl.agl < 400) {
      f.service();
      this.rtbBlock = 45;
      this.mode = 'patrol';
    }
    return fl.def.flight.maxSpeed * 0.4;
  }

  /** Where to aim a gun to hit the target: relative-velocity intercept with bullet drop (same maths as the HUD pipper). */
  private leadDir(f: Fighter, tgt: Fighter, out: Vector3): Vector3 {
    const fl = f.aircraft.flight;
    const mv = f.weapons.gun.muzzleVelocity;
    const P = _t.copy(tgt.pos).sub(fl.pos);
    const vr = _v.copy(tgt.vel).sub(fl.vel);
    const a = vr.dot(vr) - mv * mv;
    const b = 2 * P.dot(vr);
    const cc = P.dot(P);
    const disc = b * b - 4 * a * cc;
    let t = P.length() / mv;
    if (disc >= 0 && a < 0) {
      const tt = (-b - Math.sqrt(disc)) / (2 * a);
      if (tt > 0 && tt < 3) t = tt;
    }
    out.copy(P).addScaledVector(vr, t);
    out.y += 0.5 * GRAVITY * t * t;
    return out.normalize();
  }

  private fight(f: Fighter, en: Fighter, dt: number, out: Vector3): number {
    const fl = f.aircraft.flight;
    const w = f.weapons;
    const sk = this.sk;
    const maxV = fl.def.flight.maxSpeed;
    fl.forward(_f);
    _r.copy(en.pos).sub(f.pos);
    const dist = _r.length();
    const los = _p.copy(_r).multiplyScalar(1 / (dist || 1));
    const angLos = Math.acos(clamp(_f.dot(los), -1, 1));
    if (w.target !== en) w.target = en;

    // someone on my tail, close, and shooting at me? break
    const enF = _v.set(0, 0, -1).applyQuaternion(en.aircraft.flight.quat);
    const onTail = dist < 2200 && los.dot(_f) < -0.35 && enF.dot(los) < -0.55 && en.weapons.target === f;
    if (onTail && this.defendT <= 0 && this.mode !== 'defend') {
      this.defendT = 2.2 + Math.random();
      this.breakSide = Math.random() < 0.5 ? -1 : 1;
    }
    if (this.defendT > 0) {
      this.mode = 'defend';
      // hard turn across the attacker's nose, pulling down a little to keep energy
      out.crossVectors(los, UP).multiplyScalar(this.breakSide);
      out.y = -0.25;
      return Math.min(maxV * 0.8, 380);
    }

    if (dist > 3000) {
      // ---- beyond visual range: close in, shoot radar missiles, crank to keep the datalink ----
      this.mode = 'bvr';
      if (w.remaining('radar') > 0) {
        if (w.group !== 1) w.selectGroup(1);
      } else if (w.remaining('ir') > 0 && w.group !== 0) w.selectGroup(0);
      out.copy(_r).addScaledVector(en.vel, clamp(dist / 900, 0, 6) * 0.5).normalize();
      // approach roughly level, matching the target's altitude gently: a straight line to a jet far above is a zoom climb
      out.y = clamp(out.y, -0.18, 0.18) + clamp((en.pos.y - f.pos.y) / 2500, -0.1, 0.1);
      if (this.crank > 0) {
        // turn ~40 degrees off the target after launching: the missile keeps its datalink, we keep distance
        out.applyAxisAngle(UP, this.crankSide * 38 * DEG);
        out.y = clamp(out.y, -0.2, 0.2);
      }
      if (w.group === 1 && w.lock.locked && dist < sk.bvr && angLos < 50 * DEG && this.missileCool <= 0 && this.combat.threats(en).length < 2) {
        if (this.combat.fireMissile(f)) {
          this.missileCool = sk.missileCool;
          this.crank = 6;
          this.crankSide = Math.random() < 0.5 ? -1 : 1;
        }
      }
      return Math.min(maxV * 0.6, 330);
    }

    // ---- within visual range: dogfight ----
    this.mode = 'wvr';
    if (w.remaining('ir') > 0 && w.group !== 0) w.selectGroup(0);
    else if (w.remaining('ir') === 0 && w.remaining('radar') > 0 && w.group !== 1) w.selectGroup(1);

    const lead = this.leadDir(f, en, _d);
    const angLead = Math.acos(clamp(_f.dot(lead), -1, 1));
    out.copy(lead);
    if (dist < 420 && angLos < 35 * DEG && los.dot(_f) > 0.8 && en.vel.dot(_f) < 0) {
      // head-on merge: break to one side (each pilot has its own side) instead of colliding
      out.crossVectors(UP, _f).multiplyScalar(this.breakSide).addScaledVector(_f, 0.35);
      out.y = 0.08;
      out.normalize();
    } else if (angLos > 70 * DEG) {
      // target is off to the side or behind: a level turn toward it (a vertical loop wastes the fight upstairs)
      out.y = clamp(out.y, -0.3, 0.3);
      out.normalize();
    } else if (dist < 650) {
      // lag pursuit: aim a little behind the target so we stay on its tail without overshooting
      out.addScaledVector(en.vel, -0.0008 * dist).normalize();
    }

    // two jets chasing each other tend to spiral upward together: cap the climb, harder the higher we are
    const climbCap = clamp(0.35 - (f.pos.y - 2200) / 3500, -0.12, 0.35);
    if (out.y > climbCap) {
      out.y = climbCap;
      out.normalize();
    }

    // aim error: lower skill wobbles the pipper
    out.add(this.noise).normalize();

    // guns
    this.burstRest -= dt;
    if (this.burst > 0) {
      this.burst -= dt;
      if (this.burst <= 0) this.burstRest = 0.5 + Math.random() * 0.9;
    }
    if (this.burst <= 0 && this.burstRest <= 0 && dist < sk.gunRange * 1.15 && angLead < sk.gunAng * 1.4) this.burst = 1.1;
    if (this.burst > 0 && w.gunAmmo > 0) this.combat.fireGun(f, dt);

    // missiles: infrared when the target is in the seeker cone
    if (w.group === 0 && w.lock.locked && dist > 1100 && dist < 4200 && angLos < 35 * DEG && this.missileCool <= 0 && w.remaining('ir') > 0 && this.combat.threats(en).length < 2) {
      if (this.combat.fireMissile(f)) this.missileCool = sk.missileCool;
    } else if (w.group === 1 && w.lock.locked && dist > 900 && this.missileCool <= 0 && angLos < 45 * DEG && this.combat.threats(en).length < 2) {
      if (this.combat.fireMissile(f)) this.missileCool = sk.missileCool;
    }

    // speed: turning fights live near corner speed, a tail chase wants a bit more than the target
    const corner = maxV * 0.46;
    return angLos > 40 * DEG ? corner : clamp(en.vel.length() + 40 + (dist - 500) * 0.05, corner, Math.min(maxV * 0.62, 360));
  }
}
