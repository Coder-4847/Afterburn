import { Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, type Texture } from 'three';
import type { MapDef } from '../data/maps/types';
import type { TerrainTextures } from './Heightmap';
import { SKY_GLSL, type SkyUniforms } from './Sky';

/**
 * Water: one big plane that follows the camera (waves are derived from world position, so it never "swims").
 * No real reflection pass -- the sky is evaluated analytically along the reflection vector, which is
 * what you actually see from a jet. Colour and opacity come from the depth under the surface (read from the
 * terrain height texture), so shallows are clear turquoise and reefs get foam.
 */
export class Water {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private time = { value: 0 };
  private detail = { value: 1 };
  private snap = 200;

  constructor(map: MapDef, tex: TerrainTextures, noise: Texture, sky: SkyUniforms, size = 140000) {
    const w = map.water;
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: this.time,
          uDetail: this.detail,
          uNoise: { value: noise },
          uHeightTex: { value: tex.height },
          uMapSize: { value: map.size },
          uTexScale: { value: tex.uvScale },
          uTexOffset: { value: tex.uvOffset },
          uSea: { value: map.seaLevel },
          uShallow: { value: new Color(w.shallow) },
          uDeep: { value: new Color(w.deep) },
          uClarity: { value: w.clarity },
          uWave: { value: w.waveStrength },
        },
      ]),
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        uniform float uTime, uDetail, uMapSize, uTexScale, uTexOffset, uSea, uClarity, uWave;
        uniform sampler2D uNoise, uHeightTex;
        uniform vec3 uShallow, uDeep;
        ${SKY_GLSL}
        #include <fog_pars_fragment>

        vec3 waveNormal(vec2 p, float dist) {
          vec2 t = vec2(uTime);
          vec4 a = texture2D(uNoise, p * 0.0031 + t * vec2(0.010, 0.006));
          vec4 b = texture2D(uNoise, p * 0.0097 + t * vec2(-0.017, 0.011));
          vec4 c = texture2D(uNoise, p * 0.031 + t * vec2(0.028, -0.034));
          vec4 d = texture2D(uNoise, p * 0.09 + t * vec2(-0.05, -0.03));
          // fine octaves fade out with distance: they alias into sparkle otherwise
          float fc = 1.0 / (1.0 + dist * 0.0007);
          float fd = 1.0 / (1.0 + dist * 0.0030);
          vec2 g = (a.gb - 0.5) * 1.2 + (b.gb - 0.5) * 0.9 * (0.5 + 0.5 * fc) + (c.gb - 0.5) * 0.55 * uDetail * fc + (d.gb - 0.5) * 0.30 * uDetail * fd;
          float fade = 1.0 / (1.0 + dist * 0.00022);
          return normalize(vec3(-g.x * uWave * 1.6 * fade, 1.0, -g.y * uWave * 1.6 * fade));
        }

        void main() {
          vec3 toCam = cameraPosition - vWorld;
          float dist = length(toCam);
          vec3 V = toCam / dist;
          vec3 n = waveNormal(vWorld.xz, dist);

          vec2 tuv = (vWorld.xz + uMapSize * 0.5) / uMapSize * uTexScale + uTexOffset;
          bool inside = tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0;
          float depth = inside ? max(uSea - texture2D(uHeightTex, tuv).r, 0.0) : 200.0;

          float absorb = 1.0 - exp(-depth / uClarity);
          vec3 body = mix(uShallow, uDeep, pow(absorb, 0.75));
          // sky light on the water body (stays bright in daylight, darker at dusk)
          float light = 0.35 + 0.65 * clamp(uSunDir.y * 1.6, 0.0, 1.0);
          body *= light;

          float ndv = max(dot(n, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
          vec3 R = reflect(-V, n);
          R.y = abs(R.y);
          vec3 refl = skyColor(normalize(R), 0.0);

          vec3 H = normalize(V + uSunDir);
          float ndh = max(dot(n, H), 0.0);
          float spec = pow(ndh, 260.0) * 5.0 + pow(ndh, 36.0) * 0.28;
          vec3 col = body * (1.0 - F) + refl * F + uSunColor * spec;

          // shoreline and reef foam
          float fn = texture2D(uNoise, vWorld.xz * 0.045 + vec2(uTime * 0.02, -uTime * 0.015)).a;
          float fn2 = texture2D(uNoise, vWorld.xz * 0.13 - vec2(uTime * 0.03, 0.0)).a;
          float shore = 1.0 - smoothstep(0.15, 4.5, depth);
          float surge = 0.5 + 0.5 * sin(depth * 1.3 - uTime * 1.1 + fn * 6.0);
          float foam = shore * smoothstep(0.42, 0.78, fn * 0.6 + fn2 * 0.4 + surge * 0.35);
          foam *= 1.0 - smoothstep(6000.0, 20000.0, dist);
          col = mix(col, vec3(0.95, 0.98, 1.0) * (0.45 + 0.55 * light), foam * 0.85);

          float alpha = clamp(mix(0.28, 1.0, pow(absorb, 0.7)) + F * 0.7, 0.0, 1.0);
          alpha = max(alpha, foam * 0.92);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    // the sky uniforms are shared by reference so a time-of-day change updates the water too
    for (const k of Object.keys(sky)) this.material.uniforms[k] = sky[k];

    const geo = new PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.position.y = map.seaLevel;
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  setDetail(v: number): void {
    this.detail.value = v;
  }

  update(dt: number, camX: number, camZ: number): void {
    this.time.value += dt;
    this.mesh.position.x = Math.round(camX / this.snap) * this.snap;
    this.mesh.position.z = Math.round(camZ / this.snap) * this.snap;
  }
}
