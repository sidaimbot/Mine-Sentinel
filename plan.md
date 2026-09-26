# Mine Sentinel - Project Plan & Structure

**Last Updated:** 2026-09-25  
**Project Status:** Phase 5 — operator sandbox simulator (no game mechanics)  
**Tech Stack:** THREE.js (3D Engine) | HTML5 | ES6+ JavaScript | WebGL

---

## Project Overview

**Mine Sentinel** is a 3D underground mine **hazard simulator**. The operator walks the mine and injects incidents
from a Simulation Control console — **methane rising, water logging, fire** — at any location and severity,
then watches the 8-node sensor network detect them and the AI copilot classify, forecast and route an evacuation.
There are no scenarios, scores or fail states: it is a sandbox.

---

## Directory Structure

```
codiotex/
├── claude.md                 # Project guidelines
├── plan.md                   # This file
├── README.md                 # Project overview
├── package.json              # Scripts (npm run dev / dev:py)
├── .claude/launch.json       # Browser preview server (tools/serve.py :8001)
├── tools/serve.py            # No-cache static dev server (avoids stale ES modules)
│
├── hardware/
│   ├── mine_sentinel_node/mine_sentinel_node.ino  # Arduino Uno/Nano + ESP32: MQ on A0/GPIO34, DHT on D2/GPIO4, JSON lines @115200
│   └── README.md             # Wiring, flashing, connecting, line format
│
├── public/
│   ├── index.html            # Simulator: start screen, header (▣ DASHBOARD ↗), alert banner, HUD columns, sim console
│   ├── dashboard.html        # Sensor operations dashboard (USB hardware unit PU-01 + simulated 16-node network)
│   ├── styles/dashboard.css  # Light theme: unit gauges, analysis, map, serial console, tiles, trends, alarms, settings dialog, print report
│   └── styles/hud.css        # Compact glass HUD, console, labels, FX, responsive, `hud-min` mode
│
└── src/
    ├── main.js               # Bootstrap, sim clock (pause / 1-2-4×), tick, vitals, aim-point raycast
    ├── config.js             # Player, gas spread, sensor thresholds (CH₄/CO/Temp/Water), incident severity presets
    │
    ├── core/                 # GameEngine, InputManager (keyboard/mouse + Gamepad API, rumble), StateManager (event bus)
    │
    ├── world/
    │   ├── MineLayout.js     # Tunnel rects → 1 m grid, BFS distance, clearance, Dijkstra, INCIDENT_LOCATIONS
    │   ├── MineGenerator.js  # Displaced rock mesh (2 quads/m), timber sets, log lagging, loose rubble, rails, lamps + halos, signs, props
    │   ├── Textures.js       # Procedural colour + normal maps: fractured slate rock, dirt/gravel floor, wood grain, bark, lamp halo
    │   ├── Lighting.js       # Headlamp, flickering lamps, red strobe in any hazard, smoke dimming
    │   ├── GasParticles.js   # Methane haze for multiple leaks (spawn weighted by strength)
    │   ├── WaterSurface.js   # Instanced water tiles at local flood depth + scrolling ripple normal map
    │   ├── FireEffect.js     # Per-fire flames, flickering light, ceiling-hugging smoke
    │   ├── PlacementMarker.js# Pulsing ring/beam showing where the next incident will be injected
    │   ├── SensorNetwork.js  # Signal cables (wall → roof → wall) between nodes + data pulses flowing to the G-01 gateway
    │   └── RouteGuide.js     # AR floor chevrons along the evacuation route
    │
    ├── gameplay/
    │   ├── HazardSystem.js   # Incident list; fields: methaneAt, coAt, temperatureAt, smokeAt, waterDepthAt, dangerAt (+lookahead)
    │   ├── Sensors.js        # 16 black-box units (air: on arch cap-beam centre / roof rod; floor: wall 0.34 m), hysteresis, submerged state
    │   ├── Player.js         # FPS controller, collision, water drag, footsteps (splash depth)
    │   └── Objectives.js     # Live evacuation aid: follows AI plan, checklist, re-route, stand-down
    │
    ├── audio/
    │   └── AudioEngine.js    # Synth: ambience+echo, drips, steps/splashes, gas detector, klaxon, heartbeat, fire roar+crackle, water flow
    │
    ├── data/
    │   ├── AILogic.js        # Multi-hazard detection, fire/gas/water classification, ignition risk, forecast, weighted routes
    │   └── EventLog.js       # Operator actions, per-metric level changes, AI stages, suppression, evacuation steps
    │
    ├── ui/
    │   ├── UIManager.js      # Orchestration, collapsible panels (persisted), toasts
    │   ├── SimConsole.js     # 3 incident buttons, location (zone / map click / aim), severity, pause/speed, active list
    │   ├── effects.js        # fmt/utcStamp/signed, tweenNumber, typeText, drawSparkline
    │   ├── Compass.js        # Heading tape with route waypoint + incident markers
    │   ├── WorldLabels.js    # Route label, floating incident tags, aim-to-inspect tooltip
    │   ├── ScreenFX.js       # Danger vignette + smoke-driven scene fog
    │   └── panels/           # MapPanel (click to place), AlertPanel (banner), Vitals, Sensor, Evac, AITrace
    │
    ├── dashboard/
    │   ├── main.js           # Wiring: sources → Store/NetworkModel, 0.5 s tick, rAF map/charts, calibration, settings dialog
    │   ├── sources.js        # parseLine (JSON / key=value / CSV), SerialSource (Web Serial, auto-reconnect)
    │   ├── gas.js            # MQ-2/MQ-7/MQ-9 raw ADC → CO ppm (Rs/R0 power law, clean-air zeroed), R0 calibration, exposure limits
    │   ├── settings.js       # Persisted settings: baud, ADC, sensor model, R0, thresholds, physical node location
    │   ├── NetworkModel.js   # 16 nodes: physical node = live data; others simulated, coupled to live gas/humidity by tunnel distance
    │   ├── Store.js          # Packets/link stats, samples, 5 min history, alarms (raise/escalate/clear), peaks, events, console
    │   ├── MapView.js        # Mine map with gas/water overlay, PU-01 highlighted, LIVE/SIM tooltips
    │   ├── Charts.js         # Trend charts, semicircle gauges, alarm Gantt
    │   ├── Panels.js         # KPIs, unit metric cards, analysis (slope, ETA, %LEL, spread, dew point), tiles, alarms, events, console
    │   ├── Report.js         # CSV (raw + ppm samples, alarms, events) + printable report
    │   └── theme.js          # Canvas palette (keep in sync with dashboard.css)
    │
    └── utils/noise.js        # Value noise, fbm, seeded RNG
```

