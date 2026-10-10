import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, MeshStandardMaterial, Mesh, BoxGeometry, Quaternion, Scene,
  Vector3,
} from 'three';
import { weaponMesh } from '../aircraft/ProceduralJet';
import type { JetMaterials } from '../aircraft/Materials';
import type { DamageEvent } from '../damage/DamageModel';
import { DEG, clamp } from '../core/math';
import { Emitter } from '../core/Emitter';
import { BULLET_LIFE, GRAVITY, STORES, type BombDef, type MissileDef, type PodDef } from '../data/weapons';
import type { ParticleSystem } from '../render/Particles';
import type { SurfaceInfo } from '../flight/FlightModel';
import type { Fighter, FighterHooks } from './Fighter';
import { AirDummy, GroundTarget, SimpleTarget } from './Targets';
import type { Attacker, CombatEvent, SegHit, Target, Team } from './types';
import { GROUPS } from './WeaponSystem';

/** The slice of the audio system Combat needs (a no-op implementation is used when audio is off). */
export interface CombatAudio {
  gun(pos: Vector3): void;
  missileLaunch(pos: Vector3): void;
  rocket(pos: Vector3): void;
  explosion(pos: Vector3, size: number): void;
  hit(pos: Vector3): void;
  flare(pos: Vector3): void;
  rip(pos: Vector3): void;
}

export const NULL_AUDIO: CombatAudio = { gun() {}, missileLaunch() {}, rocket() {}, explosion() {}, hit() {}, flare() {}, rip() {} };

export interface Env {
  surfaceAt(x: number, z: number, out: SurfaceInfo): SurfaceInfo;
}

// ---- scratch ------------------------------------------------------------------------------------
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _v5 = new Vector3();
const _q = new Quaternion();
const _hit: SegHit = { t: 0, point: new Vector3(), moduleId: '' };
const _surf: SurfaceInfo = { height: 0, onRunway: false, onApron: false };
const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, -1);

interface Missile {
  id: number;
  def: MissileDef;
  owner: Fighter;
  target: Target | null;
  decoy: Decoy | null;
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  speed: number;
  age: number;
  tracking: boolean;
  lostTimer: number;
  checkTimer: number;
  trailAcc: number;
  mesh: Group;
  alive: boolean;
  /** Radar seeker blinded by a notch until this age. */
  blindUntil: number;
}

interface Rocket {
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  age: number;
  def: PodDef;
  owner: Fighter;
  alive: boolean;
  trailAcc: number;
}

interface Bomb {
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  def: BombDef;
  owner: Fighter;
  target: Target | null;
  mesh: Group;
  alive: boolean;
  age: number;
}

interface Decoy {
  kind: 'flare' | 'chaff';
  pos: Vector3;
  vel: Vector3;
  age: number;
  life: number;
  team: Team;
  alive: boolean;
  trailAcc: number;
}

interface Debris {
  mesh: Group;
  vel: Vector3;
  spin: Vector3;
  age: number;
  life: number;
  trailAcc: number;
}

const MAX_BULLETS = 2200;
const MAX_ROCKETS = 120;

let missileIds = 1;

/**
 * Owns every projectile, decoy, missile and bit of debris, resolves hits and explosions, and turns damage
 * events into smoke, fire and kill credit. Runs at the fixed 60 Hz tick; `render()` just poses the meshes.
 */
export class Combat implements FighterHooks {
  readonly fighters: Fighter[] = [];
  readonly ground: GroundTarget[] = [];
  readonly dummies: AirDummy[] = [];
  readonly events = new Emitter<CombatEvent>();
  audio: CombatAudio = NULL_AUDIO;
  clock = 0;
  readonly root = new Group();

  private byId = new Map<number, Fighter>();
  private missiles: Missile[] = [];
  private rockets: Rocket[] = [];
  private bombs: Bomb[] = [];
  private decoys: Decoy[] = [];
  private debris: Debris[] = [];

  // bullets (struct of arrays for speed)
  private bx = new Float32Array(MAX_BULLETS * 3);
  private bv = new Float32Array(MAX_BULLETS * 3);
  private bAge = new Float32Array(MAX_BULLETS).fill(99);
  private bDmg = new Float32Array(MAX_BULLETS);
  private bTracer = new Uint8Array(MAX_BULLETS);
  private bOwner: (Fighter | null)[] = new Array(MAX_BULLETS).fill(null);
  private bHead = 0;
  private bHigh = 0;
  private tracerGeo: BufferGeometry;
  private tracerPos: Float32Array;
  private tracerCol: Float32Array;
  private tracerCount = 0;

  private mats: JetMaterials;
  private flat = new BoxGeometry(1, 1, 1);

