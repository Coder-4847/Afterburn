import {
  ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RedFormat, RGFormat, UnsignedByteType,
} from 'three';
import type { MapDef } from '../data/maps/types';
import { clamp, yieldToMain } from '../core/math';
import { makeHeightFn } from './generators';

export interface TerrainTextures {
  /** R16F: height in metres. */
  height: DataTexture;
  /** RG8: world normal xz components, encoded 0..1. */
  normal: DataTexture;
  /** uv = (worldXZ + size/2) / size * scale + offset  (aligns texel centres with grid vertices) */
  uvScale: number;
  uvOffset: number;
}

/**
 * Regular height grid. Vertex (i, j) sits at world x = -half + i*cell, z = -half + j*cell.
 * The collision sampler uses the SAME triangulation as the terrain mesh, so what you see is what you hit.
 */
export class Heightmap {
  readonly cell: number;
  readonly half: number;
  readonly data: Float32Array;
  min = Infinity;
  max = -Infinity;

  constructor(readonly size: number, readonly res: number) {
    this.cell = size / (res - 1);
    this.half = size / 2;
    this.data = new Float32Array(res * res);
  }

  /** Generate in time-sliced batches so the loading bar can animate. */
  static async generate(map: MapDef, res: number, onProgress?: (p: number) => void): Promise<Heightmap> {
    const hm = new Heightmap(map.size, res);
    const fn = makeHeightFn(map);
    const batch = 32;
    for (let j0 = 0; j0 < res; j0 += batch) {
      const j1 = Math.min(res, j0 + batch);
      for (let j = j0; j < j1; j++) {
        const z = -hm.half + j * hm.cell;
        const row = j * res;
        for (let i = 0; i < res; i++) {
          const h = fn(-hm.half + i * hm.cell, z);
          hm.data[row + i] = h;
          if (h < hm.min) hm.min = h;
          if (h > hm.max) hm.max = h;
        }
      }
      onProgress?.(j1 / res);
      await yieldToMain();
    }
    return hm;
  }

  at(i: number, j: number): number {
    const r = this.res - 1;
    return this.data[(j < 0 ? 0 : j > r ? r : j) * this.res + (i < 0 ? 0 : i > r ? r : i)];
  }

  /** Height at world (x, z), consistent with the mesh triangulation (diagonal b-c). */
  sample(x: number, z: number): number {
    let fx = (x + this.half) / this.cell;
    let fz = (z + this.half) / this.cell;
    const r = this.res - 1;
    fx = clamp(fx, 0, r - 1e-6);
    fz = clamp(fz, 0, r - 1e-6);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const ha = this.data[j * this.res + i];
    const hb = this.data[j * this.res + i + 1];
    const hc = this.data[(j + 1) * this.res + i];
    const hd = this.data[(j + 1) * this.res + i + 1];
    if (tx + tz <= 1) return ha + tx * (hb - ha) + tz * (hc - ha);
    return hd + (1 - tx) * (hc - hd) + (1 - tz) * (hb - hd);
  }

  buildTextures(): TerrainTextures {
    const n = this.res;
    const hData = new Uint16Array(n * n);
    const nData = new Uint8Array(n * n * 2);
    const inv2c = 1 / (2 * this.cell);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        hData[k] = DataUtils.toHalfFloat(this.data[k]);
        const dhdx = (this.at(i + 1, j) - this.at(i - 1, j)) * inv2c;
        const dhdz = (this.at(i, j + 1) - this.at(i, j - 1)) * inv2c;
        const l = Math.hypot(dhdx, 1, dhdz);
        nData[k * 2] = Math.round((-dhdx / l * 0.5 + 0.5) * 255);
        nData[k * 2 + 1] = Math.round((-dhdz / l * 0.5 + 0.5) * 255);
      }
    }
    const height = new DataTexture(hData, n, n, RedFormat, HalfFloatType);
    const normal = new DataTexture(nData, n, n, RGFormat, UnsignedByteType);
    for (const t of [height, normal]) {
      t.minFilter = LinearFilter;
      t.magFilter = LinearFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.colorSpace = NoColorSpace;
      t.needsUpdate = true;
    }
    return { height, normal, uvScale: (n - 1) / n, uvOffset: 0.5 / n };
  }
}