### Mine Layout (world coords, +x east, −z north)
```
 z=-90 ┌─┐ NORTH DRIFT (G-04)
       │ │
 z=-60 ┼─┼────────────┐  JUNCTION A (G-03) ── CROSS DRIFT (G-05) ── TUNNEL B top
       │ │            │  TUNNEL B (G-06, G-07) ← spawn (20,-40) facing south
       │ │ MAIN SHAFT │  leak source (20,-17)
 z=-14 │ │ (G-02)   ┌─┴─┐
       │ │          │   │ CHAMBER (G-08)
 z=0 ┌─┴─┴─┐ BYPASS │   │
     │ENTRY├────────┴───┘   ← x 6..14, z -6..-2: closes the loop
     └─────┘ (G-01)
```

### Incident Models
| Button | Source behaviour | Sensor metrics | Clear action | Interactions |
|--------|------------------|----------------|--------------|--------------|
| ◆ Methane rising | Strength ramps to preset max; spreads by tunnel path distance | CH₄ ppm | Ventilation decay (τ 12 s) | + fire → **IGNITION RISK** |
| ▼ Water logging | Pool grows outward (reach) to preset depth | Water cm | Pumping drain (τ 18 s) | Floods a fire source > 0.4 m → **fire suppressed**; slows walking |
| ▲ Fire alert | Heat + CO + smoke; smoke banks along the roof | Temp °C, CO ppm | Extinguish (τ 5 s), CO lingers | Dims lamps, thickens fog, O₂ drop |

Severity presets (LOW / MED / HIGH) live in `config.js → INCIDENTS`.

---

## Feature Breakdown

### Phase 1: Core Infrastructure ✅
- [x] Project initialization & structure
- [x] THREE.js scene setup & camera controls
- [x] Basic mine environment generation (delivered in Phase 2)
- [x] Player movement & input handling
- [x] UI foundation & panel system

**Deliverable:** Walkable 3D mine with basic controls

### Phase 2: Mine World, Sensor & Hazard Systems ✅
- [x] Procedural mine: grid layout, displaced rock, supports, rails, lamps, signs, props
- [x] Player collision against tunnel walls
- [x] Sensor node placement & data simulation (8 nodes)
- [x] Real-time sensor reading generation from a gas field
- [x] Hazard detection (normal / elevated ≥10k / critical ≥15k ppm)
- [x] AI logic: neighbour corroboration, safe-zone selection, decision trace
- [x] Particle effects for gas + red strobe lighting in gas zones

**Deliverable:** Live telemetry with environmental threats

