import { METRICS } from './NetworkModel.js';

const HISTORY_SECONDS = 300;
const MAX_EVENTS = 400;
const MAX_CONSOLE = 150;
const MAX_SAMPLES = 20000;
const ALARM_METRICS = ['gas', 'hum', 'water', 'pres'];
const METRIC_NAME = { gas: 'CO', hum: 'Humidity', water: 'Water level', pres: 'Pressure' };
const FORMAT = {
  gas: (v) => `${Math.round(v).toLocaleString('en-US')} ppm`,
  hum: (v) => `${v.toFixed(1)} %RH`,
  water: (v) => `${Math.round(v)} cm`,
  pres: (v) => `${v.toFixed(1)} hPa`,
};

export class Store {
  constructor() {
    this.listeners = new Set();
    this.start = Date.now();
    this.nodes = [];
    this.history = new Map();
    this.samples = [];
    this.events = [];
    this.console = [];
    this.alarms = [];
    this.openAlarms = new Map();
    this.peaks = { gas: null, hum: null, water: null };
    this.packets = { count: 0, errors: 0, rate: 0, lastAt: 0 };
    this.source = { kind: 'none', detail: '' };
    this.live = null;
  }

  get now() {
    return (Date.now() - this.start) / 1000;
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  notify(kind) {
    for (const fn of this.listeners) fn(kind);
  }

  event(level, text) {
    this.events.unshift({ level, text, time: Date.now() });
    if (this.events.length > MAX_EVENTS) this.events.pop();
    this.notify('event');
  }

  line(text) {
    this.console.unshift({ text, time: Date.now() });
    if (this.console.length > MAX_CONSOLE) this.console.pop();
  }

  // Called for every decoded hardware packet.
  packet(reading) {
    const now = Date.now();
    const gap = this.packets.lastAt ? (now - this.packets.lastAt) / 1000 : 0;
    this.packets.count++;
    this.packets.lastAt = now;
    if (gap > 0) this.packets.rate = this.packets.rate ? this.packets.rate * 0.8 + (1 / gap) * 0.2 : 1 / gap;
    this.live = { ...reading, at: now };
    this.samples.push({ time: now, ...reading });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get packetAge() {
    return this.packets.lastAt ? (Date.now() - this.packets.lastAt) / 1000 : Infinity;
  }

  update(nodes) {
    const t = this.now;
    this.nodes = nodes;
    for (const n of nodes) {
      let h = this.history.get(n.id);
      if (!h) {
        h = { t: [], gas: [], hum: [], pres: [], water: [] };
        this.history.set(n.id, h);
      }
      h.t.push(t);
      // Gaps (null) instead of stale values, so charts show when the physical unit had no signal.
      for (const m of METRICS) h[m].push(n.offline && (m === 'gas' || m === 'hum') ? null : n[m] ?? null);
      while (h.t.length && t - h.t[0] > HISTORY_SECONDS) {
        h.t.shift();
        for (const m of METRICS) h[m].shift();
      }
      if (n.offline) continue;
      // Session peaks come from the real sensor only, so they never show simulated values.
      for (const m of n.physical ? ['gas', 'hum', 'water'] : []) {
        if (!n.live[m] && m !== 'water') continue;
        if (n[m] !== null && (!this.peaks[m] || n[m] > this.peaks[m].value)) this.peaks[m] = { value: n[m], nodeId: n.id, time: Date.now() };
      }
      this.trackAlarms(n, t);
    }
    this.notify('tick');
  }

  trackAlarms(n, t) {
    for (const m of ALARM_METRICS) {
      const key = `${n.id}:${m}`;
      const level = n.levels[m];
      const open = this.openAlarms.get(key);
      if (level !== 'normal' && !open) {
        const rec = { id: this.alarms.length + 1, nodeId: n.id, zone: n.zone, physical: n.physical, metric: m, level, start: t, end: null, peak: n[m] };
        this.alarms.push(rec);
        this.openAlarms.set(key, rec);
        this.event(level === 'critical' ? 'crit' : 'warn', `${n.id}${n.physical ? ' (PU-01)' : ''} ${METRIC_NAME[m]} ${level} · ${FORMAT[m](n[m])}`);
      } else if (open) {
        open.peak = Math.max(open.peak, n[m] ?? 0);
        if (level === 'critical' && open.level !== 'critical') {
          open.level = 'critical';
          this.event('crit', `${n.id} ${METRIC_NAME[m]} escalated to critical · ${FORMAT[m](n[m])}`);
        }
        if (level === 'normal') {
          open.end = t;
          this.openAlarms.delete(key);
          this.event('ok', `${n.id} ${METRIC_NAME[m]} back to normal`);
        }
      }
    }
  }

  historyWindow(id, metric, seconds) {
    const h = this.history.get(id);
    if (!h) return [];
    const from = this.now - seconds;
    const out = [];
    h.t.forEach((t, i) => { if (t >= from && h[metric][i] !== null) out.push({ t, v: h[metric][i] }); });
    return out;
  }
}

export { METRIC_NAME, FORMAT };
export default Store;
