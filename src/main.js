import * as THREE from 'three';
import GameEngine from './core/GameEngine.js';
import InputManager from './core/InputManager.js';
import StateManager from './core/StateManager.js';
import CONFIG from './config.js';
import { MineLayout } from './world/MineLayout.js';
import { MineGenerator } from './world/MineGenerator.js';
import { Lighting } from './world/Lighting.js';
import { GasParticles } from './world/GasParticles.js';
import { WaterSurface } from './world/WaterSurface.js';
import { FireEffects } from './world/FireEffect.js';
import { RouteGuide } from './world/RouteGuide.js';
import { PlacementMarker } from './world/PlacementMarker.js';
import { SensorNetwork } from './world/SensorNetwork.js';
import { HazardSystem } from './gameplay/HazardSystem.js';
import { Sensors } from './gameplay/Sensors.js';
import { Player } from './gameplay/Player.js';
import { Objectives } from './gameplay/Objectives.js';
import { AILogic } from './data/AILogic.js';
import { EventLog } from './data/EventLog.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { UIManager } from './ui/UIManager.js';
import { SimConsole } from './ui/SimConsole.js';

const $ = (id) => document.getElementById(id);
const AIM_RANGE = 40;

const game = (window.MINE_GAME = {
  isInitialized: false,
  started: false,
  sim: { paused: false, speed: 1, time: 0 },
});

function init() {
  try {
    game.engine = new GameEngine($('gameContainer'));
    game.input = new InputManager();
    game.state = new StateManager();
    game.audio = new AudioEngine();

    if (CONFIG.DEBUG.SHOW_AXES) game.engine.addObject(new THREE.AxesHelper(5));

    game.layout = new MineLayout();
    const mine = new MineGenerator(game.layout);
    game.engine.addObject(mine.generate());
    game.lighting = new Lighting(game.engine.scene, game.engine.camera, mine.lamps);
    game.hazard = new HazardSystem(game.layout, game.state);

    const { SPAWN, HEIGHT } = CONFIG.PLAYER;
    game.engine.camera.position.set(SPAWN.x, HEIGHT, SPAWN.z);
    game.engine.camera.rotation.set(0, SPAWN.yaw, 0, 'YXZ');
    game.engine.render();

    $('enterMineBtn').addEventListener('click', startSim);
    // A named window so repeated clicks focus the same dashboard instead of stacking tabs.
    $('btnDashboard').addEventListener('click', () => window.open('dashboard.html', 'mine-sentinel-dashboard'));
    bindGlobalKeys();
    updateClock();
    setInterval(updateClock, 1000);
    renderAudioState();

    game.isInitialized = true;
  } catch (error) {
    handleError('Initialization failed', error);
  }
}

function bindGlobalKeys() {
  window.addEventListener('inputKeyDown', ({ detail: { key } }) => {
    if (key === 'm') {
      game.audio.setMuted(!game.audio.muted);
      renderAudioState();
    }
    if ((key === 'enter' || key === 'pad:a' || key === 'pad:start') && !game.started) {
      startSim();
      return;
    }
    if ((key === 'p' || key === 'pad:start') && game.started) togglePause();
  });

  window.addEventListener('padConnected', ({ detail }) => {
    document.body.classList.add('pad-connected');
    $('padState').title = detail.id;
    game.ui?.toast('CONTROLLER CONNECTED', 'Left stick move · right stick look', 'ok');
    game.input.rumble(180, 0.3, 0.6);
  });
  window.addEventListener('padDisconnected', () => {
    document.body.classList.remove('pad-connected', 'pad-active');
    game.ui?.toast('CONTROLLER DISCONNECTED', 'Keyboard and mouse active');
  });
}

function renderAudioState() {
  const el = $('audioState');
  el.innerHTML = `♪ ${game.audio.muted ? 'OFF' : 'ON'} <kbd>M</kbd>`;
  el.classList.toggle('muted', game.audio.muted);
}

function startSim() {
  if (game.started) return;
  game.started = true;

  try {
    const { engine, layout, state, input, hazard } = game;
    const scene = engine.scene;

    game.audio.start();
    document.body.classList.add('hud-active');
    state.startGame();
    state.showHUD();
    state.setState({ vitals: { oxygen: 99, exposure: 0, heat: CONFIG.SENSORS.TEMPERATURE.AMBIENT } });

    game.gas = new GasParticles(scene, layout, hazard);
    game.water = new WaterSurface(scene, layout, hazard);
    game.fires = new FireEffects(scene, layout, state);
    game.sensors = new Sensors(scene, layout, hazard, state);
    game.network = new SensorNetwork(scene, layout, game.sensors);
    game.player = new Player(engine.camera, input, layout, state, hazard);
    game.ai = new AILogic(layout, hazard, state);
    game.objectives = new Objectives(layout, hazard, state, game.ai);
    game.eventLog = new EventLog(state);
    game.routeGuide = new RouteGuide(scene);
    game.marker = new PlacementMarker(scene);

    // HUD must be visible before UIManager measures the minimap canvas.
    game.ui = new UIManager({
      layout, state, hazard,
      sensors: game.sensors,
      objectives: game.objectives,
      eventLog: game.eventLog,
      camera: engine.camera,
      ai: game.ai,
      fog: scene.fog,
      onMapPick: (p) => game.console.pickPoint(p, 'MAP'),
    });
    game.console = new SimConsole({
      hazard,
      marker: game.marker,
      zoneAt: (x, z) => game.ai.zoneAt(x, z),
      getAimPoint,
      onPause: togglePause,
      onSpeed: setSpeed,
    });

    state.subscribe('player:step', ({ sprint, depth }) => game.audio.step(sprint, depth));

    // Controller haptics: short tick on operator actions, heavier pulses for evacuation and danger.
    const rumble = (...args) => game.input.rumble(...args);
    state.subscribe('incident:started', () => rumble(120, 0.25, 0.6));
    state.subscribe('incidents:stopped', () => rumble(220, 0.6, 0.3));
    state.subscribe('objective:started', () => rumble(500, 0.9, 0.7));
    state.subscribe('player:hazardZone', ({ inHazard }) => inHazard && rumble(300, 0.7, 0.3));
    state.subscribe('objective:complete', () => rumble(160, 0.2, 0.5));
    state.subscribe('events:updated', ({ entries }) => {
      const level = entries[0]?.level;
      if (level && level !== 'info') game.audio.blip(level === 'op' ? 'ui' : level);
    });

    window.addEventListener('engineFrame', (event) => tick(Math.min(event.detail.deltaTime, 0.1)));
    engine.start();
  } catch (error) {
    handleError('Failed to start simulator', error);
  }
}

