import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3,
} from 'three';
import type { AirstripDef } from '../data/maps/types';
import { DEG, mulberry32 } from '../core/math';
import { FLIGHT } from '../data/tuning';

/** Paint the runway markings. u runs along the runway (canvas x), v across it. */
function makeRunwayTexture(def: AirstripDef): CanvasTexture {
  const W = 4096;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const sx = W / def.length;
  const sy = H / def.width;
  const rnd = mulberry32(def.x * 31 + def.z);

  g.fillStyle = '#3a3c40';
  g.fillRect(0, 0, W, H);
  // asphalt grain and patches
  for (let i = 0; i < 9000; i++) {
    const v = rnd() < 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.02 + rnd() * 0.035})`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 5, 1 + rnd() * 3);
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(20,22,25,${0.05 + rnd() * 0.08})`;
    g.fillRect(rnd() * W, rnd() * H, 30 + rnd() * 160, 6 + rnd() * 30);
  }
  // rubber at the touchdown zones
  g.fillStyle = 'rgba(12,12,14,0.35)';
  for (const end of [0, 1]) {
    for (let k = 0; k < 14; k++) {
      const m = 260 + rnd() * 340;
      const u = end === 0 ? m : def.length - m;
      const v = def.width / 2 + (rnd() < 0.5 ? -1 : 1) * (1.6 + rnd() * 4.5);
      g.fillRect((u - 3 - rnd() * 14) * sx, (v - 0.35) * sy, (6 + rnd() * 24) * sx, 0.7 * sy);
    }
  }

  const white = 'rgba(236,238,240,0.92)';
  const rect = (u0: number, v0: number, du: number, dv: number) => g.fillRect(u0 * sx, v0 * sy, du * sx, dv * sy);
  g.fillStyle = white;
  // edge lines
  rect(0, 1.2, def.length, 0.9);
  rect(0, def.width - 2.1, def.length, 0.9);
  // dashed centre line
  for (let u = 130; u < def.length - 130; u += 50) rect(u, def.width / 2 - 0.45, 30, 0.9);
  // thresholds, aiming points, touchdown zone marks
  for (const end of [0, 1]) {
    const at = (m: number, len: number) => (end === 0 ? m : def.length - m - len);
    for (let k = 0; k < 8; k++) {
      const v = 4 + k * 3.6 + (k >= 4 ? 3.6 : 0);
      rect(at(10, 30), v, 30, 1.8);
    }
    rect(at(300, 45), def.width / 2 - 9.5, 45, 3.4);
    rect(at(300, 45), def.width / 2 + 6.1, 45, 3.4);
    for (let k = 1; k <= 3; k++) {
      rect(at(300 + k * 150, 22), def.width / 2 - 7.5, 22, 1.7);
      rect(at(300 + k * 150, 22), def.width / 2 + 5.8, 22, 1.7);
    }
  }
  // numbers, rotated so a pilot on approach reads them upright
  const hdg = (Math.round(def.heading / 10) + 36) % 36 || 36;
  const recip = (hdg + 18 - 1) % 36 + 1;
  const label = (n: number) => String(n).padStart(2, '0');
  g.font = `bold ${Math.round(8 * sy)}px "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = white;
  g.save();
  g.translate(70 * sx, H / 2);
  g.rotate(Math.PI / 2);
  g.fillText(label(hdg), 0, 0);
  g.restore();
  g.save();
  g.translate((def.length - 70) * sx, H / 2);
  g.rotate(-Math.PI / 2);
  g.fillText(label(recip), 0, 0);
  g.restore();

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** One runway with lights and a handful of buildings. Local +X is down the runway, +Z to the pilot's right. */
export class Airstrip {
  readonly group = new Group();
  private cos: number;
  private sin: number;

  constructor(readonly def: AirstripDef) {
    // local +X -> world (sin h, -cos h)
    this.cos = Math.sin(def.heading * DEG);
    this.sin = -Math.cos(def.heading * DEG);
    this.group.position.set(def.x, def.elevation, def.z);
    this.group.rotation.y = Math.PI / 2 - def.heading * DEG;
    this.build();
  }

  /** World -> runway-local (u along, v across to the right). */
  local(x: number, z: number, out: { u: number; v: number }): void {
    const ox = x - this.def.x;
    const oz = z - this.def.z;
    out.u = ox * this.cos + oz * this.sin;
    out.v = -ox * this.sin + oz * this.cos;
  }

  /** Direction cosines of the runway in world space (unit vector pointing down the runway number). */
  get dirX(): number { return this.cos; }
  get dirZ(): number { return this.sin; }

  isOnRunway(u: number, v: number): boolean {
    return Math.abs(u) <= this.def.length / 2 + 40 && Math.abs(v) <= this.def.width / 2 + FLIGHT.runwayMargin;
  }

  isOnApron(u: number, v: number): boolean {
    return Math.abs(u) <= this.def.length / 2 + 90 && Math.abs(v) <= this.def.width / 2 + FLIGHT.apronMargin;
  }

  private build(): void {
    const d = this.def;
    const g = this.group;

    // --- runway surface ---
    const rw = new Mesh(
      new PlaneGeometry(d.length, d.width).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({
        map: makeRunwayTexture(d), roughness: 0.88, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }),
    );
    rw.position.y = 0.18;
    rw.receiveShadow = true;
    g.add(rw);

    // --- apron + taxiway ---
    const concrete = new MeshStandardMaterial({ color: 0x8a8c8e, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
    const apron = new Mesh(new PlaneGeometry(520, 150).rotateX(-Math.PI / 2), concrete);
    apron.position.set(-80, 0.16, d.width / 2 + 150);
    apron.receiveShadow = true;
    g.add(apron);
    for (const tx of [-380, 150]) {
      const taxi = new Mesh(new PlaneGeometry(24, 120).rotateX(-Math.PI / 2), concrete);
      taxi.position.set(tx, 0.16, d.width / 2 + 60);
      taxi.receiveShadow = true;
      g.add(taxi);
    }

    // --- buildings ---
    const wall = new MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.8 });
    const roof = new MeshStandardMaterial({ color: 0x5c6670, roughness: 0.6, metalness: 0.3 });
    const glass = new MeshStandardMaterial({ color: 0x1c2b38, roughness: 0.1, metalness: 0.8 });
    const rnd = mulberry32(d.x + d.z * 7);
    const bz = d.width / 2 + 190;
    for (let i = 0; i < 3; i++) {
      const hx = -280 + i * 90;
      const body = new Mesh(new BoxGeometry(60, 9, 36), wall);
      body.position.set(hx, 4.5, bz);
      const arch = new Mesh(new CylinderGeometry(18, 18, 60, 14, 1, false, 0, Math.PI), roof);
      arch.rotation.z = Math.PI / 2; // axis along the hangar, half-circle bulging up
      arch.position.set(hx, 9, bz);
      arch.scale.set(0.6, 1, 1); // flatten the roof (local x ends up as world y)
      for (const m of [body, arch]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    }
    const tower = new Mesh(new BoxGeometry(7, 22, 7), wall);
    tower.position.set(60, 11, d.width / 2 + 120);
    const cab = new Mesh(new BoxGeometry(11, 4, 11), glass);
    cab.position.set(60, 24, d.width / 2 + 120);
    for (const m of [tower, cab]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    const tankMat = new MeshStandardMaterial({ color: 0xd6d9db, roughness: 0.5, metalness: 0.2 });
    for (let i = 0; i < 4; i++) {
      const tank = new Mesh(new CylinderGeometry(9, 9, 12, 20), tankMat);
      tank.position.set(180 + (i % 2) * 24, 6, bz + 30 + Math.floor(i / 2) * 24 + rnd() * 3);
      tank.castShadow = true;
      tank.receiveShadow = true;
      g.add(tank);
    }

    // --- lights ---
    this.buildLights();
  }

  private buildLights(): void {
    const d = this.def;
    const spots: { p: Vector3; c: Color }[] = [];
    const white = new Color(0xfff2cf).multiplyScalar(2.2);
    const green = new Color(0x38ff72).multiplyScalar(2.2);
    const red = new Color(0xff3030).multiplyScalar(2.2);
    const amber = new Color(0xffb030).multiplyScalar(2.0);
    const hx = d.length / 2;
    const hz = d.width / 2 + 1.5;
    for (let u = -hx; u <= hx + 0.1; u += 50) {
      spots.push({ p: new Vector3(u, 0.5, -hz), c: u > hx - 300 ? amber : white });
      spots.push({ p: new Vector3(u, 0.5, hz), c: u > hx - 300 ? amber : white });
    }
    for (let k = -6; k <= 6; k++) {
      spots.push({ p: new Vector3(-hx - 2, 0.5, k * 3.6), c: green });
      spots.push({ p: new Vector3(hx + 2, 0.5, k * 3.6), c: red });
    }
    // approach lights (both ends), centre line plus cross bars
    for (let k = 1; k <= 24; k++) {
      const off = 30 * k;
      spots.push({ p: new Vector3(-hx - 8 - off, 0.6, 0), c: white });
      spots.push({ p: new Vector3(hx + 8 + off, 0.6, 0), c: white });
      if (k % 4 === 0) {
        for (let s = -3; s <= 3; s++) {
          if (s === 0) continue;
          spots.push({ p: new Vector3(-hx - 8 - off, 0.6, s * 4), c: white });
          spots.push({ p: new Vector3(hx + 8 + off, 0.6, s * 4), c: white });
        }
      }
    }
    const mesh = new InstancedMesh(new BoxGeometry(0.9, 0.5, 0.9), new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), spots.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3(1, 1, 1);
    spots.forEach((sp, i) => {
      m.compose(sp.p, q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, sp.c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }
}
