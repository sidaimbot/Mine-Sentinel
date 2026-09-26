import { INCIDENT_TYPES } from '../gameplay/HazardSystem.js';
import { METRICS } from '../gameplay/Sensors.js';
import { SENSOR_NODES } from '../world/MineLayout.js';

const MAX_ENTRIES = 80;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const METRIC_LABEL = { methane: 'CH₄', co: 'CO', temperature: 'Temp', water: 'Water' };
const METRIC_VALUE = {
  methane: (r) => `${fmt(r.methane)} ppm`,
  co: (r) => `${Math.round(r.co)} ppm`,
  temperature: (r) => `${Math.round(r.temperature)} °C`,
  water: (r) => `${Math.round(r.water)} cm`,
};

export class EventLog {
  constructor(state) {
    this.state = state;
    this.entries = [];
    this.levels = {};
    this.stagesLogged = { sensor: false, classified: false, response: false };
    this.ignitionLogged = false;

    this.add('info', `Monitoring session started · ${SENSOR_NODES.length} nodes online`);

    const where = (inc) => `${inc.label} · ${inc.severity.toUpperCase()}`;
    state.subscribe('incident:started', (inc) => this.add('op', `OPERATOR: ${INCIDENT_TYPES[inc.type].label} @ ${where(inc)}`));
    state.subscribe('incident:suppressed', (inc) => this.add('ok', `Fire @ ${inc.label} suppressed by flood water`));
    state.subscribe('incident:ended', (inc) => this.add(inc.stopped ? 'op' : 'ok',
      inc.stopped ? `OPERATOR: stopped ${INCIDENT_TYPES[inc.type].short} @ ${inc.label}` : `${INCIDENT_TYPES[inc.type].short} @ ${inc.label} dissipated`));
    state.subscribe('incidents:stopped', ({ count }) => this.add('op', `OPERATOR: STOP ALL · ${count} incident${count > 1 ? 's' : ''} ended`));

    state.subscribe('sensors:sampled', ({ nodes }) => {
      for (const node of nodes) {
        for (const m of METRICS) {
          const key = `${node.id}:${m}`;
          const level = node.reading.levels[m];
          const prev = this.levels[key] ?? 'normal';
          if (level === prev) continue;
          this.levels[key] = level;
          const text = `${node.id} ${METRIC_LABEL[m]} ${level === 'normal' ? 'back to normal' : `${level} · ${METRIC_VALUE[m](node.reading)}`}`;
          this.add(level === 'critical' ? 'crit' : level === 'elevated' ? 'warn' : 'ok', text);
        }
      }
    });

    state.subscribe('ai:decision', (d) => {
      if (d.stages.sensor && !this.stagesLogged.sensor) {
        this.stagesLogged.sensor = true;
        this.add('warn', `Sensor ${d.nodeId} threshold crossed`, d.stages.sensor);
      }
      if (d.stages.classified && !this.stagesLogged.classified) {
        this.stagesLogged.classified = true;
        this.add('warn', `AI classified: ${d.classification.toLowerCase()} (${Math.round(d.confidence * 100)}%)`, d.stages.classified);
      }
      if (d.stages.response && !this.stagesLogged.response) {
        this.stagesLogged.response = true;
        this.add('crit', `Evacuation issued → ${d.target.label}`, d.stages.response);
      }
      const ignition = d.alerts.find((a) => a.type === 'ignition');
      if (ignition && !this.ignitionLogged) this.add('crit', `IGNITION RISK at ${ignition.nodeId} · methane near heat source`);
      this.ignitionLogged = !!ignition;
    });

    state.subscribe('ai:cleared', () => {
      this.stagesLogged = { sensor: false, classified: false, response: false };
      this.add('ok', 'AI: all nodes nominal · stand down');
    });

    state.subscribe('sensor:submerged', ({ id, submerged }) => this.add(submerged ? 'warn' : 'ok',
      submerged ? `${id} floor unit submerged · still reporting` : `${id} floor unit clear of water`));
    state.subscribe('player:hazardZone', ({ inHazard }) => this.add(inHazard ? 'crit' : 'ok', inHazard ? 'P-01 entered hazard zone' : 'P-01 left hazard zone'));
    state.subscribe('objective:updated', ({ to }) => this.add('warn', `Objective updated → ${to.label}`));
    const stepText = ['Hazard area cleared', 'Reached', 'Safe air confirmed at'];
    state.subscribe('objective:step', ({ index, target }) => this.add('ok', index === 0 ? stepText[0] : `${stepText[index]} ${target.label}`));
  }

  add(level, text, time = Date.now()) {
    this.entries.unshift({ level, text, time });
    if (this.entries.length > MAX_ENTRIES) this.entries.pop();
    this.state.emit('events:updated', { entries: this.entries });
  }
}

export default EventLog;
