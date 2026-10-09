import {
  AdditiveBlending, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3,
} from 'three';
import type { AircraftDef, ModelSpec } from './AircraftDef';

/** Loft a fuselage from cross sections. Nose is at -Z, tail at +Z. */
function loft(spec: ModelSpec, segments = 22): BufferGeometry {
  const L = spec.length;
  const rings = spec.sections.length;
  const pos: number[] = [];
  const n = 2.5; // super-ellipse exponent: slightly boxy, like real fuselages
  for (const [f, hw, hh, yc] of spec.sections) {
    const z = -L / 2 + f * L;
    for (let j = 0; j <= segments; j++) {
      const t = (j / segments) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      pos.push(hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), z);
    }
  }
  const idx: number[] = [];
  const row = segments + 1;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Fuselage top surface height at a given z (fraction along the length). */
function fuselageTop(spec: ModelSpec, f: number): number {
  const s = spec.sections;
  for (let i = 0; i < s.length - 1; i++) {
    if (f >= s[i][0] && f <= s[i + 1][0]) {
      const t = (f - s[i][0]) / (s[i + 1][0] - s[i][0] || 1);
      const top0 = s[i][3] + s[i][2];
      const top1 = s[i + 1][3] + s[i + 1][2];
      return top0 + (top1 - top0) * t;
    }
  }
  return 0.5;
}

function fuselageHalfWidth(spec: ModelSpec, f: number): number {
  const s = spec.sections;
  for (let i = 0; i < s.length - 1; i++) {
    if (f >= s[i][0] && f <= s[i + 1][0]) {
      const t = (f - s[i][0]) / (s[i + 1][0] - s[i][0] || 1);
      return s[i][1] + (s[i + 1][1] - s[i][1]) * t;
    }
  }
  return 0.5;
}

/**
 * A tapered slab (wing, fin, stabiliser). Corners: root leading edge, root trailing edge,
 * tip trailing edge, tip leading edge. `n` is the thickness direction.
 */
function slab(c: Vector3[], n: Vector3, tRoot: number, tTip: number): BufferGeometry {
  const v: Vector3[] = [];
  const th = [tRoot, tRoot, tTip, tTip];
  for (let i = 0; i < 4; i++) v.push(c[i].clone().addScaledVector(n, th[i] / 2));
  for (let i = 0; i < 4; i++) v.push(c[i].clone().addScaledVector(n, -th[i] / 2));
  const quads = [
    [0, 1, 2, 3], // top
    [7, 6, 5, 4], // bottom
    [0, 3, 7, 4], // leading edge
    [1, 5, 6, 2], // trailing edge
    [0, 4, 5, 1], // root
    [3, 2, 6, 7], // tip
  ];
  const pos: number[] = [];
  for (const [a, b, cc, d] of quads) {
    for (const k of [a, b, cc, a, cc, d]) pos.push(v[k].x, v[k].y, v[k].z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

function flameGeometry(radius: number, core: [number, number, number], edge: [number, number, number]): BufferGeometry {
  const g = new ConeGeometry(radius, 1, 16, 1, true);
  g.translate(0, 0.5, 0);
  g.rotateX(Math.PI / 2); // base at origin, tip toward +Z
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, p.getZ(i)));
    col[i * 4] = core[0] + (edge[0] - core[0]) * t;
    col[i * 4 + 1] = core[1] + (edge[1] - core[1]) * t;
    col[i * 4 + 2] = core[2] + (edge[2] - core[2]) * t;
    col[i * 4 + 3] = Math.pow(1 - t, 1.4);
  }
  g.setAttribute('color', new BufferAttribute(col, 4));
  return g;
}

export interface JetState {
  gearPos: number;
  power: number;
  ab: number;
}

/** A built aircraft model plus the handles needed to animate it. */
export class JetModel {
  readonly root = new Group();
  private nose = new Group();
  private mainL = new Group();
  private mainR = new Group();
  private flamesOuter: Mesh[] = [];
  private flamesInner: Mesh[] = [];
  private nozzleZ = 0;
  private t = Math.random() * 100;

