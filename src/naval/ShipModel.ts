import {
  BoxGeometry, BufferGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Group, Material, Matrix4, Mesh,
  MeshStandardMaterial, PlaneGeometry, Quaternion, Shape, SphereGeometry, SRGBColorSpace, Vector3, Euler,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Team } from '../weapons/types';

export type ShipKind = 'carrier' | 'destroyer' | 'submarine';

/** Overall dimensions in metres (the hull's local frame: +X forward, +Z to starboard, +Y up from the waterline). */
export const SHIP_DIMS: Record<ShipKind, { length: number; beam: number; top: number; draft: number; hp: number }> = {
  carrier: { length: 400, beam: 64, top: 24, draft: 11, hp: 2400 },
  destroyer: { length: 150, beam: 19, top: 26, draft: 6, hp: 520 },
  submarine: { length: 92, beam: 11, top: 8, draft: 5, hp: 300 },
};

/** Gun and missile mount positions (local, +X forward) for the AI. */
export const SHIP_MOUNTS: Record<ShipKind, { gun: [number, number, number][]; sam: [number, number, number][] }> = {
  carrier: {
    gun: [[150, 24, 31], [-110, 24, 31], [165, 24, -29], [-150, 24, -29]],
    sam: [[40, 25, -30]],
  },
  destroyer: {
    gun: [[48, 9, 0], [-20, 15, 0]],
    sam: [[16, 12, 0], [-46, 11, 0]],
  },
  submarine: {
    gun: [[18, 9, 0]],
    sam: [[-8, 6, 0]],
  },
};

/** Collects boxes / cylinders / spheres and merges them into one mesh per material: a whole ship in a handful of draw calls. */
class Builder {
  private buckets = new Map<Material, BufferGeometry[]>();
  private m = new Matrix4();
  private q = new Quaternion();
  private e = new Euler();

  add(mat: Material, geo: BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(new Vector3(x, y, z), this.q, new Vector3(sx, sy, sz));
    // (extruded hulls are non-indexed, boxes and cylinders are indexed: merge them all as plain triangle lists)
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(this.m);
    let list = this.buckets.get(mat);
    if (!list) this.buckets.set(mat, (list = []));
    list.push(g);
  }

  box(mat: Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void {
    this.add(mat, new BoxGeometry(w, h, d), x, y, z, 0, ry, 0);
  }

  cyl(mat: Material, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 14): void {
    this.add(mat, new CylinderGeometry(rTop, rBot, h, seg), x, y, z);
  }

  build(): Group {
    const g = new Group();
    for (const [mat, list] of this.buckets) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      if (list.length > 1) for (const l of list) l.dispose();
      const mesh = new Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }
}

/** Hull plan view: pointed bow, parallel middle, squared stern. x forward, y = starboard. */
function hullShape(L: number, B: number, bowFrac = 0.22, sternFrac = 0.06): Shape {
  const s = new Shape();
  const hl = L / 2;
  const hb = B / 2;
  const bow = L * bowFrac;
  s.moveTo(-hl, -hb * 0.82);
  s.lineTo(hl - bow, -hb);
  s.quadraticCurveTo(hl - bow * 0.2, -hb * 0.95, hl, 0);
  s.quadraticCurveTo(hl - bow * 0.2, hb * 0.95, hl - bow, hb);
  s.lineTo(-hl, hb * 0.82);
  s.lineTo(-hl - L * sternFrac * 0.0, -hb * 0.82);
  return s;
}

function hullGeometry(L: number, B: number, height: number, bowFrac?: number): BufferGeometry {
  const g = new ExtrudeGeometry(hullShape(L, B, bowFrac), { depth: height, bevelEnabled: false, steps: 1 });
  // shape is in x/y with depth along z: turn it so depth is up and the shape's y is the world's z
  g.rotateX(-Math.PI / 2);
  return g;
}

let deckTexture: CanvasTexture | null = null;
function carrierDeckTexture(): CanvasTexture {
  if (deckTexture) return deckTexture;
  const W = 2048;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3d4249';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},0.035)`;
    g.fillRect(Math.random() * W, Math.random() * H, 3 + Math.random() * 14, 2 + Math.random() * 6);
  }
  // landing area (angled-deck feel): edge lines, centre dashes, number
  g.fillStyle = 'rgba(235,238,240,0.9)';
  g.fillRect(0, 10, W, 5);
  g.fillRect(0, H - 15, W, 5);
  for (let x = 40; x < W - 40; x += 120) g.fillRect(x, H / 2 - 3, 70, 6);
  // arrestor wires across the aft deck
  g.fillStyle = 'rgba(30,30,32,0.9)';
  for (let k = 0; k < 4; k++) g.fillRect(230 + k * 60, 20, 5, H - 40);
  // catapult tracks
  g.fillStyle = 'rgba(20,20,22,0.8)';
  g.fillRect(W * 0.55, H * 0.3, W * 0.4, 4);
  g.fillRect(W * 0.55, H * 0.7, W * 0.4, 4);
  g.font = 'bold 120px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(235,238,240,0.85)';
  g.save();
  g.translate(W * 0.84, H / 2);
  g.rotate(Math.PI / 2);
  g.fillText('72', 0, 0);
  g.restore();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return deckTexture = t;
}

