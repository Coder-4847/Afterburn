# AFTERBURN: project memory

**Purpose of this file:** a complete hand-off for any AI (or person) picking this project up cold. Read it fully before touching
code. It records what the game is, how the code is organised, every system's current behaviour and numbers, how the user likes to
work, how to test things in this environment, what has been done, and what is still open. If you change something significant,
update the relevant section (and the "Change log" at the bottom) before you finish.

Last updated: 2026-10-10, after commit `f71fc67` (pushed). A **model rebuild + AI boundary fix is done in the working tree but NOT yet committed** (see change log 9).

---

## 1. What this is

AFTERBURN is a **browser jet combat sim**: Ace Combat-style third-person flight with War Thunder-style mouse aim and a module damage
model, tuned to be forgiving and fun. It is a **fully static web app**: Vite + TypeScript + Three.js (`three ^0.186`), no backend,
no accounts, and **no asset downloads**. Terrain, aircraft, textures, audio and music are all generated in code.

- Repo (local): `C:\Programming\Visual Studio Code\Afterburn`
- Remote: https://github.com/Coder-4847/Afterburn.git, branch `master`
- Live: https://coder-4847.github.io/Afterburn/ (GitHub Pages, deployed by `.github/workflows/deploy.yml` on every push to `main`/`master`)
- Git user: Ettan Bansal (`bansalettan@gmail.com`)
- Status: v1.0.0 feature set (6 phases) plus five feedback rounds, all committed and pushed. Latest commit `f71fc67`.

### Scripts

```bash
npm install
npm run dev        # http://localhost:5180 (port is pinned with strictPort; 5173 is occupied on the user's machine)
npm run build      # tsc --noEmit && vite build -> dist/   (must pass before every commit)
npm run preview    # serve dist (config "afterburn-preview" in .claude/launch.json uses port 4180)
```

`.claude/launch.json` has `afterburn-dev` (port 5180) and `afterburn-preview` (port 4180). `vite.config.ts` uses `base: './'` so it
works from a Pages sub-path, and splits `three` into its own chunk.

---

## 2. How the user works (important)

- The user iterates in **feedback rounds**: they playtest the live build, then send a message like "fix X, add Y, then commit and
  push it". Do the work, verify it, and when they say commit/push, **commit and push to `origin master`** (they have asked for this
  explicitly each time since the first deploy; before that the rule was "never push until told"). Confirm the Pages deploy finished.