### Phase 3: UI & HUD Integration ✅
- [x] Reference-matched visual system (Barlow Condensed + JetBrains Mono, accent top-lines, staggered panel entrance)
- [x] Alert panel with SENSOR → AI RESULT → RESPONSE pipeline + UTC timestamps, typed headline
- [x] Event log drawer (E) and close-to-chip (X), auto-reopen on escalation
- [x] Vitals bars with dashed safety thresholds, tweened numbers, status line
- [x] Sensor matrix: current / 60 s change / sparkline per reading, row highlight by level
- [x] Evacuation panel: STANDBY/ACTIVE/SAFE, live distance, checklist that progresses
- [x] Typed AI decision trace
- [x] Minimap: blueprint edges, gas overlay, pulsing alarm rings, marching-ants route, view cone
- [x] AR: floor chevrons, compass tape, world-space safe-zone label (edge-clamped), hazard callout, aim-to-inspect
- [x] Screen FX: vignette, film grain, red danger pulse in gas
- [x] Responsive: ≤1280 / ≤980 / ≤720 breakpoints

**Deliverable:** Fully functional dashboard with live data

### Phase 4: Gameplay & Polish
- [x] Scenario system (3 scenarios) + start-screen selection, best grade per scenario
- [x] Bypass tunnel → looped mine with real route choices
- [x] AI: weighted Dijkstra routing (gas + instability), 30 s gas forecast, structural watch, live re-route
- [x] Roof fall hazard: precursor vibration/dust/creaks/lamp stutter, rubble, sealed cells, buried sensor
- [x] Win/fail: safe-air confirmation, overcome by methane, struck by roof fall (slump animation)
- [x] Scoring & debrief (grade, stats, chart, events), replay / next / menu, restart via URL
- [x] Synthesised audio (ambience, drips, footsteps, gas detector, klaxon, heartbeat, creaks, rumble), mute
- [x] Pause menu (P / Esc / pointer-lock loss / tab hidden)
- [x] Toast announcements (evacuation order, objective updated, structural warning, roof fall, safe)
- [ ] Touch controls for mobile (layout is responsive; input is keyboard/mouse only)

**Deliverable:** Complete playable experience

---

## Key Architecture Decisions

### 1. **Modular Component System**
- Each system (world, gameplay, UI) is independent
- Systems communicate via `StateManager` (observer pattern)
- Allows easy testing and future expansion

### 2. **Separation of Concerns**
- **GameEngine**: Renders & scene management only
- **StateManager**: All game logic & state
- **UIManager**: Display layer (decoupled from logic)

### 3. **Procedural Generation**
- Mine layouts generated algorithmically (no static meshes initially)
- Allows infinite variety & scalability

### 4. **Real-time Data Pipeline**
- Sensor values simulated realistically
- AI system processes data independently
- UI reads from state, not sensors directly

### 5. **Retro-Terminal Aesthetic**
- CSS-based HUD (no canvas rendering for UI)
- Monospace fonts, grid backgrounds, glow effects
- High contrast & readability priority

---

## Technology Choices & Rationale

| Component | Technology | Why |
|-----------|-----------|-----|
| 3D Engine | THREE.js | Mature, WebGL abstraction, large community |
| Game Loop | RequestAnimationFrame | Hardware-optimized timing |
| State Mgmt | Custom (no Redux/Vuex) | Lightweight, clear data flow for small project |
| UI Framework | Vanilla HTML/CSS | Direct control, no bundle overhead |
| Build Tool | TBD | Depends on hosting/deployment needs |
| Version Control | Git | Standard workflow |

---

## Important Constraints & Notes

- **Performance Target:** 60 FPS on modern devices (desktop + mobile)
- **Accessibility:** High contrast terminal UI, keyboard-accessible controls
- **Browser Support:** Modern browsers (ES6+, WebGL)
- **No External UI Frameworks:** Keep it lightweight (HTML/CSS only)
- **Realistic Physics:** Gravity, collision detection (future)

---

## Iteration History

### Iteration 1 (2026-09-25) - Architecture & Setup
- ✅ Created claude.md with project guidelines
- ✅ Created comprehensive plan.md with full architecture
- ✅ Defined modular directory structure
- ✅ Established tech stack & design decisions
- ✅ Created project README with feature overview
- ✅ Set up package.json with dependencies

### Iteration 2 (2026-09-25) - Phase 1 Complete: Core Infrastructure
- ✅ Created fresh public/index.html with complete UI layout
- ✅ Implemented config.js with all game constants
- ✅ Built GameEngine.js with THREE.js scene management
- ✅ Implemented InputManager.js for keyboard/mouse input
- ✅ Implemented StateManager.js for global state & events
- ✅ Bootstrapped main.js with full game initialization
- ✅ Set up player controller with first-person camera
- ✅ Implemented sensor data simulation system
- ✅ Implemented hazard detection & alert system
- ✅ Implemented personnel vitals tracking
- ✅ Connected UI elements with live data binding

