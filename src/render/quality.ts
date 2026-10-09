import type { QualityLevel } from '../core/Settings';

/** Everything the renderer needs to know about a quality tier. Add fields here as systems appear. */
export interface QualityPreset {
  level: QualityLevel;
  /** Cap on devicePixelRatio. */
  pixelRatioCap: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Half-width of the player-centred shadow box (m). */
  shadowExtent: number;
  /** Terrain meshes cast shadows too (mountain shadows). */
  terrainShadows: boolean;
  /** Scales terrain LOD switch distances. */
  lodScale: number;
  /** Chunk geometry builds allowed per frame while streaming LODs. */
  chunkBuildBudget: number;
  /** Per-pixel terrain detail normals / water detail. */
  terrainDetail: boolean;
  waterDetail: number; // 0..1
  /** Multiplier on fog density (denser fog hides more distance on weak GPUs). */
  fogScale: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low', pixelRatioCap: 1, antialias: false, shadows: false, shadowMapSize: 1024, shadowExtent: 300,
    terrainShadows: false, lodScale: 0.6, chunkBuildBudget: 3, terrainDetail: false, waterDetail: 0.2, fogScale: 1.35,
  },
  medium: {
    level: 'medium', pixelRatioCap: 1.25, antialias: true, shadows: true, shadowMapSize: 1024, shadowExtent: 420,
    terrainShadows: false, lodScale: 0.85, chunkBuildBudget: 4, terrainDetail: true, waterDetail: 0.6, fogScale: 1.1,
  },
  high: {
    level: 'high', pixelRatioCap: 1.5, antialias: true, shadows: true, shadowMapSize: 2048, shadowExtent: 520,
    terrainShadows: true, lodScale: 1.0, chunkBuildBudget: 5, terrainDetail: true, waterDetail: 1, fogScale: 1,
  },
  ultra: {
    level: 'ultra', pixelRatioCap: 2, antialias: true, shadows: true, shadowMapSize: 4096, shadowExtent: 700,
    terrainShadows: true, lodScale: 1.45, chunkBuildBudget: 8, terrainDetail: true, waterDetail: 1, fogScale: 0.9,
  },
};

/** Pick a sensible default from the GPU string and device hints. Cheap, conservative, overridable in settings. */
export function detectQuality(gl: WebGL2RenderingContext | WebGLRenderingContext): QualityLevel {
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch {
    /* ignore */
  }
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  const cores = navigator.hardwareConcurrency || 4;

  let level: QualityLevel;
  if (mobile) level = 'low';
  else if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) level = 'low';
  else if (/rtx\s?(30|40|50)|rx\s?(6[6-9]|7|9)\d{2}|apple m[2-9]/i.test(gpu)) level = 'high';
  else if (/nvidia|geforce|gtx|rtx|radeon rx|radeon pro|apple m|apple gpu/i.test(gpu)) level = 'high';
  else if (/intel.*(iris xe|arc|iris plus)|radeon.*graphics|amd.*graphics/i.test(gpu)) level = 'medium';
  else if (/intel/i.test(gpu)) level = 'low';
  else level = 'medium';

  if (cores < 4 && level === 'high') level = 'medium';
  return level;
}
