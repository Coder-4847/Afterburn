import type { SettingsStore } from './Settings';

export type Action =
  | 'pitchUp' | 'pitchDown' | 'rollLeft' | 'rollRight' | 'yawLeft' | 'yawRight'
  | 'throttleUp' | 'throttleDown' | 'afterburner' | 'airbrake'
  | 'fireGun' | 'fireMissile' | 'cycleTarget' | 'lockTarget' | 'flares' | 'chaff'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'targetCam'
  | 'gear' | 'camera' | 'map' | 'lookAround' | 'pause' | 'toggleFps';

/** Key codes are KeyboardEvent.code values; mouse buttons are 'Mouse0' (LMB), 'Mouse1' (MMB), 'Mouse2' (RMB). */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  pitchUp: ['KeyW'],
  pitchDown: ['KeyS'],
  rollLeft: ['KeyA'],
  rollRight: ['KeyD'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['ControlLeft', 'ControlRight'],
  afterburner: ['Space'],
  airbrake: ['KeyB'],
  fireGun: ['Mouse0'],
  fireMissile: ['Mouse2'],
  cycleTarget: ['Tab', 'KeyT'],
  lockTarget: ['KeyY'],
  flares: ['KeyF'],
  chaff: ['KeyC'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  targetCam: ['KeyX'],
  gear: ['KeyG'],
  camera: ['KeyV'],
  map: ['KeyM'],
  lookAround: ['KeyZ', 'Mouse1'],
  pause: ['Escape'],
  toggleFps: ['F3'],
};

export const ACTION_LABELS: Record<Action, string> = {
  pitchUp: 'Pitch up (manual)', pitchDown: 'Pitch down (manual)',
  rollLeft: 'Roll left', rollRight: 'Roll right', yawLeft: 'Rudder left', yawRight: 'Rudder right',
  throttleUp: 'Throttle up', throttleDown: 'Throttle down', afterburner: 'Afterburner (hold)', airbrake: 'Airbrake / wheel brakes',
  fireGun: 'Fire gun', fireMissile: 'Fire missile', cycleTarget: 'Cycle target', lockTarget: 'Lock at reticle',
  flares: 'Flares', chaff: 'Chaff',
  weapon1: 'Weapon 1', weapon2: 'Weapon 2', weapon3: 'Weapon 3', weapon4: 'Weapon 4', targetCam: 'Target view (hold)',
  gear: 'Landing gear', camera: 'Change camera', map: 'Map', lookAround: 'Look around (hold)',
  pause: 'Pause', toggleFps: 'Show FPS',
};

/** Pretty-print a key code for the UI. */
export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  return code.replace('Left', 'L ').replace('Right', 'R ').replace('Control', 'Ctrl').trim();
}

const PREVENT = new Set(['Tab', 'Space', 'F3', 'ControlLeft', 'AltLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Keyboard + mouse state. Everything is action-based so rebinding is just data.
 * Mouse movement is accumulated and consumed once per rendered frame.
 */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private mdx = 0;
  private mdy = 0;
  private wheelAcc = 0;
  /** True while the pointer is captured by the canvas. */
  locked = false;
  /** If pointer lock is refused (embedded browsers etc.) we still accept raw mouse movement. */
  lockless = false;
  /** Set by the game so we only swallow keys during play. */
  captureKeys = false;

  constructor(private canvas: HTMLElement, private settings: SettingsStore) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clear());
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', (e) => { if (this.captureKeys) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.clear();
    });
  }

  private codesFor(a: Action): string[] {
    return this.settings.value.bindings[a] ?? DEFAULT_BINDINGS[a];
  }

  codes(a: Action): string[] { return this.codesFor(a); }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.captureKeys && (PREVENT.has(e.code) || e.ctrlKey)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressedThisFrame.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.captureKeys) return;
    const c = 'Mouse' + e.button;
    this.down.add(c);
    this.pressedThisFrame.add(c);
    if (e.button === 1) e.preventDefault();
  };
  private onMouseUp = (e: MouseEvent) => {
    this.down.delete('Mouse' + e.button);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.captureKeys) return;
    if (this.locked || this.lockless) {
      this.mdx += e.movementX;
      this.mdy += e.movementY;
    }
  };
  private onWheel = (e: WheelEvent) => {
    if (!this.captureKeys) return;
    e.preventDefault();
    this.wheelAcc += Math.sign(e.deltaY);
  };

  isDown(a: Action): boolean {
    for (const c of this.codesFor(a)) if (this.down.has(c)) return true;
    return false;
  }

  /** True once on the frame the action was pressed. */
  pressed(a: Action): boolean {
    for (const c of this.codesFor(a)) if (this.pressedThisFrame.has(c)) return true;
    return false;
  }

  axis(neg: Action, pos: Action): number {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  consumeMouse(out: { x: number; y: number }): void {
    out.x = this.mdx;
    out.y = this.mdy;
    this.mdx = 0;
    this.mdy = 0;
  }

  consumeWheel(): number {
    const w = this.wheelAcc;
    this.wheelAcc = 0;
    return w;
  }

  /** Test hook: pretend the mouse moved. */
  injectMouse(dx: number, dy: number): void {
    this.mdx += dx;
    this.mdy += dy;
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  clear(): void {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.mdx = this.mdy = 0;
  }

  /** Try raw (unaccelerated) pointer lock first, then a normal lock. The caller decides what to do on failure. */
  async requestLock(): Promise<boolean> {
    const c = this.canvas as HTMLCanvasElement;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (c.requestPointerLock as any)({ unadjustedMovement: true });
    } catch {
      try {
        await (c.requestPointerLock() as unknown as Promise<void> | undefined);
      } catch {
        /* handled below */
      }
    }
    await new Promise((r) => setTimeout(r, 30));
    this.locked = document.pointerLockElement === c;
    return this.locked;
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
