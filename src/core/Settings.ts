import { Emitter } from './Emitter';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = 'auto' | QualityLevel;
export type DifficultyId = 'arcade' | 'standard' | 'realistic';
export type SpeedUnit = 'kmh' | 'kt' | 'ms';
export type TimeOfDay = 'day' | 'sunset';
export type TerrainAssist = 'off' | 'warn' | 'auto';
export type ControlScheme = 'mouse' | 'mouse-throttle-ws';
export type DroneMode = 'passive' | 'hostile';
/** What you are playing: the range, an empty sky, or a team deathmatch against AI. */
export type SortieMode = 'training' | 'freeflight' | 'tdm';
export type AiSkillId = 'rookie' | 'regular' | 'ace';

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
  // sortie setup
  mapId: string;
  sortie: SortieMode;
  /** Team deathmatch: players per side (you count as one), score limit (kills), time limit (minutes, 0 = none). */
  teamSize: number;
  scoreLimit: number;
  timeLimit: number;
  aiSkill: AiSkillId;
  musicVolume: number;
  // accessibility
  colorblind: boolean;
  reduceMotion: boolean;
  /** HUD text and panel size multiplier. */
  hudScale: number;
  highContrast: boolean;
  minimap: boolean;
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
  mapId: 'coral',
  sortie: 'training',
  teamSize: 3,
  scoreLimit: 20,
  timeLimit: 10,
  aiSkill: 'regular',
  musicVolume: 0.5,
  colorblind: false,
  reduceMotion: false,
  hudScale: 1,
  highContrast: false,
  minimap: true,
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
      // older saves called the AI mode "skirmish"
      if ((this.value.sortie as string) === 'skirmish') this.value.sortie = 'tdm';
    } catch {
      /* storage unavailable or corrupt: keep defaults */
    }
  }

  /** Back to defaults (keeps the aircraft choice and the intro flag). */
  reset(): void {
    const keep = { aircraftId: this.value.aircraftId, seenIntro: this.value.seenIntro };
    this.value = { ...DEFAULT_SETTINGS, ...keep, bindings: {} };
    this.save();
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
