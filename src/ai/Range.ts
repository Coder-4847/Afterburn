import { Vector3, type Scene } from 'three';
import type { MapDef } from '../data/maps/types';
import { palette } from '../ui/palette';
import { Aircraft } from '../aircraft/Aircraft';
import { TrailEmitter } from '../aircraft/Trails';
import { DEG } from '../core/math';
import { getAircraft } from '../data/aircraft';
import { DIFFICULTIES } from '../data/difficulty';
import { presetLoadout } from '../data/stations';
import type { SurfaceInfo } from '../flight/FlightModel';
import type { ParticleSystem } from '../render/Particles';
import type { Combat } from '../weapons/Combat';
import { Fighter } from '../weapons/Fighter';
import { AirDummy, GroundTarget, type GroundKind } from '../weapons/Targets';
import { DroneBrain, type DroneOpts } from './Drone';

const _surf: SurfaceInfo = { height: 0, onRunway: false, onApron: false };

interface DroneSlot {
  fighter: Fighter;
  brain: DroneBrain;
  opts: DroneOpts;
  trail: TrailEmitter;
}

/**
 * The range is laid out relative to the map's default spawn and heading: balloons dead ahead, the ground-target site a few km
 * further on, drones orbiting off to either side. [forward, right, altitude offset]
 */
const DUMMIES: [number, number, number][] = [
  [1400, -100, -30],
  [1460, 20, 50],
  [1400, 130, -60],
  [1520, 250, 110],
];

const DRONES: { id: string; fwd: number; right: number; radius: number; dAlt: number; speed: number; dir: 1 | -1 }[] = [
  { id: 'su27', fwd: 1900, right: -1900, radius: 1500, dAlt: 350, speed: 185, dir: 1 },
  { id: 'mig29', fwd: 2100, right: 1900, radius: 1300, dAlt: 150, speed: 195, dir: -1 },
  { id: 'j10c', fwd: 3000, right: -3000, radius: 1700, dAlt: 850, speed: 200, dir: 1 },
];

const CLUSTER: { kind: GroundKind; name: string; dx: number; dz: number; h: number }[] = [
  { kind: 'bunker', name: 'Bunker', dx: 0, dz: 0, h: 0.4 },
  { kind: 'radar', name: 'Radar site', dx: 38, dz: -22, h: 2.4 },
  { kind: 'truck', name: 'Supply truck', dx: -34, dz: 20, h: 1.2 },
  { kind: 'truck', name: 'Supply truck', dx: -18, dz: 48, h: 1.9 },
  { kind: 'tent', name: 'Command tent', dx: 30, dz: 36, h: 0 },
  { kind: 'tent', name: 'Command tent', dx: -52, dz: -30, h: 0.7 },
];

/**
 * The Phase 3 training range: hovering air dummies in front of the Blue island, a cluster of ground targets on the
 * nearest high ground, and three red drones (passive evaders, or hostile with the right setting).
 */
export class TrainingRange {
  private drones: DroneSlot[] = [];
  private dummies: AirDummy[] = [];
  private ground: GroundTarget[] = [];
  hostile = false;

  constructor(private combat: Combat, private scene: Scene, private smoke: ParticleSystem) {}

