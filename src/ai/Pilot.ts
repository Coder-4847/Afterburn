import { Vector3 } from 'three';
import type { AirstripDef } from '../data/maps/types';
import type { SurfaceInfo } from '../flight/FlightModel';
import { GRAVITY } from '../data/weapons';
import { WORLD_BOUNDARY } from '../data/tuning';
import { DEG, clamp } from '../core/math';
import { MouseAim } from '../flight/MouseAim';
import { MANEUVERS } from '../flight/Maneuvers';
import { scanTerrain, type TerrainThreat } from '../flight/TerrainAssist';
import type { Combat } from '../weapons/Combat';
import type { Brain, Fighter } from '../weapons/Fighter';
import type { AiSkillId } from '../core/Settings';
import type { Target } from '../weapons/types';

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
  /** Engine thrust multiplier (acceleration and energy recovery). */
  thrust: number;
  /** 0..1: how readily the pilot closes for a gun attack and keeps it up, instead of sitting off and shooting missiles. */
  aggression: number;
  /** 0..1: how often a pilot with a signature move throws it at a gun on the tail. */
  maneuver: number;
  /** 0..1 cannon aim assist. */
  assist: number;
  /** Multiplier on the damage this pilot's weapons do. */
  damage: number;
}

export const SKILLS: Record<AiSkill, SkillDef> = {
  rookie: { label: 'Rookie', reaction: 1.1, aimErr: 0.026, gunAng: 0.055, gunRange: 760, missileCool: 50, cm: 0.45, bvr: 5200, g: 0.78, thrust: 0.68, aggression: 0.5, maneuver: 0, assist: 0.45, damage: 1 },
  regular: { label: 'Regular', reaction: 0.65, aimErr: 0.014, gunAng: 0.04, gunRange: 950, missileCool: 42, cm: 0.75, bvr: 7500, g: 0.92, thrust: 0.76, aggression: 0.65, maneuver: 0.1, assist: 0.7, damage: 1.1 },
  ace: { label: 'Ace', reaction: 0.3, aimErr: 0.0065, gunAng: 0.028, gunRange: 1100, missileCool: 36, cm: 0.85, bvr: 10000, g: 1, thrust: 0.86, aggression: 0.8, maneuver: 0.3, assist: 0.95, damage: 1.25 },
  veteran: { label: 'Veteran', reaction: 0.2, aimErr: 0.0038, gunAng: 0.022, gunRange: 1250, missileCool: 30, cm: 0.9, bvr: 11500, g: 1, thrust: 0.96, aggression: 0.92, maneuver: 0.55, assist: 1, damage: 1.4 },
  elite: { label: 'Elite', reaction: 0.1, aimErr: 0.0016, gunAng: 0.018, gunRange: 1400, missileCool: 26, cm: 0.95, bvr: 13000, g: 1, thrust: 1.06, aggression: 1, maneuver: 0.85, assist: 1, damage: 1.6 },
};

type Mode = 'patrol' | 'bvr' | 'wvr' | 'defend' | 'evade' | 'rtb' | 'strike';