  constructor(readonly def: AircraftDef, teamColor: number) {
    const spec = def.model;
    const L = spec.length;
    const body = new MeshStandardMaterial({ color: spec.colors.body, metalness: 0.55, roughness: 0.4 });
    const dark = new MeshStandardMaterial({ color: spec.colors.dark, metalness: 0.7, roughness: 0.45 });
    const accent = new MeshStandardMaterial({ color: teamColor, metalness: 0.2, roughness: 0.5, emissive: teamColor, emissiveIntensity: 0.15 });
    const glass = new MeshStandardMaterial({ color: 0x101a24, metalness: 0.95, roughness: 0.06 });
    const flat = new MeshStandardMaterial({ color: spec.colors.body, metalness: 0.5, roughness: 0.45, side: DoubleSide });
    const add = (m: Mesh, parent: Group = this.root): Mesh => {
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // --- fuselage ---
    add(new Mesh(loft(spec), body));

    // --- wings (mirrored) ---
    const w = spec.wing;
    const wz = -L / 2 + w.zRoot * L;
    const xr = fuselageHalfWidth(spec, w.zRoot + 0.05) * 0.85;
    const half = w.span / 2 - xr;
    const wingGeo = slab(
      [
        new Vector3(xr, w.y, wz),
        new Vector3(xr, w.y, wz + w.rootChord),
        new Vector3(xr + half, w.y + w.dihedral * half, wz + w.sweep + w.tipChord),
        new Vector3(xr + half, w.y + w.dihedral * half, wz + w.sweep),
      ],
      new Vector3(0, 1, 0), w.thickness, w.thickness * 0.35,
    );
    for (const s of [1, -1]) {
      const m = add(new Mesh(wingGeo, flat));
      m.scale.x = s;
      // wingtip accent
      const tip = add(new Mesh(slab(
        [
          new Vector3(xr + half - 0.9, w.y + w.dihedral * half, wz + w.sweep + (w.tipChord * 0.1)),
          new Vector3(xr + half - 0.9, w.y + w.dihedral * half, wz + w.sweep + w.tipChord),
          new Vector3(xr + half, w.y + w.dihedral * half, wz + w.sweep + w.tipChord),
          new Vector3(xr + half, w.y + w.dihedral * half, wz + w.sweep + (w.tipChord * 0.1)),
        ],
        new Vector3(0, 1, 0), w.thickness * 0.42, w.thickness * 0.38,
      ), accent));
      tip.scale.x = s;
    }

    // --- horizontal stabilisers ---
    const h = spec.hstab;
    const hz = -L / 2 + h.zRoot * L;
    const hxr = fuselageHalfWidth(spec, h.zRoot + 0.04) * 0.8;
    const hhalf = h.span / 2 - hxr;
    const hGeo = slab(
      [
        new Vector3(hxr, h.y, hz),
        new Vector3(hxr, h.y, hz + h.rootChord),
        new Vector3(hxr + hhalf, h.y + h.dihedral * hhalf, hz + h.sweep + h.tipChord),
        new Vector3(hxr + hhalf, h.y + h.dihedral * hhalf, hz + h.sweep),
      ],
      new Vector3(0, 1, 0), 0.2, 0.08,
    );
    for (const s of [1, -1]) add(new Mesh(hGeo, flat)).scale.x = s;

    // --- canards ---
    if (spec.canard) {
      const c = spec.canard;
      const cz = -L / 2 + c.zRoot * L;
      const cxr = fuselageHalfWidth(spec, c.zRoot) * 0.8;
      const chalf = c.span / 2 - cxr;
      const cg = slab(
        [new Vector3(cxr, c.y, cz), new Vector3(cxr, c.y, cz + c.rootChord), new Vector3(cxr + chalf, c.y, cz + c.sweep + c.tipChord), new Vector3(cxr + chalf, c.y, cz + c.sweep)],
        new Vector3(0, 1, 0), 0.14, 0.06,
      );
      for (const s of [1, -1]) add(new Mesh(cg, flat)).scale.x = s;
    }

    // --- vertical fins ---
    for (const f of spec.fins) {
      const fz = -L / 2 + f.zRoot * L;
      const top = fuselageTop(spec, f.zRoot + 0.05) - 0.12;
      const fin = slab(
        [
          new Vector3(0, top, fz),
          new Vector3(0, top, fz + f.rootChord),
          new Vector3(0, top + f.height, fz + f.sweep + f.tipChord),
          new Vector3(0, top + f.height, fz + f.sweep),
        ],
        new Vector3(1, 0, 0), 0.24, 0.09,
      );
      const sides = f.x === 0 ? [0] : [1, -1];
      for (const s of sides) {
        const g = new Group();
        g.position.x = f.x * (s || 1);
        g.rotation.z = -f.cant * (s || 1);
        g.add(new Mesh(fin, flat));
        const stripe = new Mesh(slab(
          [
            new Vector3(0, top + f.height * 0.72, fz + f.sweep * 0.72 + f.tipChord * 0.12),
            new Vector3(0, top + f.height * 0.72, fz + f.sweep * 0.72 + f.tipChord * 0.9),
            new Vector3(0, top + f.height, fz + f.sweep + f.tipChord),
            new Vector3(0, top + f.height, fz + f.sweep),
          ],
          new Vector3(1, 0, 0), 0.26, 0.11,
        ), accent);
        g.add(stripe);
        g.traverse((o) => { o.castShadow = true; });
        this.root.add(g);
      }
    }

    // --- canopy ---
    const canopy = add(new Mesh(new SphereGeometry(1, 22, 14), glass));
    canopy.scale.set(0.5, 0.46, 2.1);
    canopy.position.set(0, fuselageTop(spec, spec.canopyZ) - 0.08, -L / 2 + spec.canopyZ * L);

    // --- intake and nozzle(s) ---
    const intakeZ = -L / 2 + 0.36 * L;
    if (spec.engines === 1) {
      const intake = add(new Mesh(new CylinderGeometry(0.55, 0.62, 2.8, 20, 1, true), dark));
      intake.rotation.x = Math.PI / 2;
      intake.position.set(0, -0.62, intakeZ);
      const lip = add(new Mesh(new CylinderGeometry(0.5, 0.5, 0.05, 20), new MeshStandardMaterial({ color: 0x050607, roughness: 1 })));
      lip.rotation.x = Math.PI / 2;
      lip.position.set(0, -0.62, intakeZ - 1.4);
    } else {
      for (const s of [1, -1]) {
        const intake = add(new Mesh(new CylinderGeometry(0.5, 0.58, 3.2, 18, 1, true), dark));
        intake.rotation.x = Math.PI / 2;
        intake.position.set(0.95 * s, -0.25, intakeZ - 0.4);
        const lip = add(new Mesh(new CylinderGeometry(0.46, 0.46, 0.05, 18), new MeshStandardMaterial({ color: 0x050607, roughness: 1 })));
        lip.rotation.x = Math.PI / 2;
        lip.position.set(0.95 * s, -0.25, intakeZ - 2.0);
      }
    }
    this.nozzleZ = L / 2 + 0.55;
    const nozzleXs = spec.engines === 1 ? [0] : [0.62, -0.62];
    const nozzleY = spec.sections[spec.sections.length - 1][3];
    for (const nx of nozzleXs) {
      const noz = add(new Mesh(new CylinderGeometry(spec.nozzleRadius * 0.85, spec.nozzleRadius, 1.3, 20, 1, true), dark));
      noz.rotation.x = Math.PI / 2;
      noz.position.set(nx, nozzleY, L / 2 - 0.1);
      const inner = new Mesh(flameGeometry(spec.nozzleRadius * 0.8, [0.75, 0.88, 1.0], [0.3, 0.45, 1.0]), flameMat());
      const outer = new Mesh(flameGeometry(spec.nozzleRadius * 1.05, [1.0, 0.72, 0.28], [1.0, 0.25, 0.05]), flameMat());
      for (const f of [outer, inner]) {
        f.position.set(nx, nozzleY, this.nozzleZ - 0.5);
        f.visible = false;
        f.frustumCulled = false;
        this.root.add(f);
      }
      this.flamesOuter.push(outer);
      this.flamesInner.push(inner);
    }

    // --- landing gear ---
    const strutMat = new MeshStandardMaterial({ color: 0xbfc4c9, metalness: 0.8, roughness: 0.35 });
    const tyre = new MeshStandardMaterial({ color: 0x111214, roughness: 0.9 });
    const makeLeg = (grp: Group, x: number, z: number, y0: number, wheelR: number, wide: number): void => {
      // wheel centre sits wheelR above the ground line (CG is gearHeight above ground)
      const wy = -(def.flight.gearHeight - wheelR) - y0;
      const strut = new Mesh(new CylinderGeometry(0.06, 0.08, -wy, 8), strutMat);
      strut.position.y = wy / 2;
      const wheel = new Mesh(new CylinderGeometry(wheelR, wheelR, wide, 16), tyre);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.y = wy;
      grp.add(strut, wheel);
      grp.position.set(x, y0, z);
      grp.traverse((o) => { o.castShadow = true; });
      this.root.add(grp);
    };
    makeLeg(this.nose, 0, -L / 2 + 0.2 * L, -0.4, 0.22, 0.14);
    makeLeg(this.mainL, -1.35, -L / 2 + 0.58 * L, -0.4, 0.34, 0.22);
    makeLeg(this.mainR, 1.35, -L / 2 + 0.58 * L, -0.4, 0.34, 0.22);
    this.root.userData.def = def.id;
  }

  update(dt: number, s: JetState): void {
    this.t += dt;
    const g = s.gearPos;
    const fold = (1 - g) * (Math.PI / 2);
    this.nose.rotation.x = -fold;
    this.mainL.rotation.z = fold;
    this.mainR.rotation.z = -fold;
    const vis = g > 0.02;
    this.nose.visible = this.mainL.visible = this.mainR.visible = vis;

    const flick = 1 + Math.sin(this.t * 61) * 0.05 + Math.sin(this.t * 37.7) * 0.04;
    const innerLen = (0.4 + 2.2 * s.power * s.power + 2.6 * s.ab) * flick;
    const outerLen = (s.ab > 0.02 ? 1.2 + 6.5 * s.ab : 0) * flick;
    const showInner = s.power > 0.45 || s.ab > 0.02;
    for (const f of this.flamesInner) {
      f.visible = showInner;
      f.scale.set(1, 1, innerLen);
    }
    for (const f of this.flamesOuter) {
      f.visible = outerLen > 0;
      f.scale.set(1 + s.ab * 0.1, 1 + s.ab * 0.1, Math.max(outerLen, 0.01));
    }
  }
}

function flameMat(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false, fog: false,
  });
}
