import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, Sphere, Vector3,
  type Texture, type WebGLProgramParametersWithUniforms,
} from 'three';
import type { MapDef } from '../data/maps/types';
import type { QualityPreset } from '../render/quality';
import type { Heightmap, TerrainTextures } from './Heightmap';

/** 16 x 16 chunks, each 64 cells wide at full resolution. LOD n samples every 2^n-th vertex. */
const CHUNKS = 16;
const LOD_STEPS = [1, 2, 4, 8];
const LOD_DIST = [2600, 5200, 9500]; // base switch distances (m), scaled by quality

interface Chunk {
  cx: number;
  cz: number;
  mesh: Mesh;
  center: Vector3;
  radius: number;
  geoms: (BufferGeometry | null)[];
  lod: number;
}

/** Shared index buffers: the topology is identical for every chunk at a given LOD. */
function buildIndices(n: number): Uint32Array {
  const v = n + 1;
  const tris: number[] = [];
  // top surface: (a, c, b) and (b, c, d) -- same diagonal the collision sampler uses
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * v + i;
      const b = a + 1;
      const c = a + v;
      const d = c + 1;
      tris.push(a, c, b, b, c, d);
    }
  }
  // skirts: 4 strips hanging below the border vertices; skirt vertex k sits at base + k
  const base = v * v;
  const north = (i: number) => i;
  const south = (i: number) => n * v + i;
  const west = (j: number) => j * v;
  const east = (j: number) => j * v + n;
  const edge = (fn: (k: number) => number, off: number, flip: boolean) => {
    for (let k = 0; k < n; k++) {
      const t0 = fn(k);
      const t1 = fn(k + 1);
      const s0 = base + off + k;
      const s1 = base + off + k + 1;
      if (!flip) tris.push(t0, t1, s0, t1, s1, s0);
      else tris.push(t0, s0, t1, t1, s0, s1);
    }
  };
  edge(north, 0, false);
  edge(south, v, true);
  edge(west, 2 * v, true);
  edge(east, 3 * v, false);
  return new Uint32Array(tris);
}

export class Terrain {
  readonly group = new Group();
  readonly material: MeshStandardMaterial;
  private chunks: Chunk[] = [];
  private indexSets: (BufferAttribute | null)[] = [null, null, null, null];
  private quality: QualityPreset;
  private cellsPerChunk: number;
  private chunkSize: number;
  private uniforms: Record<string, { value: unknown }>;