**Status:** ✅ Phase 1 COMPLETE - Core infrastructure working
- Walkable 3D environment with camera controls
- Real-time sensor data generation
- Hazard detection with UI alerts
- Personnel vitals monitoring
- Start screen → Game transition
- ⏭️ Phase 2

### Iteration 3 (2026-09-25) - Start Flow Bug Fixes
- ✅ ENTER MINE button fixed: page must be served over HTTP (module scripts are blocked on file://)
- ✅ Fallback click handler shows how to run the server when opened from file://
- ✅ `npm run dev` now serves project root (index.html imports ../src)
- ✅ Added `.claude/launch.json` preview config (python http.server :8000)
- ✅ GameEngine loop now calls render(); fixed shadow map type; guarded double start()
- ✅ main.js: imports THREE directly, subscribes via StateManager, uses real element IDs
- ✅ Methane now ramps over time so warning → critical alerts trigger during play
- ✅ Pointer-lock rejection handled silently

### Iteration 4 (2026-09-25) - Phase 2 Complete: Mine World, Sensors & Hazards
- ✅ MineLayout: 6 tunnel rects → walk grid; BFS path distance & routes
- ✅ MineGenerator: position-based noise displacement (seamless), procedural rock textures
- ✅ Lighting: headlamp, 11 flickering lamps that strobe red above 10k ppm
- ✅ HazardSystem: leak at (20,-17) starts 8 s in, ramps to 40k ppm over 60 s; gas spreads along tunnels
- ✅ Sensors: 8 nodes with LEDs, telemetry, 60 s history; nearest node drives sensor panel
- ✅ AILogic: GAS ACCUMULATION vs POSSIBLE SENSOR FAULT; EVACUATE on critical → nearest gas-free safe zone
- ✅ Player: collision with wall sliding, sprint (Shift), arrow-key turning, head bob
- ✅ UIManager + canvas minimap (gas overlay, sensor dots, dashed return route, heading arrow)
- ✅ Vitals driven by methane at player position (exposure is an accumulated dose)
- 🐛 Fixed inverted camera (initial lookAt left a 180° roll)
- Verified in browser: ~60 fps, no console errors, alert → critical → evacuate flow works
- ⏭️ Phase 3

### Iteration 5 (2026-09-25) - Phase 3 Complete: HUD & AR Layer
- ✅ CSS extracted to public/styles/hud.css; HUD markup rebuilt to match reference screenshots
- ✅ UIManager split into 6 panel modules + Compass, WorldLabels, ScreenFX
- ✅ New Objectives.js (nav + checklist) and EventLog.js (event feed)
- ✅ RouteGuide.js floor chevrons; routes now follow tunnel centrelines (clearance field) + string-pulling
- ✅ Sensors keep 60 s history for every metric; AI stage times are wall-clock (UTC)
- ✅ InputManager: pointer lock / drag-look only from the 3D canvas so HUD buttons are clickable
- Verified in browser: nominal → warning → critical → evacuate → "Personnel safe" flow, event log, alert chip, tablet layout, no console errors
- Note: the Browser pane throttles rAF/CSS animations while hidden — test with a visible pane
- ⏭️ Phase 4

### Iteration 6 (2026-09-25) - Phase 4 Complete: Game Loop, Scenarios, Audio
- ✅ Scenarios.js (3), scenario-driven HazardSystem with forecast + roof-fall collapse
- ✅ MineLayout: bypass rect, block(), Dijkstra costField/planRoute (fixed Float32 precision bug → Float64)
- ✅ AILogic rewrite: forecast-based zone rejection, weighted routes, structural advisories, "via" zones in trace
- ✅ Objectives follow AI plan; objective:updated re-route; evacZone names where P-01 is evacuating from
- ✅ RoofFall.js, Lighting lamp stutter/death, Sensors vibration precursor + offline nodes (07/08)
- ✅ AudioEngine.js fully synthesised; Scoring.js; Debrief.js; Menus.js; toasts
- ✅ tools/serve.py no-cache server (stale-module caching caused mixed old/new code in testing)
- Verified by autopilot: SCN-01 S (97), SCN-02 A (91), SCN-03 S (98); fail path F "overcome by methane"; pause/mute; no console errors
- ⏭️ Phase 5

### Iteration 7 (2026-09-25) - Phase 5: Operator Sandbox + Compact HUD
User feedback: "more like a game, not a simulation" and "information panels hide the simulation area".
- ❌ Removed game layer: Scenarios.js, Scoring.js, Debrief.js, RoofFall.js, Menus.js, fail states, grades
- ✅ HazardSystem rewritten around operator incidents (methane / water / fire), multiple concurrent, clearable
- ✅ SimConsole: 3 incident buttons (1/2/3), location via zone list, minimap click or crosshair aim (G), severity, pause (P), 1/2/4× speed, active list with per-incident clear, HUD hide (H)
- ✅ New visuals: WaterSurface, FireEffect (flames/light/smoke), PlacementMarker; smoke fog + lamp dimming
- ✅ Sensors now CH₄ / CO / Temp / Water with hysteresis; AI multi-hazard classification + ignition risk + fire suppression by flood
- ✅ HUD rebuilt compact: 244 px glass side columns, collapsible panels (remembered), one-line alert banner (E expands), centre view kept clear
- ✅ Vitals: O₂ / dose (CH₄ + CO) / heat; no incapacitation
- Verified: all three incidents concurrently, suppression, clear-all → stand-down, aim/map placement, pause/speed, collapse, H; no console errors
- ⏭️ Iteration 8

### Iteration 8 (2026-09-25) - Stop Control, Cleaner UI, Brighter Textured Mine
User feedback: "add a button to stop the casualties", "make the UI cleaner", "too dark", "add texture like the reference photos".
- ✅ STOP ALL tile in the console (key 0) ends every incident instantly; per-incident ✕ now stops immediately too; button disabled when idle
- ✅ HazardSystem: stop(id) / stopAll() replace gradual clear; EventLog + toast report operator stops
- ✅ Textures.js: Worley-slab fractured rock with sparse open joints, mottled grey/brown, rust; dirt floor with pebbles; wood grain; bark — all with normal maps
- ✅ MineGenerator: 2× mesh density + chip noise for jagged rock, vertical log lagging in Tunnel B / main shaft / bypass (rock displacement damped behind logs), ~700 loose stones along walls, 16 lamps with additive halos
- ✅ Lighting: ambient 0.95 neutral-warm, lamps 13 @ 26 m (decay 1.15), exposure 1.1, fog 14–95 m; player radius 0.55 so the camera never clips the logs
- ✅ UI: rounded glass panels (10 px), hairline borders, more padding, no film grain, lighter vignette, rounded console/buttons/chips
- Verified: STOP ALL / chip stop, AI stand-down, visuals at Tunnel B, main shaft and Junction A; no console errors
- ⏭️ Iteration 9

### Iteration 9 (2026-09-25) - Zig-Zag Sensor Network + Larger, Cleaner UI
User feedback: "sensor boxes in zig-zag — one in the middle, one at the ground", "UI cleaner, text bigger".
- ✅ 16 sensor nodes (was 8) laid out in a zig-zag: alternating walls and alternating AIR (1.55 m) / FLOOR (0.34 m) mounts, placed between timber sets
- ✅ New unit model: bracket, charcoal shell, ID/type plate, vent grille, LED + glow halo; air units have an antenna, floor units a water probe to the ground
- ✅ SensorNetwork: roof-run signal cables along each chain, data pulses flowing to the G-01 gateway, coloured/sped up by node status
- ✅ Floor units report SUBMERGED (blue LED, event log) when flood water covers them
- ✅ Minimap: air units = dots, floor units = squares; node counts dynamic (16/16)
- ✅ Readings no longer copied into global state every sample (perf with 16 nodes)
- ✅ UI: +25–40 % text size, 280 px columns, plain-word panel titles in the display font, status pills, lighter dividers
- Verified: layout from main shaft / Tunnel B, inspect tooltips, submerged events under high water, alert details legible; no console errors
- ⏭️ Iteration 10

### Iteration 10 (2026-09-25) - Arch-Mounted Air Units + Controller Support
User feedback (with screenshot): "air sensor box at the middle of the wooden arch (crosshair)", "floor boxes unchanged", "controllable by gamepad".
- ✅ Air units bolted to the front face of the cap beam at mid-span (y 3.5 m) on 6 timber arches, with straps and an underside gas inlet; Entry A / Chamber (no arch) hang from roof rods
- ✅ Floor units unchanged
- ✅ InputManager rewritten: Gamepad API polled on its own rAF loop (works on the start screen), dead-zoned + squared sticks, `pad:*` button events, LT/L3 sprint, rumble via vibrationActuator
- ✅ Bindings: L-stick move (analog), R-stick look, Y/X/B methane/water/fire (colour-matched), A place at aim / start, View stop all, Start pause, D-pad ◀▶ location, ▲ alert details, ▼ HUD, LB/RB severity, RT speed
- ✅ Haptics on inject / stop all / evacuation order / entering a hazard / safe air
- ✅ Hints swap between keyboard keys and controller glyphs based on the last device used; header shows ◉ CONTROLLER when connected
- Verified with a simulated gamepad: analog half-stick = half pace, all bindings, hint swap; no console errors
- ⏭️ Iteration 11

### Iteration 11 (2026-09-25) - Operations Dashboard
User choices: separate live-linked page · map + sensor grid/trends + incidents/AI + KPIs/reports · monitor only.
- ✅ DashboardLink (sim side): BroadcastChannel 'mine-sentinel'; snapshot per sensor sample (nodes, incidents, player/vitals, AI decision + trace, evac + route, per-cell hazard grid as bytes), events, 1 s heartbeat, full sync on 'hello'
- ✅ Detection time / evac time / per-incident peak / session peaks tracked in the simulator so a late-opened dashboard is still correct (bug found in testing: dashboard-side tracking credited pre-existing alarms to connect time)
- ✅ Full sync ships each node's 60 s history so trend charts are populated immediately
- ✅ Dashboard: KPI strip (active incidents, nodes alarming, peak CH₄/CO/water, mean detection time, personnel), live map, AI copilot, personnel & evacuation, 16 sensor tiles, 4 trend charts with hover, incident Gantt + table, filterable event log
- ✅ Link status: WAITING / LIVE / SIM PAUSED / SIM STALLED (background-tab freeze) / LINK LOST; reconnect by re-sending 'hello'
- ✅ Reports: ⤓ CSV (incidents + events) and ⎙ REPORT (print → save as PDF) with map snapshot
- ✅ Simulator header ▣ DASHBOARD ↗ opens it in a named window
- Verified with sim + dashboard in two tabs: live mirroring, detection numbers after late open, charts seeded, report build; no console errors
- ⏭️ Iteration 12

### Iteration 12 (2026-09-25) - Dashboard Light Theme
- ✅ dashboard.css rewritten for a light theme (white cards on #eef1ef, dark text, hairline borders, soft shadows); status colours darkened for contrast on white
- ✅ New `src/dashboard/theme.js` holds the canvas palette (map, trend charts, timeline, confidence bar) — keep it in sync with the CSS variables
- ✅ The simulator HUD stays dark (it overlays the 3D mine)
- ⏭️ Iteration 13

### Iteration 13 (2026-09-26) - Sensor-Ready Dashboard (USB hardware)
- ✅ Dashboard no longer mirrors the simulator: it reads a physical unit (PU-01) over USB serial (Web Serial API, Chrome/Edge)
- ✅ Real data: MQ-2/MQ-4 gas (raw ADC → CH₄ ppm via datasheet curve + clean-air R0 calibration) and DHT11/22 humidity/temperature
- ✅ Everything else is realistic simulation: air pressure (ventilation cycle), water level (sumps), and 15 more nodes whose gas/humidity follow the live unit with tunnel-distance lag
- ✅ Optional `pres` / `water` keys switch those readings to LIVE; badges show LIVE / DEMO / SIM / NO SIGNAL
- ✅ Demo feed (hardware-like JSON lines with periodic gas puffs) runs when no board is connected; auto-reconnects to previously allowed ports
- ✅ Serial console, packet rate/errors, NO SIGNAL after 3 s, calibration banner, settings dialog (baud, ADC, sensor, location, thresholds)
- ✅ Analysis card: slope, time-to-alarm (only for meaningful rises), %LEL, spread to neighbours, dew point
- ✅ Arduino sketch + wiring guide in `hardware/`
- ✅ Removed `src/data/DashboardLink.js` from the simulator (▣ DASHBOARD button still opens the page)
- Fixed in testing: North Drift humidity baseline sat above the warning level (permanent alarm); ppm curve blew up near ADC saturation (clamped at 100,000); threshold inputs rejected 5000 (min/step mismatch); calibration ran on demo data; settings dialog overflowed
- Verified: demo feed, gas puff → warning alarm → clear, spread on map, settings save, calibration guard, mobile layout, simulator still runs; no console errors. Web Serial itself not tested (no board attached)
- ⏭️ Iteration 14

### Iteration 14 (2026-09-26) - Real Data Only, Dry Mine, Gas-Coupled Pressure
- ✅ Demo feed removed (user saw serial lines with no board connected). With no board: NO BOARD pill, `—` gas and humidity gauges, empty console with a waiting hint, analysis "Waiting for sensor unit", chart gaps (null history) instead of stale values
- ✅ Water level is 0 cm on every floor node and on PU-01, unless the board sends `water`
- ✅ Pressure follows gas on each node: Δp = 7·(1 − e^(−excess/8000)) hPa with a ~3 s lag. That is about +3.6 hPa at 6,000 ppm and 'elevated' (>4 hPa) near the 10,000 ppm alarm; it returns to baseline as gas clears, and neighbours follow through their own spread gas
- Verified: no-board state, no console errors; model ramp test (20 → 12,000 → 20 ppm) showed pressure rising, flagging, and recovering
- ⏭️ Iteration 15

### Iteration 15 (2026-09-26) - USB Connection Hardening
- Diagnosis: Windows showed no USB-serial board (only Bluetooth COM5–COM10), so the picker offered only ports that never send data
- ✅ Port picker filtered to Arduino/CH340/CP210x/FTDI/Espressif USB IDs (Shift+click lists all); auto-connect skips non-USB ports
- ✅ 5 s open timeout; DTR/RTS released after open (ESP32 auto-reset); clear console/event messages for busy port, empty picker, timeouts
- ✅ Silence watchdog: connected but no lines for 6 s → hint about sketch/baud/port
- ✅ Troubleshooting table in hardware/README.md
- ⏭️ Iteration 16

### Iteration 16 (2026-09-26) - Methane → Carbon Monoxide
- ✅ The gas channel is now CO. MQ curves (CO): MQ-2 (default, strongest response), MQ-7 and MQ-9. The clean-air value is subtracted so fresh air reads 0 ppm and any rise is shown as CO. Clamped at 2,000 ppm (over range)
- ✅ Thresholds: 35 ppm warning, 100 ppm alarm. Analysis shows ppm/min, time to alarm (above 5 ppm/min), multiples of the 25 ppm 8-hour limit, % of IDLH (1,200 ppm), and CO-specific advice (fire, fumes, self-rescuers). The bar now shows % of the alarm level
- ✅ Network scaled for CO: 0.5–3.5 ppm background, spread from 3 ppm; pressure coupling scaled to the alarm level (about +4.5 hPa 'elevated' near 120 ppm); simulated temperature rises with CO
- ✅ Settings key moved to v2. The old methane thresholds, sensor model and R0 are dropped; baud, ADC, location and humidity/water thresholds are kept
- Verified: ramp 2 → 162 → 2 ppm gave normal → elevated → critical → back, pressure following, neighbours following; no console errors
- The 3D simulator's methane incident is unchanged (dashboard only)
- ⏭️ Iteration 17

### Iteration 17 (2026-09-26) - Works With the User's ESP32 + MQ-135 Sketch
- Diagnosis: the user's own sketch (Desktop/sketch_sep25a: ESP32, MQ-135 on GPIO34, DHT11 on GPIO4, LoRa) prints `gas_raw` / `humidity_pct` / `temperature_c` JSON plus debug text; every line was rejected, so nothing showed
- ✅ Tolerant parser: loose key matching (case, `_`, units), ignores thresholds/alerts/flags, embedded JSON (LoRa receiver lines), `Label: value` text, CSV; `*ppm` keys are used as-is; JSON wins over duplicate debug text; unknown JSON reports its keys
- ✅ Failed DHT reads (`dht_valid:false` or 0/0) are dropped instead of showing 0 %RH
- ✅ Accuracy: MQ-135 CO curve (new default); Rs/RL uses the real supply vs ADC reference (5 V module on a 3.3 V ESP32 ADC); 12-bit ADC is the default and is auto-detected when raw > 1023; uncalibrated sensors learn a clean-air baseline from the first 15 s (median), with gas shown as "learning" meanwhile; manual ◎ Calibrate also uses the median
- ✅ Settings v3 (gas model/ADC/R0 reset); new "Gas module supply" option
- Verified end-to-end with a simulated port replaying the sketch's exact output: humidity/temperature live immediately, baseline learned (raw 1400 → 0 ppm), raw 2480 → 98 ppm CO warning, pressure +3.9 hPa, spread to neighbours, 1 packet/s, 0 errors
- ⏭️ Iteration 18

### Iteration 18 (2026-09-26) - Connect/Disconnect Loop Fix
- Cause 1 (my bug): after opening the port, `setSignals` cleared DTR then RTS separately, which pulses EN on the ESP32 auto-reset circuit, so the board rebooted. Its 74880-baud boot log raised a FramingError, and the reader treated that as fatal: it reported "disconnected" but left the port open, so reconnecting then failed
- ✅ No DTR/RTS changes; the reader loop takes a fresh reader after non-fatal errors (framing/overrun/break) and only ends on a lost device; the port is always closed on exit; any stale open port is closed before reopening; manual TextDecoder instead of pipeTo; boot-noise bytes stripped
- ✅ Auto-reconnect when the board re-enumerates (native-USB boards and brown-outs), unless the user disconnected
- ✅ Board diagnoses from log lines: LoRa init failure (the user's sketch halts in `while(true)`), brown-out, ESP32 reboot, DHT failure; watchdog now keys on sensor readings, not any text
- ✅ `hardware/esp32_lora_node/esp32_lora_node.ino`: the user's sketch, but it keeps reporting over USB without LoRa (retries every 30 s), keeps the last good DHT values, averages 16 ADC samples, and sends `adc:4095`
- Verified with simulated ports: boot noise + FramingError → recovered and stayed LIVE; disconnect → reconnect clean; LoRa-halt line → critical event + watchdog; no console errors
- ⏭️ Iteration 19

### Iteration 19 (2026-09-26) - Server Serial Bridge
- Diagnosis on the machine: ESP32 present as `Silicon Labs CP210x (COM12)`, driver OK, but COM12 was locked by the user's browser (Web Serial session), and it couldn't be inspected from here
- ✅ `tools/serial_bridge.py` (standard library only, Win32 via ctypes): finds the board's COM port from the registry by USB VID, opens it with DTR/RTS de-asserted (no ESP32 reset), reads lines, reopens after unplug/busy, and holds the port only while a dashboard is listening
- ✅ `tools/serve.py` serves `/serial/status` and `/serial/stream` (Server-Sent Events); optional COM name argument, `MINE_SENTINEL_BAUD` env var
- ✅ Dashboard `BridgeSource` (EventSource) is used automatically when the server offers it; Web Serial "Connect USB" stays as the fallback; the button becomes "Release port" so the Arduino IDE can upload
- Verified: auto-detected COM12; the busy port is reported clearly in the console/events; no console errors. Live data is not yet verified because the user's Chrome still held COM12
- ⏭️ Iteration 20

### Iteration 20 (2026-09-26) - Root Cause on the Hardware
- The user serves the dashboard with VS Code Live Server (127.0.0.1:5500), so the serve.py bridge isn't used there; the dashboard falls back to Web Serial automatically. The preview-pane dashboard on :8001 was grabbing COM12 through the bridge, so the preview server was stopped
- Reset the ESP32 and captured its boot log on COM12: `Starting LoRa... ERROR: LoRa initialization failed!`. The user's sketch then halts in `while(true)` and never sends sensor data. This was the real cause all along
- `hardware/esp32_lora_node` compiles (ESP32 core 3.3.11). The upload failed twice (serial noise / "failed to communicate with the flash chip", likely the USB supply sagging under the MQ-135 heater + LoRa); a third attempt was blocked because the user's browser reopened COM12. **The ESP32 may not boot until a successful upload**
- ✅ Peak CO / Peak humidity KPIs now come from the real sensor (PU-01) only
- ⏭️ Iteration 21

### Iteration 21 (2026-09-26) - Sensor Signal-Loss Incident Popup
- ✅ `src/dashboard/LossAlert.js`: when the live unit is lost (USB unplugged/reset, or plugged in but silent for 3 s) a modal pops up showing the sensor number (PU-01 / node), zone, mount, depth, distance from Entry A, grid position, a zoomed live-map crop with a pulsing last-known-position marker, the last readings (CO, trend, humidity, temperature), a risk assessment (HIGH at alarm-level CO, ELEVATED if CO was elevated or rising, else UNKNOWN), neighbouring sensors on the same cable, and response steps
- ✅ Actions: Dispatch inspection team, Area checked · no casualties, Report casualties (count), Acknowledge. Each is logged to the event log (and to CSV / the report). A two-tone siren sounds until someone acknowledges or dispatches; a red banner stays until the area is confirmed; signal restore is shown but still requires confirmation
- ✅ The operator's own Disconnect / Release port is not an incident. The alert re-arms only after live data, so a silent board doesn't re-alarm in a loop; Esc = Acknowledge
- Verified on a bridge-free test server (so COM12 isn't touched): unplug → popup with ELEVATED risk; dispatch/ack/banner; restore → confirm; silent board → popup with UNKNOWN risk; casualty report logged; no console errors besides the expected /serial/status 404 on non-bridge servers
- ⏭️ **Next:** awaiting user direction (ESP32 still needs esp32_lora_node flashed to send data)

### Iteration 2 (Ready for)
- Create core GameEngine with THREE.js setup
- Implement InputManager for controls
- Build StateManager for game state
- Create basic mine environment generator
- Connect player movement system

---

## Performance Benchmarks

- **Target FPS:** 60fps stable
- **Initial Load:** <3 seconds (before THREE.js CDN optimization)
- **Memory:** <150MB on desktop
- **Mobile:** 30fps stable on mid-range devices

---

## Testing Strategy

- Unit tests: Core math, sensor simulation
- Integration tests: System communication
- Visual regression: HUD panel rendering
- Performance profiling: GPU utilization

---

## Possible Next Steps (awaiting user direction)

1. Ventilation doors / fans the operator can toggle to redirect gas and smoke
2. More incident types (roof fall, power failure, CO-only release) as extra console buttons
3. Multiple personnel (P-02..P-04) and a group evacuation view
4. Record & replay an incident timeline; export event log as CSV
5. Touch controls for tablets
