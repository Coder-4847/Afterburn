import { Box3, Group, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { damp } from '../core/math';
import { Afterburner } from './Afterburner';
import type { AircraftDef } from './AircraftDef';
import type { JetState, ModelHandle } from './ProceduralJet';

/**
 * Optional model override. Drop `public/models/<aircraft id>.glb` into the project and that aircraft uses it
 * instead of the procedural build, with no code changes. If the file is missing, nothing happens.
 *
 * Conventions for the .glb: nose toward -Z, up +Y, any scale (it is rescaled to the aircraft's length and centred).
 * Optional node names (case-insensitive) are animated: aileron_l / aileron_r, elevator_l / elevator_r (or stabilator_*),
 * rudder / rudder_l / rudder_r, and anything starting with "gear" (hidden when the gear is up).
 */
const loader = new GLTFLoader();

function normalise(a: string): string {
  return a.toLowerCase().replace(/[^a-z_]/g, '');
}

class GlbModel implements ModelHandle {
  readonly root = new Group();
  readonly wingtips: Vector3[] = [];
  readonly nozzles: Vector3[] = [];
  private afterburners: Afterburner[] = [];
  private ail: Object3D[] = [];
  private ailSign: number[] = [];
  private elev: Object3D[] = [];
  private elevSign: number[] = [];
  private rudders: Object3D[] = [];
  private gear: Object3D[] = [];
  private sp = 0;
  private sr = 0;
  private sy = 0;

  constructor(def: AircraftDef, scene: Group) {
    // normalise size and centre
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const k = def.model.length / Math.max(0.01, size.z);
    scene.scale.multiplyScalar(k);
    const box2 = new Box3().setFromObject(scene);
    const c = box2.getCenter(new Vector3());
    scene.position.sub(c);
    this.root.add(scene);
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      const n = normalise(o.name);
      if (n.startsWith('aileron')) { this.ail.push(o); this.ailSign.push(n.endsWith('l') ? 1 : -1); }
      else if (n.startsWith('elevator') || n.startsWith('stabilator')) { this.elev.push(o); this.elevSign.push(n.endsWith('l') ? 1 : -1); }
      else if (n.startsWith('rudder')) this.rudders.push(o);
      else if (n.startsWith('gear')) this.gear.push(o);
    });
    // exhaust at the standard nozzle positions from the spec, so the afterburner works with any model
    const m = def.model;
    const xs = m.engines === 1 ? [0] : [-(m.engineSpacing ?? 0.7), m.engineSpacing ?? 0.7];
    const tailY = m.sections[m.sections.length - 1][3];
    for (const x of xs) {
      const ab = new Afterburner(m.nozzleRadius);
      ab.group.position.set(x, tailY, m.length / 2 + 0.6);
      this.root.add(ab.group);
      this.afterburners.push(ab);
      this.nozzles.push(new Vector3(x, tailY, m.length / 2 + 0.6));
    }
    const half = def.model.wing.span / 2;
    this.wingtips.push(new Vector3(half, def.model.wing.y, def.model.wing.sweep), new Vector3(-half, def.model.wing.y, def.model.wing.sweep));
  }

  update(dt: number, s: JetState): void {
    this.sp = damp(this.sp, s.pitch, 12, dt);
    this.sr = damp(this.sr, s.roll, 14, dt);
    this.sy = damp(this.sy, s.yaw, 8, dt);
    this.ail.forEach((o, i) => (o.rotation.x = this.ailSign[i] * this.sr * 0.5));
    this.elev.forEach((o, i) => (o.rotation.x = -this.sp * 0.45 + this.elevSign[i] * this.sr * 0.2));
    this.rudders.forEach((o) => (o.rotation.y = this.sy * 0.5));
    for (const g of this.gear) g.visible = s.gearPos > 0.05;
    for (const b of this.afterburners) b.update(dt, s.power, s.ab);
  }

  dispose(): void {
    for (const b of this.afterburners) b.dispose();
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}

/** Resolves to a handle if `models/<id>.glb` exists and is a valid glTF binary, otherwise null. Never throws. */
export async function tryLoadGlb(def: AircraftDef): Promise<ModelHandle | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}models/${def.id}.glb`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // the dev server answers unknown paths with index.html: insist on the glTF magic number
    if (buf.byteLength < 12 || new TextDecoder().decode(buf.slice(0, 4)) !== 'glTF') return null;
    return await parseGlb(def, buf);
  } catch {
    return null;
  }
}

export function parseGlb(def: AircraftDef, buf: ArrayBuffer): Promise<ModelHandle> {
  return new Promise((resolve, reject) => {
    loader.parse(buf, '', (gltf) => resolve(new GlbModel(def, gltf.scene as unknown as Group)), reject);
  });
}
