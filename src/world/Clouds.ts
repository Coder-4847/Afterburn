import {
  CanvasTexture, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, BufferAttribute, Mesh, ShaderMaterial,
  UniformsLib, UniformsUtils, Vector3,
} from 'three';
import type { MapDef } from '../data/maps/types';
import { clamp, mulberry32, smoothstep } from '../core/math';
import { Simplex2 } from './noise';
import type { SkyUniforms } from './Sky';

/** Soft cotton-ball sprite: overlapping radial blobs inside a radial mask. */
function puffTexture(): CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(99);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 0.7) * S * 0.24;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d * 0.85;
    const r = S * (0.1 + rnd() * 0.17);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.34)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // keep the edge clean
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, S, S);
  const t = new CanvasTexture(c);
  return t;
}

interface Cluster {
  x: number;
  y: number;
  z: number;
  radius: number;
  first: number;
  count: number;
}

/**
 * Volumetric-looking cumulus: clusters of lit billboard puffs between `base` and `top`.
 * Sorted back-to-front a few times a second, faded as you approach each puff (so you can fly through a cloud
 * without a screen full of giant quads) and with an "inside cloud" factor that drives a whiteout veil.
 */
export class Clouds {
  readonly mesh: Mesh;
  /** 0..1: how deep inside cloud the camera currently is. */
  inside = 0;
  private geom: InstancedBufferGeometry;
  private offsets: Float32Array; // x y z size
  private shades: Float32Array; // nx ny nz shade
  private n = 0;
  private clusters: Cluster[] = [];
  // unsorted source data
  private src: { x: number; y: number; z: number; size: number; nx: number; ny: number; nz: number; shade: number }[] = [];
  private order: number[] = [];
  private dist: Float32Array;
  private offAttr: InstancedBufferAttribute;
  private shAttr: InstancedBufferAttribute;
  private sortTimer = 0;
  private insideTimer = 0;
  private lastCam = new Vector3(1e9, 0, 0);
  private mat: ShaderMaterial;

