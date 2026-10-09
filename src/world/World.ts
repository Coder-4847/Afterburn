import {
  DirectionalLight, FogExp2, Mesh, PCFShadowMap, PMREMGenerator, PerspectiveCamera, Scene, SphereGeometry,
  Vector3, type Texture, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import type { MapDef } from '../data/maps/types';
import { yieldToMain } from '../core/math';
import type { TimeOfDay } from '../core/Settings';
import type { QualityPreset } from '../render/quality';
import type { FlightEnv, SurfaceInfo } from '../flight/FlightModel';
import { Airstrip } from './Airstrip';
import { Heightmap } from './Heightmap';
import { makeNoiseTexture } from './NoiseTexture';
import { Sky, fogColorFor, makeSkyUniforms } from './Sky';
import { Terrain } from './Terrain';
import { Water } from './Water';

const _up = new Vector3(0, 1, 0);
const _c = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _fwd = new Vector3();
const _loc = { u: 0, v: 0 };

export const TERRAIN_RES = 1025;

export class World implements FlightEnv {
  readonly scene = new Scene();
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly airstrips: Airstrip[] = [];
  private fog = new FogExp2(0xaaccee, 0.00006);
  private envTarget: WebGLRenderTarget | null = null;
  private pmrem: PMREMGenerator;
  private envScene = new Scene();
  private lightingKey: TimeOfDay = 'day';
  private fogBase = 0.00006;
  private fogExposure = 1;

  private constructor(
    readonly map: MapDef,
    readonly heightmap: Heightmap,
    readonly terrain: Terrain,
    readonly water: Water,
    readonly sky: Sky,
    private renderer: WebGLRenderer,
    private quality: QualityPreset,
    private noise: Texture,
  ) {
    const scene = this.scene;
    scene.fog = this.fog;
    scene.add(terrain.group, water.mesh, sky.mesh);
    for (const a of map.airstrips) {
      const s = new Airstrip(a);
      this.airstrips.push(s);
      scene.add(s.group);
    }
    this.sun.castShadow = quality.shadows;
    scene.add(this.sun, this.sun.target);
    this.pmrem = new PMREMGenerator(renderer);
    const envSky = new Mesh(new SphereGeometry(50, 32, 16), sky.material);
    envSky.frustumCulled = false;
    this.envScene.add(envSky);
  }

  static async create(
    map: MapDef,
    renderer: WebGLRenderer,
    quality: QualityPreset,
    tod: TimeOfDay,
    onProgress: (p: number, label: string) => void,
  ): Promise<World> {
    onProgress(0, 'Generating terrain');
    const hm = await Heightmap.generate(map, TERRAIN_RES, (p) => onProgress(p * 0.7, 'Generating terrain'));
    onProgress(0.72, 'Baking textures');
    await yieldToMain();
    const tex = hm.buildTextures();
    const noise = makeNoiseTexture(256, map.seed);
    const sky = new Sky(makeSkyUniforms());
    const water = new Water(map, tex, noise, sky.uniforms);
    const terrain = new Terrain(hm, map, tex, noise, quality);
    onProgress(0.9, 'Building scene');
    await yieldToMain();
    const w = new World(map, hm, terrain, water, sky, renderer, quality, noise);
    w.setQuality(quality);
    w.setTimeOfDay(tod);
    onProgress(1, 'Ready');
    return w;
  }

  /** Switch between the map's lighting presets and re-bake the sky reflection. */
  setTimeOfDay(tod: TimeOfDay): void {
    this.lightingKey = tod;
    const p = this.map.lighting[tod];
    this.sky.apply(p);
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.scene.environmentIntensity = p.envIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.fogBase = p.fogDensity;
    this.fogExposure = p.exposure;
    this.fog.density = p.fogDensity * this.quality.fogScale;

    this.sky.setDisc(false);
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
    this.sky.setDisc(true);
    this.scene.environment = this.envTarget.texture;
  }

  setQuality(q: QualityPreset): void {
    const shadowsChanged = q.shadows !== this.quality.shadows;
    this.quality = q;
    this.terrain.setQuality(q);
    this.water.setDetail(q.waterDetail);
    this.fog.density = this.fogBase * q.fogScale;

    const r = this.renderer;
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.type = PCFShadowMap;
    this.sun.castShadow = q.shadows;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== q.shadowMapSize) {
      sh.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      sh.map?.dispose();
      sh.map = null;
    }
    const e = q.shadowExtent;
    sh.camera.left = -e;
    sh.camera.right = e;
    sh.camera.top = e;
    sh.camera.bottom = -e;
    sh.camera.near = 50;
    sh.camera.far = 3600;
    sh.camera.updateProjectionMatrix();
    sh.bias = -0.0003;
    sh.normalBias = 1.2;
    if (shadowsChanged) this.scene.traverse((o) => {
      const m = (o as Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
  }

  get lighting(): TimeOfDay { return this.lightingKey; }

  /** Collision surface: terrain or sea level, whichever is higher, plus runway flags. */
  surfaceAt(x: number, z: number, out: SurfaceInfo): SurfaceInfo {
    const h = this.heightmap.sample(x, z);
    out.height = h > this.map.seaLevel ? h : this.map.seaLevel;
    out.onRunway = false;
    out.onApron = false;
    for (let i = 0; i < this.airstrips.length; i++) {
      const a = this.airstrips[i];
      a.local(x, z, _loc);
      if (a.isOnRunway(_loc.u, _loc.v)) { out.onRunway = true; out.onApron = true; break; }
      if (a.isOnApron(_loc.u, _loc.v)) out.onApron = true;
    }
    return out;
  }

  /** Nearest airstrip to a point (any team), for HUD hints and spawning. */
  nearestAirstrip(x: number, z: number): Airstrip {
    let best = this.airstrips[0];
    let bd = Infinity;
    for (const a of this.airstrips) {
      const d = Math.hypot(a.def.x - x, a.def.z - z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  update(dt: number, camera: PerspectiveCamera, focus: Vector3): void {
    const cp = camera.position;
    this.sky.mesh.position.copy(cp);
    this.water.update(dt, cp.x, cp.z);
    this.terrain.update(cp);

    // fog follows the sky in the direction we're looking
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
    fogColorFor(this.sky.uniforms, _fwd, this.fogExposure, this.fog.color);

    if (this.quality.shadows) this.updateShadow(focus);
  }

  /** Keep the shadow box around the player, snapped to shadow-map texels so shadows don't shimmer. */
  private updateShadow(focus: Vector3): void {
    const L = this.sky.sunDir;
    _r.crossVectors(_up, L);
    if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
    _r.normalize();
    _u.crossVectors(L, _r).normalize();
    const texel = (2 * this.quality.shadowExtent) / this.quality.shadowMapSize;
    _c.copy(focus);
    const cx = _c.dot(_r);
    const cy = _c.dot(_u);
    _c.addScaledVector(_r, Math.round(cx / texel) * texel - cx);
    _c.addScaledVector(_u, Math.round(cy / texel) * texel - cy);
    this.sun.target.position.copy(_c);
    this.sun.position.copy(_c).addScaledVector(L, 1800);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem.dispose();
  }
}
