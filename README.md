# AFTERBURN

A browser-based modern jet combat sim: Ace Combat-style third-person flight with mouse aim, a War Thunder-style
module damage model, and a forgiving, fun feel. It is a fully static web app: no backend, no accounts, no
asset downloads. Terrain, aircraft, textures and audio are all generated in code, so the repository is
self-contained and deploys straight to GitHub Pages.

> **Status: version 1.0, all six phases complete.** 14 aircraft, three maps, AI pilots at three skill levels, Team Deathmatch from
> 1v1 to 10v10, a training range and free flight, weapons with a module damage model, loadouts, a minimap, full key rebinding,
> procedural audio and music, and accessibility options. Everything is generated in code: no downloads, no backend.

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
| **W / S** or **mouse wheel** | Throttle up / down |
| **Space** (hold) | Afterburner |
| **B** (hold) | Airbrake / wheel brakes |
| **G** | Landing gear |
| **A / D** | Rudder left / right (the reticle follows the nose, so there is no corrective roll) |
| **Q / E** | Manual roll (overrides the reticle while held) |
| **Left mouse** (hold) | Cannon |
| **Right mouse** | Fire the selected weapon (missile / bomb on click, rockets while held) |
| **1 2 3 4** | Select weapon group: IR missiles, radar missiles, rocket pods, bombs |
| **Tab / T** | Cycle target (air targets for 1-2, ground targets for 3-4) |
| **Y** | Lock the target nearest the nose |
| **F / C** | Flares / chaff |
| **X** (hold) | Target view: the camera swings round to keep the target in sight |
| **M** | Full-screen map (north-up) |
| **P** (hold) | Scoreboard |
| **V** | Camera: chase / cockpit |
| **Z** or **middle mouse** (hold) | Look around |
| **F3** | FPS / render stats |
| **Esc** | Pause, settings, respawn options |

The other scheme (Settings > Controls) puts throttle back on Shift / Ctrl and W / S becomes manual pitch. Sensitivity, invert-Y, FOV, graphics quality,
difficulty and HUD options are all in the pause menu. Settings persist in `localStorage`.

Every key above can be rebound: **Controls and key bindings** on the setup screen or the pause menu. Click a key, then press the new key or
mouse button (Esc cancels). A key that was already used by another action is taken from it (you are told which). Esc for pause is fixed
so you can never bind yourself out of the menu. Bindings are saved with the other settings.

### Taking off and landing

Pause > **Start on the runway**: throttle up, hold Space, pull the reticle up at about 270 km/h. To land, line up with a runway,
lower the gear (**G**), throttle back and touch down gently. Arcade tolerates a sink rate under 9 m/s, a bank under 35 degrees
and a touchdown speed under 540 km/h; Standard and Realistic-lite are stricter. After touchdown, hold **B** to brake.
Landing anywhere other than a runway, or with the gear up, is a crash; you respawn after a few seconds.
Stop on a Blue runway or apron for three seconds and you are repaired, refuelled and rearmed.

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

## Maps

Pick one on the start screen (**Mission setup > Map**); the world reloads when you press the start button. Each map has three Blue and three
Red airstrips, its own lighting (day and sunset), and a spawn point for the player.

| Map | Look | Flying |
|---|---|---|
| **Coral Archipelago** | Bright tropical islands over shallow turquoise water, a rugged volcano in the middle | Wide open sky, low-level island hopping |
| **Sandstorm Basin** | A dune basin ringed by flat-topped mesas and broken highlands under dusty haze (no sea: a flat desert fills the world) | Visibility is short; canyons and mesas hide low-flying jets |
| **Frostline Alps** | Snow-capped ridges up to 2,700 m, glacial valleys and frozen lakes, falling to icy sea at the edge | Valley airstrips and high passes: terrain-hugging attacks, or fly above the peaks |

Terrain is generated per map from a seed (`src/world/generators`: `archipelago`, `desert`, `alpine`), so a map is just a data file in
`src/data/maps/` plus a generator kind. Adding a map: copy one of the map files, change the numbers (and the generator settings in
`terrain`), and add it to `src/data/maps/index.ts`.

## Game modes, AI pilots and the minimap

**Mission setup** (the start screen) has three modes, three maps, and per-mode options:

- **Team Deathmatch**: you and AI wingmen (Blue) against an AI team (Red), 1v1, 2v2, 3v3, 5v5 or 10v10. Pick a score limit (10 to 50
  kills), a time limit (none, 5, 10 or 15 minutes) and the AI skill. Only kills against the other team score (crashes do not).
  The score and clock sit at the top of the screen; hold **P** for the scoreboard (kills, assists, deaths and gun accuracy per
  pilot). When a team reaches the score limit, or the clock runs out (most kills wins, equal is a draw), the results screen shows
  the winner and the final table, with **Rematch**, **Mission setup** and **Hangar**. Everyone respawns near their own airstrips a few
  seconds after dying.
