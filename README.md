# Mine Sentinel 🛑

**An immersive 3D underground mining safety monitoring system with real-time environmental hazard detection and AI-driven decision support.**

## 🎮 Features

- **3D Mine Exploration** — Fully navigable underground environment with realistic cave geometry
- **Real-Time Monitoring** — Multi-panel HUD displaying sensor telemetry in real-time
- **Incident Simulator** — inject methane, water logging and fire anywhere, at any severity
- **Personnel Safety Tracking** — Oxygen, gas dose and heat at the operator's position
- **Evacuation Guidance** — Dynamic route calculation with distance-to-safety display
- **Sensor Network** — 8-node sensor array with live data synchronization
- **Retro-Terminal Aesthetic** — Immersive sci-fi UI with glowing neon elements

## 🚀 Quick Start

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari)
- No build tools or dependencies required

### Running
ES modules don't load from `file://`, so double-clicking `index.html` will not work. Serve the project root:
```bash
npm run dev
# or, with no Node: python tools/serve.py 8000   (no-cache, so edits always reload)
```
Then open http://localhost:8000/public/

### Usage
1. Click `[ ENTER MINE ]` — you start in Tunnel B.
2. **Move:** `WASD` / arrows · `Shift` sprint · click to lock the mouse (or drag to look).
3. **Inject incidents** from the **Simulation Control** console at the bottom:
   - `1` ◆ **Methane rising** · `2` ▼ **Water logging** · `3` ▲ **Fire alert**
   - **Location:** pick a zone, **click the minimap**, or press `G` to place it where you are aiming (a ring marks the spot)
   - **Severity:** LOW / MED / HIGH · run several incidents at once
   - **Stop:** `0` / **■ STOP ALL** ends every incident instantly · `✕` on an incident chip stops just that one
4. **Simulation:** `P` pause (you can still walk around) · 1× / 2× / 4× speed
5. **HUD:** click any panel header to collapse it · `H` hides all panels · `E` expands the alert banner (pipeline + event log) · aim at a sensor to inspect it · `M` mute

### 📊 Sensor operations dashboard
Open `http://localhost:8000/public/dashboard.html` in **Chrome or Edge** (or click **▣ DASHBOARD ↗** in the simulator).
It is built for a physical sensor unit (**PU-01**) connected by USB:
- **Live:** carbon monoxide (MQ-2 / MQ-7 / MQ-9) and humidity (DHT11 / DHT22)
- **Simulated but realistic:** air pressure (rises as CO builds up), water level (0 cm, dry) and the other 15 nodes of the mine network, which react to the live readings

Click **⏚ Connect USB** to pick the board. Without a board, gas and humidity show **NO BOARD** and the serial console stays empty; there is no fake feed.
**◎ Calibrate** sets the gas sensor's clean-air reference. **⚙ Settings** covers baud rate, ADC, sensor model, the unit's location and alarm thresholds.
**⤓ CSV** exports raw and ppm samples, alarms and events. **⎙ Report** opens a printable report.
Wiring, the Arduino sketch and the serial line format are in [`hardware/README.md`](hardware/README.md).

### 🎮 Controller
Any standard gamepad (Xbox / PlayStation / generic) works — plug it in and press a button.

| Control | Action |
|---|---|
| Left stick / Right stick | Move (analog) / Look |
| **Y** / **X** / **B** | Methane / Water / Fire (button colours match) |
| **A** | Place incident at aim · start from the title screen |
| **View / Back** | Stop all incidents |
| **Start / Menu** | Pause / resume simulation |
| D-pad ◀ ▶ | Cycle incident location |
| D-pad ▲ / ▼ | Alert details / hide HUD |
| LB / RB | Severity down / up |
| RT | Sim speed 1× → 2× → 4× |
| LT or L3 | Sprint |

The controller rumbles on incidents, stop-all, evacuation orders and when you walk into a hazard. On-screen hints switch to controller buttons automatically.

The sensor network: 16 units in a zig-zag along every tunnel — **air units** bolted to the middle of the timber arches (gas, CO, heat) and **floor units** at the ground with a water probe. Cables along the roof carry data pulses back to the G-01 gateway at Entry A; pulses turn yellow/red and speed up when a node alarms. Floor units keep reporting when submerged.

