import { Emitter } from './Emitter';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = 'auto' | QualityLevel;
export type DifficultyId = 'arcade' | 'standard' | 'realistic';
export type SpeedUnit = 'kmh' | 'kt' | 'ms';
export type TimeOfDay = 'day' | 'sunset';
export type TerrainAssist = 'off' | 'warn' | 'auto';
export type ControlScheme = 'mouse' | 'mouse-throttle-ws';
export type DroneMode = 'passive' | 'hostile';

export interface Settings {
  version: number;
  // graphics
  quality: QualitySetting;
  resolutionScale: number;
  adaptiveResolution: boolean;
  fov: number;
  showFps: boolean;
  timeOfDay: TimeOfDay;
  // controls
  mouseSensitivity: number;
  invertY: boolean;
  controlScheme: ControlScheme;
  /** action -> key codes; only overrides are stored here */
  bindings: Record<string, string[]>;
  // gameplay
  difficulty: DifficultyId;
  terrainAssist: TerrainAssist;
  speedUnit: SpeedUnit;
  cameraShake: boolean;
  // hud
  hudPitchLadder: boolean;
  hudHeadingTape: boolean;
  hudFlightPath: boolean;
  seenIntro: boolean;
  // audio / combat
  masterVolume: number;
  damageNumbers: boolean;
  /** Training-range drones: evade only, or hunt the player. */
  drones: DroneMode;
  /** Selected aircraft id (see data/aircraft). */
  aircraftId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  quality: 'auto',
  resolutionScale: 1,
  adaptiveResolution: true,
  fov: 72,
  showFps: false,
  timeOfDay: 'day',
  mouseSensitivity: 1,
  invertY: false,
  controlScheme: 'mouse',
  bindings: {},
  difficulty: 'arcade',
  terrainAssist: 'auto',
  speedUnit: 'kmh',
  cameraShake: true,
  hudPitchLadder: true,
  hudHeadingTape: true,
  hudFlightPath: true,
  seenIntro: false,
  masterVolume: 0.7,
  damageNumbers: true,
  drones: 'passive',
  aircraftId: 'f16c',
};

const KEY = 'afterburn.settings.v1';

/** Persisted settings. Anything missing from storage falls back to defaults, so adding fields is safe. */
export class SettingsStore {
  value: Settings;
  readonly changed = new Emitter<keyof Settings>();

  constructor() {
    this.value = { ...DEFAULT_SETTINGS };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.value, JSON.parse(raw));
    } catch {
      /* storage unavailable or corrupt: keep defaults */
    }
  }

  set<K extends keyof Settings>(key: K, v: Settings[K]): void {
    this.value[key] = v;
    this.save();
    this.changed.emit(key);
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* ignore */
    }
  }
}