const UP = new Vector3(0, 1, 0);
const _d = new Vector3();
const _r = new Vector3();
const _f = new Vector3();
const _p = new Vector3();
const _t = new Vector3();
const _v = new Vector3();
const _in = new Vector3();
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
  private notchT = 0;
  private notchSide: 1 | -1 = 1;
  /** Horizontal direction toward the missile we are evading (kept per pilot: scratch vectors are shared). */
  private evadeLos = new Vector3(0, 0, -1);
  /** Carrier strike: a pilot with a goal bombs it (while nobody is on top of them), then goes home to rearm. */
  strikeGoal: (() => Target | null) | null = null;
  private strikeT = 0;
  private strikeOff = 0;
  private strikeBombs = 2;
  private strikeRocketT = 0;
  /** Seconds spent outside the combat zone: the same countdown the player gets, then the jet is lost. */
  private outT = 0;
  /** Seconds until this pilot may throw its signature move again. */
  private moveCool = 3 + Math.random() * 6;
  private wasMoving = false;

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
    this.strikeT = 0;
    this.outT = 0;
    this.strikeBombs = 2;
    this.missileCool = 14 + Math.random() * 14;
    this.moveCool = 3 + Math.random() * 6;
    this.wasMoving = false;
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
    this.notchT -= dt;
    this.moveCool -= dt;
    // a signature move flies itself: the script has the controls until it is over
    if (fl.maneuver) {
      this.wasMoving = true;
      this.aim.snapTo(fl);
      return;
    }
    if (this.wasMoving) {
      this.wasMoving = false;
      this.aim.snapTo(fl);
    }
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
      if (this.cmCool <= 0 && th.eta < 4.5 + sk.cm * 2) {
        if (Math.random() < sk.cm) {
          // late in the fight, throw a pair: one flare is easy to ignore
          if (th.missile.kind === 'ir') this.combat.dispense(f, 'flare', th.eta < 2.5 ? 2 : 1);
          else this.combat.dispense(f, 'chaff', th.eta < 2.5 ? 2 : 1);
        }
        this.cmCool = (th.missile.kind === 'ir' ? 1.0 : 1.8) * (1.15 - sk.cm * 0.4);
      }
      this.evadeLos.copy(th.missile.pos).sub(f.pos);
      this.evadeLos.y = 0;
      if (this.evadeLos.lengthSq() < 1) this.evadeLos.set(0, 0, -1);
      this.evadeLos.normalize();
      _d.crossVectors(this.evadeLos, UP).multiplyScalar(this.evadeSide);
      _d.y = Math.sin(f.clock * 1.9) * 0.45 - (th.eta < 3 ? 0.25 : 0);
    }
    this.evadeT -= dt;

    // ---- radar lock but no missile yet: turn to put the shooter on the beam (a notch the seeker cannot see) ----
    const hardLock = threats.length === 0 && sk.cm >= 0.6 ? this.combat.radarLocks(f).find((l) => l.locked && l.by.pos.distanceTo(f.pos) > 2500) : undefined;
    if (hardLock && this.notchT <= -2) {
      this.notchT = 3;
      this.notchSide = Math.random() < 0.5 ? -1 : 1;
    }

    // ---- how close to the edge of the arena are we, and are we heading out? ----
    const edgeK = this.edgePressure(f, _in);
    const beyond = Math.max(Math.abs(f.pos.x - this.center.x), Math.abs(f.pos.z - this.center.z)) > this.boundary;
    this.outT = beyond ? this.outT + dt : Math.max(0, this.outT - dt * 2);
    if (this.outT > WORLD_BOUNDARY.countdown) {
      this.outT = 0;
      this.combat.crashFighter(f, 'Left combat zone');
      return;
    }
    if (evading && edgeK > 0.15) {
      // beam the missile on whichever side keeps us in the arena
      _d.crossVectors(this.evadeLos, UP);
      this.evadeSide = _d.dot(_in) >= 0 ? 1 : -1;
      _d.multiplyScalar(this.evadeSide);
    }

    // ---- pick a target (spread out: avoid everyone piling on one jet) ----
    const en = this.pickEnemy(f);

    // ---- what to do ----
    let speed = fl.def.flight.maxSpeed * 0.7;
    let ab = false;
    const strikeLeft = w.remaining('bomb') + w.remaining('rocket');
    const needsRtb =
      f.damage.health() < 0.3 - 0.12 * sk.aggression || f.damage.fuel < 0.14 || (w.remaining('ir') + w.remaining('radar') === 0 && w.gunAmmo < 25) ||
      (this.strikeGoal !== null && strikeLeft === 0);
    const strikeTgt = this.strikeGoal && strikeLeft > 0 ? this.strikeGoal() : null;
    if (evading || this.evadeT > 0) {
      this.mode = 'evade';
      if (!evading) _d.crossVectors(this.evadeLos, UP).multiplyScalar(this.evadeSide);
      speed = Math.min(fl.def.flight.maxSpeed * 0.8, 400);
      ab = true;
    } else if (hardLock && this.notchT > 0) {
      this.mode = 'evade';
      _r.copy(hardLock.by.pos).sub(f.pos);
      _r.y = 0;
      _r.normalize();
      _d.crossVectors(_r, UP).multiplyScalar(this.notchSide);
      _d.y = clamp((this.patrolAlt - f.pos.y) / 800, -0.1, 0.1);
      speed = Math.min(fl.def.flight.maxSpeed * 0.55, 300);
    } else if (needsRtb && this.rtbBlock <= 0) {
      this.mode = 'rtb';
      speed = this.goHome(f, _d);
    } else if (strikeTgt && (!en || en.pos.distanceToSquared(f.pos) > (en.weapons.target === f ? 2400 : 1300) ** 2)) {
      this.mode = 'strike';
      speed = this.strike(f, strikeTgt, dt, _d);
      ab = fl.speed < speed - 50;
    } else if (en) {
      speed = this.fight(f, en, dt, _d);
      ab = fl.speed < speed - 35;
    } else {
      this.mode = 'patrol';
      speed = this.patrol(f, dt, _d);
    }

    // ---- keep clear of friendly aircraft (two jets chasing the same target otherwise collide) ----
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let near = false;
    for (const o of this.combat.fighters) {
      if (o === f || o.team !== f.team || !o.alive) continue;
      _p.copy(f.pos).sub(o.pos);
      const d = _p.length();
      if (d > 320 || d < 1) continue;
      const k = (1 - d / 320) * (1 - d / 320) / d;
      sx += _p.x * k;
      sy += _p.y * k;
      sz += _p.z * k;
      near = true;
    }
    if (near) {
      _d.normalize();
      _d.x += sx * 340;
      _d.y += sy * 340;
      _d.z += sz * 340;
    }

    // ---- ceiling: thin air makes a jet a poor fighter, and the sky is not the arena ----
    if (f.pos.y > 5600) _d.y = Math.min(_d.y, -0.15 - (f.pos.y - 5600) / 2500);

    // ---- stay in the arena: whatever the goal, bend the heading back in before the jet runs out of room to turn ----
    if (edgeK > 0) this.bendInward(_d, _in, edgeK);

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
    if (fl.agl < 700) _d.y = Math.max(_d.y, ((700 - fl.agl) / 700) * 0.45);

    // ---- terrain avoidance beats everything ----
    scanTerrain(fl, this.combat.env as never, 10, this.threat);
    this.avoidTerrain(f, _d, this.threat.time, edgeK);
    // terrain avoidance picks the heading with the most clearance, which near an edge is often out over open sea.
    // Unless the ground is about to be hit, the arena wins the heading and avoidance only keeps its climb.
    if (edgeK > 0.3 && this.threat.time > 5 && fl.agl > 180) this.bendInward(_d, _in, Math.max(edgeK, 0.85));

    // ---- flight controls ----
    _d.normalize();
    this.aim.aim.copy(_d);
    this.aim.clampToNose(fl);
    this.aim.compute(fl, fl.difficulty, this.cmd);
    // a jet that is running out of room pulls everything it has, whatever its skill
    c.pitch = this.cmd.pitch * (this.mode === 'evade' || this.mode === 'defend' || edgeK > 0.4 ? 1 : sk.g);
    c.roll = this.cmd.roll;
    c.yaw = this.cmd.yaw;
    c.throttle = clamp(0.6 + (speed - fl.speed) * 0.02, 0.2, 1);
    c.afterburner = ab || fl.speed < speed - 70 || (edgeK > 0.6 && fl.speed < 300);
    c.gearDown = false;
    c.airbrake = false;
  }

  // ---- strike run ------------------------------------------------------------------------------

  /** Approach the target low and straight, drop bombs on the computed release point, fire rockets on the way in, then leave. */
  private strike(f: Fighter, tgt: Target, dt: number, out: Vector3): number {
    const fl = f.aircraft.flight;
    const w = f.weapons;
    const maxV = fl.def.flight.maxSpeed;
    fl.forward(_f);
    this.strikeT -= dt;
    this.strikeRocketT -= dt;
    if (this.strikeT > 0) {
      // egress: straight on and a gentle climb, away from the guns
      out.copy(_f);
      out.y = 0;
      out.normalize();
      out.y = 0.16;
      return maxV * 0.8;
    }
    _r.copy(tgt.pos).sub(f.pos);
    let dh = Math.hypot(_r.x, _r.z) || 1;
    // each run is aimed a little off the centre line: how far depends on the pilot's skill
    const px = -_r.z / dh;
    const pz = _r.x / dh;
    _r.x += px * this.strikeOff;
    _r.z += pz * this.strikeOff;
    dh = Math.hypot(_r.x, _r.z) || 1;
    const hx = _r.x / dh;
    const hz = _r.z / dh;
    const h = f.pos.y - tgt.pos.y;
    const want = tgt.pos.y + (dh > 4200 ? Math.max(this.patrolAlt - tgt.pos.y, 350) : 150 + dh * 0.05);
    out.set(hx, clamp((want - f.pos.y) / 700, -0.3, 0.2), hz);
    const fh = Math.hypot(_f.x, _f.z) || 1;
    const align = (_f.x * hx + _f.z * hz) / fh;
    if (align > 0.97 && dh < 2800 && w.cooldown <= 0 && w.remaining('bomb') > 0) {
      // time for a bomb to fall from here, at our ground speed
      const rel = Math.hypot(fl.vel.x, fl.vel.z) * Math.sqrt((2 * Math.max(h, 10)) / GRAVITY);
      if (dh <= rel + 30 && this.combat.dropBomb(f)) {
        this.strikeBombs--;
        if (this.strikeBombs <= 0 || w.remaining('bomb') === 0) this.endRun(5.5);
      }
    }
    if (align > 0.985 && dh < 1500 && dh > 350 && w.remaining('rocket') > 0 && this.strikeRocketT < -2) this.strikeRocketT = 1;
    if (this.strikeRocketT > 0) this.combat.fireRockets(f, dt);
    if (dh < 260) this.endRun(6);
    return maxV * 0.62;
  }

  /** A freshly assigned strike pilot picks the aim offset for the first run. */
  endRunInit(): void {
    this.strikeT = 0;
    this.strikeOff = (Math.random() * 2 - 1) * (this.sk.aimErr / 0.006) * 14;
  }

  private endRun(seconds: number): void {
    this.strikeT = seconds;
    this.strikeBombs = 2;
    this.strikeOff = (Math.random() * 2 - 1) * (this.sk.aimErr / 0.006) * 14;
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
      for (const m of this.combat.fighters) {
        if (m === f || m.team !== f.team || m.weapons.target !== o) continue;
        score += m.isPlayer ? -350 : 1800; // join the player's target; do not pile onto another AI's
      }
      if (o.isPlayer) score -= 300 + 700 * this.sk.aggression; // the human is who the fight is for: come to them
      if (o.weapons.target === f) score -= 1500; // someone shooting at us comes first
      else if (o.weapons.target && o.weapons.target.team === f.team && o.weapons.target.kind === 'air') score -= 800; // peel one off a teammate
      score -= (1 - o.damage.health()) * 1200; // a hurt jet is a kill waiting to happen
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
  private avoidTerrain(f: Fighter, out: Vector3, time: number, edgeK = 0): void {
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
      // prefer going straight on unless another heading is clearly better; near the edge, headings that leave the arena lose
      let score = clear - Math.abs(deg) * 6;
      if (edgeK > 0) {
        const ex = Math.max(Math.abs(f.pos.x + _p.x * reach * 0.6 - this.center.x), Math.abs(f.pos.z + _p.z * reach * 0.6 - this.center.z));
        if (ex > this.boundary * 0.92) score -= 3000 * edgeK;
      }
      if (score > bestClear) {
        bestClear = score;
        best = deg;
      }
    }
    out.copy(_f).applyAxisAngle(UP, best * DEG);
    out.y = time < 5 || fl.agl < 160 ? 0.95 : time < 8 ? 0.55 : 0.3;
    out.normalize();
  }

  // ---- arena edge ------------------------------------------------------------------------------

  /**
   * 0..1 pressure to turn back into the arena. A jet needs about one turn radius of room to reverse, so the pressure
   * rises as the distance left along the current heading (to the safe square) shrinks toward that radius. Writes the
   * horizontal direction toward the middle to `inward`.
   */
  private edgePressure(f: Fighter, inward: Vector3): number {
    const fl = f.aircraft.flight;
    const px = f.pos.x - this.center.x;
    const pz = f.pos.z - this.center.z;
    const lim = this.boundary * 0.8;
    const dist = Math.max(Math.abs(px), Math.abs(pz));
    inward.set(-px, 0, -pz);
    if (inward.lengthSq() < 1) inward.set(0, 0, -1);
    inward.normalize();
    if (dist < lim * 0.45) return 0;
    let vx = fl.vel.x;
    let vz = fl.vel.z;
    const sp = Math.hypot(vx, vz) || 1;
    vx /= sp;
    vz /= sp;
    // outside the safe square: full pressure if still heading out, firm pressure while coming back
    if (dist > lim) return (px * vx + pz * vz) / (Math.hypot(px, pz) || 1) > 0.15 ? 1 : 0.6;
    // thin air widens the turn: the same stick turns a jet at 6 km in a circle twice the size of one at sea level
    const air = Math.max(0.45, Math.exp(-Math.max(0, f.pos.y) / 9500));
    // a crippled jet (a wing shot up, an engine out) turns in a much wider circle
    const hurt = 1 + Math.max(0, 0.5 - f.damage.health()) * 3;
    const R = clamp(((sp * sp) / (GRAVITY * 8 * air)) * hurt, 450, 5000);
    const tx = vx > 1e-3 ? (lim - px) / vx : vx < -1e-3 ? (-lim - px) / vx : Infinity;
    const tz = vz > 1e-3 ? (lim - pz) / vz : vz < -1e-3 ? (-lim - pz) / vz : Infinity;
    const s = Math.min(tx, tz);
    return clamp((2 * R - s) / (1.4 * R), 0, 1);
  }

  /** Rotate the horizontal part of `d` toward `inward` by k of the angle between them (the climb is kept). */
  private bendInward(d: Vector3, inward: Vector3, k: number): void {
    const y = d.y;
    let hx = d.x;
    let hz = d.z;
    const hl = Math.hypot(hx, hz);
    if (hl < 1e-3) {
      hx = inward.x;
      hz = inward.z;
    } else {
      hx /= hl;
      hz /= hl;
    }
    // signed angle from the current heading to the inward direction
    const cross = hx * inward.z - hz * inward.x;
    const dot = hx * inward.x + hz * inward.z;
    let ang = Math.atan2(cross, dot);
    if (Math.abs(ang) > 3.0) ang = ang >= 0 ? Math.PI : -Math.PI;
    const a = ang * k;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const nx = hx * c - hz * s;
    const nz = hx * s + hz * c;
    const flat = Math.sqrt(Math.max(0, 1 - y * y));
    d.set(nx * flat, y, nz * flat);
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
      // a gun close behind: a pilot with a signature move throws it, and the attacker overshoots
      if (sk.maneuver > 0 && this.moveCool <= 0 && dist < 800 && Math.random() < sk.maneuver * dt * 1.6) {
        const mv = MANEUVERS[f.aircraft.def.maneuver];
        if (fl.agl > mv.minAgl + 60 && this.edgePressure(f, _in) < 0.8 && fl.maneuverBlock(mv) === null && fl.startManeuver(mv) === null) {
          this.moveCool = 9 + Math.random() * 9;
          return Math.min(maxV * 0.8, 380);
        }
      }
      // hard turn across the attacker's nose, pulling down a little to keep energy
      out.crossVectors(los, UP).multiplyScalar(this.breakSide);
      out.y = -0.25 + (sk.aggression > 0.78 ? Math.sin(f.clock * 2.7) * 0.3 : 0);
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
          this.crank = 6 - 3.5 * sk.aggression;
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
    } else if (dist < 650 && sk.aggression < 0.78) {
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
      if (this.burst <= 0) this.burstRest = 0.2 + (1 - sk.aggression) * 0.8 + Math.random() * 0.5;
    }
    const cone = sk.gunAng * (dist < 450 ? 2.4 : 1.4);
    if (this.burst <= 0 && this.burstRest <= 0 && dist < sk.gunRange * 1.15 && angLead < cone) this.burst = 0.8 + sk.aggression * 1.1;
    if (this.burst > 0 && w.gunAmmo > 0) this.combat.fireGun(f, dt);

    // missiles: infrared when the target is in the seeker cone
    // inside ~1.3-1.8 km (more for the aggressive) the cannon is the weapon: pilots close the distance for a gun kill
    const gunZone = 900 + 900 * sk.aggression;
    const inFlight = sk.aggression > 0.7 ? 1 : 2;
    if (w.group === 0 && w.lock.locked && dist > gunZone && dist < 4200 && angLos < 35 * DEG && this.missileCool <= 0 && w.remaining('ir') > 0 && this.combat.threats(en).length < inFlight) {
      if (this.combat.fireMissile(f)) this.missileCool = sk.missileCool;
    } else if (w.group === 1 && w.lock.locked && dist > gunZone && this.missileCool <= 0 && angLos < 45 * DEG && this.combat.threats(en).length < inFlight) {
      if (this.combat.fireMissile(f)) this.missileCool = sk.missileCool;
    }

    // speed: turning fights live near corner speed, a tail chase wants a bit more than the target
    const corner = maxV * 0.46;
    // too slow to turn: unload (lower the nose) and let the speed come back instead of pulling into a stall
    if (fl.speed < corner * 0.8 && angLos > 25 * DEG) {
      out.y = Math.min(out.y, -0.12);
      out.normalize();
    }
    return angLos > 40 * DEG ? corner : clamp(en.vel.length() + 40 + (dist - 500) * 0.05, corner, Math.min(maxV * 0.62, 360));
  }
}