Things to try: start a fire and flood the same spot (the water puts it out), or put methane next to a fire (the AI raises an ignition-risk warning).

## 📁 Project Structure

```
codiotex/
├── hardware/               # Arduino/ESP32 sketch + wiring guide for the USB sensor unit
├── public/
│   ├── index.html          # Simulator
│   └── dashboard.html      # Sensor operations dashboard
├── src/
│   ├── main.js             # Application bootstrap
│   ├── config.js           # Game constants
│   ├── core/               # Engine & systems
│   ├── world/              # Environment generation
│   ├── gameplay/           # Game mechanics
│   ├── ui/                 # HUD & interface
│   ├── data/               # Simulation data & AI
│   └── utils/              # Helper functions
├── claude.md               # Development guidelines
├── plan.md                 # Project architecture & roadmap
└── README.md               # This file
```

## 🎯 What It Simulates

- How each hazard spreads through the tunnels (by path distance, not straight lines)
- How the sensor network sees it (CH₄, CO, temperature, water level)
- How the AI copilot classifies it, forecasts 30 s ahead and routes personnel to the safest zone

## 🛠️ Development

See `claude.md` for:
- Code standards and naming conventions
- Architecture patterns and best practices
- Debugging tips and common issues
- Git workflow and commit guidelines

See `plan.md` for:
- Detailed feature roadmap
- Technology stack rationale
- Performance targets and budgets
- Testing strategy

### Running Locally
```bash
# No build step needed — works directly in browser
# For development, use a simple HTTP server:

# Python 3
python -m http.server 8000

# Node.js
npx http-server

# Then visit http://localhost:8000/public/
```

## 📊 HUD Panels Explained

### Spatial Overview
Minimap showing your position, sensor nodes, hazard zones, and safe routes.

### Hazard Panel
Critical alerts with gas concentration readings and AI recommendations.

### Personnel Safety
Real-time vital signs gauges:
- **Oxygen** — Atmospheric oxygen concentration
- **Exposure** — Hazardous gas exposure level
- **Structural Risk** — Tunnel collapse/rockfall risk

### Sensor Matrix
Live telemetry from current sensor node:
- Methane (CH₄) concentration in PPM
- Temperature in °C
- Vibration index (0-100)
- Humidity percentage
- Battery status

### Evacuation Procedure
Current safe route with:
- Distance to nearest safe zone
- Step-by-step checklist
- Route name and waypoints

### AI Decision Trace
Real-time AI reasoning pipeline showing:
- Current detected conditions
- AI classification of threat
- Recommended response action

## 🎨 Visual Design

- **Color Scheme:** Dark theme with neon accents (gold, green, red)
- **Typography:** Monospace terminal aesthetic (Courier New)
- **Effects:** Glow, scan lines, grid overlays
- **Responsive:** Works on desktop, tablet, and mobile

## 📈 Performance

- **Target:** 60 FPS on desktop, 30 FPS on mobile
- **Memory:** <150MB peak usage
- **Load Time:** <3 seconds
- **GPU:** Supports mid-range and modern GPUs

## 🐛 Known Limitations

- Initial load depends on THREE.js CDN availability
- Mobile: Some HUD panels hidden for screen space
- Large mines may impact performance on older devices

## 🤝 Contributing

When contributing new features:
1. Read `claude.md` development standards
2. Follow the modular architecture in `plan.md`
3. Keep commits focused and well-documented
4. Test in browser before submitting changes

## 📝 License

Educational / Portfolio project — Free to use and modify.

## 🎓 Learning Value

Mine Sentinel demonstrates:
- THREE.js 3D graphics programming
- Game loop architecture and state management
- Real-time data visualization (HUD/dashboard patterns)
- Event-driven system design
- Responsive UI design
- Performance optimization techniques

## 🔗 Resources

- **THREE.js:** https://threejs.org/
- **WebGL:** https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
- **Game Development:** Understanding game loops, state management, and component patterns

---

**Made with ⚒️ by Claude | Active Development**
