import { utcStamp, typeText } from '../effects.js';
import { SENSOR_NODES } from '../../world/MineLayout.js';

const $ = (id) => document.getElementById(id);
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const KIND = {
  methane: 'GAS EVENT',
  fire: 'FIRE EVENT',
  water: 'WATER INGRESS',
  ignition: 'IGNITION RISK',
};
const HEADLINE = {
  methane: { critical: 'Methane threshold exceeded.', elevated: 'Methane rising.' },
  fire: { critical: 'Fire detected — smoke spreading.', elevated: 'Heat / CO anomaly.' },
  water: { critical: 'Tunnel flooding.', elevated: 'Water level rising.' },
  ignition: { critical: 'Methane near a heat source.', elevated: 'Methane near a heat source.' },
};

export class AlertPanel {
  constructor(eventLog, state) {
    this.banner = $('alertBanner');
    this.details = $('alertDetails');
    this.eventLog = eventLog;
    this.decision = null;
    this.lastLevel = null;

    $('alertToggle').addEventListener('click', () => this.toggle());
    window.addEventListener('inputKeyDown', (e) => { if (e.detail.key === 'e' || e.detail.key === 'pad:up') this.toggle(); });
    state.subscribe('events:updated', () => this.renderEvents());
    this.renderEvents();
  }

  toggle() {
    this.details.classList.toggle('hidden');
  }

  update(decision) {
    this.decision = decision;
    this.render();
    if (decision && decision.level !== this.lastLevel) {
      this.banner.animate([0, -5, 5, -3, 3, 0].map((x) => ({ translate: `${x}px 0` })), { duration: 420 });
    }
    this.lastLevel = decision?.level ?? null;
  }

  render() {
    const d = this.decision;
    this.banner.className = `level-${d ? d.level : 'normal'}`;

    if (!d) {
      $('alertKind').textContent = 'ALL SYSTEMS NOMINAL';
      typeText($('alertHeadline'), 'No active alerts');
      $('alertLocation').textContent = `${SENSOR_NODES.length} / ${SENSOR_NODES.length} NODES`;
      $('alertMore').classList.add('hidden');
      $('alertDetail').textContent = 'AI copilot is monitoring the sensor network. Use the Simulation Control console to inject an incident.';
      $('alertList').innerHTML = '';
      for (const s of ['Sensor', 'Ai', 'Response']) this.setStage(s, null, '—');
      return;
    }

    const critical = d.level === 'critical';
    $('alertKind').textContent = `${critical ? 'CRITICAL' : 'WARNING'} · ${KIND[d.type]}`;
    typeText($('alertHeadline'), HEADLINE[d.type][critical ? 'critical' : 'elevated'], { cps: 50 });
    $('alertLocation').textContent = `${d.zone} / ${d.nodeId}`;
    const extra = d.alerts.length - 1;
    $('alertMore').textContent = `+${extra}`;
    $('alertMore').classList.toggle('hidden', extra <= 0);

    $('alertDetail').textContent = critical && d.target
      ? `${d.metric} ${d.value}. ${titleCase(d.classification)}. Evacuate toward ${titleCase(d.target.label)}.`
      : `${d.metric} ${d.value}. ${titleCase(d.classification)}. Monitoring.`;

    $('alertList').innerHTML = d.alerts
      .map((a) => `<li class="${a.level}">${KIND[a.type]} · ${a.nodeId} · ${a.value}</li>`)
      .join('');

    this.setStage('Sensor', d.stages.sensor, `${d.nodeId} threshold crossed`);
    this.setStage('Ai', d.stages.classified, `${titleCase(d.classification)} · ${Math.round(d.confidence * 100)}%`);
    this.setStage('Response', d.stages.response, critical && d.target ? `Evacuation → ${titleCase(d.target.label)}` : 'Monitoring · awaiting escalation');

    const current = d.stages.response ? 'Response' : d.stages.classified ? 'Ai' : 'Sensor';
    for (const name of ['Sensor', 'Ai', 'Response']) $(`stage${name}`).classList.toggle('current', name === current);
  }

  setStage(name, time, text) {
    const pending = time === null || time > Date.now();
    $(`stage${name}`).classList.toggle('done', !pending);
    $(`stage${name}Text`).textContent = pending && time !== null ? 'Processing…' : text;
    $(`stage${name}Time`).textContent = time ? utcStamp(time) : '--:--:--.-';
  }

  renderEvents() {
    const entries = this.eventLog.entries;
    $('eventCount').textContent = entries.length;
    $('eventLog').innerHTML = entries
      .slice(0, 40)
      .map((e) => `<li class="${e.level}"><time>${utcStamp(e.time)}</time><i class="ev-dot"></i><span>${e.text}</span></li>`)
      .join('');
  }
}

export default AlertPanel;
