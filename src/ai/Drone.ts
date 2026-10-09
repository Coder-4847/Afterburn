import { Vector3 } from 'three';
import { DEG, clamp } from '../core/math';
import { MouseAim } from '../flight/MouseAim';
import { scanTerrain, type TerrainThreat } from '../flight/TerrainAssist';
import type { Combat } from '../weapons/Combat';
import type { Brain, Fighter } from '../weapons/Fighter';

export interface DroneOpts {
  /** Centre of the orbit (x, z) and its radius, altitude (MSL) and speed. */
  cx: number;
  cz: number;
  radius: number;
  altitude: number;
  speed: number;
  /** +1 / -1: direction of the orbit. */
  dir: 1 | -1;
}

const UP = new Vector3(0, 1, 0);
const _d = new Vector3();
const _t = new Vector3();
const _r = new Vector3();
const _p = new Vector3();
const _v = new Vector3();

/**
 * Training-range pilot. Flies a lazy orbit; when a missile is inbound it deploys the right countermeasure and
 * breaks across the missile's path; when shot at it jinks. In hostile mode it also hunts the nearest enemy
 * fighter, using guns inside ~1 km and missiles when it has a lock.
 */
export class DroneBrain implements Brain {
  hostile = false;
  private aim = new MouseAim();
  private cmd = { pitch: 0, roll: 0, yaw: 0 };
  private threat: TerrainThreat = { time: Infinity };
  private evade = 0;
  private evadeSide = 1;
  private cmCool = 0;
  private missileCool = 6 + Math.random() * 6;
  private breakOff = 0;
  private jinkT = 0;
  private jink = 0;
  private enemy: Fighter | null = null;
  private scanT = 0;
  /** Gun discipline: short bursts with a pause, so a hostile drone is dangerous but not a laser. */
  private burst = 0;
  private burstRest = 1;

  constructor(private combat: Combat, private opts: DroneOpts) {}

  /** Start a fresh life: forget targets and timers. */
  reset(f: Fighter): void {
    this.evade = 0;
    this.breakOff = 0;
    this.enemy = null;
    this.missileCool = 6 + Math.random() * 6;
    this.aim.snapTo(f.aircraft.flight);
  }

  update(f: Fighter, dt: number): void {
    const fl = f.aircraft.flight;
    const c = f.aircraft.controls;
    const w = f.weapons;
    const o = this.opts;
    this.cmCool -= dt;
    this.missileCool -= dt;
    this.breakOff -= dt;
    this.jinkT -= dt;
    this.scanT -= dt;

    // ---- threat awareness ----
    const threats = this.combat.threats(f).filter((t) => t.eta < 9);
    if (threats.length > 0) {
      const th = threats[0];
      if (this.evade <= 0) this.evadeSide = Math.random() < 0.5 ? -1 : 1;
      this.evade = 3.5;
      if (this.cmCool <= 0 && th.eta < 4.2) {
        if (th.missile.kind === 'ir') this.combat.dispense(f, 'flare', 1);
        else this.combat.dispense(f, 'chaff', 1);
        this.cmCool = th.missile.kind === 'ir' ? 1.1 : 2.2;
      }
      // beam the missile: fly perpendicular to the line of sight, alternating climb / dive
      _r.copy(th.missile.pos).sub(f.pos);
      _r.y = 0;
      if (_r.lengthSq() < 1) _r.set(0, 0, -1);
      _r.normalize();
      _d.crossVectors(_r, UP).multiplyScalar(this.evadeSide);
      _d.y = Math.sin(this.clockWobble(f) * 1.7) * 0.4;
    } else if (f.sinceHit < 1.2 && this.jinkT <= 0) {
      this.jink = Math.random() < 0.5 ? -1 : 1;
      this.jinkT = 1.1;
    }
    this.evade -= dt;

    // ---- decide where to go ----
    let speed = o.speed;
    let ab = false;
    const evading = threats.length > 0 || this.evade > 0;
    if (evading && threats.length === 0) {
      // the missile is gone: keep the last break going a moment
      _d.crossVectors(_r, UP).multiplyScalar(this.evadeSide);
    }
    if (evading) {
      speed = fl.def.flight.maxSpeed * 0.62;
      ab = false;
    } else {
      const en = this.hostile ? this.pickEnemy(f) : null;
      if (en && this.breakOff <= 0) {
        speed = this.attack(f, en, dt, _d);
        ab = fl.speed < speed - 40;
      } else if (this.breakOff > 0 && this.enemy) {
        // overshoot: pull away from the enemy, nose up
        _d.copy(f.pos).sub(this.enemy.pos);
        _d.y = 0;
        _d.normalize();
        _d.y = 0.35;
        speed = fl.def.flight.maxSpeed * 0.7;
        ab = true;
      } else {
        this.orbit(f, _d);
        if (this.jinkT > 0) {
          _d.x += this.jink * 0.45 * Math.cos(f.clock * 3);
          _d.y += this.jink * 0.3 * Math.sin(f.clock * 4);
        }
      }
    }

    // ---- terrain avoidance beats everything ----
    scanTerrain(fl, this.combat.env as never, 5, this.threat);
    if (this.threat.time < 5 || fl.agl < 110) {
      _d.y = Math.max(_d.y, 0.55);
    }

    // ---- flight controls via the same control law the player uses ----
    _d.normalize();
    this.aim.aim.copy(_d);
    this.aim.clampToNose(fl);
    this.aim.compute(fl, fl.difficulty, this.cmd);
    c.pitch = this.cmd.pitch;
    c.roll = this.cmd.roll;
    c.yaw = this.cmd.yaw;
    c.throttle = clamp(0.62 + (speed - fl.speed) * 0.02, 0.2, 1);
    c.afterburner = ab || fl.speed < speed - 70;
    c.gearDown = false;
    c.airbrake = false;
    void w;
  }

