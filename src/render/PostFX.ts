import { HalfFloatType, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { QualityPreset } from './quality';

/**
 * Scene -> HDR (half-float, MSAA) target -> bloom -> tone mapping + sRGB output.
 * The scene is rendered in linear HDR, so the sun, afterburners, runway lights and sun glints can exceed 1.0
 * and bloom; ACES tone mapping happens last (in OutputPass, using the renderer's exposure).
 */
export class PostFX {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private target: WebGLRenderTarget;

  constructor(renderer: WebGLRenderer, width: number, height: number, pixelRatio: number, q: QualityPreset) {
    this.target = new WebGLRenderTarget(width * pixelRatio, height * pixelRatio, { type: HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    // placeholder scene/camera: replaced every frame
    this.renderPass = new RenderPass(null as unknown as Scene, null as unknown as PerspectiveCamera);
    // threshold 1.0 on HDR luminance: only genuinely bright things (sun, flames, lights, glints) bloom
    this.bloom = new UnrealBloomPass(new Vector2(width, height), q.bloomStrength, 0.4, 1.0);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  setBloom(strength: number): void {
    this.bloom.strength = strength;
  }

  render(scene: Scene, camera: PerspectiveCamera, dt: number): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.target.dispose();
  }
}
