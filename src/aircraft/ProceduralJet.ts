import {
  BoxGeometry, ConeGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial,
  SphereGeometry, TorusGeometry, Vector3,
  type Material, type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp } from '../core/math';
import { Afterburner } from './Afterburner';
import type { AircraftDef, FinSpec, IntakeSpec, ModelSpec, PodSpec, Section } from './AircraftDef';
import { SKIN_TILE, makeJetMaterials, type JetMaterials } from './Materials';
import type { Armament } from '../data/stations';
import { STORES, type StoreDef } from '../data/weapons';

/** What the model needs each frame to animate itself. Axes are -1..1. */
export interface JetState {
  gearPos: number;
  power: number;
  ab: number;
  pitch: number;
  roll: number;
  yaw: number;
  airbrake: number;
}

/** Anything that can stand in for the aircraft's visual (procedural build or a loaded .glb). */
export interface ModelHandle {
  root: Group;
  update(dt: number, s: JetState): void;
  /** Local-space points for wingtip vortices and exhaust trails. */
  wingtips: Vector3[];
  nozzles: Vector3[];
  /** Local-space eye point for the cockpit camera, if the model defines one. */
  dispose(): void;
}

// ----------------------------------------------------------------------------------------------
// geometry helpers
// ----------------------------------------------------------------------------------------------

interface Ring {
  z: number;
  hw: number;
  /** Half height above the centre (cy). */
  hh: number;
  /** Half height below the centre; defaults to hh. */
  hb?: number;
  cx: number;
  cy: number;
  /** Cross-section exponent (2 ellipse, 4 rounded box) for the upper and lower halves. */
  n?: number;
  nb?: number;
}

/**
 * Loft a closed tube through rings (super-ellipse cross sections, upper and lower halves may differ in height and
 * squareness). Nose/front is the first ring.
 */
