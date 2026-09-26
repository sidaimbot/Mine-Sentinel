# Mine Sentinel - Claude Development Guidelines

**Project:** Mine Sentinel - 3D Underground Mining Safety Simulator  
**Tech Stack:** THREE.js | HTML5 | ES6+ JavaScript  
**Last Updated:** 2026-09-25

---

## Project Context

Mine Sentinel is an immersive 3D safety monitoring system for underground mining operations. The application combines:
- Real-time 3D mine environment with first-person exploration
- Multi-panel HUD displaying sensor telemetry, hazard alerts, and evacuation routes
- AI-driven environmental monitoring system
- Retro-terminal aesthetic with glowing neon elements

See `plan.md` for full architecture and feature roadmap.

---

## Development Standards

### Code Organization
- **Modular design:** Each system is independent and communicates via StateManager
- **One responsibility per class:** GameEngine handles rendering, InputManager handles input, etc.
- **No nested callbacks:** Use event emitters and observers
- **Clear file purposes:** Filename matches functionality

### Naming Conventions
- **Classes:** PascalCase (`MineGenerator`, `HazardSystem`)
- **Functions:** camelCase (`updateSensorData`, `renderHUD`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_METHANE_PPM`, `GRID_SIZE`)
- **Private fields:** Prefix with `#` (ES2022 style)
- **Event names:** PascalCase with 'Event' suffix (`SensorUpdateEvent`, `HazardAlertEvent`)

### Comments & Documentation
- No comments for obvious code (good names speak for themselves)
- Add comments for:
  - **WHY** a complex algorithm exists (not WHAT it does)
  - Performance-critical sections or workarounds
  - Non-obvious game mechanics
  - Example: `// THREE.js requires position update before geometry update for correct shadows`
- JSDoc only for public APIs

### CSS & Styling
- All styles currently inline in HTML (can extract to `styles/main.css` later)
- Use CSS variables for theme colors (already established: `#d2d39b`, `#77d46d`, etc.)
- Mobile-first responsive design
- No framework dependencies (vanilla CSS Grid/Flexbox)

---

## Game Development Practices

### State Management
- **Single source of truth:** StateManager holds all game state
- **No direct mutations:** Use setState() for updates
- **Event-driven updates:** Subscribers listen for state changes
- **Immutable patterns preferred:** Return new objects rather than mutate

### Performance Priorities
1. Maintain 60fps on desktop, 30fps on mobile
2. Minimize memory allocations in game loop
3. Reuse geometries/materials (THREE.js best practices)
4. Lazy-load assets where possible
5. Profile before optimizing

### 3D Scene Management
- Use THREE.js best practices (OrthographicCamera for UI, PerspectiveCamera for world)
- Keep scene graph shallow (avoid unnecessary parent-child nesting)
- Frustum culling for large environments
- LOD (Level of Detail) for distant objects (future optimization)

---

## Workflow & Git

### Commits
- **One logical change per commit** (not per file)
- **Clear messages:** "Add gas particle effect system" not "update files"
- **Include attribution:** `Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>`
- Example: 
  ```
  Implement sensor data simulation system
  
  - Add realistic sensor value generation with gradual changes
  - Implement gas accumulation algorithm
  - Create sensor update event broadcasting
  
  Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
  ```

### Branches
- Feature branches: `feature/sensor-system`, `feature/evacuation-ui`
- Bug fixes: `fix/camera-clipping`
- Never force-push to main

### Testing & Verification
- Test in browser before committing
- Check console for errors/warnings
- Verify UI responsiveness (desktop + mobile viewport sizes)
- Test on actual devices if possible

---

## Project Structure Notes

```
src/
  core/       → Engine, input, state management (no game logic)
  world/      → Environment generation, lighting, particles
  gameplay/   → Player, sensors, hazards, objectives
  ui/         → HUD panels, gauges, animations
  data/       → Simulation data, AI logic, event logging
  utils/      → Math helpers, vectors, time utilities
```

Each folder is self-contained. Cross-folder imports are OK, but avoid circular dependencies.

---

## Common Tasks & Patterns

### Adding a New Sensor Reading
1. Define sensor in `config.js` (name, range, unit)
2. Add generation logic in `SensorData.js`
3. Connect to HUD in `SensorPanel.js`
4. Test with console output

### Creating a Hazard Event
1. Define hazard type in `config.js`
2. Add detection logic in `HazardSystem.js`
3. Emit event via StateManager
4. Handle in `HazardPanel.js` for UI display

### Updating Player Position on Map
1. Player position updates in `Player.js`
2. StateManager broadcasts `PlayerMoveEvent`
3. `MapPanel.js` listens and updates visual position

---

## Local Dev Server

- Use `python tools/serve.py <port>` (or `npm run dev`). It sends `Cache-Control: no-store`.
- Plain `python -m http.server` lets browsers cache ES modules heuristically, so edited modules can silently
  fail to reload (mixed old/new code). If that happens, switch port to get a fresh cache.
- The Claude preview (`.claude/launch.json`) runs the no-cache server on port 8001.

## Browser Compatibility

- **Target:** Modern browsers (2022+)
- **Minimum:** ES6, WebGL 1.0 (THREE.js r128+)
- **No IE support**
- Test on Chrome, Firefox, Safari (desktop + mobile)

---

## Performance Budgets

- **Initial load:** <3 seconds (THREE.js CDN + scene init)
- **HUD update:** <16ms per frame (60fps target)
- **Physics step:** <8ms per frame
- **Memory:** <150MB peak on desktop

---

## Debugging Tips

### Common Issues & Fixes

**3D objects not visible:**
- Check camera far plane distance (default 1000)
- Verify object position relative to camera
- Check material color (might be black on black background)
- Enable wireframe: `material.wireframe = true`

**Input not working:**
- Verify event listeners attached in InputManager
- Check that focus is on window (not iframe)
- Console should show key/mouse events

**HUD not updating:**
- Verify StateManager event is emitted
- Check UIManager is subscribed to event
- Look for JavaScript errors in console

**Low FPS:**
- Open DevTools → Performance tab
- Check for long rendering times
- Look for garbage collection pauses
- Profile with THREE.js stats.js

---

## Documentation & References

- THREE.js Docs: https://threejs.org/docs/
- Game Loop Patterns: Understand requestAnimationFrame timing
- State Management: Observer pattern for decoupled communication
- WebGL Limits: Know your browser/GPU constraints

---

## Final Notes

- **Stay creative:** The architecture supports experimentation
- **Iterate quickly:** Build features, test, refine
- **Keep it lightweight:** No build tool overhead, direct module imports
- **Performance matters:** A slow game isn't fun, profile early
- **Update plan.md:** After each iteration, reflect changes in the plan
