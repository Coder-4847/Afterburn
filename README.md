# AFTERBURN

A browser-based modern jet combat sim: Ace Combat-style third-person flight with mouse aim, a War Thunder-style
damage model (coming), and a forgiving, fun feel. It is a fully static web app: no backend, no accounts, no
asset downloads. Terrain, aircraft, textures and (later) audio are all generated in code, so the repository is
self-contained and deploys straight to GitHub Pages.

> **Status: Phase 1 of 6 (foundation, flight, world).** One placeholder aircraft, one map (Coral Archipelago),
> free flight with takeoff and landing. Weapons, AI, the full roster, other maps and game modes arrive in later phases.

## Run it

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # type-checks, then builds to dist/
npm run preview    # serve the production build locally
```

Requires a browser with WebGL2 (current Chrome, Edge, Firefox or Safari) and Node 18+ for development.

## Controls (Phase 1)

Mouse-aim is the default scheme: the mouse moves a reticle, and the aircraft banks and pulls to bring its nose onto it.

| Input | Action |
|---|---|
| **Mouse** | Move the aim reticle (the jet follows it) |
| **Shift / Ctrl** or **mouse wheel** | Throttle up / down |
| **Space** (hold) | Afterburner |
| **B** (hold) | Airbrake / wheel brakes |
| **G** | Landing gear |
| **W / S, A / D** | Manual pitch and roll (overrides the reticle while held) |
| **Q / E** | Rudder |
| **V** | Camera: chase / cockpit |
| **Z** or **middle mouse** (hold) | Look around |
| **F3** | FPS / render stats |
| **Esc** | Pause, settings, respawn options |

An alternate scheme (Settings > Controls) moves throttle to W / S. Sensitivity, invert-Y, FOV, graphics quality,
difficulty and HUD options are all in the pause menu. Settings persist in `localStorage`.

Weapons, targeting and countermeasure keys (LMB, RMB, Tab/T, Y, F, C, 1-4, M) are already in the binding table
and start working in Phase 3. Full key rebinding UI comes in Phase 5 (the bindings are data-driven already).

### Taking off and landing

Pause > **Start on the runway**: throttle up, hold Space, pull the reticle up at about 270 km/h. To land, line up with a runway,
lower the gear (**G**), throttle back and touch down gently. Arcade tolerates a sink rate under 9 m/s, a bank under 35 degrees
and a touchdown speed under 540 km/h; Standard and Realistic-lite are stricter. After touchdown, hold **B** to brake.
Landing anywhere other than a runway, or with the gear up, is a crash; you respawn after a few seconds.
(Rearm and repair at airstrips arrives in Phase 4.)

Arcade mode also has terrain avoidance: **PULL UP** warns, then an auto pull-up takes over when impact is imminent.

## Tuning the feel

Everything lives in config files, no code changes needed.

| What | File |
|---|---|
| Flight constants (control response, stall behaviour, drag, ground handling) | `src/data/tuning.ts` (`FLIGHT`) |
| Mouse-aim control law (gains, bank limits, push/pull) | `src/data/tuning.ts` (`AIM`) and `src/data/difficulty.ts` |
| Camera lag, FOV kick, look-around | `src/data/tuning.ts` (`CAMERA`) |
| Terrain assist (warning time, auto pull-up) | `src/data/tuning.ts` (`TERRAIN_ASSIST`) |
| Difficulty presets (assists, G multiplier, landing tolerances) | `src/data/difficulty.ts` |
| Per-aircraft handling (stall speed, thrust, turn rates, G limit) | `src/data/aircraft/*.ts` |
| Maps (terrain, palette, lighting, airstrips) | `src/data/maps/*.ts` |
| Graphics tiers (shadows, LOD, resolution, fog) | `src/render/quality.ts` |

Quick guide for the most common tweaks:

- *Turns feel too slow / fast:* `AIM.maxOffset`, the aircraft `pitchRate`/`gLimit`, and `maxBank` per difficulty.
- *Nose hunts or wobbles:* lower `FLIGHT.pitchResponse`, or increase `AIM.pitchFullError`.
- *Too much / too little altitude loss in turns:* `maxBank` in `difficulty.ts` and `AIM.trimGain`.
- *Takes off too early / late:* `stallSpeed` in the aircraft file (lift scales from it).

## Graphics quality

Low / Medium / High / Ultra, with auto-detect by default (GPU string and device hints). **Adaptive resolution** lowers the
render scale automatically if the frame rate drops and raises it again when things are stable. Press **F3** for live stats.
Target: 60 FPS on a mid-range laptop; Phase 6 is the dedicated 10v10 optimisation pass.

## Project layout

```
src/
  core/      game loop, input, settings, math helpers
  flight/    flight model, mouse-aim controller, terrain assist
  aircraft/  aircraft definitions, procedural jet builder, aircraft entity
  world/     terrain (chunked LOD), sky, water, airstrips, noise, heightmap
  render/    renderer wrapper, camera rig, quality presets
  ui/        HUD (canvas + DOM), menus, styles
  data/      aircraft, maps, difficulty, tuning (all data-driven)
  weapons/ damage/ ai/ audio/ modes/   reserved for later phases
```

Aircraft, maps and (later) weapons and modes are plain data objects: adding content means adding a file under
`src/data`. A `.glb` override per aircraft is planned for Phase 2.

## Deploying to GitHub Pages

The build uses a relative base (`./`), so it works from `https://<user>.github.io/<repo>/` without changes.

1. Create a GitHub repository and push this project to the `main` branch.
2. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and deploys on every push to `main`.

Nothing is deployed until you push.

## Notes

- Aircraft and weapon names (F-16C, Su-57, AIM-120, ...) are used as in-game labels only. All models are original
  procedural builds. If you publish commercially, check trademark rules for the real-world names and replace them where needed.
- Development builds expose the game on `window.afterburn` (with a `debug` helper for scripted flight tests); production
  builds do not.

## Roadmap

1. **Foundation, flight, world** (this phase)
2. Aircraft roster (14 jets), animated surfaces, post-processing, clouds, hangar
3. Weapons, countermeasures, module damage model, training targets
4. AI pilots, all three maps, airstrip rearm/repair, minimap
5. Game modes (1v1 to 10v10, Training), menus, scoreboards, rebinding, music
6. Optimisation, balance, bug sweep, accessibility, release prep