- They want **result over ceremony**: short status, no recaps of obvious things, honest notes about anything that is not verified.
- Never push or deploy things they did not ask to be pushed. Do not claim a deploy succeeded without checking the Actions run.
- Commits end with the trailer the harness supplies (currently `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).
- The user plays on the live site, in a normal browser with pointer lock. Their feedback so far has been about **feel**: where the
  enemies are, being killed too easily, turning too slow/too twitchy, landing too hard, brakes too weak, models too crude.
- They use the memory files to continue after deleting a chat: keep this file current.

---

## 3. Repository map

```
index.html, package.json, tsconfig.json, vite.config.ts, README.md, memory.md
.github/workflows/deploy.yml     GitHub Pages deploy (Node 22, npm ci, npm run build, upload dist)
public/                          (empty of required assets; an optional public/models/<id>.glb override is supported)
src/
  main.ts                        boots Game; in dev installs devtools and exposes window.afterburn
  core/   Game.ts (orchestrator, ~1900 lines)  Input.ts  Settings.ts  Emitter.ts  math.ts  devtools.ts
  flight/ FlightModel.ts  MouseAim.ts  TerrainAssist.ts
  aircraft/ AircraftDef.ts  Aircraft.ts  ProceduralJet.ts  Materials.ts  Afterburner.ts  Trails.ts  ModelLoader.ts
  weapons/ Combat.ts  Fighter.ts  WeaponSystem.ts  Loadout.ts  Targets.ts  types.ts
  damage/  DamageModel.ts
  ai/      Pilot.ts (PilotBrain + strike role)  Skirmish.ts  Drone.ts  Range.ts (training range)
  naval/   ShipModel.ts  Ship.ts  Fleet.ts                (carrier strike)
  modes/   Match.ts
  world/   World.ts  Terrain.ts  Heightmap.ts  Airstrip.ts  Water.ts  Sky.ts  Clouds.ts  NoiseTexture.ts  noise.ts  generators/
  render/  GameRenderer.ts  CameraRig.ts  HangarScene.ts  Particles.ts  PostFX.ts  quality.ts
  ui/      Hud.ts  CombatHud.ts  Menus.ts  Hangar.ts  Minimap.ts  Scoreboard.ts  palette.ts  style.css
  audio/   Audio.ts (procedural WebAudio)  Music.ts (procedural score)
  data/    tuning.ts  difficulty.ts  weapons.ts  stations.ts  aircraft/*.ts (14 + index)  maps/*.ts (4 + index + types)
```

### Key classes and who owns what

- `Game` (core/Game.ts): the single orchestrator. Holds settings, input, renderer, camera rig, HUD, menus, world, player
  `Aircraft`, player `Fighter`, `Combat`, `TrainingRange`, `Skirmish`, `Fleet`, `Match`. Fixed 60 Hz physics (`stepPhysics`),
  display-rate rendering with interpolation (`renderFrame`), input sampled once per rendered frame (`processInput`).
  State machine: `loading | ready | playing | paused | hangar | results`. `buildSortie()` creates the combat layer and everything a
  mode needs; `rebuild()` reloads world/sortie; `loadWorld()` creates the `World`. `this.mode` is the *effective* mode (a carrier
  sortie that cannot build a fleet falls back to TDM without changing the saved setting).
- `FlightModel` (flight/): arcade-ish 6-DOF-lite aerodynamics, ground handling, graded landings, catapult/arrestor.
- `MouseAim` (flight/): the mouse-aim control law (reticle -> pitch/roll/yaw commands). Used by the player and every AI.
- `Combat` (weapons/): owns all projectiles (bullets, rockets, bombs, missiles incl. ship SAMs), decoys, explosions, debris, events,
  kill crediting, eject/crash handling. Any `Attacker` (fighter or ship) can own a projectile. Ground targets live in `combat.ground`
  (training-range targets and ships), air dummies in `combat.dummies`, aircraft in `combat.fighters`.
- `Fighter` (weapons/): an aircraft + `DamageModel` + `WeaponSystem` + `Loadout` + stats; implements `Target`. Has `brain` (AI),
  `lives` (Infinity by default), `invulnerable` (set while being serviced), `respawn`.
- `SimpleTarget` (weapons/Targets.ts): base for balloons, ground targets, drones, and ships (`Ship extends SimpleTarget`).
- `Skirmish` (ai/): populates AI wingmen and opponents with `PilotBrain`s; respawns them near their strips/carrier. `setFleet()`
  switches it to carrier placement and strike roles.
- `Fleet` (naval/): builds each team's carrier group on water, runs ship gun/SAM AI, registers/deactivates carrier decks in
  `World.decks`, spawns sinking effects, provides `deckSpawn(team)`.
- `Match` (modes/): score/clock/end conditions for TDM, Last Stand (lives) and Carrier Strike (carrier integrity).
- `World` (world/): terrain, water, sky, clouds, airstrips, `surfaceAt(x,z)` (height, onRunway, onApron, onDeck/deckTeam),
  `decks[]`, `nearestAirstrip`.

---

## 4. Controls (defaults)

Default scheme is `mouse-throttle-ws` (the alternate `mouse` scheme puts throttle on Shift/Ctrl and W/S becomes manual pitch).
Everything is rebindable in the Controls screen (Esc is fixed). Defaults from `core/Input.ts`:

| Input | Action |
|---|---|
| Mouse | move the aim reticle; the jet banks/pulls onto it |
| W / S, mouse wheel | throttle up / down (Shift / Ctrl also work as throttleUp / throttleDown) |
| Space (hold) | afterburner |
| B (hold) | airbrake / wheel brakes |
| G | landing gear |
| A / D | rudder (the reticle follows the nose, so no corrective roll) |
| Q / E | manual roll |
| LMB (hold) / RMB | cannon / fire selected weapon (rockets while held) |
| 1 2 3 4 | weapon group: IR missiles, radar missiles, rocket pods, bombs |
| Tab or T | cycle target (air for 1-2, ground/ships for 3-4) |
| Y | lock target nearest the nose |
| F / C | flares / chaff |
| X (hold) | target camera |
| J (hold ~0.9 s) | eject |
| V | chase/cockpit camera; Z or MMB (hold) look around |
| M / P (hold) | full map / scoreboard; F3 FPS |
| Esc | pause |

On the carrier respawn screen: **1** = next sortie in the air, **2** = from the carrier deck.

---

## 5. Systems and their current numbers

All the "feel" knobs are in `src/data/tuning.ts` (`FLIGHT`, `CAMERA`, `AIM`, `TERRAIN_ASSIST`, `WORLD_BOUNDARY`), `src/data/difficulty.ts`
and each aircraft's `flight` block.

### 5.1 Flight and control
- Fixed step 1/60 s, `maxSubSteps` 5. Atmosphere: density scale height 9500 m, floor 0.45, thrust ~ density^0.7.
- Soft stall (never spins; nose falls through), weathervane stability, authority scales with airspeed vs stall speed.
- Drag: `inducedDrag 5`, `gearDrag 0.55`, **`airbrakeDrag 4.2`** (was 1.6).
- Mouse aim: `AIM.radiansPerCount 0.0021`, reticle max offset 40 deg. Dynamic bank cap (`bankRef 0.6, bankExp 0.8, bankMin 0.14`),
  `errDecay 0.45`, `rollScale 0.7`, `yawSuppress 0.2`. This was tuned over two feedback rounds: small corrections must not
  over-turn, big U-turns must not take forever. The Arcade difficulty adds `flatTurn` (rudder turns the heading without banking).
- Difficulties (`difficulty.ts`): `arcade` (default; gMul 2, damageTaken 0.35, aimAssist 0.85, lockSpeed 2.2, auto flares/chaff,
  auto terrain pull-up), `standard` (damageTaken 0.7), `realistic` ("Realistic-lite", damageTaken 1, no assists). Each has landing
  tolerances (sink/roll/speed/pitch).
- Terrain assist: warn at 5.5 s, auto pull-up at 2.6 s (Arcade), suppressed while landing.
- World boundary: leaving the combat zone starts a 15 s countdown, then you crash. **AI gets the same rule** (`PilotBrain.outT`, 15 s beyond the boundary -> `crashFighter(f, 'Left combat zone')`).

### 5.2 Ground, landing, service
- Rolling friction `0.06 g`; **`idleRollFriction 0.3 g`** when the throttle is closed on the ground (so rollouts stop inside a
  runway); **`brakeFriction 1.6 g`** with the brake held (x1.2 on Arcade); Arcade also auto-brakes with throttle closed.
  Measured: 75 m/s rollout stops in about 150-175 m braking, about 1 km coasting on Standard.
- Landings are **graded**, not pass/fail: within limits = good landing; past them but survivable = crash landing with damage (gear
  breaks first); gear-up belly landing on a runway or wheels-down on open ground is survivable; water or a truly violent impact
  destroys the aircraft. Rough ground friction and lift dump apply. A broken gear cannot be lowered again.
- **Service** only when **stopped on a friendly (Blue) runway or friendly carrier deck**: 10 s rearm/refuel, 20 s if repair is
  needed (`SERVICE_REARM`, `SERVICE_REPAIR` in Game.ts). The aircraft is `invulnerable` while the crew works; the countdown is a
  big HUD element and resets if you move.
- Eject (hold J): in the air 50/50 the pilot is recovered (life kept) or not (life lost); if landed and stopped (speed < 20) it
  always works. Ejecting from a falling wreck can win back a spent life. **AI pilots never eject.**

### 5.3 Damage model (damage/DamageModel.ts)
Module kinds: `fuselage, cockpit, engine(s), fuel, wingL, wingR, tail, gear`. Engine damage -> less thrust (out at 0), wing damage
-> lift/roll loss and wobble, tail damage -> pitch/yaw loss, fuel leaks, fires (engine fire, general fire, extinguish chance),
wings/tail can be ripped off (rip events hide the model part), pilot can be killed. Hit boxes are derived from the model spec using
`secAt(spec, f)` (so the smoothed fuselage sections matter). A typical fighter has 100-140 HP across modules.

### 5.4 Weapons (data/weapons.ts, data/stations.ts)
- Gun per aircraft; IR missiles (AIM-9X, IRIS-T, R-73, PL-10, MICA-IR), radar missiles (AIM-120D, Meteor, R-77, PL-15, MICA-EM),
  rocket pods (Hydra-70, S-8, Type 90), bombs (Mk 82 / FAB-250 / Type 250-2 dumb, GBU-12 / KAB-500L / LS-500J guided, ~260-300
  warhead). Stations and presets (`Dogfighter`, `Beyond-visual-range`, `Strike`, `Balanced`) in `stations.ts`. Hangar edits and
  saves loadouts per aircraft in localStorage.
- Ship SAMs (`SAMS` in weapons.ts): `ir` Sea Sparrow (warhead 150) and `radar` SM-2 (warhead 170). Flares/chaff work on them.
- Missiles: two-stage motor, proportional navigation, seeker cones, decoy seduction, radar missiles use datalink then active.
- AI Dogfighter preset is mostly heat-seekers so fights end up close and the cannon matters.

### 5.5 AI (ai/Pilot.ts)
`PilotBrain` modes: `patrol, bvr, wvr, defend, evade, rtb, strike`. Same `MouseAim` law as the player. Skills (`SKILLS`):
rookie (reaction 1.5 s, aimErr 0.032, missileCool 55 s, cm 0.35, bvr 4500 m), regular, ace. **Arena keeping** (`edgePressure` / `bendInward`): pressure 0..1 rises as the distance left along the heading to a safe square (0.8 x boundary) shrinks below ~2 turn radii (R = v^2 / (8 g x air density x damage factor)); whatever the goal the heading is bent toward the middle, evade picks the beam side that keeps it in, terrain-ray scoring penalises rays that leave the arena, and the arena wins over terrain avoidance unless the ground is < 5 s away. Above 0.4 pressure the pilot pulls full stick. Before this fix a bug in the "never dive" clamp (`max(_d.y, 0)` above 700 m AGL) stopped AI ever commanding a descent, so fights drifted up to 6-7 km where the air is too thin to turn. Measured over 4-minute fights on all maps: time outside the boundary fell from 25-40% of jet-seconds (max 2.5x boundary) to ~1% (max ~1.3x, only crippled jets). Avoids terrain with ray fans, keeps
level turns when the goal is behind (prevents vertical spirals), shares targets, RTBs to a strip/carrier (a low pass within 900 m
services instantly, then `rtbBlock` 45 s). **Strike role** (carrier mode): `strikeGoal` returns the enemy carrier; the pilot fights
only enemies within 1300 m (2400 m if that enemy is targeting it), otherwise flies a bombing run: low and straight, computes the
bomb release distance from ground speed and height (`hv * sqrt(2h/g)`), drops 2 bombs per run with a skill-dependent aim offset,
fires rockets inside 1500 m, egresses 5-6 s, then RTBs when out of bombs/rockets. Strikers use the `Strike` loadout and are every
third AI (`index % 3 === 1`, or the only AI on its side).

### 5.6 Game modes (Settings.sortie)
- `tdm` Team Deathmatch: 1v1 up to 10v10, score limit 10-50, time limit none/5/10/15 min. Only cross-team kills score.
- `elimination` **Last Stand**: three lives each; destroyed with the pilot aboard costs a life; first team out of pilots loses;
  spectate when out of lives; time-limit tie-break = more pilots left, then more lives.
- `carrier` **Carrier Strike** (see 5.7).
- `training`: balloons, a ground-target site, three drones (passive evade, or hostile via setting).
- `freeflight`: empty sky.
Team size default 2, AI skill default rookie, time limit default 10 min, difficulty default arcade, aircraft default F-16C.

### 5.7 Carrier Strike
- **Own map: Cobalt Sea** (`data/maps/cobalt.ts`, `exclusive: 'carrier'`). Always used for this mode; the map picker is replaced by
  a fixed line in mission setup; other modes never list it (`FREE_MAPS`, `mapIdFor(sortie, chosen)` in `data/maps/index.ts`).
- Each team: one anchored **carrier** (400 m x 64 m, 2400 hp), **2 destroyers** (520 hp, guns + SAMs) and **2 submarines** (300 hp,
  surfaced, missiles). Fleet placement: `Fleet.build()` finds open water near +/-0.42 x boundary, picks a carrier heading with
  open water ahead/behind (`openHeading`), puts escorts on clear water, and patrols small circles (radius 110-220 m) where there
  is room, else sits on station.
- Defences scale with AI skill (`GUNNERY` in Fleet.ts): rookie samCool 36 s, regular 26 s, ace 17 s; gun bursts at the nearest
  enemy aircraft; SAMs not stacked on an aircraft that already has one inbound; first SAM delay 3-10 s. A pass at 180 m through
  the fleet cost 3-9% health in tests.
- **Deck**: a rectangle (`World.decks`, `Deck` interface) that `surfaceAt` returns as a runway at deck height. A sunk carrier's deck
  goes inactive. **Arrestor**: 3.2 g decel when on deck, throttle < 0.5 and no catapult run (about 100 m stop). **Catapult**: see below.
- **Launch (easy by design):** on the deck, bring throttle above 0.9 (hold throttle-up) and the shuttle engages (`catapult` in
  FlightModel, only from speed < 25 m/s). It accelerates at `catapultAccel 46 m/s^2` until `catapultSpeed 122 m/s` regardless of
  the throttle key. Game then holds full throttle + afterburner, steers the reticle ~13 deg above the horizon through a 3.4 s
  `launchAssist` window (6 deg while still on the deck above 70 m/s), and raises the gear at 30 m AGL and > 95 m/s. Measured:
  airborne in about 2 s, 140-170 m/s and 150-350 m of altitude by 8-13 s, on all difficulties. A hint appears on the deck.
- **Spawn choice**: `carrierSpawn: 'deck' | 'air'` setting (mission setup select, or keys 1/2 on the respawn screen). Deck spawn is
  at the stern lane (`halfLength - 70` behind the centre), clear of parked aircraft (they sit on the port edge, y = -0.37 x beam).
  Air spawn is 500 m toward the enemy carrier at 450 m altitude. Pause menu has "Launch from your carrier".
- **Win/lose**: `Match.setCarriers(blueFrac, redFrac)` each step (score fields hold percentages); a carrier at 0 ends the match
  after a 4.5 s sinking delay (`endTimer`); on the clock the healthier carrier wins. HUD shows both integrities plus range and
  bearing to the Red carrier, and warns when your carrier drops 8% ("YOUR CARRIER IS UNDER ATTACK").
- Bombs: ~270 each (3 = about 34% of a carrier), so about 3 sorties; escorts take 1-2 bombs, subs 1.
- If the fleet cannot be built the sortie runs as TDM with a note on the briefing (Game.briefNote).

### 5.8 Maps (data/maps)
Authored at about 20 km then scaled by `WORLD_SCALE 0.55` (Frostline 0.7) in `maps/index.ts` so fights are close. Seeds make terrain
reproducible; generators: `archipelago`, `desert`, `alpine` (`world/generators`).
- `coral` Coral Archipelago: tropical islands, Blue west / Red east, six airstrips, central volcano. Default map.
- `sandstorm` Sandstorm Basin: desert, mesas, haze, no sea (`groundPlane`).
- `frostline` Frostline Alps: mountain island, valleys, frozen lakes.
- `cobalt` Cobalt Sea: **Carrier Strike only**, open ocean, middle island chain, an airfield island behind each fleet.
`Airstrip` lights only exist over land (lamps sample the heightmap; approach strings stop at the first lamp that would be over
water). Verified: zero lamps over water on all Coral strips.

### 5.9 Models (aircraft/ProceduralJet.ts, naval/ShipModel.ts)
- `JetModel` builds from `AircraftDef.model` (`ModelSpec`). **Every airframe is authored from real dimensions** (data files use `const L = <real length>; const m = (x) => x / L` and write distances in metres from the nose). Fuselage `sections [z, halfW, halfHeightAbove, yc, halfHeightBelow?, topExp?, bottomExp?]` are asymmetric super-ellipses; `pods` are extra lofted bodies (engine nacelles on the Flanker family and Su-57, DSI bumps on J-20/J-35); intakes take `n` (squareness), `toe`, `drop`; wing/tailplane take `xRoot` (where they leave the fuselage), fins take `y` (root height); canopy has real glass length/width/height and `tandem`; `nozzleAspect` flattens the F-22 nozzles; `features` toggles chines, IRST, probe (L/R), gun muzzle, bay doors, spine, hook; `gear` places wheels. `refineSections` smooths the stations with a monotone cubic (`secAt` returns hw, hh, yc, top, bot from the refined set). Gear/belly heights were set to realistic axis-above-ground values. Stations (`stations.ts`) and the damage model read `wing.xRoot` too.
- Surfaces use `foilPatch` (real aerofoil sections, rounded LE, sharp TE, closed tips): wings, flaps, ailerons, tailplanes, canards,
  fins, rudders; LE slat skins, team-colour tip band. Pivoting surfaces are separate groups driven by flight controls.
- Details: radome, nose band, pitot, dorsal spine, wing-root fillets, forebody chines (f22, su57, j20, j35), IRST ball (su27, su35s,
  j16, mig29, su57), teardrop canopy with bows/rails/seat/pilot, intake lips + splitters, nozzle petals, tail sting (twins), arrestor
  hook, nav lights (team-coloured), landing gear with launch bar and doors, store pylons.
- Performance: `bake()` merges every static mesh per material (all converted to non-indexed). About 45-55 meshes and 15-18k
  triangles per jet; 20 jets ~ 1070 draw calls / 880k triangles (a 10v10 scene). Weapon stores are one vertex-coloured mesh each,
  geometry cached per store type and shared.
- Ships (`ShipModel.buildShip`): `Builder` merges per material and must convert to non-indexed (ExtrudeGeometry hulls are
  non-indexed; mixing indexed and non-indexed made `mergeGeometries` fail and silently dropped hulls once).
- Optional `.glb` override per aircraft (`ModelLoader.ts`, `public/models/<id>.glb`).

### 5.10 Rendering, audio, UI
- Post chain (bloom, MSAA, tone mapping), shadows, LOD terrain streaming, procedural clouds/sky/water, particles for smoke/fire/trails.
  Quality presets `low/medium/high/ultra` + `auto` (detected from the GPU); adaptive resolution trims render scale if frames sag.
- Procedural WebAudio engine/lock tone/RWR/missile alarm + generated music (menu theme vs flight theme with intensity).
- HUD: speed/alt, pitch ladder, heading tape, flight path marker, weapon panel, target box, damage silhouette, RWR, kill feed, damage
  numbers, service countdown, match bar, briefing card (22 s at sortie start). Minimap (heading-up, 16 km detection radius) and full
  map (M). Scoreboard (hold P). Results screen with Rematch / Mission setup / Hangar.
- Accessibility: colour-blind palette, reduce motion, HUD scale, high-contrast HUD.
- Settings persist in `localStorage` key `afterburn.settings.v1` (settings version 3; missing fields fall back to defaults).

### 5.11 Aircraft roster (14)
West: F-22, F-16C (default), F/A-18E, F-15C, Rafale C, Typhoon. Russia: Su-57, Su-35S, Su-27, MiG-29. China: J-20, J-10C, J-16, J-35.
AI teams: Blue picks `faction === 'west'`, Red picks the rest. Add an aircraft by copying a file in `src/data/aircraft/`, then
importing and appending it in `index.ts`.

---

## 6. Testing in this environment

- The in-app browser pane has **no pointer lock** (the game falls back to a free cursor after two refused locks). Screenshot area is
  about 800x560: call `resize_window` 800x560. Screenshots lag a call behind and sometimes time out: retry. The tab must be fronted
  for `requestAnimationFrame` to run.
- Dev builds expose **`window.afterburn`** (the `Game` instance; private members are reachable in JS): `.debug` (player, fighter,
  combat, range, skirmish, fleet, match, tuning, `step(n)`, `setup(x,y,z,hdgDeg,spd,thr)`, `spawnAir`, `spawnRunway`, `aimAt`,
  `stats`, `hangarView(id, yaw, pitch, ab, gear, panels, wait)`), `.tools` (`sheet`, `handling`, `glbRoundTrip`, `clearSheet`),
  `.fleet`, `.match`, `.rebuild()`, `.settings`.
- **Re-fetch `g.debug` after any `rebuild()`/`setAircraft`**: its helpers capture the current player; a stale one moves the old jet.
- Scripted sim: `g.state = 'paused'`, then `g.debug.step(900)` is 15 sim-seconds (includes `combat.update`, fleet and AI). Call
  `g.checkDeath(); g.updateCrash(dt)` manually when testing the death flow. Reset `combat.decoys = []` / `missiles = []` between
  trials. 10,800 steps (3 min) run in about 1.3 s.
- Free-camera screenshots (HMR makes the page reload on every source edit, so wait ~5 s after editing): set `g.state = 'loading'`
  (the loop stops rendering), build `new g.rig.camera.constructor(50, 800/560, 1, 40000)`, position/`lookAt`, then
  `g.world.update(0, cam, cam.position); g.renderer.render(g.world.scene, cam, 0)`.
- Hangar views: `await g.debug.hangarView('f22', 0.7, 0.25, false, false, false, 1500)`; call `g.hangar.resize(800/560)` first if
  the pane aspect looks off.
- Console error capture: temporarily replace `console.error` and count calls around a `rebuild()`.
- Useful checks already scripted before: stopping distances (brake on/off per difficulty), catapult launch timeline per
  difficulty, deck landing/arrestor, carrier win flow (`rc.take(99999, g.fighter, 'Mk 82')`), 3-5 min AI strike simulations at all
  skills, lamps-over-water count per strip, draw calls via `renderer.gl.info.render`.

### Environment gotchas
- Shell is Git Bash on Windows. **Bash heredocs with backticks/quotes mangle edits and `python` hangs.** Write multi-line edit scripts
  with the Write tool as a scratchpad `.cjs` and run with `node`; use an `edit(path, pairs)` helper that throws when an anchor is
  missing (note: a script that throws part-way has already applied the earlier edits; do not blindly rerun it). Template literals
  inside such scripts need `\${...}` escaped.
- `mergeGeometries` requires all inputs indexed or all non-indexed.
- `UniformsUtils.merge` clones uniform objects (re-assign shared ones afterwards). With the HDR post chain fog is mixed pre-tone-mapping
  (`World.fogToneMapped = false`).
- LF/CRLF warnings on commit are harmless.

---

## 7. Change log (what each round changed)

1. **Phases 1-6** (`c860d2d` ... `e26898c`): foundation + flight model + Coral; 14 aircraft, procedural models, post, clouds, hangar;
   weapons, countermeasures, module damage, loadouts, range, audio; AI pilots, 3 maps, skirmish, minimap; modes, mission setup,
   scoreboard, key rebinding, music; optimisation, accessibility, bug sweep, v1.0.0. First push + Pages deploy.
2. **Playtest 1** (`e7eb154`): enemies hard to find (markers, arrow, minimap), gear auto-retracting and auto pull-up while landing,
   rudder barrel-rolling, constant missile pressure.
3. **Playtest 2** (`2a4d6e5`): maps made much smaller, easier combat, calmer controls, better enemy awareness, bigger jets.
4. **Landings/damage/eject/Last Stand** (`0a1cceb`): turning pass, graded and crash landings, richer module damage, eject, 3-life mode.
5. **Servicing/AI** (`9c55b9f`): runway-only servicing with protected countdown (10 s / 20 s), 50/50 air eject vs guaranteed ground
   eject, Last Stand clock, smarter AI.
6. **Carrier Strike** (`0e131ae`): stronger brakes, the mode itself, detailed aircraft models, shoreline-safe runway lights, plus
   fixes (ship hull merge, escort placement, assist bookkeeping for ship kills).
7. **Own carrier map** (`f27cd53`): Cobalt Sea, no map choice, parked jets moved off the spawn lane.
8. **Aerofoil models + easy catapult** (`f71fc67`): real aerofoil wings/tails, better canopies and details, one-key carrier launch.
9. **Real-proportion remodel + AI arena fix** (uncommitted): all 14 jets re-authored from real dimensions with the extended builder
   (see 5.9); matte paint with quieter panel lines; smaller team-colour tip bands; AI no longer drifts out of bounds (5.5); AI that
   stays outside 15 s is lost like the player; ceiling/descent clamp bug fixed. Dev note: in the Browser pane the screenshot is a
   device-pixel crop (top-left), so use `camera.setViewOffset(W, H, W/6, H/6, W, H)` on `g.hangar.camera` and wait ~1 s before a screenshot.

---

## 8. Known limitations and ideas for later

- Jets share one procedural builder but each airframe now has its own real-proportion data (planform, intakes, nacelles, canopy, tail).
  They are still approximations (no wing twist/camber, simplified intake ducts and nozzles, no weapon bay doors that open).
- Triangle count per jet rose to about 16-18k; low-end GPUs rely on adaptive resolution. A distance LOD for jets is not implemented.
- Carrier Strike on a land-heavy map is not supported (Sandstorm/Frostline have no usable sea); only Cobalt Sea.
- Carrier escorts mostly steam tight circles or sit on station; no convoy movement. Carriers are anchored.
- The carrier catapult run points toward the central island chain on Cobalt Sea (about 2.3 km of clear water ahead); if it feels
  tight, nudge the carrier sites or the middle island in `cobalt.ts`.
- No multiplayer, no persistence beyond settings and loadouts, no campaign.
- Deploy status: the Pages run for `f71fc67` completed with success. To check any later push:
  `curl -s "https://api.github.com/repos/Coder-4847/Afterburn/actions/runs?per_page=2"` (the `gh` CLI is not installed here).
- `memory.md` itself and change 9 are uncommitted until the user asks for a commit.

---

## 9. Quick start for a new session

1. Read this file, then `README.md` (player-facing docs) and skim `src/core/Game.ts`.
2. `git status` / `git log --oneline | head`; make sure `npm run build` passes before starting.
3. Start the dev server (`afterburn-dev`, port 5180) and use the testing notes in section 6.
4. After each change: `npx tsc --noEmit`, check the console is error-free after a rebuild, test the behaviour with a script, then
   (when the user asks) `npm run build`, commit with the trailer, `git push origin master`, confirm the deploy.
5. Update this file's relevant sections and the change log.