  constructor(map: MapDef, sky: SkyUniforms, clusterBudget: number) {
    const def = map.clouds;
    const rnd = mulberry32(map.seed + 5);
    const noise = new Simplex2(map.seed + 77);
    if (def && clusterBudget > 0) {
      const half = map.size * 0.62;
      let guard = 0;
      while (this.clusters.length < clusterBudget && guard++ < clusterBudget * 12) {
        const x = (rnd() * 2 - 1) * half;
        const z = (rnd() * 2 - 1) * half;
        // coverage mask: clouds gather in patches
        const m = 0.5 + 0.5 * noise.fbm(x * 0.00028, z * 0.00028, 3);
        if (m < 1 - def.coverage - 0.08 * rnd()) continue;
        const radius = (300 + rnd() * 650) * def.scale;
        const base = def.base + rnd() * (def.top - def.base) * 0.45;
        const cl: Cluster = { x, y: base, z, radius, first: this.src.length, count: 0 };
        const puffs = 12 + Math.floor(rnd() * 16);
        for (let i = 0; i < puffs; i++) {
          const a = rnd() * Math.PI * 2;
          const d = Math.sqrt(rnd()) * radius;
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          const rel = 1 - d / radius; // 1 at the centre
          const height = rel * radius * (0.35 + rnd() * 0.5) * (0.5 + 0.5 * m);
          const py = base + height;
          const size = (radius * 0.55 + rnd() * radius * 0.45) * (0.45 + 0.7 * rel) * 1.05;
          const nx = px - x, ny = (py - base) + radius * 0.25, nz = pz - z;
          const nl = Math.hypot(nx, ny, nz) || 1;
          this.src.push({ x: px, y: py, z: pz, size, nx: nx / nl, ny: ny / nl, nz: nz / nl, shade: clamp(0.45 + height / radius, 0, 1) });
          cl.count++;
        }
        this.clusters.push(cl);
      }
    }
    this.n = this.src.length;
    this.order = this.src.map((_, i) => i);
    this.dist = new Float32Array(this.n);
    this.offsets = new Float32Array(this.n * 4);
    this.shades = new Float32Array(this.n * 4);

    this.geom = new InstancedBufferGeometry();
    this.geom.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    this.geom.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geom.setIndex([0, 1, 2, 0, 2, 3]);
    this.offAttr = new InstancedBufferAttribute(this.offsets, 4).setUsage(DynamicDrawUsage);
    this.shAttr = new InstancedBufferAttribute(this.shades, 4).setUsage(DynamicDrawUsage);
    this.geom.setAttribute('aOff', this.offAttr);
    this.geom.setAttribute('aShade', this.shAttr);
    this.geom.instanceCount = this.n;

    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uTex: { value: puffTexture() }, uTint: { value: new Color(1, 1, 1) } }]),
      vertexShader: /* glsl */ `
        attribute vec4 aOff;
        attribute vec4 aShade;
        varying vec2 vUv;
        varying vec4 vShade;
        varying float vFade;
        varying vec3 vWorldDir;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = viewMatrix * vec4(aOff.xyz, 1.0);
          float size = aOff.w;
          // per-puff rotation so neighbouring puffs do not look like copies
          float ang = fract(sin(dot(aOff.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831;
          float cs = cos(ang), sn = sin(ang);
          vec2 p = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
          mvPosition.xy += p * size;
          gl_Position = projectionMatrix * mvPosition;
          float d = -mvPosition.z;
          // fade out as the camera enters the puff, and a little at very long range
          vFade = smoothstep(size * 0.12, size * 0.85, d) * (1.0 - smoothstep(26000.0, 40000.0, d));
          vUv = uv;
          vShade = aShade;
          vWorldDir = aShade.xyz;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec2 vUv;
        varying vec4 vShade;
        varying float vFade;
        varying vec3 vWorldDir;
        uniform vec3 uSunDir, uSunColor, uHorizon, uZenith;
        #include <fog_pars_fragment>
        void main() {
          float a = texture2D(uTex, vUv).a * vFade;
          if (a < 0.004) discard;
          // lit by the sun on the side facing it; shaded blue-grey from the sky underneath
          float facing = clamp(dot(normalize(vWorldDir), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
          float lit = clamp(facing * 0.75 + vShade.w * 0.45, 0.0, 1.0);
          vec3 ambient = mix(uHorizon, uZenith, 0.35) * 0.75;
          vec3 col = mix(ambient * 0.9, uSunColor * 1.05 + ambient * 0.35, lit);
          gl_FragColor = vec4(col, a * 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    for (const k of ['uSunDir', 'uSunColor', 'uHorizon', 'uZenith'] as const) this.mat.uniforms[k] = sky[k];

    this.mesh = new Mesh(this.geom, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = this.n > 0;
    this.sort(new Vector3(0, 1e4, 0));
  }

  private sort(cam: Vector3): void {
    const { src, dist, order } = this;
    for (let i = 0; i < this.n; i++) {
      const s = src[i];
      const dx = s.x - cam.x, dy = s.y - cam.y, dz = s.z - cam.z;
      dist[i] = dx * dx + dy * dy + dz * dz;
    }
    order.sort((a, b) => dist[b] - dist[a]); // far to near
    for (let k = 0; k < this.n; k++) {
      const s = src[order[k]];
      this.offsets[k * 4] = s.x; this.offsets[k * 4 + 1] = s.y; this.offsets[k * 4 + 2] = s.z; this.offsets[k * 4 + 3] = s.size;
      this.shades[k * 4] = s.nx; this.shades[k * 4 + 1] = s.ny; this.shades[k * 4 + 2] = s.nz; this.shades[k * 4 + 3] = s.shade;
    }
    this.offAttr.needsUpdate = true;
    this.shAttr.needsUpdate = true;
    this.lastCam.copy(cam);
  }

  update(dt: number, cam: Vector3): void {
    if (this.n === 0) return;
    this.sortTimer += dt;
    if (this.sortTimer > 0.35 && cam.distanceToSquared(this.lastCam) > 60 * 60) {
      this.sortTimer = 0;
      this.sort(cam);
    }
    this.insideTimer += dt;
    if (this.insideTimer > 0.1) {
      this.insideTimer = 0;
      let inside = 0;
      for (const cl of this.clusters) {
        const dx = cl.x - cam.x, dz = cl.z - cam.z;
        if (dx * dx + dz * dz > (cl.radius * 1.4) ** 2) continue;
        for (let i = cl.first; i < cl.first + cl.count; i++) {
          const s = this.src[i];
          const d = Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z);
          inside += smoothstep(s.size * 0.62, s.size * 0.08, d) * 0.55;
        }
      }
      this.inside = clamp(inside, 0, 1);
    }
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v && this.n > 0;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