- **Training Range**: target balloons dead ahead, a ground-target site and three Red drones that evade (or, set to *Hostile*, hunt you).
- **Free Flight**: an empty sky for practising takeoffs, landings and aerobatics.

**AI pilots** (`src/ai/Pilot.ts`) fly the same mouse-aim control law you do. They patrol, close to missile range and fire radar missiles
(then turn 40 degrees off to keep the datalink), merge and dogfight with guns and IR missiles, break when someone is on their tail,
beam the missile and use flares or chaff when one is inbound, avoid mountains by looking ahead, and return to an airstrip to rearm when
hurt, low on fuel or out of weapons. Skill (**Rookie / Regular / Ace**) sets reaction time, aim error, gun and missile range, how often
they fire and how well they use countermeasures. They share targets so a team spreads out instead of piling onto one jet.

**Rearm and repair:** stop on a friendly (Blue) runway or apron for three seconds with the gear down to be repaired, refuelled and rearmed.
AI pilots do this on a low pass over their own strip.

**Minimap:** a heading-up radar in the top-left shows terrain, airstrips and aircraft (enemies only inside a 16 km detection radius;
your selected target is circled; inbound missiles flash). **M** opens the whole map, north-up. The minimap can be switched off in
Settings > HUD.

## Accessibility

Settings > Accessibility:

- **Colour-blind safe colours**: blue against orange instead of blue against red (HUD, minimap, scoreboard and the jets' team colours;
  applies when the next mission loads). The gun pipper turns white so it never competes with the orange enemy marks.
- **Reduce motion**: no screen shake, speed streaks, sun glare, G-load vignette or blinking warnings, and less field-of-view push.
- **HUD size** (80% to 150%) and **high-contrast HUD** (heavier outlines, darker panels).
- Every key and mouse button can be rebound; menus work with the keyboard (Tab / Enter) and show a focus outline; every audio warning
  (missile alarm, radar lock, lock tone) has a visual counterpart (MISSILE / LOCKED text, the warning ring, the RWR scope).
- Flight assists: three difficulty levels, terrain warning with optional auto pull-up, and Arcade mode's stall protection and
  auto-levelling.

## Performance notes

- Each jet's static parts (fuselage, wings, pods, intakes, canopy, fins) are merged into a handful of meshes at build time, weapon
  geometry is shared between all copies, and effects use pooled particle systems, so a 10v10 match (20 aircraft) stays well within a
  frame budget on a mid-range laptop. Control surfaces, nozzles, landing gear and weapon stores stay separate because they move.
- Graphics quality (Low to Ultra, auto by default), render resolution and adaptive resolution are in Settings; **F3** shows live
  frame time, draw calls and triangles.
- Switching maps and missions frees the old world's GPU memory (checked by repeated reloads: geometry and texture counts stay flat).
- If the browser reclaims the graphics context, or the game hits a repeating error, a panel offers a reload instead of freezing.

## Music and sound

All audio is generated in the browser. Effects (cannon, missiles, explosions, engine, warnings) and a procedural score: a slow pad and
arpeggio in the menus, and in flight a driving theme (bass, hats, kick, snare, a lead line) whose layers fade in as enemies get close,
missiles are inbound or you are hurt. Effects volume and music volume are separate sliders in Settings. Browsers only allow audio
after a click, so the menu music starts on your first click.

## Weapons and damage

**Weapons.** Each aircraft has real stations (wingtips, wing pylons, fuselage, internal bays on the stealth jets) built from its model,
and a payload limit. Stores hang visibly on the jet and drop off as you fire them. The cannon (calibre, rounds and rate follow the
aircraft) shows a lead pipper on the selected target; bombs show a CCIP impact marker.

- **IR missiles** (AIM-9X, IRIS-T, R-73, PL-10, MICA-IR): a seeker cone and a lock range that grows with the target's heat
  (afterburners are beacons) and is best from behind. They can be fired uncaged and will hunt for heat. **Flares** (F) seduce them.