  private clockWobble(f: Fighter): number {
    return f.clock;
  }

  /** Circle the orbit centre at the set altitude, easing back onto the circle if pushed off it. */
  private orbit(f: Fighter, out: Vector3): void {
    const o = this.opts;
    const p = f.pos;
    _p.set(p.x - o.cx, 0, p.z - o.cz);
    const dist = Math.max(1, _p.length());
    _t.set(-_p.z, 0, _p.x).multiplyScalar((o.dir) / dist); // tangent
    const k = clamp((dist - o.radius) / (o.radius * 0.5), -1, 1.4);
    out.copy(_t).addScaledVector(_p, (-k * 1.1) / dist);
    out.y = clamp((o.altitude - p.y) / 350, -0.35, 0.35);
  }

  private pickEnemy(f: Fighter): Fighter | null {
    if (this.scanT > 0 && this.enemy?.alive) return this.enemy;
    this.scanT = 1;
    let best: Fighter | null = null;
    let bd = 7000 * 7000;
    for (const o of this.combat.fighters) {
      if (o.team === f.team || !o.alive) continue;
      const d = o.pos.distanceToSquared(f.pos);
      if (d < bd) {
        bd = d;
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

  /** Pursue and shoot. Returns the speed to fly at. */
  private attack(f: Fighter, en: Fighter, dt: number, out: Vector3): number {
    const fl = f.aircraft.flight;
    const w = f.weapons;
    _r.copy(en.pos).sub(f.pos);
    const dist = _r.length();
    // lead pursuit: aim where the enemy will be when a bullet / we arrive
    const tt = clamp(dist / Math.max(300, fl.speed + 400), 0, 2.5);
    _v.copy(en.pos).addScaledVector(en.vel, tt * 0.8).sub(f.pos);
    out.copy(_v).normalize();
    // don't dive into the sea chasing a low target
    if (f.pos.y < 250) out.y = Math.max(out.y, 0.1);

    fl.forward(_p);
    const ang = Math.acos(clamp(_p.dot(_v.normalize()), -1, 1));

    // choose weapons: IR first, then radar
    if (w.remaining('ir') > 0 && w.group !== 0) w.selectGroup(0);
    else if (w.remaining('ir') === 0 && w.remaining('radar') > 0 && w.group !== 1) w.selectGroup(1);
    if (w.target !== en) w.target = en;

    this.burstRest -= dt;
    if (this.burst > 0) {
      this.burst -= dt;
      if (this.burst <= 0) this.burstRest = 1.3 + Math.random();
    }
    if (this.burst <= 0 && this.burstRest <= 0 && dist < 950 && ang < 2.2 * DEG) this.burst = 0.7;
    if (this.burst > 0) this.combat.fireGun(f, dt);
    if (this.missileCool <= 0 && w.lock.locked && ang < 25 * DEG && dist > 700 && (w.group === 0 || w.group === 1)) {
      if (this.combat.fireMissile(f)) this.missileCool = 14 + Math.random() * 8;
    }
    if (dist < 260) this.breakOff = 2.2;
    return clamp(en.vel.length() + (dist - 700) * 0.12, 160, fl.def.flight.maxSpeed * 0.85);
  }
}