// Point on the floor under the crosshair, or the far end of the tunnel ahead when looking level.
function getAimPoint() {
  const cam = game.engine.camera;
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const { layout } = game;

  if (dir.y < -0.05) {
    const t = -cam.position.y / dir.y;
    const p = { x: cam.position.x + dir.x * t, z: cam.position.z + dir.z * t };
    if (t < AIM_RANGE && layout.canOccupy(p.x, p.z, 0.3)) return p;
  }
  const flat = new THREE.Vector2(dir.x, dir.z).normalize();
  let last = null;
  for (let d = 1; d < AIM_RANGE; d += 0.5) {
    const p = { x: cam.position.x + flat.x * d, z: cam.position.z + flat.y * d };
    if (!layout.canOccupy(p.x, p.z, 0.3)) break;
    last = p;
  }
  return last;
}

function togglePause() {
  game.sim.paused = !game.sim.paused;
  game.console.setPaused(game.sim.paused, game.sim.speed);
}

function setSpeed(speed) {
  game.sim.speed = speed;
  game.console.setPaused(game.sim.paused, speed);
}

let vitalsTimer = 0;

function tick(dt) {
  const { hazard, lighting, gas, water, fires, sensors, player, objectives, routeGuide, ui, ai, audio, sim } = game;
  const simDt = sim.paused ? 0 : dt * sim.speed;
  const pos = player.position;

  hazard.update(simDt);
  player.update(dt);
  sensors.update(simDt, dt, pos);
  objectives.update(dt, pos);
  lighting.update(dt, hazard);
  gas.update(simDt);
  water.update(dt);
  fires.update(simDt);
  routeGuide.update(dt, objectives.route, objectives.evacuating);
  game.network.update(dt);
  game.console.update(dt);
  ui.setPlacement(game.console.location);
  ui.update(dt, player);

  sim.time += simDt;
  const mins = Math.floor(sim.time / 60), secs = Math.floor(sim.time % 60);
  $('simClock').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  let fire = 0;
  for (const inc of hazard.incidents) {
    if (inc.type === 'fire') fire = Math.max(fire, inc.level * Math.exp(-Math.hypot(inc.source.x - pos.x, inc.source.z - pos.z) / 12));
  }
  const depth = hazard.waterDepthAt(pos.x, pos.z);
  const nearWater = hazard.incidents.some((i) => i.type === 'water' && Math.hypot(i.source.x - pos.x, i.source.z - pos.z) < 25);
  audio.update(dt, {
    ppm: hazard.methaneAt(pos.x, pos.z),
    exposure: game.state.getState().vitals.exposure,
    alarm: ai.decision?.level === 'critical',
    fire,
    water: Math.min(1, depth * 2 + (nearWater ? 0.3 : 0)),
  });

  vitalsTimer += dt;
  if (vitalsTimer >= 0.5) {
    updateVitals(vitalsTimer * (sim.paused ? 0 : sim.speed));
    vitalsTimer = 0;
  }
}

function updateVitals(simDt) {
  const { state, hazard, player, ui } = game;
  const { x, z } = player.position;
  const { vitals } = state.getState();
  const ppm = hazard.methaneAt(x, z);
  const co = hazard.coAt(x, z);

  // Methane displaces air and fire smoke consumes it; dose accumulates from CH₄ above 5,000 ppm and CO above 35 ppm.
  const oxygen = Math.max(0, 100 - Math.max(0, ppm - 2000) / 2000 - hazard.smokeAt(x, z) * 14);
  const doseRate = (ppm > 5000 ? ((ppm - 5000) / 10000) * 4 : 0) + (co > 35 ? ((co - 35) / 100) * 0.8 : 0);
  const exposure = Math.min(100, Math.max(0, vitals.exposure + (doseRate > 0 ? doseRate : -1.5) * simDt));

  state.setState({ vitals: { oxygen, exposure, heat: hazard.temperatureAt(x, z) } });
  ui.renderVitals(state.getState().vitals);
}

function updateClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  $('clock').textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
}

function handleError(title, error) {
  console.error(title, error);
  const errorElement = $('startupError');
  errorElement.style.display = 'block';
  errorElement.textContent = `${title}: ${error.message}`;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