function loft(rings: Ring[], n: number, segments: number, capFront = false, capBack = false): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const row = segments + 1;
  for (const r of rings) {
    const hb = r.hb ?? r.hh;
    const nt = r.n ?? n;
    const nb = r.nb ?? r.n ?? n;
    const per = 2 * Math.PI * Math.sqrt((r.hw * r.hw + ((r.hh + hb) / 2) ** 2) / 2);
    for (let j = 0; j <= segments; j++) {
      const t = (j / segments) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const up = s >= 0;
      const ex = 2 / (up ? nt : nb);
      pos.push(r.cx + r.hw * Math.sign(c) * Math.pow(Math.abs(c), ex), r.cy + (up ? r.hh : hb) * Math.sign(s) * Math.pow(Math.abs(s), ex), r.z);
      uv.push(((j / segments) * per) / SKIN_TILE, r.z / SKIN_TILE);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capFront) {
    const f = rings[0];
    const centre = pos.length / 3;
    pos.push(f.cx, f.cy, f.z);
    uv.push(0, 0);
    for (let j = 0; j < segments; j++) idx.push(centre, j + 1, j);
  }
  if (capBack) {
    const l = rings[rings.length - 1];
    const centre = pos.length / 3;
    pos.push(l.cx, l.cy, l.z);
    uv.push(0, 0);
    const base = (rings.length - 1) * row;
    for (let j = 0; j < segments; j++) idx.push(centre, base + j, base + j + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A thin tapered plate from a convex-ish planform (fan triangulation from the centroid).
 * `pts` are absolute positions on the mid-surface, `origin` is subtracted so the mesh can pivot about it,
 * `n` is the thickness direction and `thick(p)` the thickness at a point. UVs are planar in metres.
 */
function polySlab(pts: Vector3[], origin: Vector3, n: Vector3, thick: (p: Vector3) => number): BufferGeometry {
  const k = pts.length;
  const cen = new Vector3();
  for (const p of pts) cen.add(p);
  cen.multiplyScalar(1 / k);
  const top: Vector3[] = [];
  const bot: Vector3[] = [];
  const abs: Vector3[] = [];
  const mk = (p: Vector3) => {
    const t = thick(p) / 2;
    top.push(p.clone().addScaledVector(n, t).sub(origin));
    bot.push(p.clone().addScaledVector(n, -t).sub(origin));
    abs.push(p);
  };
  for (const p of pts) mk(p);
  mk(cen);
  const cTop = top[k];
  const cBot = bot[k];
  const pos: number[] = [];
  const uv: number[] = [];
  const tri = (a: Vector3, b: Vector3, c: Vector3) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    // planar UV from the dominant axis of the face normal (absolute coordinates so panels line up across parts)
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    for (const v of [a, b, c]) {
      const wx = v.x + origin.x;
      const wy = v.y + origin.y;
      const wz = v.z + origin.z;
      if (ay >= ax && ay >= az) uv.push(wx / SKIN_TILE, wz / SKIN_TILE);
      else if (ax >= az) uv.push(wz / SKIN_TILE, wy / SKIN_TILE);
      else uv.push(wx / SKIN_TILE, wy / SKIN_TILE);
    }
  };
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    tri(cTop, top[i], top[j]);
    tri(cBot, bot[j], bot[i]);
    tri(top[i], bot[i], bot[j]);
    tri(top[i], bot[j], top[j]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  return g;
}

/** Half thickness of a NACA 4-digit style section as a fraction of the maximum thickness (0.5 at about 30% chord, 0 at both ends). */
function foilHalf(s: number): number {
  const q = 0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s * s * s - 0.1015 * s * s * s * s - 0.0021 * s;
  return (Math.max(0, q) / 0.1002) * 0.5;
}

/**
 * A lifting surface with a real aerofoil section: rounded leading edge, maximum thickness a third of the way back, sharp
 * trailing edge, closed at both ends. `LE(t)` and `TE(t)` give the leading and trailing edge at span station t (0..1) in
 * absolute coordinates, `n` is the thickness direction, `thick(t)` the maximum thickness there. The patch covers span
 * t0..t1 and chord fraction s0..s1 (so a flap is the rear part of the same wing). Positions are relative to `origin` so a
 * control surface can hinge about it. Chord points are cosine-spaced near a leading edge so the nose is round.
 */
function foilPatch(
  LE: (t: number) => Vector3, TE: (t: number) => Vector3, t0: number, t1: number, s0: number, s1: number,
  n: Vector3, thick: (t: number) => number, origin: Vector3, nSpan = 3, nChord = 9,
): BufferGeometry {
  const sList: number[] = [];
  for (let i = 0; i <= nChord; i++) {
    const u = i / nChord;
    sList.push(s0 + (s1 - s0) * (s0 < 0.02 ? 1 - Math.cos((u * Math.PI) / 2) : u));
  }
  const loop = 2 * (nChord + 1);
  const pos: number[] = [];
  const uv: number[] = [];
  const a = new Vector3();
  const chord = new Vector3();
  const p = new Vector3();
  const useXZ = Math.abs(n.y) > 0.5;
  const useZY = !useXZ && Math.abs(n.x) > 0.5;
  const put = (v: Vector3): void => {
    pos.push(v.x - origin.x, v.y - origin.y, v.z - origin.z);
    if (useXZ) uv.push(v.x / SKIN_TILE, v.z / SKIN_TILE);
    else if (useZY) uv.push(v.z / SKIN_TILE, v.y / SKIN_TILE);
    else uv.push(v.x / SKIN_TILE, v.y / SKIN_TILE);
  };
  for (let j = 0; j <= nSpan; j++) {
    const t = t0 + ((t1 - t0) * j) / nSpan;
    a.copy(LE(t));
    chord.copy(TE(t)).sub(a);
    const T = thick(t);
    for (let i = 0; i <= nChord; i++) {
      const s = sList[i];
      p.copy(a).addScaledVector(chord, s).addScaledVector(n, foilHalf(s) * T);
      put(p);
    }
    for (let i = nChord; i >= 0; i--) {
      const s = sList[i];
      p.copy(a).addScaledVector(chord, s).addScaledVector(n, -foilHalf(s) * T);
      put(p);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nSpan; j++) {
    for (let k = 0; k < loop; k++) {
      const a0 = j * loop + k;
      const b0 = j * loop + ((k + 1) % loop);
      const c0 = a0 + loop;
      const d0 = b0 + loop;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
  }
  // end caps
  for (const j of [0, nSpan]) {
    const base = j * loop;
    for (let k = 1; k < loop - 1; k++) idx.push(base, base + k + 1, base + k);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface SecAt {
  hw: number;
  /** Half height and centre of the whole section (top and bottom as one symmetric extent). */
  hh: number;
  yc: number;
  top: number;
  bot: number;
}

/** A section with every column present: [z, hw, hh, yc, hb, n, nb]. */
type FullSection = [number, number, number, number, number, number, number];

function fullSections(s: Section[], defN: number): FullSection[] {
  return s.map((q) => {
    const n = q[5] ?? defN;
    return [q[0], q[1], q[2], q[3], q[4] ?? q[2], n, q[6] ?? n] as FullSection;
  });
}

/**
 * Smooth the stations: a monotone cubic (no overshoot) through half width, heights and centre, linear through the
 * exponents, `sub` samples per segment. A straight-line loft of a handful of stations looks faceted; this does not.
 */
function refineSections(s: FullSection[], sub: number): FullSection[] {
  const n = s.length;
  if (n < 3) return s;
  const slopes = [1, 2, 3, 4].map((c) => {
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((s[i + 1][c] - s[i][c]) / (s[i + 1][0] - s[i][0] || 1e-6));
    const m = new Array<number>(n);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
      } else {
        const a = m[i] / d[i];
        const b = m[i + 1] / d[i];
        const h = a * a + b * b;
        if (h > 9) {
          const t = 3 / Math.sqrt(h);
          m[i] = t * a * d[i];
          m[i + 1] = t * b * d[i];
        }
      }
    }
    return m;
  });
  const out: FullSection[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = s[i + 1][0] - s[i][0];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const v = (c: number) => h00 * s[i][c] + h10 * h * slopes[c - 1][i] + h01 * s[i + 1][c] + h11 * h * slopes[c - 1][i + 1];
      out.push([
        s[i][0] + t * h, Math.max(0, v(1)), Math.max(0, v(2)), v(3), Math.max(0, v(4)),
        lerp(s[i][5], s[i + 1][5], t), lerp(s[i][6], s[i + 1][6], t),
      ]);
    }
  }
  out.push(s[n - 1]);
  return out;
}

const refined = new WeakMap<ModelSpec, FullSection[]>();
function fine(spec: ModelSpec): FullSection[] {
  let r = refined.get(spec);
  if (!r) refined.set(spec, (r = refineSections(fullSections(spec.sections, spec.shapeN ?? 2.5), 6)));
  return r;
}

export function secAt(spec: ModelSpec, f: number): SecAt {
  const s = fine(spec);
  f = clamp(f, 0, 1);
  let q: FullSection | null = null;
  let r: FullSection | null = null;
  let t = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (f >= s[i][0] && f <= s[i + 1][0]) {
      q = s[i];
      r = s[i + 1];
      t = (f - s[i][0]) / (s[i + 1][0] - s[i][0] || 1);
      break;
    }
  }
  if (!q || !r) q = r = s[s.length - 1];
  const hw = lerp(q[1], r[1], t);
  const yc = lerp(q[3], r[3], t);
  const top = yc + lerp(q[2], r[2], t);
  const bot = yc - lerp(q[4], r[4], t);
  return { hw, hh: (top - bot) / 2, yc: (top + bot) / 2, top, bot };
}

type Kind = 'ail' | 'flap' | 'stab' | 'canard' | 'rudder' | 'brake';
interface Mover {
  g: Group;
  axis: Vector3;
  kind: Kind;
  side: number;
}

/**
 * Procedural fighter built from an AircraftDef.model spec. Parts that move on the real aircraft are separate
 * pivoting groups: ailerons, flaps, all-moving tailplanes and canards, rudders, airbrake, thrust-vectoring nozzles
 * and the landing gear. Local axes: -Z forward, +Y up, +X right.
 */
export class JetModel implements ModelHandle {
  readonly root = new Group();
  readonly wingtips: Vector3[] = [];
  readonly nozzles: Vector3[] = [];
  /** Detachable parts (shot off by the damage model). */
  readonly parts = { wingL: new Group(), wingR: new Group(), tail: new Group() };
  /** Visible weapon stores, indexed by station. */
  private stores: (Group | null)[] = [];
  private storeRoot = new Group();
  private movers: Mover[] = [];
  private nozzleGroups: Group[] = [];
  private afterburners: Afterburner[] = [];
  private nose = new Group();
  private mainL = new Group();
  private mainR = new Group();
  private mats: JetMaterials;
  private geoms: BufferGeometry[] = [];
  private t = 0;
  private sp = 0;
  private sr = 0;
  private sy = 0;
  private sb = 0;
  private sf = 0;

  constructor(readonly def: AircraftDef, teamColor: number) {
    const spec = def.model;
    this.mats = makeJetMaterials(spec.colors, teamColor, def.id.length * 17 + def.id.charCodeAt(0));
    this.root.add(this.parts.wingL, this.parts.wingR, this.parts.tail, this.storeRoot);
    this.buildFuselage(spec);
    this.buildPods(spec);
    this.buildWings(spec);
    this.buildTail(spec);
    this.buildIntakesAndCanopy(spec);
    this.buildEngines(spec);
    this.buildGear(spec);
    this.bake();
    this.root.userData.def = def.id;
  }

  /**
   * A jet is built from ~35 meshes, which is far too many draw calls for twenty of them (and again for every shadow pass).
   * Everything that never moves relative to its holder (fuselage, wing slabs, pods, intakes, canopy, fins) is merged into one
   * mesh per material. Control surfaces, nozzles, afterburners, landing gear and weapon stores stay separate: they animate or
   * can disappear. The wings and the tail keep their own holders so the damage model can still rip them off.
   */
  private bake(): void {
    const skip = new Set<Object3D>([this.parts.wingL, this.parts.wingR, this.parts.tail, this.storeRoot, this.nose, this.mainL, this.mainR]);
    for (const m of this.movers) skip.add(m.g);
    for (const g of this.nozzleGroups) skip.add(g);
    for (const b of this.afterburners) skip.add(b.group);
    for (const holder of [this.root, this.parts.wingL, this.parts.wingR, this.parts.tail]) this.bakeHolder(holder, skip);
  }

  private bakeHolder(holder: Group, skip: Set<Object3D>): void {
    const buckets = new Map<string, { mat: Material; shadow: boolean; geos: BufferGeometry[] }>();
    const dead: Mesh[] = [];
    const walk = (o: Object3D, parent: Matrix4): void => {
      for (const child of o.children) {
        if (skip.has(child)) continue;
        child.updateMatrix();
        const m = new Matrix4().multiplyMatrices(parent, child.matrix);
        const mesh = child as Mesh;
        if (mesh.isMesh && !Array.isArray(mesh.material)) {
          const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(m);
          const key = [mesh.material.uuid, mesh.castShadow, Object.keys(g.attributes).sort().join(',')].join('|');
          let b = buckets.get(key);
          if (!b) buckets.set(key, (b = { mat: mesh.material, shadow: mesh.castShadow, geos: [] }));
          b.geos.push(g);
          dead.push(mesh);
        } else walk(child, m);
      }
    };
    walk(holder, new Matrix4());
    for (const mesh of dead) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      const i = this.geoms.indexOf(mesh.geometry);
      if (i >= 0) this.geoms.splice(i, 1);
    }
    for (const b of buckets.values()) {
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      if (!merged) continue;
      for (const g of b.geos) if (g !== merged) g.dispose();
      const mesh = new Mesh(merged, b.mat);
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      this.geoms.push(merged);
      holder.add(mesh);
    }
  }

  // ---- small helpers ------------------------------------------------------------------------

  private mesh(g: BufferGeometry, m: Material, parent: Group = this.root, shadow = true): Mesh {
    const mesh = new Mesh(g, m);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    this.geoms.push(g);
    parent.add(mesh);
    return mesh;
  }

  /** A pivoting control surface: geometry is stored relative to the pivot so rotating the group hinges it. */
  private surface(pts: Vector3[], pivot: Vector3, axis: Vector3, n: Vector3, thick: (p: Vector3) => number, kind: Kind, side: number, mat: Material, parent: Group = this.root): Group {
    const g = new Group();
    g.position.copy(pivot);
    this.mesh(polySlab(pts, pivot, n, thick), mat, g);
    parent.add(g);
    this.movers.push({ g, axis: axis.clone().normalize(), kind, side });
    return g;
  }

  /** A pivoting aerofoil surface (aileron, flap, rudder, tailplane): geometry is relative to the pivot. */
  private foilSurface(
    LE: (t: number) => Vector3, TE: (t: number) => Vector3, t0: number, t1: number, s0: number, s1: number, pivot: Vector3, axis: Vector3,
    n: Vector3, thick: (t: number) => number, kind: Kind, side: number, parent: Group,
  ): Group {
    const g = new Group();
    g.position.copy(pivot);
    this.mesh(foilPatch(LE, TE, t0, t1, s0, s1, n, thick, pivot), this.mats.flat, g);
    parent.add(g);
    this.movers.push({ g, axis: axis.clone().normalize(), kind, side });
    return g;
  }

  private ringsOf(L: number, secs: FullSection[], cx = 0): Ring[] {
    return secs.map((s) => ({ z: -L / 2 + s[0] * L, hw: s[1], hh: s[2], hb: s[4], cx, cy: s[3], n: s[5], nb: s[6] }));
  }

  // ---- fuselage -------------------------------------------------------------------------------

  private buildFuselage(spec: ModelSpec): void {
    const L = spec.length;
    const n = spec.shapeN ?? 2.5;
    const secs = refineSections(fullSections(spec.sections, n), 4);
    this.mesh(loft(this.ringsOf(L, secs), n, 44), this.mats.body);
    this.fuselageDetail(spec, secs, n);
  }

  /** Extra lofted bodies from the spec: engine nacelles, tail booms, bumps and fairings. */
  private buildPods(spec: ModelSpec): void {
    const L = spec.length;
    const dn = spec.shapeN ?? 2.5;
    for (const p of spec.pods ?? ([] as PodSpec[])) {
      const secs = refineSections(fullSections(p.rings, p.n ?? dn), 3);
      const mat = p.mat === 'dark' ? this.mats.dark : p.mat === 'intake' ? this.mats.intake : p.mat === 'glass' ? this.mats.glass : this.mats.body;
      for (const sx of p.mirror ? [1, -1] : [1]) {
        const g = loft(this.ringsOf(L, secs, sx * p.x), p.n ?? dn, p.segments ?? 22, p.mouth ?? false, p.capBack ?? false);
        this.mesh(g, mat);
      }
    }
  }

  // ---- wings, lerx, flaps, ailerons ----------------------------------------------------------

  private buildWings(spec: ModelSpec): void {
    const L = spec.length;
    const w = spec.wing;
    const z0 = -L / 2 + w.zRoot * L;
    const xr = w.xRoot ?? secAt(spec, w.zRoot + 0.08).hw * 0.8;
    const half = w.span / 2 - xr;
    const fs = w.flapSpan ?? 0.42;
    const hingeC = 0.27;
    const up = new Vector3(0, 1, 0);

    for (const s of [1, -1]) {
      const P = (x: number, z: number, y = w.y + (x - xr) * w.dihedral) => new Vector3(s * x, y, z);
      const rootLE = P(xr, z0);
      const rootTE = P(xr, z0 + w.rootChord);
      const tipLE = P(xr + half, z0 + w.sweep);
      const tipTE = P(xr + half, z0 + w.sweep + w.tipChord);
      const LE = (t: number) => rootLE.clone().lerp(tipLE, t);
      const TE = (t: number) => rootTE.clone().lerp(tipTE, t);
      const hinge = (t: number) => TE(t).lerp(LE(t), hingeC);
      const thickT = (t: number) => lerp(w.thickness, w.thickness * 0.34, t);
      const origin = new Vector3();
      const pg = s > 0 ? this.parts.wingR : this.parts.wingL;
      const sH = 1 - hingeC; // chord fraction of the hinge line

      // the fixed wing is an aerofoil from the leading edge to the hinge line; flap and aileron are the rear of the same section
      this.mesh(foilPatch(LE, TE, 0, 1, 0, sH, up, thickT, origin, 5, 10), this.mats.flat, pg);
      const axis = hinge(1).sub(hinge(0));
      this.foilSurface(LE, TE, 0, fs, sH, 1, hinge(fs * 0.5), axis, up, thickT, 'flap', s, pg);
      this.foilSurface(LE, TE, fs, 1, sH, 1, hinge((fs + 1) / 2), axis, up, thickT, 'ail', s, pg);

      if (w.lerx) {
        // a leading-edge root extension: a thin triangular strake that runs from well ahead of the wing, along the fuselage
        // side, out to the wing's leading edge
        const reach = w.lerx.reach;
        const xA = Math.max(0.25, xr * 0.9);
        const A = P(xA, z0 - w.lerx.length, w.y);
        const B = LE(reach);
        const R = P(xr, z0 + w.rootChord * 0.2, w.y);
        const sx = (t: number) => A.clone().lerp(B, t);
        const tx = (t: number) => R.clone().lerp(B, t);
        const tk = w.thickness * (w.lerx.thick ?? 0.5);
        this.mesh(foilPatch(sx, tx, 0, 1, 0, 1, up, (t) => tk * (1 - t * 0.55), origin, 3, 8), this.mats.flat, pg);
      }
      if (w.pods) {
        const pod = this.mesh(new CylinderGeometry(0.17, 0.17, 2.6, 12).rotateX(Math.PI / 2), this.mats.dark, pg);
        pod.position.copy(tipLE).add(new Vector3(0, 0, w.tipChord * 0.45));
        const nose = this.mesh(new SphereGeometry(0.17, 10, 8), this.mats.dark, pg);
        nose.position.copy(pod.position).add(new Vector3(0, 0, -1.3));
      } else {
        // team-colour band on the outer wing: a skin over the same aerofoil
        this.mesh(foilPatch(LE, TE, 1 - 0.34 / half, 1, 0.06, 0.94, up, (t) => thickT(t) * 1.04 + 0.012, origin, 2, 10), this.mats.accent, pg);
        if (w.tipRail) {
          // launch rail on the wing tip for a short-range missile
          const rail = this.mesh(new BoxGeometry(0.1, 0.1, Math.min(2.4, w.tipChord * 1.6 + 0.8)), this.mats.dark, pg);
          rail.position.copy(tipLE).add(new Vector3(s * 0.08, 0, w.tipChord * 0.5 + 0.1));
        }
      }
      this.wingtips.push(tipTE.clone().add(new Vector3(0, 0, -w.tipChord * 0.2)));

      // leading-edge slat seam, flap-track fairings and a navigation light on the tip
      const chord = (t: number) => lerp(w.rootChord, w.tipChord, t);
      // leading-edge slat: a darker skin over the front of the outer wing
      this.mesh(foilPatch(LE, TE, 0.22, 0.96, 0.015, 0.14, up, (t) => thickT(t) * 1.05 + 0.014, origin, 4, 5), this.mats.dark, pg);
      for (const t of [0.14, 0.34, 0.62, 0.84]) {
        const fairing = this.mesh(new SphereGeometry(1, 8, 6), this.mats.dark, pg);
        fairing.scale.set(0.07, 0.06 * (1 - t * 0.5), chord(t) * 0.16 + 0.2);
        fairing.position.copy(TE(t)).add(new Vector3(0, -0.07, chord(t) * 0.02));
      }
      this.light(tipLE.clone().add(new Vector3(s * 0.03, 0.0, w.tipChord * 0.3)), s > 0 ? [0.2, 2.6, 0.5] : [2.8, 0.2, 0.2], pg);
    }
  }

  /** Navigation / anti-collision lights: tiny, unlit and bright, merged into one mesh per holder with vertex colours. */
  private light(p: Vector3, _rgb: [number, number, number], parent: Group, r = 0.065): void {
    // (team-coloured: it merges into the accent mesh, so a light costs no extra draw call)
    this.mesh(new SphereGeometry(r, 8, 6), this.mats.accent, parent, false).position.copy(p);
  }

  /** Radome, pitot, dorsal spine, wing-root fillets, chines, sensor balls, probe, hook: everything that is not the skin itself. */
  private fuselageDetail(spec: ModelSpec, secs: FullSection[], n: number): void {
    const L = spec.length;
    const ft = spec.features ?? {};
    const ring = (s: FullSection, k: number): Ring => ({ z: -L / 2 + s[0] * L, hw: s[1] * k, hh: s[2] * k, hb: s[4] * k, cx: 0, cy: s[3], n: s[5], nb: s[6] });
    // dark radome over the nose
    const rEnd = ft.radome ?? 0.07;
    const nose = secs.filter((s) => s[0] <= rEnd);
    if (nose.length >= 3) this.mesh(loft(nose.map((s) => ring(s, 1.012)), n, 32), this.mats.dark);
    // pitot boom
    const tip = secs[0];
    const pitot = this.mesh(new CylinderGeometry(0.014, 0.026, L * 0.05, 6).rotateX(Math.PI / 2), this.mats.strut);
    pitot.position.set(0, tip[3], -L / 2 - L * 0.018);
    // dorsal spine from behind the canopy toward the fin
    const glass = (spec.canopyLen ?? 2.2) / L;
    const sp = ft.spine;
    const f0 = sp ? sp[0] : spec.canopyZ + glass * 0.85;
    const f1 = sp ? sp[1] : Math.min(0.8, f0 + 0.3);
    const sw = sp ? sp[2] : 0.45;
    const sh = sp ? sp[3] : 0.17;
    const spine: Ring[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const f = f0 + (f1 - f0) * t;
      const sec = secAt(spec, f);
      const k = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.04)), 0.7);
      const hw = Math.min(sec.hw * 0.5, sw) * k + 0.01;
      const hh = sh * k + 0.01;
      spine.push({ z: -L / 2 + f * L, hw, hh, cx: 0, cy: sec.top - 0.04 + hh * 0.5 });
    }
    this.mesh(loft(spine, 2.4, 14), this.mats.body);
    // wing-root fillets: a smooth fairing where each wing meets the body
    {
      const w = spec.wing;
      const z0 = -L / 2 + w.zRoot * L;
      const xr = w.xRoot ?? secAt(spec, w.zRoot + 0.08).hw * 0.8;
      for (const s of [1, -1]) {
        const rings: Ring[] = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const k = Math.pow(Math.sin(Math.PI * (0.06 + t * 0.88)), 0.8);
          const z = z0 - 0.4 + (w.rootChord * 0.95 + 0.4) * t;
          const sec = secAt(spec, (z + L / 2) / L);
          rings.push({ z, hw: 0.34 * k + 0.02, hh: 0.2 * k + 0.02, cx: s * Math.min(xr * 1.04, sec.hw * 0.95), cy: w.y + 0.03 });
        }
        this.mesh(loft(rings, 2.2, 12), this.mats.body);
      }
    }
    // forebody chines: a thin sharp-edged shelf along each side of the nose
    if (ft.chines) {
      const c0 = 0.05;
      const c1 = Math.min(0.36, spec.wing.zRoot);
      const mid = secAt(spec, (c0 + c1) / 2);
      for (const s of [1, -1]) {
        const xin = mid.hw * 0.7;
        const ext = 0.42 + mid.hw * 0.28;
        const zA = -L / 2 + c0 * L;
        const zB = -L / 2 + c1 * L;
        const y = mid.yc - mid.hh * 0.15;
        const LEf = (t: number) => new Vector3(s * (xin + t * ext), y, zA + t * (zB - zA) * 0.62);
        const TEf = (t: number) => new Vector3(s * (xin + t * ext), y, zB);
        this.mesh(foilPatch(LEf, TEf, 0, 1, 0, 1, new Vector3(0, 1, 0), (t) => 0.1 - t * 0.07, new Vector3(), 4, 10), this.mats.body);
      }
    }
    // infra-red search and track ball ahead of the windscreen
    if (ft.irst) {
      const fz = spec.canopyZ - 0.03;
      const sec = secAt(spec, fz);
      const ball = this.mesh(new SphereGeometry(0.19, 12, 10), this.mats.glass);
      ball.position.set(0, sec.top + 0.04, -L / 2 + fz * L);
      const mount = this.mesh(new CylinderGeometry(0.2, 0.24, 0.1, 12), this.mats.dark);
      mount.position.set(0, sec.top - 0.02, -L / 2 + fz * L);
    }
    // refuelling probe
    if (ft.probe) {
      const s = ft.probe === 'R' ? 1 : -1;
      const fz = Math.max(0.12, spec.canopyZ - 0.04);
      const sec = secAt(spec, fz);
      const probe = this.mesh(new CylinderGeometry(0.035, 0.035, 1.5, 6).rotateX(Math.PI / 2), this.mats.strut);
      probe.position.set(s * sec.hw * 0.55, sec.top + 0.12, -L / 2 + fz * L - 0.75);
      probe.rotation.x = 0.12;
      const strut = this.mesh(new BoxGeometry(0.05, 0.28, 0.05), this.mats.strut);
      strut.position.set(s * sec.hw * 0.55, sec.top + 0.02, -L / 2 + fz * L - 0.1);
    }
    // cannon muzzle
    if (ft.gun) {
      const [gx, gy, gz] = ft.gun;
      const muzzle = this.mesh(new CylinderGeometry(0.075, 0.09, 0.5, 8).rotateX(Math.PI / 2), this.mats.dark);
      muzzle.position.set(gx, gy, -L / 2 + gz * L);
    }
    // weapons-bay doors under the belly
    if (ft.bay) {
      const [b0, b1, bw] = ft.bay;
      const sec = secAt(spec, (b0 + b1) / 2);
      for (const dx of [-1, 1]) {
        const door = this.mesh(new BoxGeometry(0.04, 0.03, (b1 - b0) * L), this.mats.dark);
        door.position.set(dx * bw, sec.bot + 0.04, -L / 2 + ((b0 + b1) / 2) * L);
      }
    }
    // arrestor hook stub under the tail
    const tail = secAt(spec, 0.97);
    const hook = this.mesh(new BoxGeometry(0.07, 0.07, 1.5), this.mats.dark);
    hook.position.set(0, tail.bot + 0.15, -L / 2 + (ft.hook ?? 0.9) * L);
    hook.rotation.x = 0.16;
  }

  // ---- tailplanes, canards, fins -------------------------------------------------------------

  private buildTail(spec: ModelSpec): void {
    const L = spec.length;
    const up = new Vector3(0, 1, 0);

    const allMoving = (t: { zRoot: number; rootChord: number; tipChord: number; span: number; sweep: number; y: number; dihedral?: number; xRoot?: number; thickness?: number }, kind: 'stab' | 'canard', pivotFrac: number, thickR: number, parent: Group) => {
      const z0 = -L / 2 + t.zRoot * L;
      const xr = t.xRoot ?? secAt(spec, t.zRoot + 0.04).hw * 0.82;
      const half = t.span / 2 - xr;
      const dih = t.dihedral ?? 0;
      const thk = t.thickness ?? thickR;
      for (const s of [1, -1]) {
        const P = (x: number, z: number) => new Vector3(s * x, t.y + (x - xr) * dih, z);
        const rootLE = P(xr, z0);
        const rootTE = P(xr, z0 + t.rootChord);
        const tipLE = P(xr + half, z0 + t.sweep);
        const tipTE = P(xr + half, z0 + t.sweep + t.tipChord);
        const pr = rootLE.clone().lerp(rootTE, pivotFrac);
        const pt = tipLE.clone().lerp(tipTE, pivotFrac);
        const axis = pt.clone().sub(pr);
        const LEf = (u: number) => rootLE.clone().lerp(tipLE, u);
        const TEf = (u: number) => rootTE.clone().lerp(tipTE, u);
        this.foilSurface(LEf, TEf, 0, 1, 0, 1, pr, axis, up, (u) => lerp(thk, thk * 0.4, u), kind, s, parent);
      }
    };
    if (spec.hstab) allMoving(spec.hstab, 'stab', 0.45, 0.2, this.parts.tail);
    if (spec.canard) allMoving({ ...spec.canard, dihedral: 0 }, 'canard', 0.4, 0.16, this.root);

    for (const f of spec.fins) this.buildFin(spec, f);

    if (spec.airbrake) {
      const sec = secAt(spec, 0.62);
      const z = -L / 2 + 0.6 * L;
      const top = sec.top - 0.05;
      const pts = [new Vector3(-0.7, top, z), new Vector3(0.7, top, z), new Vector3(0.6, top, z + 2.2), new Vector3(-0.6, top, z + 2.2)];
      const pivot = new Vector3(0, top, z);
      this.surface(pts, pivot, new Vector3(1, 0, 0), up, () => 0.1, 'brake', 1, this.mats.dark);
    }
  }

  private buildFin(spec: ModelSpec, f: FinSpec): void {
    const L = spec.length;
    const ventral = f.height < 0;
    const z0 = -L / 2 + f.zRoot * L;
    const sec = secAt(spec, f.zRoot + 0.05);
    const xFin = f.x;
    const yb = f.y ?? (ventral ? sec.bot + 0.12 : sec.top - 0.14);
    const h = f.height;
    const sides = f.x === 0 ? [0] : [1, -1];
    const xAxis = new Vector3(1, 0, 0);
    const hingeC = 0.3;
    const s0 = 0.12; // rudder starts a little above the root

    for (const s of sides) {
      const grp = new Group();
      grp.position.x = s * xFin;
      grp.rotation.z = -f.cant * s * (ventral ? -1 : 1);
      this.parts.tail.add(grp);
      const rootLE = new Vector3(0, yb, z0);
      const rootTE = new Vector3(0, yb, z0 + f.rootChord);
      const tipLE = new Vector3(0, yb + h, z0 + f.sweep);
      const tipTE = new Vector3(0, yb + h, z0 + f.sweep + f.tipChord);
      const LE = (t: number) => rootLE.clone().lerp(tipLE, t);
      const TE = (t: number) => rootTE.clone().lerp(tipTE, t);
      const hinge = (t: number) => TE(t).lerp(LE(t), hingeC);
      const tk = f.thickness ?? Math.max(0.12, f.rootChord * 0.055);
      const thickT = (t: number) => lerp(tk, tk * 0.42, t);
      const hasRudder = (f.rudder ?? true) && !ventral;
      const origin = new Vector3();
      const sH = 1 - hingeC;
      if (hasRudder) {
        this.mesh(foilPatch(LE, TE, 0, 1, 0, sH, xAxis, thickT, origin, 4, 10), this.mats.flat, grp);
        this.mesh(foilPatch(LE, TE, 0, s0, sH, 1, xAxis, thickT, origin, 1, 6), this.mats.flat, grp);
        const g = new Group();
        g.position.copy(hinge(s0));
        this.mesh(foilPatch(LE, TE, s0, 1, sH, 1, xAxis, thickT, hinge(s0), 3, 6), this.mats.flat, g);
        grp.add(g);
        this.movers.push({ g, axis: hinge(1).sub(hinge(s0)).normalize(), kind: 'rudder', side: 1 });
        // team stripe near the top
        this.mesh(foilPatch(LE, TE, 0.91, 1, 0.06, 0.94, xAxis, (t) => thickT(t) * 1.04 + 0.014, origin, 2, 8), this.mats.accent, grp);
      } else {
        this.mesh(foilPatch(LE, TE, 0, 1, 0, 1, xAxis, thickT, origin, 4, 10), this.mats.flat, grp);
      }
      if (!ventral) {
        // antenna cap and a white tail light
        const cap = this.mesh(new SphereGeometry(1, 8, 6), this.mats.dark, grp);
        cap.scale.set(0.08, 0.08, Math.max(0.4, f.tipChord * 0.35));
        cap.position.set(0, yb + h + 0.03, z0 + f.sweep + f.tipChord * 0.4);
        this.light(new Vector3(0, yb + h * 0.82, z0 + f.sweep * 0.82 + f.tipChord + 0.05), [2.4, 2.4, 2.4], grp, 0.05);
      }
    }
  }

  // ---- intakes, canopy -----------------------------------------------------------------------

  private buildIntakesAndCanopy(spec: ModelSpec): void {
    const L = spec.length;
    const intake = (it: IntakeSpec, s: number) => {
      const z0 = -L / 2 + it.zFrac * L;
      const n = it.n ?? 3.6;
      const toe = it.toe ?? 0;
      const drop = it.drop ?? 0;
      const rings: Ring[] = [];
      for (const t of [0, 0.035, 0.3, 0.65, 1]) {
        rings.push({
          z: z0 + t * it.len, hw: it.w * 0.5 * lerp(1, 0.86, t), hh: it.h * 0.5 * lerp(1, 0.9, t), cx: s * (it.x - toe * t), cy: it.y - drop * t, n,
        });
      }
      this.mesh(loft(rings, n, 20, true), this.mats.intake, this.root);
      // body skin covers everything but the lip, so only the dark front disc shows
      const shell = loft(rings.slice(1).map((r) => ({ ...r, hw: r.hw * 1.01, hh: r.hh * 1.01 })), n, 20);
      this.mesh(shell, this.mats.body);
      // rolled lip: a thin collar of skin around the mouth
      const lip = loft([
        { z: z0 - 0.015, hw: it.w * 0.5 * 1.045, hh: it.h * 0.5 * 1.045, cx: s * it.x, cy: it.y, n },
        { z: z0 + 0.1, hw: it.w * 0.5 * 1.03, hh: it.h * 0.5 * 1.03, cx: s * it.x, cy: it.y, n },
      ], n, 20);
      this.mesh(lip, this.mats.body);
      if (it.splitter ?? true) {
        if (it.x !== 0) {
          // boundary-layer splitter on the fuselage side of a cheek intake
          const plate = this.mesh(new BoxGeometry(0.05, it.h * 1.1, it.len * 0.5), this.mats.dark);
          plate.position.set(s * (it.x - it.w * 0.5 - 0.06), it.y, z0 + it.len * 0.18);
        } else {
          // the diverter gap between a chin intake and the belly
          const plate = this.mesh(new BoxGeometry(it.w * 0.98, 0.05, it.len * 0.5), this.mats.dark);
          plate.position.set(0, it.y + it.h * 0.5 + 0.03, z0 + it.len * 0.2);
        }
      }
    };
    for (const it of spec.intakes) {
      if (it.x === 0) intake(it, 1);
      else {
        intake(it, 1);
        intake(it, -1);
      }
    }

    // canopy: a teardrop bubble sitting in the fuselage, with bows, rails, seats and pilots inside
    const gl = spec.canopyLen ?? 2.2;
    const mid = secAt(spec, spec.canopyZ + (gl * 0.4) / L);
    const hwMax = spec.canopyW ?? clamp(mid.hw * 0.62, 0.3, 0.64);
    const hhMax = spec.canopyH ?? clamp(mid.hh * 0.5, 0.34, 0.46);
    const zc = -L / 2 + spec.canopyZ * L;
    const prof: [number, number, number][] = [
      [0, 0.1, 0.08], [0.05, 0.3, 0.26], [0.12, 0.55, 0.52], [0.24, 0.8, 0.8], [0.38, 0.96, 0.96], [0.52, 1, 1], [0.66, 0.94, 0.9],
      [0.8, 0.74, 0.66], [0.92, 0.44, 0.34], [1, 0.14, 0.1],
    ];
    const bubble: Ring[] = prof.map(([t, w, h]) => {
      const s = secAt(spec, spec.canopyZ + (t * gl) / L);
      const base = s.top - 0.26;
      return { z: zc + t * gl, hw: hwMax * w, hh: hhMax * h, cx: 0, cy: base + hhMax * h };
    });
    this.mesh(loft(bubble, 2.2, 26), this.mats.glass);
    // windscreen frame across the front, then the bows
    const wf = bubble[2];
    const frame = this.mesh(new BoxGeometry(wf.hw * 1.7, 0.05, 0.12), this.mats.dark);
    frame.position.set(0, wf.cy - wf.hh * 0.98, wf.z);
    for (const t of spec.tandem ? [0.14, 0.4, 0.62, 0.92] : [0.14, 0.52, 0.92]) {
      const r = bubble[prof.findIndex((p) => p[0] >= t)];
      const bow = this.mesh(new TorusGeometry(1, 0.024, 5, 18, Math.PI).scale(r.hw * 1.04, r.hh * 1.04, 1), this.mats.dark);
      bow.position.set(0, r.cy - r.hh * 0.02, r.z);
    }
    for (const x of [1, -1]) {
      const rail = this.mesh(new BoxGeometry(0.04, 0.05, gl * 0.86), this.mats.dark);
      const r = bubble[3];
      rail.position.set(x * r.hw * 0.97, r.cy - r.hh * 0.6, zc + gl * 0.5);
    }
    for (const t of spec.tandem ? [0.34, 0.68] : [0.5]) {
      const seat = this.mesh(new BoxGeometry(0.4, 0.46, 0.34), this.mats.dark);
      seat.position.set(0, bubble[3].cy - 0.1, zc + gl * (t + 0.06));
      const helmet = this.mesh(new SphereGeometry(0.14, 10, 8), this.mats.strut);
      helmet.position.set(0, bubble[3].cy + 0.12, zc + gl * t);
    }
  }

  // ---- engines -------------------------------------------------------------------------------

  private buildEngines(spec: ModelSpec): void {
    const L = spec.length;
    const tail = secAt(spec, 1);
    const ft = spec.features ?? {};
    const xs = spec.engines === 1 ? [0] : [-(spec.engineSpacing ?? 0.7), spec.engineSpacing ?? 0.7];
    const r = spec.nozzleRadius;
    const y = spec.nozzleY ?? tail.yc;
    const zp = spec.nozzleZ !== undefined ? -L / 2 + spec.nozzleZ * L : L / 2 - 0.7;
    const asp = spec.nozzleAspect ?? 1;
    for (const x of xs) {
      const pivot = new Vector3(x, y, zp);
      const grp = new Group();
      grp.position.copy(pivot);
      grp.scale.set(asp, 1 / Math.sqrt(asp), 1);
      this.root.add(grp);
      const shell = this.mesh(new CylinderGeometry(r * 0.82, r, 1.5, 22, 1, true).rotateX(Math.PI / 2), this.mats.nozzle, grp);
      shell.position.z = 0.55;
      // exhaust petals
      const petals: BufferGeometry[] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const pg = new BoxGeometry(((Math.PI * 2 * r) / 16) * 0.92, 0.014, 0.55);
        pg.applyMatrix4(new Matrix4().makeRotationZ(a + Math.PI / 2).multiply(new Matrix4().makeRotationX(-0.1)).setPosition(Math.cos(a) * r * 1.0, Math.sin(a) * r * 1.0, 1.0));
        petals.push(pg);
      }
      const merged = mergeGeometries(petals, false);
      for (const p of petals) p.dispose();
      if (merged) this.mesh(merged, this.mats.nozzle, grp);
      const glow = this.mesh(new CylinderGeometry(r * 0.7, r * 0.78, 0.6, 18, 1, true).rotateX(Math.PI / 2), this.mats.heat, grp, false);
      glow.position.z = 0.35;
      const burner = new Afterburner(r);
      burner.group.position.z = 1.28;
      grp.add(burner.group);
      this.afterburners.push(burner);
      if (spec.vectoringNozzles) this.nozzleGroups.push(grp);
      this.nozzles.push(new Vector3(x, y, zp + 1.3));
    }
    if (spec.engines === 2 && (ft.sting ?? true)) {
      // tail sting between the engines
      const sting = this.mesh(new CylinderGeometry(0.07, 0.2, 2.2, 10).rotateX(Math.PI / 2), this.mats.body);
      sting.position.set(0, y + 0.05, L / 2 + 0.1);
      this.light(new Vector3(0, y + 0.05, L / 2 + 1.2), [2.4, 2.4, 2.4], this.root, 0.05);
    }
  }

  // ---- landing gear --------------------------------------------------------------------------

  private buildGear(spec: ModelSpec): void {
    const L = spec.length;
    const def = this.def;
    const g = spec.gear ?? {};
    const mainX = g.mainX ?? Math.max(1.25, secAt(spec, 0.58).hw * 0.75 + 0.35);
    const mainR = g.mainR ?? 0.34;
    const noseR = g.noseR ?? 0.22;
    // each leg is built from a handful of pieces merged into one mesh per material (strut metal, rubber, dark hardware)
    const makeLeg = (grp: Group, x: number, z: number, y0: number, wheelR: number, wide: number, kind: 'nose' | 'mainL' | 'mainR'): void => {
      const wy = -(def.flight.gearHeight - wheelR) - y0;
      const drop = -wy;
      const metal: BufferGeometry[] = [];
      const rubber: BufferGeometry[] = [];
      const hard: BufferGeometry[] = [];
      const at = (geo: BufferGeometry, px: number, py: number, pz: number): BufferGeometry => geo.translate(px, py, pz);
      metal.push(at(new CylinderGeometry(0.09, 0.105, drop * 0.55, 10), 0, wy * 0.275, 0));
      metal.push(at(new CylinderGeometry(0.05, 0.055, drop * 0.5, 8), 0, wy * 0.77, 0));
      const twin = kind === 'nose';
      const offs = twin ? [-0.12, 0.12] : [0];
      for (const ox of offs) {
        rubber.push(at(new CylinderGeometry(wheelR, wheelR, wide, 18).rotateZ(Math.PI / 2), ox, wy, 0));
        metal.push(at(new CylinderGeometry(wheelR * 0.55, wheelR * 0.55, wide + 0.05, 12).rotateZ(Math.PI / 2), ox, wy, 0));
      }
      hard.push(at(new BoxGeometry(0.035, 0.035, 0.34), 0, wy * 0.6, -0.14));
      hard.push(at(new BoxGeometry(0.035, 0.035, 0.34), 0, wy * 0.6, 0.14));
      if (kind === 'nose') {
        // catapult launch bar and a pair of small doors
        hard.push(at(new BoxGeometry(0.05, 0.05, 0.7).rotateX(0.5), 0, wy + 0.12, -0.38));
        for (const sx of [-1, 1]) hard.push(at(new BoxGeometry(0.02, 0.45, 0.6), sx * 0.24, wy * 0.2, 0));
      } else {
        const sx = kind === 'mainL' ? -1 : 1;
        hard.push(at(new BoxGeometry(0.02, 0.62, 0.9), sx * 0.34, wy * 0.22, 0));
        hard.push(at(new BoxGeometry(0.02, 0.5, 0.5), -sx * 0.2, wy * 0.2, 0.1));
      }
      const add = (list: BufferGeometry[], mat: Material): void => {
        const m = mergeGeometries(list, false);
        for (const geo of list) geo.dispose();
        if (m) this.mesh(m, mat, grp);
      };
      add(metal, this.mats.strut);
      add(rubber, this.mats.tyre);
      add(hard, this.mats.dark);
      grp.position.set(x, y0, z);
      this.root.add(grp);
    };
    makeLeg(this.nose, 0, -L / 2 + (g.noseZ ?? 0.2) * L, -0.4, noseR, 0.14, 'nose');
    makeLeg(this.mainL, -mainX, -L / 2 + (g.mainZ ?? 0.58) * L, -0.4, mainR, 0.22, 'mainL');
    makeLeg(this.mainR, mainX, -L / 2 + (g.mainZ ?? 0.58) * L, -0.4, mainR, 0.22, 'mainR');
  }

  // ---- weapon stores -------------------------------------------------------------------------

  /** Hang the chosen weapons on their pylons (internal bay stores are not visible). */
  mountStores(items: (string | null)[], arm: Armament): void {
    for (const g of this.stores) if (g) this.storeRoot.remove(g);
    this.stores = items.map((id, i) => {
      const st = arm.stations[i];
      if (!id || !st || st.internal) return null;
      const def = STORES[id];
      const g = new Group();
      const w = weaponMesh(def, this.mats, true);
      w.position.y = -def.radius - 0.12;
      g.add(w);
      g.position.set(st.x, st.y + (st.kind === 'tip' ? 0 : 0.1), st.z);
      g.traverse((o) => { o.castShadow = true; });
      this.storeRoot.add(g);
      return g;
    });
  }

  setStoreVisible(i: number, visible: boolean): void {
    const g = this.stores[i];
    if (g) g.visible = visible;
  }

  showAllStores(): void {
    for (const g of this.stores) if (g) g.visible = true;
  }

  /** Reveal wings and tail again (after a repair / respawn). */
  restoreParts(): void {
    this.parts.wingL.visible = this.parts.wingR.visible = this.parts.tail.visible = true;
  }

  // ---- animation -----------------------------------------------------------------------------

  update(dt: number, s: JetState): void {
    this.t += dt;
    this.sp = damp(this.sp, s.pitch, 12, dt);
    this.sr = damp(this.sr, s.roll, 14, dt);
    this.sy = damp(this.sy, s.yaw, 8, dt);
    this.sb = damp(this.sb, s.airbrake, 4, dt);
    this.sf = damp(this.sf, s.gearPos, 3, dt); // landing flaps follow the gear

    for (const m of this.movers) {
      // Hinge axes point outward (so they mirror left/right): a given angle is trailing-edge-down on the right
      // wing and trailing-edge-up on the left. Symmetric motion therefore needs the side factor, roll does not.
      let a = 0;
      switch (m.kind) {
        case 'ail': a = -this.sr * 0.5; break;
        case 'flap': a = m.side * this.sf * 0.55 - this.sr * 0.18; break;
        case 'stab': a = -m.side * this.sp * 0.45 - this.sr * 0.24; break;
        case 'canard': a = m.side * this.sp * 0.42; break;
        case 'rudder': a = this.sy * 0.55; break;
        case 'brake': a = -this.sb * 0.95; break;
      }
      m.g.quaternion.setFromAxisAngle(m.axis, a);
    }
    for (const g of this.nozzleGroups) g.rotation.set(this.sp * 0.32, -this.sy * 0.32, 0);

    // gear
    const gp = s.gearPos;
    const fold = (1 - gp) * (Math.PI / 2);
    this.nose.rotation.x = -fold;
    this.mainL.rotation.z = fold;
    this.mainR.rotation.z = -fold;
    this.nose.visible = this.mainL.visible = this.mainR.visible = gp > 0.02;

    // exhaust
    const heat = 0.25 + 2.2 * s.power * s.power + 2.4 * s.ab;
    this.mats.heat.color.setRGB(1.6 * heat, 0.5 * heat, 0.12 * heat);
    for (const b of this.afterburners) b.update(dt, s.power, s.ab);
  }

  dispose(): void {
    for (const g of this.geoms) g.dispose();
    for (const b of this.afterburners) b.dispose();
    const m = this.mats;
    for (const k of Object.keys(m) as (keyof JetMaterials)[]) m[k].dispose();
  }
}