  constructor(readonly scene: Scene, readonly env: Env, readonly smoke: ParticleSystem, readonly fire: ParticleSystem) {
    this.scene.add(this.root);
    this.mats = {
      strut: new MeshStandardMaterial({ color: 0xd4d8dc, metalness: 0.5, roughness: 0.4 }),
      dark: new MeshStandardMaterial({ color: 0x30343a, metalness: 0.5, roughness: 0.5 }),
    } as unknown as JetMaterials;

    this.tracerPos = new Float32Array(MAX_BULLETS * 6);
    this.tracerCol = new Float32Array(MAX_BULLETS * 6);
    this.tracerGeo = new BufferGeometry();
    this.tracerGeo.setAttribute('position', new BufferAttribute(this.tracerPos, 3).setUsage(35048));
    this.tracerGeo.setAttribute('color', new BufferAttribute(this.tracerCol, 3).setUsage(35048));
    const lines = new LineSegments(this.tracerGeo, new LineBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    lines.frustumCulled = false;
    lines.renderOrder = 15;
    this.root.add(lines);
    void this.flat;
  }

  /** Remove everything this combat manager put in the scene (used when a sortie is rebuilt). */
  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
    });
    this.tracerGeo.dispose();
    this.flat.dispose();
    for (const m of [...this.missiles, ...this.bombs]) m.mesh.traverse((o) => (o as Mesh).geometry?.dispose());
    this.fighters.length = 0;
    this.byId.clear();
  }

  // ---- registry --------------------------------------------------------------------------------

  addFighter(f: Fighter): void {
    f.hooks = this;
    this.fighters.push(f);
    this.byId.set(f.id, f);
  }

  removeFighter(f: Fighter): void {
    const i = this.fighters.indexOf(f);
    if (i >= 0) this.fighters.splice(i, 1);
    this.byId.delete(f.id);
    f.hooks = null;
  }

  addGround(t: GroundTarget): void {
    this.ground.push(t);
    this.root.add(t.mesh);
    t.onKilled = (tt, k, w) => this.simpleKilled(tt, k, w);
  }

  addDummy(t: AirDummy): void {
    this.dummies.push(t);
    this.root.add(t.mesh);
    t.onKilled = (tt, k, w) => this.simpleKilled(tt, k, w);
  }

  clearRange(): void {
    for (const t of [...this.ground, ...this.dummies]) {
      this.root.remove(t.mesh);
      t.mesh.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const mat = m.material;
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
      });
    }
    this.ground.length = 0;
    this.dummies.length = 0;
  }

  /** Every living target, optionally only those hostile to a team. */
  targets(hostileTo?: Team): Target[] {
    const out: Target[] = [];
    for (const f of this.fighters) if (f.alive && (!hostileTo || f.team !== hostileTo)) out.push(f);
    for (const d of this.dummies) if (d.alive && (!hostileTo || d.team !== hostileTo)) out.push(d);
    for (const g of this.ground) if (g.alive && (!hostileTo || g.team !== hostileTo)) out.push(g);
    return out;
  }

  /** Terrain line-of-sight between two points (coarse sampling). */
  los = (a: Vector3, b: Vector3): boolean => {
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = a.y + (b.y - a.y) * t;
      if (y < this.env.surfaceAt(x, z, _surf).height) return false;
    }
    return true;
  };

  // ---- target selection ------------------------------------------------------------------------

  private candidates(f: Fighter): Target[] {
    const ground = f.weapons.group >= 2;
    return this.targets(f.team).filter((t) => (t.kind === 'ground') === ground && t.pos.distanceToSquared(f.pos) < 22000 * 22000);
  }

  /** Tab: next target by distance in front of us. */
  cycleTarget(f: Fighter): void {
    const fl = f.aircraft.flight;
    fl.forward(_v1);
    const all = this.candidates(f)
      .map((t) => {
        _v2.copy(t.pos).sub(fl.pos);
        const d = _v2.length();
        const ang = Math.acos(clamp(_v1.dot(_v2) / (d || 1), -1, 1));
        return { t, d, ang };
      })
      .sort((a, b) => a.d - b.d);
    // prefer what is in front of us, but with nothing there pick the nearest anywhere (the HUD arrow then shows where it is)
    const front = all.filter((c) => c.ang < 100 * DEG);
    const list = front.length ? front : all;
    if (list.length === 0) {
      f.weapons.target = null;
      return;
    }
    const cur = list.findIndex((c) => c.t === f.weapons.target);
    f.weapons.target = list[(cur + 1) % list.length].t;
    f.weapons.lock.progress = 0;
    f.weapons.lock.locked = false;
  }

  /** Y: the target closest to where the reticle points. */
  pickToward(f: Fighter, dir: Vector3): void {
    const fl = f.aircraft.flight;
    let best: Target | null = null;
    let bestAng = 35 * DEG;
    for (const t of this.candidates(f)) {
      _v2.copy(t.pos).sub(fl.pos);
      const ang = Math.acos(clamp(dir.dot(_v2) / (_v2.length() || 1), -1, 1));
      if (ang < bestAng) {
        bestAng = ang;
        best = t;
      }
    }
    f.weapons.target = best;
    f.weapons.lock.progress = 0;
    f.weapons.lock.locked = false;
  }

  // ---- firing ---------------------------------------------------------------------------------

  private muzzle(f: Fighter, out: Vector3): Vector3 {
    const L = f.aircraft.def.model.length;
    out.set(0.5, 0.15, -L * 0.3).applyQuaternion(f.aircraft.flight.quat).add(f.aircraft.flight.pos);
    return out;
  }

  /** Hold the trigger: spawn the bullets owed this tick. */
  fireGun(f: Fighter, dt: number): void {
    const w = f.weapons;
    if (!f.alive || w.gunAmmo <= 0) return;
    const gp = w.gun;
    w.gunAcc += dt * gp.rate;
    let n = Math.floor(w.gunAcc);
    w.gunAcc -= n;
    n = Math.min(n, w.gunAmmo);
    if (n <= 0) return;
    const fl = f.aircraft.flight;
    fl.forward(_v1);
    this.muzzle(f, _v2);
    for (let i = 0; i < n; i++) {
      const idx = this.bHead;
      this.bHead = (this.bHead + 1) % MAX_BULLETS;
      if (idx + 1 > this.bHigh) this.bHigh = idx + 1;
      const sp = gp.spread;
      _v3.copy(_v1);
      _v3.x += (Math.random() * 2 - 1) * sp;
      _v3.y += (Math.random() * 2 - 1) * sp;
      _v3.z += (Math.random() * 2 - 1) * sp;
      _v3.normalize();
      const k = idx * 3;
      const lead = (i / n) * dt; // spread the bullets of one tick along the path
      this.bx[k] = _v2.x + fl.vel.x * lead; this.bx[k + 1] = _v2.y + fl.vel.y * lead; this.bx[k + 2] = _v2.z + fl.vel.z * lead;
      this.bv[k] = _v3.x * gp.muzzleVelocity + fl.vel.x;
      this.bv[k + 1] = _v3.y * gp.muzzleVelocity + fl.vel.y;
      this.bv[k + 2] = _v3.z * gp.muzzleVelocity + fl.vel.z;
      this.bAge[idx] = 0;
      this.bDmg[idx] = gp.damage;
      this.bTracer[idx] = w.gunAmmo % 3 === 0 ? 1 : 0;
      this.bOwner[idx] = f;
      w.gunAmmo--;
      f.stats.shots++;
    }
    // muzzle flash
    this.fire.emit(_v2.x, _v2.y, _v2.z, 0, 0, 0, 0.06, 1.4, 0.3, 3, 2.2, 1.2, 0.8);
    this.audio.gun(_v2);
  }

  private stationWorld(f: Fighter, i: number, out: Vector3): Vector3 {
    const st = f.loadout.arm.stations[i];
    const fl = f.aircraft.flight;
    return out.set(st.x, st.y - 0.25, st.z).applyQuaternion(fl.quat).add(fl.pos);
  }

  /** RMB with an IR/radar group selected. Returns false if nothing could be fired. */
  fireMissile(f: Fighter): boolean {
    const w = f.weapons;
    if (!f.alive || w.cooldown > 0) return false;
    const kind = w.kind;
    if (kind !== 'ir' && kind !== 'radar') return false;
    const si = w.nextStation(kind);
    if (si < 0) return false;
    // radar missiles need a lock; IR can be fired uncaged and will search for heat
    const tgt = w.target;
    if (kind === 'radar' && !(tgt && w.lock.locked)) return false;
    const def = STORES[w.items[si]!] as MissileDef;
    const fl = f.aircraft.flight;
    this.stationWorld(f, si, _v1);
    fl.forward(_v2);
    const m: Missile = {
      id: missileIds++, def, owner: f, target: kind === 'radar' ? tgt : tgt && w.lock.locked ? tgt : null, decoy: null,
      pos: _v1.clone(), prev: _v1.clone(), vel: fl.vel.clone().addScaledVector(_v2, 20), speed: 0, age: 0,
      tracking: !!tgt, lostTimer: 0, checkTimer: 0, trailAcc: 0, mesh: this.makeMissileMesh(def), alive: true, blindUntil: 0,
    };
    m.speed = m.vel.length();
    // IR missiles may be fired at a visible-but-unlocked target: the seeker will try to find it
    if (kind === 'ir' && tgt && !w.lock.locked && w.lock.tracking) m.target = tgt;
    m.vel.y -= 2; // ejector drop
    this.missiles.push(m);
    this.root.add(m.mesh);
    w.consume(si);
    f.hideStore(si);
    w.cooldown = 0.7;
    f.stats.shots++;
    this.events.emit({ type: 'launch', shooter: f, weapon: def.name });
    this.audio.missileLaunch(m.pos);
    this.fire.emit(m.pos.x, m.pos.y, m.pos.z, 0, 0, 0, 0.35, 3, 12, 3, 2.4, 1.6, 0.9);
    return true;
  }

  private makeMissileMesh(def: MissileDef): Group {
    const g = new Group();
    const m = weaponMesh(def, this.mats);
    g.add(m);
    return g;
  }

  /** Ripple-fire rockets while RMB is held. */
  fireRockets(f: Fighter, dt: number): void {
    const w = f.weapons;
    if (!f.alive) return;
    w.rocketAcc += dt * 14;
    while (w.rocketAcc >= 1) {
      w.rocketAcc -= 1;
      const si = w.nextStation('rocket');
      if (si < 0) return;
      const def = STORES[w.items[si]!] as PodDef;
      if (this.rockets.length >= MAX_ROCKETS) return;
      const fl = f.aircraft.flight;
      fl.forward(_v2);
      this.stationWorld(f, si, _v1);
      _v3.copy(_v2);
      _v3.x += (Math.random() - 0.5) * 0.014;
      _v3.y += (Math.random() - 0.5) * 0.014;
      _v3.normalize();
      this.rockets.push({
        pos: _v1.clone(), prev: _v1.clone(), vel: fl.vel.clone().addScaledVector(_v3, 60), age: 0, def, owner: f, alive: true, trailAcc: 0,
      });
      w.consume(si);
      f.stats.shots++;
      this.audio.rocket(_v1);
    }
  }

  dropBomb(f: Fighter): boolean {
    const w = f.weapons;
    if (!f.alive || w.cooldown > 0) return false;
    const si = w.nextStation('bomb');
    if (si < 0) return false;
    const def = STORES[w.items[si]!] as BombDef;
    const fl = f.aircraft.flight;
    this.stationWorld(f, si, _v1);
    const tgt = def.guided && w.lock.locked ? w.target : null;
    const mesh = new Group();
    mesh.add(weaponMesh(def, this.mats));
    this.root.add(mesh);
    this.bombs.push({ pos: _v1.clone(), prev: _v1.clone(), vel: fl.vel.clone(), def, owner: f, target: tgt, mesh, alive: true, age: 0 });
    w.consume(si);
    f.hideStore(si);
    w.cooldown = 0.5;
    f.stats.shots++;
    this.audio.rocket(_v1);
    return true;
  }

  /** Queue flares (a burst) or chaff. Returns false if the magazine is empty. */
  dispense(f: Fighter, kind: 'flare' | 'chaff', count = 1): boolean {
    const w = f.weapons;
    if (!f.alive) return false;
    if (kind === 'flare') {
      if (w.flares <= 0) return false;
      w.flareBurst += count;
    } else {
      if (w.chaff <= 0) return false;
      w.chaffBurst += count;
    }
    return true;
  }

  private spawnDecoy(f: Fighter, kind: 'flare' | 'chaff'): void {
    const fl = f.aircraft.flight;
    const L = f.aircraft.def.model.length;
    _v1.set((Math.random() - 0.5) * 3, -0.7, L * 0.38).applyQuaternion(fl.quat).add(fl.pos);
    // thrown out and down, then it falls behind as the air drags it
    _v2.set((Math.random() - 0.5) * 2, -1, 0.2).normalize().applyQuaternion(fl.quat);
    const d: Decoy = {
      kind, pos: _v1.clone(), vel: fl.vel.clone().multiplyScalar(0.85).addScaledVector(_v2, kind === 'flare' ? 28 : 18),
      age: 0, life: kind === 'flare' ? 5.5 : 6.5, team: f.team, alive: true, trailAcc: 0,
    };
    this.decoys.push(d);
    if (kind === 'chaff') {
      for (let i = 0; i < 38; i++) {
        this.smoke.emit(d.pos.x, d.pos.y, d.pos.z, d.vel.x + (Math.random() - 0.5) * 36, d.vel.y + (Math.random() - 0.5) * 36, d.vel.z + (Math.random() - 0.5) * 36, 2.5 + Math.random() * 2.5, 0.6, 1.4, 0.85, 0.9, 1, 0.55, 1.4);
      }
    }
    this.audio.flare(d.pos);
  }

  // ---- simulation tick -----------------------------------------------------------------------

  update(dt: number): void {
    this.clock += dt;
    const hostileCache = new Map<Team, Target[]>();
    const hostile = (team: Team): Target[] => {
      let l = hostileCache.get(team);
      if (!l) {
        l = this.targets(team);
        hostileCache.set(team, l);
      }
      return l;
    };

    // AI fighters: brain, damage/fuel, then physics (the player's are stepped by Game)
    for (const f of this.fighters) {
      if (f.isPlayer) continue;
      if (f.state === 'alive') {
        f.brain?.update(f, dt);
        f.prePhysics(dt);
        f.aircraft.flight.step(dt, f.aircraft.controls, this.env as never);
        if (f.aircraft.flight.crashed) this.crashFighter(f, f.aircraft.flight.crashed);
      } else if (f.state === 'wreck') {
        f.prePhysics(dt);
        f.aircraft.flight.step(dt, f.aircraft.controls, this.env as never);
      } else {
        f.respawn -= dt;
      }
    }

    for (const f of this.fighters) {
      const w = f.weapons;
      w.cooldown = Math.max(0, w.cooldown - dt);
      if (f.state === 'alive') {
        w.updateLock(dt, this.los);
        this.countermeasureQueue(f, dt);
      }
      if (f.state === 'wreck') this.updateWreck(f, dt);
      else if (f.state === 'alive') this.damageEffects(f, dt);
    }

    this.updateBullets(dt, hostile);
    this.updateRockets(dt, hostile);
    this.updateBombs(dt, hostile);
    this.updateDecoys(dt);
    this.updateMissiles(dt, hostile);
    this.updateDebris(dt);
    for (const t of this.dummies) t.update(dt);
    for (const t of this.ground) {
      t.update(dt);
      if (!t.alive && Math.random() < dt * 14) this.smoke.emit(t.pos.x + (Math.random() - 0.5) * 3, t.pos.y + 1, t.pos.z + (Math.random() - 0.5) * 3, 0, 5 + Math.random() * 3, 0, 4, 2, 10, 0.07, 0.07, 0.08, 0.5, 0.2, -1);
    }
  }

  private countermeasureQueue(f: Fighter, dt: number): void {
    const w = f.weapons;
    w.cmTimer -= dt;
    if (w.cmTimer > 0) return;
    if (w.flareBurst > 0 && w.flares > 0) {
      w.flareBurst--;
      w.flares--;
      this.spawnDecoy(f, 'flare');
      w.cmTimer = 0.11;
    } else if (w.chaffBurst > 0 && w.chaff > 0) {
      w.chaffBurst--;
      w.chaff--;
      this.spawnDecoy(f, 'chaff');
      w.cmTimer = 0.3;
    } else {
      w.flareBurst = Math.min(w.flareBurst, w.flares);
      w.chaffBurst = Math.min(w.chaffBurst, w.chaff);
    }
  }

  // ---- bullets ----------------------------------------------------------------------------

  private updateBullets(dt: number, hostile: (t: Team) => Target[]): void {
    const n = this.bHigh;
    let tc = 0;
    let alive = false;
    for (let i = 0; i < n; i++) {
      if (this.bAge[i] >= BULLET_LIFE) continue;
      alive = true;
      const k = i * 3;
      const owner = this.bOwner[i]!;
      _v1.set(this.bx[k], this.bx[k + 1], this.bx[k + 2]);
      this.bv[k + 1] -= GRAVITY * dt;
      _v2.set(this.bx[k] + this.bv[k] * dt, this.bx[k + 1] + this.bv[k + 1] * dt, this.bx[k + 2] + this.bv[k + 2] * dt);
      this.bAge[i] += dt;

      let hitT: Target | null = null;
      let best = 2;
      const list = hostile(owner.team);
      for (let j = 0; j < list.length; j++) {
        const t = list[j];
        if (t === owner) continue;
        if (t.segmentHit(_v1, _v2, _hit) && _hit.t < best) {
          best = _hit.t;
          hitT = t;
          _v3.copy(_hit.point);
        }
      }
      if (hitT) {
        _hit.point.copy(_v3);
        // segmentHit left its module id in _hit for the *last* tested target; re-run on the winner
        hitT.segmentHit(_v1, _v2, _hit);
        this.bulletHit(owner, hitT, this.bDmg[i], _hit);
        this.bAge[i] = 99;
        continue;
      }
      const ground = this.env.surfaceAt(_v2.x, _v2.z, _surf).height;
      if (_v2.y < ground) {
        const sea = ground <= 0.01;
        this.fire.emit(_v2.x, ground + 0.4, _v2.z, 0, 4, 0, sea ? 0.35 : 0.2, 1, sea ? 5 : 2.5, sea ? 1.1 : 2, sea ? 1.2 : 1.4, sea ? 1.3 : 1, 0.5, 2);
        this.bAge[i] = 99;
        continue;
      }
      this.bx[k] = _v2.x; this.bx[k + 1] = _v2.y; this.bx[k + 2] = _v2.z;
      if (this.bTracer[i]) {
        // a tracer is a short streak along the velocity: bright head, dim tail
        const o = tc * 6;
        const sx = this.bv[k] * 0.022, sy = this.bv[k + 1] * 0.022, sz = this.bv[k + 2] * 0.022;
        this.tracerPos[o] = _v2.x - sx; this.tracerPos[o + 1] = _v2.y - sy; this.tracerPos[o + 2] = _v2.z - sz;
        this.tracerPos[o + 3] = _v2.x; this.tracerPos[o + 4] = _v2.y; this.tracerPos[o + 5] = _v2.z;
        this.tracerCol[o] = 0.5; this.tracerCol[o + 1] = 0.18; this.tracerCol[o + 2] = 0.05;
        this.tracerCol[o + 3] = 3.2; this.tracerCol[o + 4] = 2.2; this.tracerCol[o + 5] = 0.9;
        tc++;
      }
    }
    if (!alive) this.bHigh = 0;
    this.tracerCount = tc;
  }

  private bulletHit(owner: Fighter, t: Target, dmg: number, h: SegHit): void {
    owner.stats.hits++;
    owner.stats.damage += dmg;
    t.hit(h, dmg, owner, 'Cannon', Math.random() < 0.04);
    this.fire.emit(h.point.x, h.point.y, h.point.z, (Math.random() - 0.5) * 12, (Math.random() - 0.3) * 12, (Math.random() - 0.5) * 12, 0.16, 0.5, 0.1, 3, 2, 0.8, 0.9, 1.5);
    this.audio.hit(h.point);
    if (!(t instanceof Object && 'segmentHit' in t && (t as Fighter).damage)) {
      // non-fighter targets don't call back through the fighter hook
      this.events.emit({ type: 'hit', attacker: owner, victim: t, damage: dmg, weapon: 'Cannon', point: h.point.clone() });
    }
  }

  // ---- rockets and bombs -----------------------------------------------------------------

  private updateRockets(dt: number, hostile: (t: Team) => Target[]): void {
    for (const r of this.rockets) {
      if (!r.alive) continue;
      r.age += dt;
      r.prev.copy(r.pos);
      const sp = r.vel.length();
      if (r.age < r.def.burn) {
        _v1.copy(r.vel).multiplyScalar(1 / (sp || 1));
        r.vel.addScaledVector(_v1, r.def.accel * dt);
      }
      r.vel.y -= GRAVITY * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.trailAcc += sp * dt;
      if (r.trailAcc > 9) {
        r.trailAcc = 0;
        this.smoke.emit(r.pos.x, r.pos.y, r.pos.z, 0, 0, 0, 2.2, 0.5, 3.4, 0.9, 0.9, 0.92, 0.5, 0.3);
      }
      if (r.age < r.def.burn) this.fire.emit(r.pos.x, r.pos.y, r.pos.z, 0, 0, 0, 0.06, 0.9, 0.2, 3, 1.8, 0.8, 0.7);
      let hit = false;
      for (const t of hostile(r.owner.team)) {
        if (t === r.owner) continue;
        if (t.segmentHit(r.prev, r.pos, _hit)) {
          this.detonate(_hit.point, r.def.blastRadius, r.def.warhead, r.owner, r.def.name, 9);
          hit = true;
          break;
        }
      }
      if (!hit) {
        const g = this.env.surfaceAt(r.pos.x, r.pos.z, _surf).height;
        if (r.pos.y < g) {
          _v2.set(r.pos.x, g, r.pos.z);
          this.detonate(_v2, r.def.blastRadius, r.def.warhead, r.owner, r.def.name, 8);
          hit = true;
        }
      }
      if (hit || r.age > 9) r.alive = false;
    }
    this.rockets = this.rockets.filter((r) => r.alive);
  }

  private updateBombs(dt: number, hostile: (t: Team) => Target[]): void {
    for (const b of this.bombs) {
      if (!b.alive) continue;
      b.age += dt;
      b.prev.copy(b.pos);
      b.vel.y -= GRAVITY * dt;
      if (b.target && b.target.alive && b.def.guided) {
        // fins steer the bomb toward the designated point, within a limited turn rate
        _v1.copy(b.target.pos).sub(b.pos).normalize().multiplyScalar(b.vel.length());
        _v1.sub(b.vel);
        const l = _v1.length();
        if (l > 1e-3) b.vel.addScaledVector(_v1, Math.min(1, (45 * dt) / l));
      }
      b.pos.addScaledVector(b.vel, dt);
      let hit = false;
      for (const t of hostile(b.owner.team)) {
        if (t === b.owner) continue;
        if (t.segmentHit(b.prev, b.pos, _hit)) {
          this.detonate(_hit.point, b.def.blastRadius, b.def.warhead, b.owner, b.def.name, 22);
          hit = true;
          break;
        }
      }
      if (!hit) {
        const g = this.env.surfaceAt(b.pos.x, b.pos.z, _surf).height;
        if (b.pos.y < g) {
          _v2.set(b.pos.x, Math.max(g, 0), b.pos.z);
          this.detonate(_v2, b.def.blastRadius, b.def.warhead, b.owner, b.def.name, 24);
          hit = true;
        }
      }
      if (hit || b.age > 60) {
        b.alive = false;
        this.root.remove(b.mesh);
      }
    }
    this.bombs = this.bombs.filter((b) => b.alive);
  }

  // ---- decoys ---------------------------------------------------------------------------------

  private updateDecoys(dt: number): void {
    for (const d of this.decoys) {
      d.age += dt;
      if (d.age >= d.life) {
        d.alive = false;
        continue;
      }
      d.vel.x *= 1 - dt * 0.55;
      d.vel.z *= 1 - dt * 0.55;
      d.vel.y -= (d.kind === 'flare' ? 4 : 1.2) * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.kind === 'flare') {
        const f = 1 - d.age / d.life;
        this.fire.emit(d.pos.x, d.pos.y, d.pos.z, 0, 0, 0, 0.12, 2.6 * (0.5 + f * 0.5), 0.8, 3, 2.7, 2.2, 0.9);
        d.trailAcc += dt;
        if (d.trailAcc > 0.06) {
          d.trailAcc = 0;
          this.smoke.emit(d.pos.x, d.pos.y, d.pos.z, 0, 0, 0, 2.6, 1, 5, 0.95, 0.95, 0.95, 0.5, 0.4);
        }
      }
    }
    this.decoys = this.decoys.filter((d) => d.alive);
  }

  // ---- missiles --------------------------------------------------------------------------------

  /** Chance-based seduction by decoys, checked a few times a second. */
  private tryDecoy(m: Missile): void {
    const t = m.target;
    if (!t || m.decoy) return;
    const radar = m.def.kind === 'radar';
    _v1.copy(t.pos).sub(m.pos);
    const dist = _v1.length();
    if (dist < 1) return;
    _v1.multiplyScalar(1 / dist);
    // how "crossing" the geometry is: head-on / tail-chase is the hardest to decoy
    const tv = t.vel.length();
    const cross = tv > 5 ? Math.sqrt(Math.max(0, 1 - Math.pow(_v1.dot(_v2.copy(t.vel).multiplyScalar(1 / tv)), 2))) : 0.5;
    let sigT: number;
    if (radar) sigT = Math.min(3, Math.pow(Math.max(t.rcs, 0.01), 0.35));
    else {
      // a missile looking at the tail sees the hot end; head-on it sees far less
      const aspect = tv > 5 ? 0.45 + 0.55 * Math.max(0, _v1.dot(_v2)) : 1;
      sigT = Math.max(0.2, t.irSignature() * aspect);
    }
    let best: Decoy | null = null;
    let bestW = 0;
    for (const d of this.decoys) {
      if (d.kind !== (radar ? 'chaff' : 'flare') || d.team === m.owner.team) continue;
      _v3.copy(d.pos).sub(m.pos);
      const dd = _v3.length();
      if (dd < 1 || dd > dist + 600) continue;
      _v3.multiplyScalar(1 / dd);
      const ang = Math.acos(clamp(_v1.dot(_v3), -1, 1));
      const fov = radar ? 0.1 + 120 / Math.max(300, dist) : 0.07 + 90 / Math.max(300, dist);
      if (ang > fov) continue;
      const fade = 1 - d.age / d.life;
      const sig = (radar ? 2.4 : 2.1) * (0.45 + 0.55 * fade);
      const w = sig / (sig + sigT);
      if (w > bestW) {
        bestW = w;
        best = d;
      }
    }
    if (!best) return;
    const closeFactor = dist < 450 ? 0.35 : 1; // a close seeker is locked on tight
    const p = m.def.decoySusceptibility * bestW * (0.4 + 0.6 * cross) * closeFactor * 0.34;
    if (Math.random() < p) m.decoy = best;
  }

  private updateMissiles(dt: number, hostile: (t: Team) => Target[]): void {
    for (const m of this.missiles) {
      if (!m.alive) continue;
      const def = m.def;
      m.age += dt;
      const bt = def.burn1 + def.burn2;
      const accel = m.age < def.burn1 ? def.accel1 : m.age < bt ? def.accel2 : 0;
      const rho = Math.max(0.3, Math.exp(-Math.max(0, m.pos.y) / 9500));
      m.speed += (accel - def.drag * rho * m.speed * m.speed) * dt;
      m.speed -= GRAVITY * (m.vel.y / (m.speed || 1)) * dt * 0.6;
      m.speed = Math.max(0, m.speed);
      if (m.age > def.flightTime || (m.age > bt && m.speed < 130)) {
        this.fizzle(m);
        continue;
      }

      // ---- seeker ----
      m.checkTimer -= dt;
      if (m.checkTimer <= 0) {
        m.checkTimer = 0.2;
        if (m.decoy && !m.decoy.alive) m.decoy = null; // the flare burned out: back to the real target if still in view
        this.tryDecoy(m);
        if (!m.target && def.kind === 'ir' && m.age > 0.25) this.acquire(m, hostile(m.owner.team));
      }
      if (m.target && !m.target.alive) m.target = null;

      let aim: Target | { pos: Vector3; vel: Vector3 } | null = null;
      if (m.decoy) aim = m.decoy;
      else if (m.target) aim = m.target;
      m.vel.normalize();
      if (aim && m.age > 0.15) {
        _v1.copy(aim.pos).sub(m.pos);
        const dist = _v1.length();
        _v1.multiplyScalar(1 / (dist || 1));
        const ang = Math.acos(clamp(m.vel.dot(_v1), -1, 1));
        let seeing = ang < def.trackCone * DEG;
        if (def.kind === 'radar' && !m.decoy && m.target && dist < def.activeRange) {
          // own radar seeker: a notch (target flying across the closing line) can blind it for a moment
          _v2.copy(m.target.vel).sub(m.vel.clone().multiplyScalar(m.speed));
          const closing = -_v2.dot(_v1);
          if (closing < 55 && m.age > m.blindUntil && Math.random() < dt * 1.6) m.blindUntil = m.age + 1.2 + Math.random();
          if (m.age < m.blindUntil) seeing = false;
        }
        if (seeing) {
          m.lostTimer = 0;
          // proportional navigation
          _v2.copy(aim.vel).sub(_v3.copy(m.vel).multiplyScalar(m.speed)); // relative velocity
          const vc = -_v2.dot(_v1);
          _v4.crossVectors(_v1, _v2).multiplyScalar(1 / (dist || 1)); // line-of-sight rate vector
          _v5.crossVectors(_v4, _v1).multiplyScalar(def.nav * Math.max(vc, 60));
          const aMax = def.maxG * GRAVITY * clamp((m.speed / 320) * (m.speed / 320), 0.04, 1) * (0.4 + 0.6 * rho);
          const am = _v5.length();
          if (am > aMax) _v5.multiplyScalar(aMax / am);
          m.vel.multiplyScalar(m.speed).addScaledVector(_v5, dt);
        } else {
          m.lostTimer += dt;
          m.vel.multiplyScalar(m.speed);
          if (m.lostTimer > 1.5 && !m.decoy) m.target = null;
        }
      } else m.vel.multiplyScalar(m.speed);
      // gravity bends an unguided missile's path down
      m.vel.y -= GRAVITY * dt * 0.7;
      const sp = m.vel.length();
      if (sp > 1) m.vel.multiplyScalar(m.speed / sp);

      m.prev.copy(m.pos);
      m.pos.addScaledVector(m.vel, dt);

      // ---- proximity fuse and terrain ----
      let boom = false;
      for (const t of hostile(m.owner.team)) {
        if (t === m.owner && m.age < 0.6) continue;
        const rad = def.fuseRadius + (t.kind === 'air' ? 0 : t.radius * 0.3);
        // closest point on this tick's path to the target
        _v1.copy(m.pos).sub(m.prev);
        const l2 = _v1.lengthSq();
        const s = l2 > 1e-6 ? clamp(_v2.copy(t.pos).sub(m.prev).dot(_v1) / l2, 0, 1) : 1;
        _v3.copy(m.prev).addScaledVector(_v1, s);
        if (_v3.distanceTo(t.pos) < rad) {
          this.detonate(_v3, def.blastRadius, def.warhead, m.owner, def.name, def.blastRadius * 0.9);
          boom = true;
          break;
        }
      }
      if (!boom) {
        const g = this.env.surfaceAt(m.pos.x, m.pos.z, _surf).height;
        if (m.pos.y < g + 0.5) {
          _v3.set(m.pos.x, Math.max(g, 0), m.pos.z);
          this.detonate(_v3, def.blastRadius * 0.8, def.warhead * 0.5, m.owner, def.name, def.blastRadius * 0.8);
          boom = true;
        }
      }
      if (boom) {
        m.alive = false;
        this.root.remove(m.mesh);
        continue;
      }

      // ---- exhaust ----
      if (m.age < bt) this.fire.emit(m.pos.x, m.pos.y, m.pos.z, 0, 0, 0, 0.08, def.length * 0.55, 0.3, 3, 2, 0.9, 0.9);
      m.trailAcc += m.speed * dt;
      if (m.trailAcc > 8) {
        m.trailAcc = 0;
        const a = m.age < bt ? 0.5 : 0.24;
        this.smoke.emit(m.pos.x, m.pos.y, m.pos.z, 0, 0, 0, 4.2, 0.7, 5.5, 0.92, 0.93, 0.95, a, 0.25);
      }
    }
    this.missiles = this.missiles.filter((m) => m.alive);
  }

  /** IR seeker search for the hottest hostile in view (uncaged launches and lost-lock recovery). */
  private acquire(m: Missile, list: Target[]): void {
    let best: Target | null = null;
    let bestScore = 0;
    for (const t of list) {
      if (t.kind !== 'air' || t === m.owner) continue;
      _v1.copy(t.pos).sub(m.pos);
      const d = _v1.length();
      if (d > 6500) continue;
      const ang = Math.acos(clamp(_v1.normalize().dot(_v2.copy(m.vel).normalize()), -1, 1));
      if (ang > m.def.acquireCone * DEG) continue;
      const score = t.irSignature() / (d * d);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) m.target = best;
  }

  private fizzle(m: Missile): void {
    m.alive = false;
    this.root.remove(m.mesh);
    this.smoke.emit(m.pos.x, m.pos.y, m.pos.z, 0, 2, 0, 3, 3, 9, 0.5, 0.5, 0.5, 0.5);
  }

  /** Is anything inbound on this fighter? Used for the missile-warning system and by AI. */
  threats(f: Fighter): { missile: { id: number; kind: 'ir' | 'radar'; pos: Vector3; vel: Vector3 }; dist: number; eta: number }[] {
    const out: { missile: { id: number; kind: 'ir' | 'radar'; pos: Vector3; vel: Vector3 }; dist: number; eta: number }[] = [];
    for (const m of this.missiles) {
      if (!m.alive || m.target !== f) continue;
      const dist = m.pos.distanceTo(f.pos);
      out.push({ missile: { id: m.id, kind: m.def.kind, pos: m.pos, vel: m.vel }, dist, eta: dist / Math.max(100, m.speed) });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /** Radar locks / tracks that hostile fighters currently have on this fighter. */
  radarLocks(f: Fighter): { by: Fighter; locked: boolean }[] {
    const out: { by: Fighter; locked: boolean }[] = [];
    for (const o of this.fighters) {
      if (o === f || o.team === f.team || !o.alive) continue;
      const w = o.weapons;
      if (w.target === f && w.kind === 'radar' && w.lock.tracking) out.push({ by: o, locked: w.lock.locked });
    }
    return out;
  }

  // ---- explosions, damage, wrecks ---------------------------------------------------------------

  /** Visual + audio + area damage. */
  detonate(point: Vector3, radius: number, warhead: number, owner: Attacker | null, weapon: string, size: number): void {
    const px = point.x, py = point.y, pz = point.z;
    for (let i = 0; i < Math.round(8 + size * 1.5); i++) {
      this.fire.emit(px, py, pz, (Math.random() - 0.5) * size * 3, (Math.random() - 0.3) * size * 3, (Math.random() - 0.5) * size * 3, 0.35 + Math.random() * 0.4, size * 0.4, size * 1.1, 3, 1.9 + Math.random() * 0.5, 0.5, 0.9, 2.5);
    }
    for (let i = 0; i < Math.round(4 + size * 0.6); i++) {
      this.smoke.emit(px, py, pz, (Math.random() - 0.5) * size * 1.4, Math.random() * size * 0.9, (Math.random() - 0.5) * size * 1.4, 2.5 + Math.random() * 2.5, size * 0.4, size * 1.6, 0.1, 0.1, 0.11, 0.55, 0.9, -1);
    }
    this.audio.explosion(point, size);
    this.events.emit({ type: 'explosion', point: point.clone(), size });
    const list = this.targets();
    for (const t of list) {
      if (owner && t.team === owner.team && t !== owner) continue; // friendly fire off
      if (owner && t === owner) continue;
      if (t.pos.distanceTo(point) > radius + t.radius + 4) continue;
      t.blast(point, radius, warhead, owner, weapon);
    }
  }

  // Fighter hooks -------------------------------------------------------------------------------

  hitEvent(attacker: Attacker | null, victim: Target, damage: number, weapon: string, point: Vector3): void {
    this.events.emit({ type: 'hit', attacker, victim, damage, weapon, point: point.clone() });
  }

  damageEvents(f: Fighter, ev: DamageEvent[], attacker: Attacker | null, weapon: string): void {
    for (const e of ev) {
      if (e.type === 'rip') {
        const ok = f.ripPart(e.part);
        this.spawnDebris(f, e.part, ok);
        this.audio.rip(f.pos);
        this.detonate(_v1.copy(f.pos), 4, 0, null, 'rip', 3);
      } else if (e.type === 'destroyed') {
        this.fighterDestroyed(f, attacker, weapon, e.reason);
      }
    }
    this.events.emit({ type: 'damage-events', victim: f, events: ev });
  }

  /** Kill credit, stats and the kill event. Does not change the fighter's state. */
  private bookKill(f: Fighter, attacker: Attacker | null, weapon: string, reason: string): void {
    if (attacker && !f.lastHit) f.lastHit = { who: attacker, weapon, t: f.clock };
    const cr = f.credit();
    const killer = cr.killer ?? attacker;
    f.stats.deaths++;
    const kf = killer ? this.byId.get(killer.id) : undefined;
    if (kf && kf !== f) kf.stats.kills++;
    for (const a of cr.assists) this.byId.get(a.id)!.stats.assists++;
    this.events.emit({ type: 'kill', killer, victim: f, weapon: cr.weapon || weapon || reason, assists: cr.assists });
  }

  /** Flew into the ground / left the zone while still flying: credit anyone who recently hurt us, then explode. */
  crashFighter(f: Fighter, reason: string, silent = false): void {
    if (f.state !== 'alive') return;
    this.bookKill(f, null, 'Crash', reason);
    f.aircraft.controls.afterburner = false;
    this.explodeFighter(f, silent);
  }

  private fighterDestroyed(f: Fighter, attacker: Attacker | null, weapon: string, reason: string): void {
    if (f.state !== 'alive') return;
    this.bookKill(f, attacker, weapon, reason);
    const fl = f.aircraft.flight;
    f.aircraft.controls.afterburner = false;
    if (fl.agl < 70 || reason === 'Burned up' && Math.random() < 0.4) {
      this.explodeFighter(f);
      return;
    }
    // a burning wreck falls out of the sky and explodes on the ground
    f.state = 'wreck';
    fl.wreck = true;
    fl.wreckSpin.set((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 3.2);
    f.damage.fire = 1;
    f.respawn = 7;
  }

  private updateWreck(f: Fighter, dt: number): void {
    const fl = f.aircraft.flight;
    const fx = f.fxAcc;
    fx.wreck += dt;
    while (fx.wreck > 0.03) {
      fx.wreck -= 0.03;
      this.fire.emit(fl.pos.x, fl.pos.y, fl.pos.z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 0.35, 3, 0.8, 3, 1.6, 0.4, 0.8, 1);
      this.smoke.emit(fl.pos.x, fl.pos.y, fl.pos.z, (Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3, 5, 3, 16, 0.06, 0.06, 0.07, 0.65, 0.2, -1.2);
    }
    if (fl.crashed) this.explodeFighter(f);
  }

  /** Final explosion: the aircraft is gone (respawn timer starts for AI). */
  explodeFighter(f: Fighter, silent = false): void {
    const fl = f.aircraft.flight;
    if (!silent) this.detonate(fl.pos, 24, 90, f.lastHit?.who ?? null, 'wreck', 28);
    for (const part of ['wingL', 'wingR', 'tail'] as const) {
      if (!f.damage.get(part).gone && Math.random() < 0.75) this.spawnDebris(f, part, f.ripPart(part));
    }
    f.state = 'dead';
    f.respawn = f.respawn > 0 ? f.respawn : 8;
    f.aircraft.object.visible = false;
    fl.wreck = true;
  }

  /** Smoke / fire / leaks coming off a damaged but flying aircraft. */
  private damageEffects(f: Fighter, dt: number): void {
    const d = f.damage;
    const fl = f.aircraft.flight;
    const fx = f.fxAcc;
    const m = f.aircraft.model;
    const engines = d.byKind('engine');
    let worst = 1;
    for (const e of engines) worst = Math.min(worst, d.ratio(e.id));
    if (worst < 0.7 || d.fire > 0) {
      fx.smoke += dt * (14 + (0.7 - worst) * 70 + d.fire * 40);
      while (fx.smoke >= 1) {
        fx.smoke -= 1;
        const nz = m.nozzles[Math.floor(Math.random() * m.nozzles.length)];
        _v1.copy(nz).applyQuaternion(fl.quat).add(fl.pos);
        const dark = worst < 0.35 || d.fire > 0 ? 0.05 : 0.3;
        this.smoke.emit(_v1.x, _v1.y, _v1.z, fl.vel.x * 0.9, fl.vel.y * 0.9, fl.vel.z * 0.9, 3 + Math.random() * 2, 1.4, 9, dark, dark, dark + 0.01, 0.55 + d.fire * 0.2, 0.3);
      }
    }
    if (d.fire > 0) {
      fx.fire += dt * 38;
      while (fx.fire >= 1) {
        fx.fire -= 1;
        const nz = m.nozzles[Math.floor(Math.random() * m.nozzles.length)];
        _v1.copy(nz).add(_v2.set(0, 0.2, -2.2)).applyQuaternion(fl.quat).add(fl.pos);
        this.fire.emit(_v1.x, _v1.y, _v1.z, fl.vel.x * 0.92, fl.vel.y * 0.92, fl.vel.z * 0.92, 0.4, 2.2, 0.5, 3, 1.4 + Math.random() * 0.5, 0.35, 0.85, 0.5);
      }
    }
    if (d.leaking) {
      fx.leak += dt * 26;
      while (fx.leak >= 1) {
        fx.leak -= 1;
        _v1.copy(d.get('fuel').center).applyQuaternion(fl.quat).add(fl.pos);
        this.smoke.emit(_v1.x, _v1.y, _v1.z, fl.vel.x * 0.95, fl.vel.y * 0.95 - 1, fl.vel.z * 0.95, 1.8, 0.5, 3.2, 0.93, 0.95, 1, 0.38, 0.5);
      }
    }
    for (const part of ['wingL', 'wingR'] as const) {
      const r = d.ratio(part);
      if (r < 0.6 && r > 0 && Math.random() < dt * (0.6 - r) * 30) {
        _v1.copy(d.get(part).center).applyQuaternion(fl.quat).add(fl.pos);
        this.smoke.emit(_v1.x, _v1.y, _v1.z, fl.vel.x * 0.95, fl.vel.y * 0.95, fl.vel.z * 0.95, 2, 0.8, 4, 0.5, 0.5, 0.52, 0.35, 0.4);
      }
    }
  }

  private spawnDebris(f: Fighter, part: 'wingL' | 'wingR' | 'tail', hadPart: boolean): void {
    const fl = f.aircraft.flight;
    const mod = f.damage.get(part);
    const g = new Group();
    const parts = (f.aircraft.model as { parts?: Record<string, Group> }).parts;
    if (hadPart && parts?.[part]) {
      const clone = parts[part].clone(true);
      clone.visible = true;
      clone.position.sub(mod.center);
      g.add(clone);
    } else {
      const m = new Mesh(this.flat, this.mats.dark);
      m.scale.set(3, 0.25, 2);
      g.add(m);
    }
    _v1.copy(mod.center).applyQuaternion(fl.quat).add(fl.pos);
    g.position.copy(_v1);
    g.quaternion.copy(fl.quat);
    this.root.add(g);
    this.debris.push({
      mesh: g,
      vel: fl.vel.clone().multiplyScalar(0.85).add(_v2.set((Math.random() - 0.5) * 22, 4 + Math.random() * 10, (Math.random() - 0.5) * 22)),
      spin: new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
      age: 0, life: 12, trailAcc: 0,
    });
    // a puff of fire where it came off
    for (let i = 0; i < 8; i++) this.fire.emit(_v1.x, _v1.y, _v1.z, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, 0.4, 3, 1, 3, 1.7, 0.5, 0.8, 1.5);
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.age += dt;
      d.vel.y -= GRAVITY * dt;
      d.vel.multiplyScalar(1 - dt * 0.05);
      d.mesh.position.addScaledVector(d.vel, dt);
      const w = d.spin.length();
      _q.setFromAxisAngle(_v2.copy(d.spin).multiplyScalar(1 / (w || 1)), w * dt);
      d.mesh.quaternion.multiply(_q);
      d.trailAcc += dt;
      if (d.trailAcc > 0.05) {
        d.trailAcc = 0;
        const p = d.mesh.position;
        this.smoke.emit(p.x, p.y, p.z, 0, 0, 0, 2.5, 1.2, 6, 0.08, 0.08, 0.09, 0.5, 0.3);
        if (d.age < 6) this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.25, 1.6, 0.4, 3, 1.4, 0.4, 0.7);
      }
      const g = this.env.surfaceAt(d.mesh.position.x, d.mesh.position.z, _surf).height;
      if (d.mesh.position.y < g + 0.5 || d.age > d.life) {
        if (d.mesh.position.y < g + 0.5) this.detonate(_v1.copy(d.mesh.position), 6, 0, null, 'debris', 5);
        this.root.remove(d.mesh);
        d.age = 999;
      }
    }
    this.debris = this.debris.filter((d) => d.age < 999);
  }

  private simpleKilled(t: SimpleTarget, killer: Attacker | null, weapon: string): void {
    const assists: Attacker[] = [];
    for (const e of t.lastAttackers.values()) if (e.who.id !== killer?.id && t.clock - e.t < 25 && e.dmg >= 12) assists.push(e.who);
    const kf = killer ? this.byId.get(killer.id) : undefined;
    if (kf) kf.stats.kills++;
    for (const a of assists) this.byId.get(a.id)!.stats.assists++;
    this.detonate(t.pos, 10, 0, null, 'target', t.kind === 'ground' ? 14 : 12);
    this.events.emit({ type: 'kill', killer, victim: t, weapon, assists });
  }

  // ---- warnings for the HUD ----------------------------------------------------------------------

  /** Bearing (rad, + = right of the nose) and elevation from a fighter to a world point. */
  bearingTo(f: Fighter, p: Vector3): { bearing: number; elevation: number } {
    _q.copy(f.aircraft.flight.quat).invert();
    _v1.copy(p).sub(f.pos).applyQuaternion(_q);
    return { bearing: Math.atan2(_v1.x, -_v1.z), elevation: Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z)) };
  }

  // ---- per-frame visuals ---------------------------------------------------------------------

  render(alpha: number): void {
    // tracer streaks
    const g = this.tracerGeo;
    g.setDrawRange(0, this.tracerCount * 2);
    (g.attributes.position as BufferAttribute).needsUpdate = true;
    (g.attributes.color as BufferAttribute).needsUpdate = true;
    for (const m of this.missiles) {
      m.mesh.position.lerpVectors(m.prev, m.pos, alpha);
      _v1.copy(m.vel);
      if (_v1.lengthSq() > 1e-6) {
        _q.setFromUnitVectors(FWD, _v1.normalize());
        m.mesh.quaternion.copy(_q);
      }
    }
    for (const b of this.bombs) {
      b.mesh.position.lerpVectors(b.prev, b.pos, alpha);
      _v1.copy(b.vel);
      if (_v1.lengthSq() > 1e-6) b.mesh.quaternion.setFromUnitVectors(FWD, _v1.normalize());
    }
  }

  /** The kind label for HUD (e.g. selected group). */
  static groupKind(g: number): string {
    return GROUPS[g];
  }
}

void UP;