  /** Spiral outwards from a point until there is solid ground (not a beach, not too steep). */
  private findLand(cx: number, cz: number, tol = 7): Vector3 | null {
    const h = (x: number, z: number) => this.combat.env.surfaceAt(x, z, _surf).height;
    for (let r = 0; r <= 3600; r += 80) {
      const n = r === 0 ? 1 : Math.max(6, Math.round((r * 2 * Math.PI) / 100));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const y = h(x, z);
        if (y < 8) continue;
        // flat enough for a cluster: neighbours within a few metres
        let flat = true;
        for (const [dx, dz] of [[55, 0], [-55, 0], [0, 55], [0, -55]]) if (Math.abs(h(x + dx, z + dz) - y) > tol) flat = false;
        if (flat) return new Vector3(x, y, z);
      }
    }
    return null;
  }

  /** Highest ground within a ring (so an orbit clears the mountains on any map). */
  private ringMax(cx: number, cz: number, r: number): number {
    let m = 0;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      m = Math.max(m, this.combat.env.surfaceAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r, _surf).height);
    }
    return m;
  }

  build(hostile: boolean, map: MapDef): void {
    this.clear();
    this.hostile = hostile;
    const sp = map.spawn;
    const hd = (sp.heading * Math.PI) / 180;
    const fx = Math.sin(hd);
    const fz = -Math.cos(hd);
    const rx = Math.cos(hd);
    const rz = Math.sin(hd);
    const at = (fwd: number, right: number): [number, number] => [sp.x + fx * fwd + rx * right, sp.z + fz * fwd + rz * right];

    for (const [i, [fwd, right, dAlt]] of DUMMIES.entries()) {
      const [x, z] = at(fwd, right);
      const ground = this.combat.env.surfaceAt(x, z, _surf).height;
      const d = new AirDummy(`Target balloon ${i + 1}`, new Vector3(x, Math.max(sp.altitude + dAlt, ground + 120), z));
      this.combat.addDummy(d);
      this.dummies.push(d);
    }

    // ground cluster on flat land a few km ahead
    const [gx, gz] = at(2400, 300);
    const site = this.findLand(gx, gz) ?? this.findLand(gx, gz, 30);
    if (site) {
      for (const g of CLUSTER) {
        const x = site.x + g.dx;
        const z = site.z + g.dz;
        const y = this.combat.env.surfaceAt(x, z, _surf).height;
        if (y < 3) continue;
        const t = new GroundTarget(g.name, g.kind, new Vector3(x, y, z), Math.random() * Math.PI * 2);
        this.combat.addGround(t);
        this.ground.push(t);
      }
    }

    for (const spec of DRONES) {
      const [cx, cz] = at(spec.fwd, spec.right);
      const alt = Math.max(sp.altitude + spec.dAlt, this.ringMax(cx, cz, spec.radius) + 450);
      this.addDrone(spec.id, { cx, cz, radius: spec.radius, altitude: alt, speed: spec.speed, dir: spec.dir });
    }
  }

  private addDrone(id: string, opts: DroneOpts): void {
    const def = getAircraft(id);
    const ac = new Aircraft(def, DIFFICULTIES.standard, palette.redHex);
    this.scene.add(ac.object);
    const f = new Fighter(`${def.name}`, 'red', ac, false);
    // drones always carry a balanced load, whatever the player saved for that airframe
    f.loadout.items = presetLoadout(f.loadout.arm, 'Balanced');
    f.weapons.rearm();
    f.mountVisuals();
    const brain = new DroneBrain(this.combat, opts);
    brain.hostile = this.hostile;
    f.brain = brain;
    this.combat.addFighter(f);
    const slot: DroneSlot = { fighter: f, brain, opts, trail: new TrailEmitter(this.smoke) };
    this.drones.push(slot);
    this.place(slot);
  }

  private place(s: DroneSlot): void {
    const o = s.opts;
    const f = s.fighter;
    const a = Math.random() * Math.PI * 2;
    // start on the orbit, heading along it
    const x = o.cx + Math.cos(a) * o.radius;
    const z = o.cz + Math.sin(a) * o.radius;
    const tx = -Math.sin(a) * o.dir;
    const tz = Math.cos(a) * o.dir;
    const heading = Math.atan2(tx, -tz); // 0 = north (-Z)
    f.reset();
    f.aircraft.flight.reset(new Vector3(x, o.altitude, z), heading, o.speed, false, 0.7);
    f.aircraft.syncVisual(1, 0);
    s.brain.reset(f);
    s.trail.reset();
  }

  setHostile(h: boolean): void {
    this.hostile = h;
    for (const d of this.drones) d.brain.hostile = h;
  }

  /** Fixed-step bookkeeping: respawn drones that have finished exploding. */
  update(): void {
    for (const d of this.drones) {
      if (d.fighter.state === 'dead' && d.fighter.respawn <= 0) this.place(d);
    }
  }

  /** Per-frame visuals for every non-player aircraft. */
  render(alpha: number, dt: number, trailQuality: number): void {
    for (const d of this.drones) {
      const f = d.fighter;
      if (f.state === 'dead') continue;
      f.aircraft.syncVisual(alpha, dt);
      if (dt > 0) d.trail.update(f.aircraft, trailQuality);
    }
  }

  clear(): void {
    for (const d of this.drones) {
      this.combat.removeFighter(d.fighter);
      d.fighter.aircraft.dispose();
    }
    this.drones = [];
    this.combat.clearRange();
    this.dummies = [];
    this.ground = [];
  }

  get droneFighters(): Fighter[] {
    return this.drones.map((d) => d.fighter);
  }
}

void DEG;
