# AFTERBURN

A browser-based modern jet combat sim: Ace Combat-style third-person flight with mouse aim, a War Thunder-style
damage model (coming), and a forgiving, fun feel. It is a fully static web app: no backend, no accounts, no
asset downloads. Terrain, aircraft, textures and (later) audio are all generated in code, so the repository is
self-contained and deploys straight to GitHub Pages.

> **Status: Phase 2 of 6 (aircraft roster and visual polish).** 14 aircraft with distinct models and handling, a hangar,
> post-processing, clouds and contrails, on one map (Coral Archipelago) with free flight, takeoff and landing. Weapons, AI,
> the other maps and the game modes arrive in later phases.

## Run it

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # type-checks, then builds to dist/
npm run preview    # serve the production build locally
```

Requires a browser with WebGL2 (current Chrome, Edge, Firefox or Safari) and Node 18+ for development.

## Controls

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

## Aircraft roster

Open the **Hangar** from the start screen or the pause menu: a 3D viewer (drag to rotate, scroll to zoom) with gear, afterburner and
control-surface demos, and a stat sheet with 1-5 star ratings for Speed, Agility, Firepower, Durability and Stealth. Changing aircraft
respawns you. Your choice is saved.

| West | Russia | China |
|---|---|---|
| F-22 Raptor | Su-57 Felon | J-20 Mighty Dragon |
| F-16C Fighting Falcon | Su-35S Flanker-E | J-10C Vigorous Dragon |
| F/A-18E Super Hornet | Su-27 Flanker | J-16 |
| F-15C Eagle | MiG-29 Fulcrum | J-35 |
| Rafale C | | |
| Eurofighter Typhoon | | |

Each has its own silhouette (canards, delta or swept wings, twin or canted tails, ventral fins, chin or side intakes, wingtip pods,
thrust-vectoring nozzles) and its own handling: stall speed, thrust, G limit, pitch and roll rate, how quickly it bleeds energy in
hard turns, and whether thrust vectoring keeps it controllable at low speed. Ailerons, flaps, tailplanes, canards, rudders, the
airbrake and the landing gear animate from the actual flight controls.

### Adding an aircraft

1. Copy any file in `src/data/aircraft/` and edit the numbers (`flight` for handling, `model` for the shape, `ratings` for the hangar).
2. Import it in `src/data/aircraft/index.ts` and append it to `AIRCRAFT_LIST`.

That's all: the hangar, selection and flight model pick it up.

### Using your own model (.glb)

Drop `public/models/<aircraft id>.glb` into the project (for example `public/models/f22.glb`) and that aircraft uses it instead of the
procedural build, with no code changes. If the file is missing, the procedural model is used. Conventions: nose toward -Z, up +Y; any
scale (it is resized to the aircraft's length and centred). Optional node names animate: `aileron_l` / `aileron_r`,
`elevator_l` / `elevator_r`, `rudder`, and anything starting with `gear` is hidden when the gear is up. The afterburner is attached
automatically.

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

Low / Medium / High / Ultra, with auto-detect by default (GPU string and device hints). Low renders directly with no
post-processing. Medium and above render in HDR with MSAA, bloom (sun, afterburners, runway lights, glints) and ACES tone mapping,
plus sun glare, speed streaks, contrails (above about 3,600 m), wingtip vortices (hard pulls), cumulus clouds you can fly through
and shadows. Cloud count, shadow resolution, terrain detail and effect density all scale per tier (`src/render/quality.ts`). **Adaptive resolution** lowers the
render scale automatically if the frame rate drops and raises it again when things are stable. Press **F3** for live stats.
Target: 60 FPS on a mid-range laptop; Phase 6 is the dedicated 10v10 optimisation pass.

## Project layout

```
src/
  core/      game loop, input, settings, math helpers
  flight/    flight model, mouse-aim controller, terrain assist
  aircraft/  aircraft schema, procedural jet builder (+ materials, afterburner, trails), .glb override loader, aircraft entity
  world/     terrain (chunked LOD), sky, water, clouds, airstrips, noise, heightmap
  render/    renderer + post-processing chain, camera rig, quality presets, particle system, hangar scene
  ui/        HUD (canvas + DOM), menus, styles
  data/      aircraft, maps, difficulty, tuning (all data-driven)
  weapons/ damage/ ai/ audio/ modes/   reserved for later phases
```

Aircraft, maps and (later) weapons and modes are plain data objects: adding content means adding a file under
`src/data`.

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

1. Foundation, flight, world (done)
2. **Aircraft roster (14 jets), animated surfaces, post-processing, clouds, hangar** (this phase)
3. Weapons, countermeasures, module damage model, training targets
4. AI pilots, all three maps, airstrip rearm/repair, minimap
5. Game modes (1v1 to 10v10, Training), menus, scoreboards, rebinding, music
6. Optimisation, balance, bug sweep, accessibility, release prep
