import { Vector3, type Scene } from 'three';
import { Aircraft } from '../aircraft/Aircraft';
import { TrailEmitter } from '../aircraft/Trails';
import type { AircraftDef } from '../aircraft/AircraftDef';
import type { AiSkillId } from '../core/Settings';
import { AIRCRAFT_LIST } from '../data/aircraft';
import { DIFFICULTIES } from '../data/difficulty';
import type { AirstripDef, MapDef } from '../data/maps/types';
import { DEG } from '../core/math';
import type { Fleet } from '../naval/Fleet';
import { presetLoadout } from '../data/stations';
import type { SurfaceInfo } from '../flight/FlightModel';
import type { ParticleSystem } from '../render/Particles';
import type { Combat } from '../weapons/Combat';
import { Fighter } from '../weapons/Fighter';
import type { Team } from '../weapons/types';
import { palette } from '../ui/palette';
import { PilotBrain, SKILLS } from './Pilot';

const _surf: SurfaceInfo = { height: 0, onRunway: false, onApron: false };

interface Slot {
  fighter: Fighter;
  brain: PilotBrain;
  trail: TrailEmitter;
  team: Team;
  index: number;
}

/**
 * Populates a map with AI fighters on both sides: wingmen for the player's team (Blue) and opponents (Red). Each slot has
 * a fixed airframe, a PilotBrain, and respawns near one of its team's airstrips a few seconds after it dies.
 * Phase 5 builds the real game modes (team sizes, scoring, win conditions) on top of this.
 */
export class Skirmish {
  private slots: Slot[] = [];
  /** A comfortable fighting altitude for this map: above the high ground, so AI is not forever dodging peaks. */
  private cruise: number;
  /** Carrier strike: the two carrier groups (AI starts beside its carrier and rearms on its deck). */
  private fleet: Fleet | null = null;

