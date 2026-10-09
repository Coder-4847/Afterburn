import {
  Color, DirectionalLight, Fog, Mesh, MeshStandardMaterial, PMREMGenerator, PerspectiveCamera, RingGeometry, Scene, CircleGeometry,
  Vector3, type Texture, type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Armament } from '../data/stations';
import { JetModel } from '../aircraft/ProceduralJet';
import type { AircraftDef } from '../aircraft/AircraftDef';
import { clamp, damp } from '../core/math';

const BG = 0x0b0e12;

/** A showroom for the hangar screen: studio lighting, a reflective floor, an orbit camera and a posed aircraft. */
export class HangarScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.5, 300);
  private env: Texture;
  private model: JetModel | null = null;
  private def: AircraftDef | null = null;
  private floor: Mesh;
  private ring: Mesh;
  private key: DirectionalLight;

  // view state
  yaw = 0.75;
  pitch = 0.16;
  private dist = 30;
  private distTarget = 30;
  private t = 0;
  autoRotate = true;
  private idle = 0;

  // pose options driven from the UI
  gearDown = true;
  afterburner = false;
  animate = true;
  private gear = 1;
  private ab = 0;
  private power = 0.35;

  constructor(renderer: WebGLRenderer) {
    const pm = new PMREMGenerator(renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.42;
    this.scene.background = new Color(BG);
    this.scene.fog = new Fog(BG, 38, 95);

    this.key = new DirectionalLight(0xfff1de, 1.7);
    this.key.position.set(14, 22, 10);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    sc.near = 1;
    sc.far = 80;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.05;
    const rim = new DirectionalLight(0x7fb2ff, 1.0);
    rim.position.set(-18, 7, -16);
    this.scene.add(this.key, rim);

    this.floor = new Mesh(
      new CircleGeometry(60, 64).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ color: 0x1b222b, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.25 }),
    );
    this.floor.receiveShadow = true;
    this.ring = new Mesh(
      new RingGeometry(15.2, 15.32, 96).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ color: 0x0b2a33, emissive: 0x5fe0ff, emissiveIntensity: 0.9, roughness: 1 }),
    );
    this.scene.add(this.floor, this.ring);
  }

  setAircraft(def: AircraftDef, teamColor: number): void {
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.def = def;
    this.model = new JetModel(def, teamColor);
    this.model.root.position.y = 0;
    this.scene.add(this.model.root);
    const L = def.model.length;
    this.floor.position.y = -def.flight.gearHeight;
    this.ring.position.y = -def.flight.gearHeight + 0.02;
    this.distTarget = L * 1.2 + 3;
    this.dist = Math.max(this.dist, this.distTarget * 0.9);
    this.gear = this.gearDown ? 1 : 0;
  }

  /** Show the chosen weapons hanging on the previewed aircraft. */
  setLoadout(items: (string | null)[], arm: Armament): void {
    this.model?.mountStores(items, arm);
  }

  /** Mouse drag. */
  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.008;
    this.pitch = clamp(this.pitch + dy * 0.006, -0.12, 1.25);
    this.idle = 0;
  }

  zoom(delta: number): void {
    const L = this.def?.model.length ?? 15;
    this.distTarget = clamp(this.distTarget * (1 + delta * 0.0012), L * 0.7, L * 3.2);
    this.idle = 0;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.t += dt;
    this.idle += dt;
    if (this.autoRotate && this.idle > 2.5) this.yaw += dt * 0.18;
    this.dist = damp(this.dist, this.distTarget, 6, dt);

    const L = this.def?.model.length ?? 15;
    const target = new Vector3(0, -0.2 + L * 0.02, 0);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      target.x + Math.sin(this.yaw) * cp * this.dist,
      target.y + Math.sin(this.pitch) * this.dist,
      target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    // shift the view a little so the model sits in the clear space between the two panels
    this.camera.lookAt(target);

    if (this.model) {
      const t = this.t;
      this.gear = damp(this.gear, this.gearDown ? 1 : 0, 3, dt);
      this.ab = damp(this.ab, this.afterburner ? 1 : 0, 3, dt);
      this.power = damp(this.power, this.afterburner ? 1 : 0.35, 3, dt);
      const a = this.animate;
      this.model.update(dt, {
        gearPos: this.gear, power: this.power, ab: this.ab,
        pitch: a ? Math.sin(t * 1.25) : 0, roll: a ? Math.sin(t * 0.85 + 1) : 0, yaw: a ? Math.sin(t * 0.6) * 0.8 : 0,
        airbrake: a ? Math.max(0, Math.sin(t * 0.5)) : 0,
      });
    }
  }

  dispose(): void {
    this.model?.dispose();
    this.env.dispose();
  }
}
