import { Vector3 } from 'three';
import type { AiSkillId } from '../core/Settings';
import { GRAVITY, SAMS } from '../data/weapons';
import type { MapDef } from '../data/maps/types';
import type { Deck, World } from '../world/World';
import type { Combat } from '../weapons/Combat';
import type { Fighter } from '../weapons/Fighter';
import type { Team } from '../weapons/types';
import { palette } from '../ui/palette';
import { Ship } from './Ship';
import { SHIP_MOUNTS } from './ShipModel';

interface Gunnery {
  /** Rad of random error on a round (grows with range). */
  spread: number;
  /** Damage of one round against an aircraft before the difficulty scale. */
  damage: number;
  /** Seconds between bursts. */
  gunCool: number;
  /** Seconds between missiles per launcher. */
  samCool: number;
  samRange: number;
  gunRange: number;
}

/** How dangerous the fleet's defences are, by AI skill. Tuned so a competent pilot can run in, bomb and leave. */
const GUNNERY: Record<AiSkillId, Gunnery> = {
  rookie: { spread: 0.03, damage: 3.2, gunCool: 3.4, samCool: 36, samRange: 4800, gunRange: 1900 },
  regular: { spread: 0.022, damage: 4, gunCool: 2.4, samCool: 26, samRange: 5600, gunRange: 2200 },
  ace: { spread: 0.015, damage: 5, gunCool: 1.7, samCool: 17, samRange: 6400, gunRange: 2500 },
};

const _p = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const _t = new Vector3();

/**
 * Each team's carrier group: one anchored carrier (a flight deck pilots can take off from and land on), and destroyers and
 * submarines steaming round it with guns and surface-to-air missiles. Escorts do not respawn: clearing them is how a strike
 * gets to the carrier.
 */
export class Fleet {
  readonly ships: Ship[] = [];
  readonly carriers: Partial<Record<Team, Ship>> = {};
  private decks = new Map<Ship, Deck>();
  private burst = new Map<Ship, number[]>();
  private burstAim = new Map<Ship, Vector3[]>();
  private sinkFx = new Map<Ship, number>();

  constructor(private combat: Combat, private world: World, private map: MapDef, private skill: AiSkillId) {}

  // ---- placement -------------------------------------------------------------------------------

  private depthAt(x: number, z: number): number {
    return this.map.seaLevel - this.world.heightmap.sample(x, z);
  }

