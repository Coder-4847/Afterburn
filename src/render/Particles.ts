import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';

/**
 * A pooled GPU point-sprite particle system. One draw call, fixed capacity, ring-buffer allocation
 * (the oldest particle is recycled when the pool is full). Used for contrails, vortices, smoke, fire, sparks.
 * CPU integrates positions each frame; sizes are in metres and projected to screen in the vertex shader.
 */
export class ParticleSystem {
  readonly points: Points;
  private readonly cap: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private head = 0;
  private uScale = { value: 800 };
  private geom: BufferGeometry;
  private posAttr: BufferAttribute;
  private sizeAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private colAttr: BufferAttribute;
  /** Highest slot touched since all particles were last dead (bounds the update loop). */
  private hi = 0;

  constructor(capacity: number, additive: boolean, fog: boolean) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);

    this.geom = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(35048);
    this.sizeAttr = new BufferAttribute(this.size, 1).setUsage(35048);
    this.alphaAttr = new BufferAttribute(this.alpha, 1).setUsage(35048);
    this.colAttr = new BufferAttribute(this.col, 3).setUsage(35048);
    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('aSize', this.sizeAttr);
    this.geom.setAttribute('aAlpha', this.alphaAttr);
    this.geom.setAttribute('aColor', this.colAttr);

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      fog,
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uScale: this.uScale }]),
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * uScale / max(0.5, -mvPosition.z), 0.0, 420.0);
          vAlpha = aAlpha;
          vColor = aColor;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          a *= a;
          gl_FragColor = vec4(vColor, a * vAlpha);
          if (gl_FragColor.a < 0.003) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    material.uniforms.uScale = this.uScale; // merge() cloned it; keep ours live
    this.points = new Points(this.geom, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  /** Call when the camera or render resolution changes: converts metres to pixels. */
  setView(drawingBufferHeight: number, fovDeg: number): void {
    this.uScale.value = drawingBufferHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number, r: number, g: number, b: number, alpha: number, drag = 0, gravity = 0,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    if (i + 1 > this.hi) this.hi = i + 1;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.a0[i] = alpha;
    this.drag[i] = drag;
    this.grav[i] = gravity;
    this.size[i] = size0;
    this.alpha[i] = alpha;
  }

  update(dt: number): void {
    const n = this.hi;
    let any = false;
    for (let i = 0; i < n; i++) {
      const life = this.life[i];
      if (this.age[i] >= life) continue;
      any = true;
      const a = (this.age[i] += dt);
      if (a >= life) {
        this.size[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      const t = a / life;
      const k = i * 3;
      const dr = 1 - Math.min(1, this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      // quick fade in (avoids popping at the emitter), long fade out
      this.alpha[i] = this.a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * 0.3);
    }
    if (!any) this.hi = 0;
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  clear(): void {
    this.age.fill(1);
    this.size.fill(0);
    this.alpha.fill(0);
    this.hi = 0;
  }

  dispose(): void {
    this.geom.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}
