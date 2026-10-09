import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';
import { mulberry32 } from '../core/math';

/**
 * Tileable noise shared by terrain detail, water waves and foam.
 *   R: fbm A         G,B: gradient of A (0.5 = flat)         A: independent fbm B
 * The gradients mip-map toward 0.5, so detail normals fade out by themselves with distance.
 */
export function makeNoiseTexture(size = 256, seed = 7): DataTexture {
  const rnd = mulberry32(seed);
  const octaves = 6;
  const baseP = 4;

  const lattices: Float32Array[][] = [];
  for (let ch = 0; ch < 2; ch++) {
    const per: Float32Array[] = [];
    for (let o = 0; o < octaves; o++) {
      const p = baseP << o;
      const a = new Float32Array(p * p);
      for (let i = 0; i < a.length; i++) a[i] = rnd();
      per.push(a);
    }
    lattices.push(per);
  }

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const sampleOct = (lat: Float32Array, p: number, u: number, v: number): number => {
    const x = u * p;
    const y = v * p;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const xa = x0 % p;
    const ya = y0 % p;
    const xb = (x0 + 1) % p;
    const yb = (y0 + 1) % p;
    const a = lat[ya * p + xa];
    const b = lat[ya * p + xb];
    const c = lat[yb * p + xa];
    const d = lat[yb * p + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (ch: number, u: number, v: number): number => {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * sampleOct(lattices[ch][o], baseP << o, u, v);
      norm += amp;
      amp *= 0.55;
    }
    return sum / norm;
  };

  const A = new Float32Array(size * size);
  const B = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      A[y * size + x] = fbm(0, x / size, y / size);
      B[y * size + x] = fbm(1, x / size, y / size);
    }
  }
  const wrap = (i: number) => (i + size) % size;
  const gx = new Float32Array(size * size);
  const gy = new Float32Array(size * size);
  let maxG = 1e-6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = A[y * size + wrap(x + 1)] - A[y * size + wrap(x - 1)];
      const dy = A[wrap(y + 1) * size + x] - A[wrap(y - 1) * size + x];
      gx[y * size + x] = dx;
      gy[y * size + x] = dy;
      maxG = Math.max(maxG, Math.abs(dx), Math.abs(dy));
    }
  }
  // A is a narrow band around 0.5; stretch it so it spans most of 0..1
  let minA = 1;
  let maxA = 0;
  let minB = 1;
  let maxB = 0;
  for (let i = 0; i < A.length; i++) {
    minA = Math.min(minA, A[i]); maxA = Math.max(maxA, A[i]);
    minB = Math.min(minB, B[i]); maxB = Math.max(maxB, B[i]);
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(((A[i] - minA) / (maxA - minA)) * 255);
    data[i * 4 + 1] = Math.round((0.5 + (0.5 * gx[i]) / maxG) * 255);
    data[i * 4 + 2] = Math.round((0.5 + (0.5 * gy[i]) / maxG) * 255);
    data[i * 4 + 3] = Math.round(((B[i] - minB) / (maxB - minB)) * 255);
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
