import {
  AdditiveBlending, BufferAttribute, CanvasTexture, Color, ConeGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, SphereGeometry, Sprite,
  SpriteMaterial,
} from 'three';

let glowTex: CanvasTexture | null = null;
function glowTexture(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new CanvasTexture(c);
  return glowTex;
}

function flameGeometry(radius: number, core: [number, number, number], edge: [number, number, number]): ConeGeometry {
  const g = new ConeGeometry(radius, 1, 18, 1, true);
  g.translate(0, 0.5, 0);
  g.rotateX(Math.PI / 2); // base at origin, tip toward +Z
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, p.getZ(i)));
    col[i * 4] = core[0] + (edge[0] - core[0]) * t;
    col[i * 4 + 1] = core[1] + (edge[1] - core[1]) * t;
    col[i * 4 + 2] = core[2] + (edge[2] - core[2]) * t;
    col[i * 4 + 3] = Math.pow(1 - t, 1.3);
  }
  g.setAttribute('color', new BufferAttribute(col, 4));
  return g;
}

function flameMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false, fog: false });
}

/**
 * Engine exhaust for one nozzle: a hot inner core, an orange afterburner plume, shock diamonds and a glow sprite.
 * Colours are HDR (above 1.0) so the bloom pass makes them glow. Origin is the nozzle exit, +Z is aft.
 */
export class Afterburner {
  readonly group = new Group();
  private inner: Mesh;
  private outer: Mesh;
  private diamonds: Mesh[] = [];
  private glow: Sprite;
  private seed = Math.random() * 100;
  private t = 0;
  private mats: (MeshBasicMaterial | SpriteMaterial)[] = [];
  private geoms: (ConeGeometry | SphereGeometry)[] = [];

  constructor(private radius: number) {
    const gi = flameGeometry(radius * 0.8, [1.9, 2.1, 2.5], [0.4, 0.6, 1.5]);
    const go = flameGeometry(radius * 1.05, [2.5, 1.35, 0.45], [1.4, 0.35, 0.06]);
    const mi = flameMaterial();
    const mo = flameMaterial();
    this.inner = new Mesh(gi, mi);
    this.outer = new Mesh(go, mo);
    for (const m of [this.inner, this.outer]) {
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
    }
    const dm = new MeshBasicMaterial({ color: new Color(3.2, 2.6, 1.9), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    const dg = new SphereGeometry(1, 10, 8);
    for (let i = 0; i < 4; i++) {
      const d = new Mesh(dg, dm);
      d.visible = false;
      d.frustumCulled = false;
      this.diamonds.push(d);
      this.group.add(d);
    }
    const sm = new SpriteMaterial({ map: glowTexture(), color: new Color(1.7, 0.85, 0.38), blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, transparent: true });
    this.glow = new Sprite(sm);
    this.glow.visible = false;
    this.group.add(this.glow);
    this.mats.push(mi, mo, dm, sm);
    this.geoms.push(dg);
  }

  /** power 0..1 (military throttle), ab 0..1 (afterburner). */
  update(dt: number, power: number, ab: number): void {
    this.t += dt;
    const flick = 1 + Math.sin((this.t + this.seed) * 63) * 0.05 + Math.sin((this.t + this.seed) * 37.7) * 0.05;
    const r = this.radius;
    const showInner = power > 0.55 || ab > 0.02;
    const innerLen = (0.3 + 2.0 * Math.max(0, power - 0.4) * 1.6 + 3.4 * ab) * flick;
    this.inner.visible = showInner;
    this.inner.scale.set(1, 1, innerLen);
    const outerLen = ab > 0.02 ? (1.4 + 7.5 * ab) * flick : 0;
    this.outer.visible = outerLen > 0;
    this.outer.scale.set(1 + ab * 0.12, 1 + ab * 0.12, Math.max(0.01, outerLen));
    for (let i = 0; i < this.diamonds.length; i++) {
      const d = this.diamonds[i];
      d.visible = ab > 0.35;
      const pos = (0.7 + i * 1.15) * (0.6 + 0.4 * ab);
      d.position.z = pos;
      const s = r * 0.32 * (1 - i * 0.18) * (0.8 + 0.4 * Math.sin((this.t + i) * 40));
      d.scale.set(s, s, s * 1.5);
    }
    const glowS = r * (power > 0.55 ? 1.8 + ab * 3.0 : 0);
    this.glow.visible = glowS > 0;
    this.glow.scale.set(glowS * flick, glowS * flick, 1);
    (this.glow.material as SpriteMaterial).opacity = 0.3 + 0.55 * ab + 0.15 * power;
  }

  dispose(): void {
    this.inner.geometry.dispose();
    this.outer.geometry.dispose();
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
