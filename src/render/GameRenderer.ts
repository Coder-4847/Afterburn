import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer, type PerspectiveCamera, type Scene } from 'three';
import { clamp } from '../core/math';
import type { QualityPreset } from './quality';

/**
 * Thin wrapper over WebGLRenderer: owns canvas sizing, the effective pixel ratio
 * (device ratio x quality cap x resolution scale x adaptive scale) and tone mapping.
 * Phase 2 slots the post-processing composer in behind `render()`.
 */
export class GameRenderer {
  readonly gl: WebGLRenderer;
  private quality!: QualityPreset;
  private resScale = 1;
  /** Extra factor controlled by the adaptive-resolution governor. */
  adaptiveScale = 1;

  constructor(readonly canvas: HTMLCanvasElement, antialias: boolean) {
    this.gl = new WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1;
    this.gl.shadowMap.autoUpdate = true;
  }

  get pixelRatio(): number {
    return this.gl.getPixelRatio();
  }

  setQuality(q: QualityPreset, resolutionScale: number): void {
    this.quality = q;
    this.resScale = resolutionScale;
    this.applySize();
  }

  setResolutionScale(s: number): void {
    this.resScale = s;
    this.applySize();
  }

  applySize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
    const pr = clamp(dpr * this.resScale * this.adaptiveScale, 0.35, 3);
    this.gl.setPixelRatio(pr);
    this.gl.setSize(window.innerWidth, window.innerHeight, false);
  }

  render(scene: Scene, camera: PerspectiveCamera): void {
    this.gl.render(scene, camera);
  }
}
