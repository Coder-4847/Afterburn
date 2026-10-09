import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer, type PerspectiveCamera, type Scene } from 'three';
import { clamp } from '../core/math';
import { PostFX } from './PostFX';
import type { QualityPreset } from './quality';

/**
 * Thin wrapper over WebGLRenderer: owns canvas sizing, the effective pixel ratio
 * (device ratio x quality cap x resolution scale x adaptive scale), tone mapping and the post-processing chain.
 */
export class GameRenderer {
  readonly gl: WebGLRenderer;
  private quality!: QualityPreset;
  private resScale = 1;
  private post: PostFX | null = null;
  private postKey = '';
  /** Extra factor controlled by the adaptive-resolution governor. */
  adaptiveScale = 1;

  constructor(readonly canvas: HTMLCanvasElement, antialias: boolean) {
    this.gl = new WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1;
    this.gl.shadowMap.autoUpdate = true;
    // every post pass would otherwise reset the counters: accumulate over the whole frame instead
    this.gl.info.autoReset = false;
  }

  get pixelRatio(): number {
    return this.gl.getPixelRatio();
  }

  /** True while the HDR post chain is active (fog colours then must not be pre-tone-mapped). */
  get postActive(): boolean {
    return !!this.post;
  }

  get drawingHeight(): number {
    return this.gl.domElement.height;
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
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);

    // (re)build the post chain when the tier changes; just resize it otherwise
    const key = this.quality.post ? `${this.quality.msaa}` : '';
    if (key !== this.postKey) {
      this.post?.dispose();
      this.post = this.quality.post ? new PostFX(this.gl, w, h, pr, this.quality) : null;
      this.postKey = key;
    } else this.post?.setSize(w, h, pr);
    this.post?.setBloom(this.quality.bloomStrength);
  }

  render(scene: Scene, camera: PerspectiveCamera, dt: number): void {
    this.gl.info.reset();
    if (this.post) this.post.render(scene, camera, dt);
    else this.gl.render(scene, camera);
  }
}