- **Radar missiles** (AIM-120D, Meteor, R-77, PL-15, MICA-EM): need a lock, with a range that depends on the target's radar cross-section
  (stealth jets are hard to lock). They fly on a datalink, then go active; **chaff** (C) and notching (flying across the missile's line)
  can defeat them.
- **Rocket pods** ripple while the right button is held. **Bombs** are unguided, or laser-guided if you hold a lock on a ground target.
- Missiles use proportional navigation with real G and speed limits, so a missile that is out of energy cannot catch a hard turn.

**Damage** is per module, War Thunder style: cockpit (pilot), engines, fuel tanks, wings, tail and fuselage, each with hit boxes and
hit points. Cannon rounds hit the module they strike; explosions damage everything in range. Lost wings roll you off, a hurt tail
wobbles the nose and weakens control, engines lose thrust and burn, fuel leaks drain you (BINGO at 20%) and can ignite. Fires burn the
fuselage until they go out, and speed helps put them out. The HUD shows a damage silhouette. A destroyed aircraft tumbles, burning,
until it hits the ground; wings and tail can be ripped off as flaming debris.

**Loadouts.** Hangar > pick an aircraft > **Loadout** tab: a dropdown per station, four presets (Dogfighter, Beyond-visual-range, Strike,
Balanced), a payload bar, and named custom loadouts you can save and load. Loadouts are stored per aircraft in `localStorage`.

**Training range.** The range sits east of the Blue island: hovering target balloons dead ahead, a ground-target site (bunker, radar,
trucks, tents) on the foothills of the volcano, and three Red drones (Su-27, MiG-29, J-10C) that orbit, dispense flares and chaff and
break across inbound missiles. Set **Red drones** to *Hostile* in Settings and they hunt you with guns and missiles (watch the
MISSILE warning and the RWR scope). Targets respawn after a while. Kills, deaths, a kill feed and floating damage numbers are on the HUD.

**Audio.** All sound is synthesised with WebAudio (cannon, launches, explosions, hits, engine, seeker tone, missile alarm, radar
warning chirp); volume is in Settings. Audio starts on your first click, as browsers require.

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
| Missiles, rockets, bombs, cannon profiles | `src/data/weapons.ts` |
| Stations, presets, payload limits per aircraft | `src/data/stations.ts` |
| Hit points per module, fire and leak behaviour | `src/damage/DamageModel.ts` (aircraft `hp` in `src/data/aircraft/*.ts`) |
| Training range layout and drones | `src/ai/Range.ts`, `src/ai/Drone.ts` |
| AI skill levels and behaviour | `src/ai/Pilot.ts` (`SKILLS`) |
| Match rules, limits | `src/modes/Match.ts`, setup options in `src/ui/Menus.ts` |
| Music themes (tempo, chords, layers) | `src/audio/Music.ts` (`THEMES`) |

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
Target: 60 FPS on a mid-range laptop, including 10v10 matches.

## Project layout

```
src/
  core/      game loop, input, settings, math helpers
  flight/    flight model, mouse-aim controller, terrain assist
  aircraft/  aircraft schema, procedural jet builder (+ materials, afterburner, trails), .glb override loader, aircraft entity
  world/     terrain (chunked LOD), sky, water, clouds, airstrips, noise, heightmap
  render/    renderer + post-processing chain, camera rig, quality presets, particle system, hangar scene
  ui/        HUD (canvas + DOM), combat HUD, minimap, menus, styles
  data/      aircraft, maps, difficulty, tuning (all data-driven)
  weapons/   combat manager (projectiles, missiles, decoys, explosions), fighter, weapon system, loadouts, targets
  damage/    module damage model
  ai/        pilots (skirmish AI), training-range drones, range layout, skirmish manager
  audio/     procedural WebAudio: effects and the music score
  modes/     match rules (team scores, limits, winner)
```

Aircraft, maps, weapons and (later) modes are plain data objects: adding content means adding a file under
`src/data`.

## Deploying to GitHub Pages

The build uses a relative base (`./`), so it works from `https://<user>.github.io/<repo>/` without changes.

1. Create a GitHub repository and push this project to the `main` (or `master`) branch.
2. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and deploys on every push to `main`.

Nothing is deployed until you push.

## Notes

- No licence file is included: add the one you want before publishing the repository.
- Saved data lives in the browser's `localStorage` (settings, key bindings, loadouts). Settings > Saved data resets the settings.
- Aircraft and weapon names (F-16C, Su-57, AIM-120, ...) are used as in-game labels only. All models are original
  procedural builds. If you publish commercially, check trademark rules for the real-world names and replace them where needed.
- Development builds expose the game on `window.afterburn` (with a `debug` helper for scripted flight tests); production
  builds do not.

## Roadmap

1. Foundation, flight, world (done)
2. Aircraft roster (14 jets), animated surfaces, post-processing, clouds, hangar (done)
3. Weapons, countermeasures, module damage model, loadouts, training targets, audio (done)
4. AI pilots, all three maps, airstrip rearm/repair, minimap (done)
5. Game modes (1v1 to 10v10, Training), menus, scoreboards, rebinding, music (done)
6. Optimisation, balance, bug sweep, accessibility, release prep (done)