function mats(teamHex: number) {
  return {
    hull: new MeshStandardMaterial({ color: 0x69727d, roughness: 0.7, metalness: 0.25 }),
    dark: new MeshStandardMaterial({ color: 0x2c3138, roughness: 0.75, metalness: 0.2 }),
    light: new MeshStandardMaterial({ color: 0xaeb5bc, roughness: 0.6, metalness: 0.3 }),
    team: new MeshStandardMaterial({ color: teamHex, roughness: 0.6, metalness: 0.1 }),
    glass: new MeshStandardMaterial({ color: 0x0f1b26, roughness: 0.15, metalness: 0.7 }),
    boot: new MeshStandardMaterial({ color: 0x8a2f26, roughness: 0.8, metalness: 0.1 }),
  };
}

/** Builds a ship's visual (local frame: +X forward, +Y up from the waterline, +Z starboard). */
export function buildShip(kind: ShipKind, team: Team, teamHex: number): Group {
  const d = SHIP_DIMS[kind];
  const M = mats(teamHex);
  const b = new Builder();
  const L = d.length;
  const B = d.beam;

  if (kind === 'carrier') {
    // hull: below-water red boot topping, grey sides, then the overhanging flight deck
    b.add(M.boot, hullGeometry(L * 0.96, B * 0.9, d.draft, 0.25), 0, -d.draft, 0);
    b.add(M.hull, hullGeometry(L * 0.98, B * 0.94, 14, 0.24), 0, 0, 0);
    b.add(M.dark, hullGeometry(L * 0.97, B * 0.98, 1.6, 0.2), 0, 14, 0);
    // flight deck with markings: one textured slab, slightly larger than the hull
    const deck = new Mesh(new PlaneGeometry(L * 0.95, B * 0.88), new MeshStandardMaterial({ map: carrierDeckTexture(), roughness: 0.9, metalness: 0.05 }));
    deck.rotation.x = -Math.PI / 2;
    deck.rotation.z = Math.PI / 2 * 0; // texture runs along +X
    deck.position.set(-L * 0.01, d.top + 0.05, -B * 0.02);
    deck.receiveShadow = true;
    // deck structure under the slab: a box so it has thickness and a visible edge
    b.box(M.dark, L * 0.96, 8, B * 0.9, -L * 0.01, d.top - 4.1, -B * 0.02);
    // sponsons and catwalks along the sides
    for (const s of [-1, 1]) {
      b.box(M.hull, L * 0.7, 3, 4, -L * 0.05, d.top - 6, s * (B * 0.45 + 1));
      b.box(M.light, L * 0.6, 0.6, 1.2, -L * 0.05, d.top - 1.5, s * (B * 0.44));
    }
    // island superstructure on the starboard edge
    const ix = -L * 0.06;
    const iz = B * 0.33;
    b.box(M.hull, 46, 9, 12, ix, d.top + 4.5, iz);
    b.box(M.hull, 32, 9, 10, ix + 2, d.top + 13.5, iz);
    b.box(M.glass, 18, 3.4, 10.4, ix + 8, d.top + 17, iz);
    b.box(M.team, 10, 5, 10.2, ix - 4, d.top + 15.5, iz);
    b.cyl(M.light, 0.7, 0.9, 26, ix - 8, d.top + 31, iz, 8);
    b.box(M.dark, 12, 0.5, 4, ix - 8, d.top + 38, iz);
    b.cyl(M.dark, 3.2, 3.2, 0.8, ix + 4, d.top + 28, iz, 18);
    b.box(M.light, 4, 3, 4, ix + 4, d.top + 25, iz);
    b.cyl(M.hull, 1.4, 1.8, 6, ix + 18, d.top + 21, iz, 10); // funnel stub
    // elevators and deck-edge details
    b.box(M.dark, 26, 0.2, 14, L * 0.16, d.top + 0.2, -B * 0.28);
    b.box(M.dark, 26, 0.2, 14, -L * 0.28, d.top + 0.2, -B * 0.28);
    b.box(M.dark, 30, 0.2, 14, L * 0.05, d.top + 0.2, B * 0.18);
    // defence guns (CIWS domes) on sponsons
    for (const [x, , z] of SHIP_MOUNTS.carrier.gun) {
      b.cyl(M.light, 1.6, 2.0, 2.2, x, d.top - 4, z, 12);
      b.add(M.light, new SphereGeometry(1.7, 12, 8), x, d.top - 2.4, z);
      b.box(M.dark, 3.4, 0.5, 0.5, x + 1.8, d.top - 2.3, z);
    }
    // parked aircraft on the port side, bow and stern (low detail)
    const park = (x: number, z: number, h: number): void => {
      b.box(M.light, 15, 1.1, 2.4, x, d.top + 1.2, z, h);
      b.box(M.light, 3.4, 0.35, 11, x - 1.4, d.top + 1.2, z, h);
      b.box(M.dark, 2.6, 2.6, 0.5, x - 6, d.top + 2.2, z, h);
      b.box(M.glass, 3, 0.9, 1.4, x + 3, d.top + 1.9, z, h);
    };
    for (let i = 0; i < 5; i++) park(-L * 0.38 + i * 28, -B * 0.1 + (i % 2) * 6, 0.2 + (i % 3) * 0.05);
    for (let i = 0; i < 3; i++) park(L * 0.28 + i * 24, B * 0.3, 0.25);
    const g = b.build();
    g.add(deck);
    return g;
  }

  if (kind === 'destroyer') {
    b.add(M.boot, hullGeometry(L * 0.97, B * 0.88, d.draft, 0.3), 0, -d.draft, 0);
    b.add(M.hull, hullGeometry(L, B, 9, 0.3), 0, 0, 0);
    b.add(M.dark, hullGeometry(L * 0.98, B * 0.96, 0.8, 0.3), 0, 9, 0);
    // superstructure: stepped blocks, bridge, mast, funnels
    b.box(M.hull, 44, 7, 14, 5, 12.5, 0);
    b.box(M.hull, 26, 6, 12, 8, 19, 0);
    b.box(M.glass, 10, 2.4, 12.2, 17, 19.5, 0);
    b.box(M.team, 4, 3, 12.2, -6, 16, 0);
    b.box(M.hull, 14, 6, 11, -22, 14, 0);
    b.cyl(M.dark, 3.2, 3.8, 9, -14, 22, 0, 12);
    b.cyl(M.dark, 2.6, 3.2, 7, -26, 20, 0, 12);
    b.cyl(M.light, 0.5, 0.7, 22, 6, 33, 0, 8);
    b.box(M.light, 8, 0.5, 3, 6, 36, 0);
    b.add(M.light, new SphereGeometry(2.6, 14, 10), -2, 24, 0);
    // main gun forward: turret, barrel
    b.cyl(M.hull, 3.6, 4.2, 3.2, 48, 10.6, 0, 16);
    b.add(M.hull, new SphereGeometry(3.4, 14, 10), 48, 12.2, 0);
    b.add(M.dark, new CylinderGeometry(0.4, 0.4, 9, 8), 53, 12.4, 0, 0, 0, Math.PI / 2);
    // vertical-launch cells and a helipad aft
    b.box(M.dark, 12, 0.7, 9, 22, 9.6, 0);
    b.box(M.dark, 14, 0.7, 12, -52, 9.5, 0);
    b.cyl(M.team, 4.5, 4.5, 0.2, -52, 9.9, 0, 18);
    // CIWS / small guns
    for (const [x, y, z] of SHIP_MOUNTS.destroyer.gun.slice(1)) {
      b.cyl(M.light, 1.3, 1.6, 1.8, x, y - 0.9, z, 10);
      b.add(M.light, new SphereGeometry(1.4, 10, 8), x, y + 0.2, z);
    }
    return b.build();
  }

  // submarine, surfaced
  const R = B / 2;
  b.add(M.dark, new CylinderGeometry(R, R, L * 0.8, 16), 0, R * 0.2 - d.draft * 0.35, 0, 0, 0, Math.PI / 2);
  b.add(M.dark, new SphereGeometry(R, 16, 12), L * 0.4, R * 0.2 - d.draft * 0.35, 0, 0, 0, 0, 1.5, 1, 1);
  b.add(M.dark, new SphereGeometry(R, 16, 12), -L * 0.4, R * 0.2 - d.draft * 0.35, 0, 0, 0, 0, 1.8, 1, 1);
  b.box(M.dark, L * 0.7, 1.4, 3, 0, R * 0.2 - d.draft * 0.35 + R * 0.95, 0);
  b.box(M.hull, 12, 6, 3.6, 4, R * 0.2 + 2.2, 0);
  b.box(M.team, 3, 1.2, 3.8, 4, R * 0.2 + 4.6, 0);
  b.cyl(M.light, 0.25, 0.25, 6, 7, R * 0.2 + 8, 0.8, 6);
  b.cyl(M.light, 0.25, 0.25, 5, 1, R * 0.2 + 8, -0.8, 6);
  b.box(M.dark, 5, 0.4, 14, -L * 0.36, 0.6, 0);
  b.box(M.dark, 5, 0.4, 0.4, -L * 0.45, 3.2, 0);
  b.add(M.dark, new ConeGeometry(R * 0.5, 5, 10), -L * 0.5 - 1.2, 0.6, 0, 0, 0, Math.PI / 2);
  // deck gun
  b.cyl(M.light, 1.1, 1.3, 1.4, 18, 2.3, 0, 10);
  b.add(M.dark, new CylinderGeometry(0.25, 0.25, 4, 6), 20, 2.6, 0, 0, 0, Math.PI / 2);
  void team;
  return b.build();
}
