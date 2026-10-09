import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { LightingPreset } from '../data/maps/types';
import { DEG, lerp } from '../core/math';

/** Uniforms shared (by reference) between the sky dome, the water and the environment-map bake. */
export interface SkyUniforms {
  uSunDir: { value: Vector3 };
  uZenith: { value: Color };
  uHorizon: { value: Color };
  uGroundCol: { value: Color };
  uSunColor: { value: Color };
  uSunsetTint: { value: Color };
  [k: string]: { value: unknown };
}

export function makeSkyUniforms(): SkyUniforms {
  return {
    uSunDir: { value: new Vector3(0, 1, 0) },
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uGroundCol: { value: new Color() },
    uSunColor: { value: new Color() },
    uSunsetTint: { value: new Color() },
  };
}

/** Analytic sky: gradient + forward-scattering glow + sun disc. HDR (the sun disc is far above 1.0). */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGroundCol;
uniform vec3 uSunColor;
uniform vec3 uSunsetTint;

vec3 skyColor(vec3 d, float disc) {
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  float s = clamp(dot(d, uSunDir), 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.45));
  // warm band on the sun's side of the horizon
  float band = pow(1.0 - up, 5.0);
  col = mix(col, uSunsetTint, clamp(band * pow(s, 2.5) * 0.9, 0.0, 1.0));
  // forward scattering glow around the sun
  col += uSunColor * (0.08 * pow(s, 4.0) + 0.30 * pow(s, 22.0) + 0.9 * pow(s, 260.0));
  // below the horizon: fade to the ground colour
  col = mix(col, uGroundCol, 1.0 - smoothstep(-0.2, 0.0, h));
  col += uSunColor * disc * 45.0 * smoothstep(0.99986, 0.99994, s) * step(-0.01, h);
  return col;
}
`;

export class Sky {
  readonly mesh: Mesh;
  readonly uniforms: SkyUniforms;
  readonly material: ShaderMaterial;
  /** Direction *toward* the sun. */
  readonly sunDir = new Vector3();
  private discUniform = { value: 1 };

  constructor(uniforms: SkyUniforms, radius = 30000) {
    this.uniforms = uniforms;
    this.material = new ShaderMaterial({
      uniforms: { ...uniforms, uDisc: this.discUniform },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uDisc;
        ${SKY_GLSL}
        void main() {
          gl_FragColor = vec4(skyColor(normalize(vDir), uDisc), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** The sun disc is left out of the environment map (the directional light already represents it). */
  setDisc(on: boolean): void {
    this.discUniform.value = on ? 1 : 0;
  }

  apply(p: LightingPreset): void {
    const u = this.uniforms;
    const az = p.sunAzimuth * DEG;
    const el = p.sunElevation * DEG;
    // compass azimuth: 0 = north (-Z), 90 = east (+X)
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    u.uSunDir.value.copy(this.sunDir);
    u.uZenith.value.set(p.zenith);
    u.uHorizon.value.set(p.horizon);
    u.uGroundCol.value.set(p.ground);
    u.uSunColor.value.set(p.sunColor);
    u.uSunsetTint.value.set(p.sunsetTint);
  }
}

// ---- tone-mapped colours for fog -------------------------------------------------------
// Fog is applied *after* tone mapping in three's shaders, so to blend invisibly into the sky the
// fog colour must be the tone-mapped sky colour. This mirrors three's ACESFilmicToneMapping.

function rrt(v: number): number {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.432951) + 0.238081;
  return a / b;
}

export function acesTonemap(c: Color, exposure: number, out: Color): Color {
  const k = exposure / 0.6;
  const r = c.r * k, g = c.g * k, b = c.b * k;
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ig = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const ib = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const pr = rrt(ir), pg = rrt(ig), pb = rrt(ib);
  out.r = Math.min(1, Math.max(0, 1.60475 * pr - 0.53108 * pg - 0.07367 * pb));
  out.g = Math.min(1, Math.max(0, -0.10208 * pr + 1.10813 * pg - 0.00605 * pb));
  out.b = Math.min(1, Math.max(0, -0.00327 * pr - 0.07276 * pg + 1.07602 * pb));
  return out;
}

const _tmp = new Color();
const _warm = new Color();

/** Fog colour for the current view: horizon colour, warmed toward the sun when looking at it. */
export function fogColorFor(u: SkyUniforms, viewDirXZ: Vector3, exposure: number, out: Color, tonemap = true): Color {
  const sd = u.uSunDir.value;
  const sl = Math.hypot(sd.x, sd.z) || 1;
  const facing = Math.max(0, (viewDirXZ.x * sd.x + viewDirXZ.z * sd.z) / sl);
  const f = Math.pow(facing, 3) * 0.9 * Math.pow(Math.max(0, 1 - sd.y * 1.2), 2);
  _warm.copy(u.uHorizon.value).lerp(u.uSunsetTint.value, f);
  _tmp.copy(_warm);
  // a little sun glow added in HDR, like the sky shader does near the horizon
  const glow = Math.pow(facing, 12) * 0.12 * lerp(1, 0.4, sd.y);
  _tmp.r += u.uSunColor.value.r * glow;
  _tmp.g += u.uSunColor.value.g * glow;
  _tmp.b += u.uSunColor.value.b * glow;
  // with the HDR post chain, fog is mixed before tone mapping, so the raw horizon colour already matches the sky
  return tonemap ? acesTonemap(_tmp, exposure, out) : out.copy(_tmp);
}