  constructor(
    private hm: Heightmap,
    private map: MapDef,
    private tex: TerrainTextures,
    noise: Texture,
    quality: QualityPreset,
  ) {
    this.quality = quality;
    this.cellsPerChunk = (hm.res - 1) / CHUNKS;
    this.chunkSize = this.cellsPerChunk * hm.cell;
    const p = map.palette;
    this.uniforms = {
      uHeightTex: { value: tex.height },
      uNormalTex: { value: tex.normal },
      uNoiseTex: { value: noise },
      uMapSize: { value: map.size },
      uTexScale: { value: tex.uvScale },
      uTexOffset: { value: tex.uvOffset },
      uColBase: { value: new Color(p.base) },
      uColSand: { value: new Color(p.sand) },
      uColRock: { value: new Color(p.rock) },
      uColSnow: { value: new Color(p.snow) },
      uColSeabed: { value: new Color(p.seabed) },
      uSandTop: { value: p.sandTop },
      uSnowLine: { value: p.snowLine },
      uRockSlope: { value: p.rockSlope },
      uDetail: { value: p.detailStrength * (quality.terrainDetail ? 1 : 0) },
    };

    this.material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
    this.material.onBeforeCompile = (s) => this.patch(s);
    this.material.customProgramCacheKey = () => 'afterburn-terrain-v1';

    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const x0 = -hm.half + cx * this.chunkSize;
        const z0 = -hm.half + cz * this.chunkSize;
        const mesh = new Mesh(new BufferGeometry(), this.material);
        mesh.frustumCulled = true;
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        mesh.castShadow = quality.terrainShadows;
        const center = new Vector3(x0 + this.chunkSize / 2, 0, z0 + this.chunkSize / 2);
        const chunk: Chunk = { cx, cz, mesh, center, radius: this.chunkSize * 0.75, geoms: [null, null, null, null], lod: -1 };
        this.chunks.push(chunk);
        this.group.add(mesh);
        // start with the coarsest geometry so there is never a hole
        this.setLod(chunk, 3);
      }
    }
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    (this.uniforms.uDetail as { value: number }).value = this.map.palette.detailStrength * (q.terrainDetail ? 1 : 0);
    for (const c of this.chunks) c.mesh.castShadow = q.terrainShadows;
  }

  private patch(shader: WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vTWorld;
uniform sampler2D uHeightTex, uNormalTex, uNoiseTex;
uniform float uMapSize, uTexScale, uTexOffset;
uniform vec3 uColBase, uColSand, uColRock, uColSnow, uColSeabed;
uniform float uSandTop, uSnowLine, uRockSlope, uDetail;
vec3 gTerrainNormal;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec2 tuv = (vTWorld.xz + uMapSize * 0.5) / uMapSize * uTexScale + uTexOffset;
  float th = texture2D(uHeightTex, tuv).r;
  vec2 tn = texture2D(uNormalTex, tuv).rg * 2.0 - 1.0;
  vec3 wn = vec3(tn.x, sqrt(max(0.0, 1.0 - dot(tn, tn))), tn.y);

  vec4 nA = texture2D(uNoiseTex, vTWorld.xz * 0.00045);
  vec4 nB = texture2D(uNoiseTex, vTWorld.xz * 0.0031);
  vec4 nC = texture2D(uNoiseTex, vTWorld.xz * 0.019);
  vec4 nD = texture2D(uNoiseTex, vTWorld.xz * 0.11);

  float dist = distance(vTWorld, cameraPosition);
  float dFade = 1.0 - smoothstep(500.0, 3500.0, dist);
  // detail normals: two gradient scales, fade with distance
  vec2 g = (nC.gb - 0.5) * 2.0 * 0.9 + (nD.gb - 0.5) * 2.0 * 0.55 * dFade;
  wn = normalize(wn + vec3(g.x, 0.0, g.y) * uDetail * (0.55 + 0.45 * dFade));
  gTerrainNormal = wn;

  float slope = 1.0 - wn.y;
  float hv = th + (nA.r - 0.5) * 3.0 + (nB.r - 0.5) * 2.0;
  float sandW = 1.0 - smoothstep(uSandTop - 1.0, uSandTop + 1.5, hv);
  float rockW = smoothstep(uRockSlope - 0.05, uRockSlope + 0.09, slope + (nB.a - 0.5) * 0.14);
  float snowW = smoothstep(uSnowLine, uSnowLine + 90.0, th + (nB.r - 0.5) * 80.0) * (1.0 - smoothstep(0.30, 0.50, slope));
  float under = 1.0 - smoothstep(-2.0, 0.6, th);

  vec3 col = uColBase * (0.72 + 0.55 * nB.r) * (0.9 + 0.2 * nC.a);
  col = mix(col, uColSand * (0.88 + 0.22 * nC.r), sandW);
  col = mix(col, uColRock * (0.62 + 0.7 * nC.r) * (0.85 + 0.3 * nD.a), rockW);
  col = mix(col, uColSnow, snowW);
  col = mix(col, uColSeabed * (0.8 + 0.3 * nC.r), under);
  diffuseColor.rgb = col;
}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `float faceDirection = 1.0;
vec3 normal = normalize((viewMatrix * vec4(gTerrainNormal, 0.0)).xyz);
vec3 nonPerturbedNormal = normal;`,
      );
  }

  // ---- geometry --------------------------------------------------------------------

  private indexFor(lod: number): BufferAttribute {
    let a = this.indexSets[lod];
    if (!a) {
      const n = this.cellsPerChunk / LOD_STEPS[lod];
      a = new BufferAttribute(buildIndices(n), 1);
      this.indexSets[lod] = a;
    }
    return a;
  }

  private buildGeometry(c: Chunk, lod: number): BufferGeometry {
    const step = LOD_STEPS[lod];
    const n = this.cellsPerChunk / step;
    const v = n + 1;
    const hm = this.hm;
    const pos = new Float32Array((v * v + 4 * v) * 3);
    const i0 = c.cx * this.cellsPerChunk;
    const j0 = c.cz * this.cellsPerChunk;
    let o = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        pos[o++] = -hm.half + (i0 + i * step) * hm.cell;
        pos[o++] = hm.data[(j0 + j * step) * hm.res + (i0 + i * step)];
        pos[o++] = -hm.half + (j0 + j * step) * hm.cell;
      }
    }
    // skirts hide cracks between neighbouring chunks at different LODs
    const depth = 14 * step + 8;
    const copyEdge = (fn: (k: number) => number) => {
      for (let k = 0; k <= n; k++) {
        const src = fn(k) * 3;
        pos[o++] = pos[src];
        pos[o++] = pos[src + 1] - depth;
        pos[o++] = pos[src + 2];
      }
    };
    copyEdge((k) => k); // north
    copyEdge((k) => n * v + k); // south
    copyEdge((k) => k * v); // west
    copyEdge((k) => k * v + n); // east

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(this.indexFor(lod));
    g.boundingSphere = new Sphere(c.center.clone().setY((hm.min + hm.max) / 2), c.radius + (hm.max - hm.min) / 2);
    return g;
  }

  private setLod(c: Chunk, lod: number): void {
    let g = c.geoms[lod];
    if (!g) {
      g = this.buildGeometry(c, lod);
      c.geoms[lod] = g;
    }
    c.mesh.geometry = g;
    c.lod = lod;
  }

  /** Pick LODs from camera distance (with hysteresis) and stream in missing geometry within a per-frame budget. */
  update(camPos: Vector3, budgetOverride?: number): void {
    let budget = budgetOverride ?? this.quality.chunkBuildBudget;
    const s = this.quality.lodScale;
    const wanted: { c: Chunk; lod: number; d: number }[] = [];
    for (const c of this.chunks) {
      const dx = camPos.x - c.center.x;
      const dz = camPos.z - c.center.z;
      const d = Math.sqrt(dx * dx + dz * dz + camPos.y * camPos.y * 0.25) - this.chunkSize * 0.5;
      const hyst = c.lod >= 0 ? 1.08 : 1;
      let lod = 3;
      for (let k = 0; k < 3; k++) {
        const lim = LOD_DIST[k] * s * (c.lod > k ? 1 / hyst : hyst);
        if (d < lim) { lod = k; break; }
      }
      if (lod !== c.lod) wanted.push({ c, lod, d });
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const w of wanted) {
      if (w.c.geoms[w.lod]) this.setLod(w.c, w.lod);
      else if (budget > 0) { this.setLod(w.c, w.lod); budget--; }
    }
  }

  /** Build everything near a position up front (used during loading so the first frame has no pop-in). */
  prewarm(camPos: Vector3): void {
    this.update(camPos, 100000);
  }
}
