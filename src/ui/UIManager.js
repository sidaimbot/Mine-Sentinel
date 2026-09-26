import { MapPanel } from './panels/MapPanel.js';
import { AlertPanel } from './panels/AlertPanel.js';
import { VitalsPanel } from './panels/VitalsPanel.js';
import { SensorPanel } from './panels/SensorPanel.js';
import { EvacPanel } from './panels/EvacPanel.js';
import { AITracePanel } from './panels/AITracePanel.js';
import { Compass, bearing, headingFromYaw } from './Compass.js';
import { WorldLabels } from './WorldLabels.js';
import { ScreenFX } from './ScreenFX.js';
import { INCIDENT_TYPES } from '../gameplay/HazardSystem.js';

const $ = (id) => document.getElementById(id);
const ROUTE_LOOKAHEAD = 6;
const COLLAPSE_KEY = 'mineSentinel.collapsed';
const TYPE_COLOR = { methane: '#e9c44c', water: '#4fb3d9', fire: '#ff6a2a' };
const titleCase = (t) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export class UIManager {
  constructor({ layout, hazard, sensors, state, objectives, eventLog, camera, ai, fog, onMapPick }) {
    this.hazard = hazard;
    this.ai = ai;
    this.sensors = sensors;
    this.state = state;
    this.objectives = objectives;

    this.map = new MapPanel($('minimap'), layout, hazard, sensors, onMapPick);
    this.alert = new AlertPanel(eventLog, state);
    this.vitals = new VitalsPanel();
    this.sensorPanel = new SensorPanel();
    this.evac = new EvacPanel();
    this.aiTrace = new AITracePanel($('aiTrace'));
    this.compass = new Compass($('compass'));
    this.labels = new WorldLabels(camera);
    this.fx = new ScreenFX(fog);
    this.bindCollapsing();

    state.subscribe('sensors:sampled', () => {
      this.sensorPanel.render(this.sensors.getNode(this.state.getState().sensors.active));
      this.map.renderHazards();
      this.aiTrace.render(this.ai.trace);
    });
    state.subscribe('ai:decision', (d) => this.alert.update(d));
    state.subscribe('ai:cleared', () => this.alert.update(null));
    state.subscribe('objective:updated', ({ to }) => {
      this.toast('OBJECTIVE UPDATED', `Re-route to ${titleCase(to.label)}`);
      $('evacPanel').animate(
        [{ boxShadow: '0 0 0 1px #e9c44c, 0 0 30px rgba(233,196,76,0.5)' }, { boxShadow: '0 0 0 0 transparent' }],
        { duration: 1600, easing: 'ease-out' }
      );
    });
    state.subscribe('incident:started', (inc) => this.toast(`INJECTED · ${inc.severity.toUpperCase()}`, `${INCIDENT_TYPES[inc.type].label} @ ${titleCase(inc.label)}`, 'op'));
    state.subscribe('incidents:stopped', ({ count }) => this.toast('ALL INCIDENTS STOPPED', `${count} incident${count > 1 ? 's' : ''} ended by operator`, 'ok'));
    state.subscribe('incident:suppressed', (inc) => this.toast('FIRE SUPPRESSED', `Flood water at ${titleCase(inc.label)}`, 'ok'));
    state.subscribe('objective:started', ({ target }) => this.toast('EVACUATION ORDER', `Proceed to ${titleCase(target.label)}`, 'crit'));
    state.subscribe('objective:complete', () => this.toast('SAFE AIR CONFIRMED', 'P-01 accounted for', 'ok'));

    this.alert.update(null);
    this.aiTrace.render(this.ai.trace);
  }

  bindCollapsing() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY)) ?? {}; } catch { /* storage may be blocked */ }
    for (const panel of document.querySelectorAll('.hud-panel[data-panel]')) {
      const id = panel.dataset.panel;
      panel.classList.toggle('collapsed', !!saved[id]);
      panel.querySelector('.panel-head').addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        saved[id] = panel.classList.contains('collapsed');
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(saved)); } catch { /* storage may be blocked */ }
        if (id === 'map' && !saved[id]) this.map.resize();
      });
    }
  }

  toast(kicker, text, level = '') {
    const el = $('toast');
    el.className = level;
    el.innerHTML = `<div class="t-kicker">${kicker}</div><div class="t-main">${text}</div>`;
    // Restart the CSS animation even when toasts arrive back to back.
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  setPlacement(loc) {
    this.map.placement = loc;
  }

  update(dt, player) {
    const { objectives, hazard } = this;
    const pos = player.position;

    this.map.draw(dt, player, objectives.evacuating ? objectives.route : []);
    this.evac.render(objectives);
    this.labels.update(objectives, hazard, this.sensors, pos);
    this.fx.update(dt, hazard.dangerAt(pos.x, pos.z), hazard.smokeAt(pos.x, pos.z));

    const markers = [];
    const route = objectives.route;
    if (objectives.evacuating && route.length > 1) {
      const wp = route[Math.min(ROUTE_LOOKAHEAD, route.length - 1)];
      markers.push({ bearing: bearing(wp.x - pos.x, wp.z - pos.z), color: '#e9c44c', shape: 'diamond' });
    }
    for (const inc of hazard.incidents) {
      markers.push({ bearing: bearing(inc.source.x - pos.x, inc.source.z - pos.z), color: TYPE_COLOR[inc.type], shape: 'triangle' });
    }
    this.compass.draw(headingFromYaw(player.heading), markers);
  }

  renderVitals(vitals) {
    this.vitals.render(vitals);
  }
}

export default UIManager;