/** Merged weapon geometry, built once per store type and shared by every copy (two draw calls per store). */
const weaponGeoms = new Map<string, { geo: BufferGeometry; pylon: BufferGeometry }>();
let storeMaterial: MeshStandardMaterial | null = null;
const WHITE = new Color(0xc4c9ce);
const DARK = new Color(0x2c323a);

function weaponGeometry(def: StoreDef): { geo: BufferGeometry; pylon: BufferGeometry } {
  const hit = weaponGeoms.get(def.id);
  if (hit) return hit;
  const L = def.length;
  const r = def.radius;
  const white: BufferGeometry[] = [];
  const dark: BufferGeometry[] = [];
  const add = (to: BufferGeometry[], geo: BufferGeometry, x = 0, y = 0, z = 0, rotZ = 0): void => {
    geo.applyMatrix4(new Matrix4().makeRotationZ(rotZ).setPosition(x, y, z));
    to.push(geo);
  };
  if (def.kind === 'ir' || def.kind === 'radar') {
    add(white, new CylinderGeometry(r, r, L * 0.62, 12).rotateX(Math.PI / 2), 0, 0, L * 0.1);
    add(white, new CylinderGeometry(r * 0.82, r, L * 0.1, 12).rotateX(Math.PI / 2), 0, 0, L * 0.46);
    add(def.kind === 'ir' ? dark : white, new ConeGeometry(r, L * 0.26, 12).rotateX(-Math.PI / 2), 0, 0, -L * 0.34);
    if (def.kind === 'ir') add(white, new SphereGeometry(r * 0.42, 8, 6), 0, 0, -L * 0.47);
    // colour bands, mid-body wings (small) and tail fins (large)
    add(dark, new CylinderGeometry(r * 1.03, r * 1.03, L * 0.035, 12).rotateX(Math.PI / 2), 0, 0, -L * 0.18);
    add(dark, new CylinderGeometry(r * 1.03, r * 1.03, L * 0.035, 12).rotateX(Math.PI / 2), 0, 0, L * 0.2);
    for (let i = 0; i < 4; i++) add(dark, new BoxGeometry(r * 2.6, 0.012, L * 0.12), 0, 0, -L * 0.05, (i * Math.PI) / 2 + Math.PI / 4);
    for (let i = 0; i < 4; i++) add(dark, new BoxGeometry(r * 3.8, 0.015, L * 0.17), 0, 0, L * 0.4, (i * Math.PI) / 2 + Math.PI / 4);
  } else if (def.kind === 'rocket') {
    add(dark, new CylinderGeometry(r, r, L, 14).rotateX(Math.PI / 2));
    add(white, new ConeGeometry(r * 0.96, L * 0.16, 14).rotateX(-Math.PI / 2), 0, 0, -L * 0.58);
    add(dark, new CylinderGeometry(r * 1.04, r * 1.04, L * 0.04, 14).rotateX(Math.PI / 2), 0, 0, -L * 0.2);
    add(dark, new CylinderGeometry(r * 1.04, r * 1.04, L * 0.04, 14).rotateX(Math.PI / 2), 0, 0, L * 0.2);
    // tube mouths at the rear: a ring of small white discs
    for (let i = 0; i < 7; i++) {
      const a = i === 0 ? 0 : ((i - 1) / 6) * Math.PI * 2;
      const rr = i === 0 ? 0 : r * 0.55;
      add(white, new CylinderGeometry(r * 0.2, r * 0.2, 0.05, 8).rotateX(Math.PI / 2), Math.cos(a) * rr, Math.sin(a) * rr, L / 2 + 0.01);
    }
  } else {
    // bomb: teardrop body, nose fuze, tail cone, cruciform fins; guided bombs add canards
    add(dark, new CylinderGeometry(r, r, L * 0.5, 14).rotateX(Math.PI / 2), 0, 0, 0);
    add(dark, new ConeGeometry(r, L * 0.22, 14).rotateX(-Math.PI / 2), 0, 0, -L * 0.36);
    add(white, new CylinderGeometry(r * 0.2, r * 0.2, L * 0.07, 8).rotateX(Math.PI / 2), 0, 0, -L * 0.5);
    add(dark, new CylinderGeometry(r * 0.55, r, L * 0.2, 14).rotateX(Math.PI / 2), 0, 0, L * 0.35);
    add(white, new CylinderGeometry(r * 1.02, r * 1.02, L * 0.04, 14).rotateX(Math.PI / 2), 0, 0, -L * 0.1);
    add(white, new CylinderGeometry(r * 1.02, r * 1.02, L * 0.04, 14).rotateX(Math.PI / 2), 0, 0, L * 0.1);
    for (let i = 0; i < 4; i++) add(dark, new BoxGeometry(r * 3.6, 0.014, L * 0.16), 0, 0, L * 0.44, (i * Math.PI) / 2);
    if ((def as { guided?: boolean }).guided) for (let i = 0; i < 4; i++) add(white, new BoxGeometry(r * 2.4, 0.012, L * 0.1), 0, 0, -L * 0.3, (i * Math.PI) / 2 + Math.PI / 4);
  }
  // one geometry, two colours (vertex colours): a store is a single draw call
  const paint = (lists: [BufferGeometry[], Color][]): BufferGeometry => {
    const painted: BufferGeometry[] = [];
    for (const [list, colour] of lists) {
      for (const g of list) {
        const ng = g.index ? g.toNonIndexed() : g.clone();
        const n = ng.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([colour.r, colour.g, colour.b], i * 3);
        ng.setAttribute('color', new BufferAttribute(col, 3));
        ng.deleteAttribute('uv');
        painted.push(ng);
      }
    }
    const m = mergeGeometries(painted, false)!;
    for (const g of painted) g.dispose();
    return m;
  };
  const geo = paint([[white, WHITE], [dark, DARK]]);
  // the pylon hangs above the store (the store sits r + 0.12 below the hardpoint)
  const pylonBox = new BoxGeometry(0.12, 0.3, Math.min(1.4, def.length * 0.45));
  pylonBox.translate(0, r + 0.1, 0);
  const pylon = paint([[white, WHITE], [dark, DARK], [[pylonBox], DARK]]);
  const out = { geo, pylon };
  weaponGeoms.set(def.id, out);
  return out;
}

/** A simple visual for a store: missiles are slim with fins, pods are fat tubes, bombs are teardrops. Nose toward -Z. */
export function weaponMesh(def: StoreDef, _mats?: JetMaterials, onPylon = false): Group {
  const g = new Group();
  const wg = weaponGeometry(def);
  const geo = onPylon ? wg.pylon : wg.geo;
  if (!storeMaterial) storeMaterial = new MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.42 });
  g.add(new Mesh(geo, storeMaterial));
  return g;
}

/** The shared pylon box for a store type. */
export function pylonGeometry(def: StoreDef): BufferGeometry {
  return weaponGeometry(def).pylon;
}