  constructor(private combat: Combat, private scene: Scene, private smoke: ParticleSystem, private map: MapDef, private skill: AiSkillId) {
    let top = 0;
    const b = map.boundary;
    for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) top = Math.max(top, combat.env.surfaceAt((i / 8) * b, (j / 8) * b, _surf).height);
    // high mountains: fight above the peaks. Low terrain: a modest altitude is plenty.
    this.cruise = Math.min(4000, Math.max(map.spawn.altitude, top > 1000 ? top + 350 : top * 0.8 + 500));
  }

  setFleet(fleet: Fleet | null): void {
    this.fleet = fleet;
  }

  build(blue: number, red: number): void {
    this.clear();
    for (let i = 0; i < blue; i++) this.add('blue', i, blue);
    for (let i = 0; i < red; i++) this.add('red', i, red);
  }

  private pool(team: Team): AircraftDef[] {
    return AIRCRAFT_LIST.filter((a) => (team === 'blue' ? a.faction === 'west' : a.faction !== 'west'));
  }

  private add(team: Team, index: number, count: number): void {
    const pool = this.pool(team);
    const def = pool[Math.floor(Math.random() * pool.length)];
    const ac = new Aircraft(def, DIFFICULTIES.standard, team === 'blue' ? palette.blueHex : palette.redHex);
    this.scene.add(ac.object);
    const f = new Fighter(`${def.name} ${team === 'blue' ? 'B' : 'R'}${index + 1}`, team, ac, false);
    // AI flies the dogfighter load (mostly heat-seekers): fights end up close, where the cannon matters
    // carrier strike: about a third of each side carries bombs and goes for the other carrier
    const striker = !!this.fleet && (index % 3 === 1 || count === 1);
    f.loadout.items = presetLoadout(f.loadout.arm, striker ? 'Strike' : 'Dogfighter');
    f.weapons.rearm();
    f.mountVisuals();
    f.aimAssist = { rookie: 0.35, regular: 0.6, ace: 0.9 }[this.skill];
    let homes = this.map.airstrips.filter((a) => a.team === team);
    const own = this.fleet?.carriers[team];
    if (own) {
      const deck: AirstripDef = {
        id: 'carrier-' + team, team, name: own.name, x: own.pos.x, z: own.pos.z, heading: own.heading / DEG,
        length: own.dims.length, width: 50, elevation: this.map.seaLevel + own.dims.top,
      };
      homes = [deck];
    }
    const brain = new PilotBrain(this.combat, SKILLS[this.skill], homes, { x: 0, z: 0 }, this.cruise + (index % 3) * 220, this.map.boundary);
    if (striker && f.weapons.remaining('bomb') + f.weapons.remaining('rocket') > 0) {
      const foe: Team = team === 'blue' ? 'red' : 'blue';
      brain.strikeGoal = () => {
        const c = this.fleet?.carriers[foe];
        return c && c.alive ? c : null;
      };
      brain.endRunInit();
    }
    f.brain = brain;
    this.combat.addFighter(f);
    const slot: Slot = { fighter: f, brain, trail: new TrailEmitter(this.smoke), team, index };
    this.slots.push(slot);
    this.place(slot, count);
  }

  /** Put a fighter in the air above one of its team's airstrips, heading for the middle of the map. */
  private place(s: Slot, count = 4): void {
    const own = this.fleet?.carriers[s.team];
    const foe = this.fleet?.carriers[s.team === 'blue' ? 'red' : 'blue'];
    if (own && foe) {
      // out ahead of the carrier group, toward the enemy, spread across the line of advance
      const dx = foe.pos.x - own.pos.x;
      const dz = foe.pos.z - own.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      const side = (s.index % 2 === 0 ? 1 : -1) * (Math.floor(s.index / 2) + 1) * 260;
      const out = 1100 + 180 * Math.floor(s.index / 2);
      const x = own.pos.x + ux * out - uz * side;
      const z = own.pos.z + uz * out + ux * side;
      const ground = this.combat.env.surfaceAt(x, z, _surf).height;
      const alt = Math.max(this.cruise + 100 * (s.index % 4), ground + 450);
      const f = s.fighter;
      f.reset();
      f.aircraft.flight.reset(new Vector3(x, alt, z), Math.atan2(ux, -uz), 200, false, 0.75);
      f.aircraft.syncVisual(1, 0);
      s.brain.reset(f);
      s.trail.reset();
      return;
    }
    const strips = this.map.airstrips.filter((a) => a.team === s.team);
    const strip = strips[s.index % strips.length];
    const toCx = -strip.x;
    const toCz = -strip.z;
    const len = Math.hypot(toCx, toCz) || 1;
    const dx = toCx / len;
    const dz = toCz / len;
    // start well out from the strip toward the middle of the map, so the two teams are a few km apart, not a transatlantic flight
    // (and spread each strip's jets out sideways so they don't spawn inside each other)
    const k = Math.floor(s.index / strips.length);
    const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 320;
    const out = len * 0.52 + 250 * k;
    const x = strip.x + dx * out - dz * side;
    const z = strip.z + dz * out + dx * side;
    const ground = this.combat.env.surfaceAt(x, z, _surf).height;
    const alt = Math.max(this.cruise + 120 * (k % 4), ground + 500);
    const f = s.fighter;
    f.reset();
    f.aircraft.flight.reset(new Vector3(x, alt, z), Math.atan2(dx, -dz), 205, false, 0.75);
    f.aircraft.syncVisual(1, 0);
    s.brain.reset(f);
    s.trail.reset();
    void count;
  }

  /** Fixed-step bookkeeping: respawn the fallen. */
  update(): void {
    for (const s of this.slots) if (s.fighter.state === 'dead' && s.fighter.respawn <= 0 && s.fighter.lives > 0) this.place(s);
  }

  render(alpha: number, dt: number, trailQuality: number): void {
    for (const s of this.slots) {
      const f = s.fighter;
      if (f.state === 'dead') continue;
      f.aircraft.syncVisual(alpha, dt);
      if (dt > 0) s.trail.update(f.aircraft, trailQuality);
    }
  }

  clear(): void {
    for (const s of this.slots) {
      this.combat.removeFighter(s.fighter);
      s.fighter.aircraft.dispose();
    }
    this.slots = [];
  }

  /** Fighting altitude for this map. */
  get cruiseAlt(): number {
    return this.cruise;
  }

  get fighters(): Fighter[] {
    return this.slots.map((s) => s.fighter);
  }
}