  /** Open water around a point: every sample on a ring (and the middle) at least `min` metres deep. */
  private waterRing(x: number, z: number, r: number, min = 5): boolean {
    if (this.depthAt(x, z) < min) return false;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (this.depthAt(x + Math.cos(a) * r, z + Math.sin(a) * r) < min) return false;
    }
    return true;
  }

  /** The nearest open water to a preferred point (carriers need a few hundred metres of clear sea). */
  private findWater(px: number, pz: number, r: number, avoid: { x: number; z: number }[] = [], gap = 0): { x: number; z: number } | null {
    const limit = this.map.boundary * 0.88;
    for (let rad = 0; rad <= limit * 1.4; rad += 120) {
      const n = rad === 0 ? 1 : Math.max(8, Math.round((rad * 2 * Math.PI) / 160));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = px + Math.cos(a) * rad;
        const z = pz + Math.sin(a) * rad;
        if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
        if (avoid.some((o) => Math.hypot(o.x - x, o.z - z) < gap)) continue;
        if (this.waterRing(x, z, r)) return { x, z };
      }
    }
    return null;
  }

  /** Is there any water to put a carrier on? (Sandstorm Basin has none.) */
  static hasWater(world: World, map: MapDef): boolean {
    if (map.groundPlane) return false;
    let n = 0;
    const b = map.boundary * 0.8;
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) if (world.heightmap.sample((i / 6) * b, (j / 6) * b) < map.seaLevel - 5) n++;
    return n > 6;
  }

  build(): boolean {
    this.clear();
    const b = this.map.boundary;
    const sites: Record<Team, { x: number; z: number } | null> = {
      blue: this.findWater(-b * 0.42, 0, 520),
      red: this.findWater(b * 0.42, 0, 520),
    };
    if (!sites.blue || !sites.red) return false;
    // never the same bit of water
    if (Math.hypot(sites.blue.x - sites.red.x, sites.blue.z - sites.red.z) < 1500) return false;
    for (const team of ['blue', 'red'] as Team[]) {
      const s = sites[team]!;
      const o = sites[team === 'blue' ? 'red' : 'blue']!;
      const toEnemy = Math.atan2(o.x - s.x, -(o.z - s.z)); // heading toward the other carrier
      this.addGroup(team, s.x, s.z, toEnemy);
    }
    return true;
  }

  /** Distance (m) along a bearing before the sea gives way to land (or `max` if it does not). */
  private rayClear(x: number, z: number, a: number, max: number): number {
    for (let d = 100; d <= max; d += 100) if (this.depthAt(x + Math.sin(a) * d, z - Math.cos(a) * d) < 4) return d;
    return max;
  }

  /**
   * The carrier points where there is open water ahead for take-off and behind for the landing approach, as near as it can to
   * the direction of the enemy (so a catapult launch never aims the pilot at a mountain).
   */
  private openHeading(x: number, z: number, pref: number): number {
    let best = pref;
    let bs = -Infinity;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const ahead = this.rayClear(x, z, a, 3000);
      const behind = this.rayClear(x, z, a + Math.PI, 2000);
      const diff = Math.abs((((a - pref + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      const s = Math.min(ahead, 2200) + 0.6 * Math.min(behind, 1600) - diff * 140;
      if (s > bs) {
        bs = s;
        best = a;
      }
    }
    return best;
  }

  private addGroup(team: Team, x: number, z: number, toEnemy: number): void {
    const heading = this.openHeading(x, z, toEnemy);
    const hex = team === 'blue' ? palette.blueHex : palette.redHex;
    const label = team === 'blue' ? 'Blue' : 'Red';
    const carrier = new Ship(`${label} carrier`, 'carrier', team, hex, x, z, heading, this.map.seaLevel);
    this.add(carrier);
    this.carriers[team] = carrier;
    const deck: Deck = {
      x, z, dx: Math.sin(heading), dz: -Math.cos(heading), halfLength: carrier.dims.length * 0.47, halfWidth: carrier.dims.beam * 0.42,
      height: this.map.seaLevel + carrier.dims.top, team, active: true,
    };
    this.world.decks.push(deck);
    this.decks.set(carrier, deck);

    // escorts: each steams a small circle in clear water near its station (destroyers out front, submarines closer in)
    const plan: { kind: 'destroyer' | 'submarine'; r: number; a: number; dir: 1 | -1 }[] = [
      { kind: 'destroyer', r: 780, a: 0.7, dir: 1 },
      { kind: 'destroyer', r: 780, a: 0.7 + Math.PI, dir: 1 },
      { kind: 'submarine', r: 560, a: 2.3, dir: -1 },
      { kind: 'submarine', r: 560, a: 2.3 + Math.PI, dir: -1 },
    ];
    let n = 0;
    for (const e of plan) {
      const px = x + Math.cos(e.a) * e.r;
      const pz = z + Math.sin(e.a) * e.r;
      // keep clear of the carrier and of the escorts already placed
      const taken = this.ships.map((s) => ({ x: s.pos.x, z: s.pos.z }));
      const spot = this.findWater(px, pz, 330, taken, 420) ?? this.findWater(px, pz, 150, taken, 300);
      if (!spot) continue;
      const ship = new Ship(`${label} ${e.kind} ${++n}`, e.kind, team, hex, spot.x, spot.z, heading, this.map.seaLevel);
      // the widest circle that stays in water (a destroyer needs room, so the very small ones just sit on station)
      const r = [220, 160, 110].find((rr) => this.waterRing(spot.x, spot.z, rr + 40, 4));
      if (r !== undefined) {
        ship.patrol = { cx: spot.x, cz: spot.z, r, ang: e.a, dir: e.dir, speed: e.kind === 'destroyer' ? 8 : 5 };
        ship.update(0);
      }
      this.add(ship);
    }
  }

  private add(s: Ship): void {
    this.ships.push(s);
    this.combat.addGround(s);
    this.burst.set(s, SHIP_MOUNTS[s.shipKind].gun.map(() => 0));
    this.burstAim.set(s, SHIP_MOUNTS[s.shipKind].gun.map(() => new Vector3()));
  }

  /** Where to put an aircraft on its carrier's deck (at the stern, nose toward the bow). */
  deckSpawn(team: Team): { x: number; y: number; z: number; heading: number } | null {
    const c = this.carriers[team];
    const d = c && this.decks.get(c);
    if (!c || !d || !c.alive) return null;
    const back = d.halfLength - 70;
    return { x: d.x - d.dx * back, z: d.z - d.dz * back, y: d.height, heading: c.heading };
  }

  // ---- simulation --------------------------------------------------------------------------------

  update(dt: number): void {
    const g = GUNNERY[this.skill];
    const targets: Fighter[] = [];
    for (const f of this.combat.fighters) if (f.alive && !f.invulnerable) targets.push(f);

    for (const s of this.ships) {
      // (Combat.update already steps every ground target, ships included)
      if (!s.alive) {
        const d = this.decks.get(s);
        if (d) d.active = false;
        this.sinkEffects(s, dt);
        continue;
      }
      this.fire(s, targets, g, dt);
    }
  }

  /** Burning, exploding, sinking. */
  private sinkEffects(s: Ship, dt: number): void {
    if (s.sinkT > 16) return;
    let t = (this.sinkFx.get(s) ?? 0) - dt;
    if (t <= 0) {
      t = s.shipKind === 'carrier' ? 0.35 : 0.8;
      const lx = (Math.random() - 0.5) * s.dims.length * 0.8;
      const lz = (Math.random() - 0.5) * s.dims.beam * 0.7;
      s.toWorld(lx, s.dims.top * (0.5 + Math.random() * 0.8), lz, _p);
      this.combat.detonate(_p, 0, 0, null, 'sinking', s.shipKind === 'carrier' ? 16 + Math.random() * 10 : 8 + Math.random() * 6);
    }
    this.sinkFx.set(s, t);
  }

  private fire(s: Ship, targets: Fighter[], g: Gunnery, dt: number): void {
    if (targets.length === 0) return;
    const mounts = SHIP_MOUNTS[s.shipKind];
    const bursts = this.burst.get(s)!;
    const aims = this.burstAim.get(s)!;

    // guns: bursts at the nearest aircraft in range
    for (let i = 0; i < mounts.gun.length; i++) {
      s.gunCool[i] -= dt;
      const [lx, ly, lz] = mounts.gun[i];
      s.toWorld(lx, ly, lz, _p);
      if (bursts[i] > 0) {
        const tgt = this.nearest(targets, _p, g.gunRange, s.team);
        if (!tgt) {
          bursts[i] = 0;
          continue;
        }
        if (Math.round(s.clock * 60) % 2 === 0) {
          bursts[i]--;
          this.shoot(s, _p, tgt, g, aims[i]);
        }
      } else if (s.gunCool[i] <= 0) {
        const tgt = this.nearest(targets, _p, g.gunRange, s.team);
        if (tgt && tgt.pos.y > this.map.seaLevel + 25) {
          bursts[i] = 14 + Math.floor(Math.random() * 8);
          // a persistent aiming error for the whole burst: the rounds walk across, not through, the target
          aims[i].set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(g.spread * 1.8);
          s.gunCool[i] = g.gunCool * (0.8 + Math.random() * 0.5);
        } else s.gunCool[i] = 0.5;
      }
    }

    // missiles: one every so often, at something close enough, not already being chased by one of ours
    for (let i = 0; i < mounts.sam.length; i++) {
      s.samCool[i] -= dt;
      if (s.samCool[i] > 0) continue;
      const [lx, ly, lz] = mounts.sam[i];
      s.toWorld(lx, ly, lz, _p);
      const tgt = this.nearest(targets, _p, g.samRange, s.team);
      if (!tgt || tgt.pos.distanceTo(_p) < 700 || tgt.aircraft.flight.agl < 60) {
        s.samCool[i] = 1.5;
        continue;
      }
      // do not stack missiles on the same aircraft
      if (this.combat.threats(tgt).length >= 1) {
        s.samCool[i] = 3;
        continue;
      }
      const radar = s.shipKind === 'carrier' || Math.random() < 0.5;
      _v.copy(tgt.pos).sub(_p);
      _v.y += 12;
      this.combat.launchSam(s, _p, _v, tgt, radar ? SAMS.radar : SAMS.ir);
      s.samCool[i] = g.samCool * (0.8 + Math.random() * 0.5) * (s.shipKind === 'submarine' ? 1.25 : 1);
    }
  }

  private nearest(list: Fighter[], from: Vector3, range: number, friendly: Team): Fighter | null {
    let best: Fighter | null = null;
    let bd = range * range;
    for (const f of list) {
      if (f.team === friendly) continue;
      const d = f.pos.distanceToSquared(from);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  /** One round toward where the aircraft will be, with the burst's aiming error and a little scatter. */
  private shoot(s: Ship, from: Vector3, tgt: Fighter, g: Gunnery, bias: Vector3): void {
    const fl = tgt.aircraft.flight;
    const mv = 900;
    // time of flight and lead (no drop compensation needed at these ranges beyond a nudge)
    _t.copy(tgt.pos).sub(from);
    const dist = _t.length();
    const t = dist / mv;
    _w.copy(tgt.pos).addScaledVector(fl.vel, t);
    _w.y += 0.5 * GRAVITY * t * t;
    _w.sub(from).normalize();
    const err = g.spread * (0.6 + dist / 1800);
    _w.x += bias.x + (Math.random() - 0.5) * err;
    _w.y += bias.y + (Math.random() - 0.5) * err;
    _w.z += bias.z + (Math.random() - 0.5) * err;
    _w.normalize().multiplyScalar(mv);
    this.combat.fireRound(s, from, _w, g.damage);
  }

  clear(): void {
    for (const s of this.ships) this.combat.removeGroundTarget(s);
    this.ships.length = 0;
    this.carriers.blue = undefined;
    this.carriers.red = undefined;
    this.world.decks.length = 0;
    this.decks.clear();
    this.burst.clear();
    this.burstAim.clear();
    this.sinkFx.clear();
  }
}
