import CONFIG from '../config.js';

const S = CONFIG.SENSORS;

export function levelFor(metric, value) {
  const t = S[metric];
  if (value >= t.CRITICAL_THRESHOLD) return 'critical';
  if (value >= t.ALERT_THRESHOLD) return 'elevated';
  return 'normal';
}

export const methaneLevel = (ppm) => levelFor('METHANE', ppm);

export const INCIDENT_TYPES = {
  methane: { label: 'METHANE RISING', short: 'CH₄', icon: '◆' },
  water: { label: 'WATER LOGGING', short: 'WATER', icon: '▼' },
  fire: { label: 'FIRE ALERT', short: 'FIRE', icon: '▲' },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const SUPPRESS_DEPTH = 0.4;

let nextId = 1;

export class HazardSystem {
  constructor(layout, state) {
    this.layout = layout;
    this.state = state;
    this.incidents = [];
    this.time = 0;
  }

  get active() {
    return this.incidents.filter((i) => !i.clearing);
  }

  trigger(type, location, severity) {
    const incident = {
      id: nextId++,
      type,
      severity,
      params: CONFIG.INCIDENTS[type][severity],
      source: { x: location.x, z: location.z },
      label: location.label,
      startedAt: this.time,
      age: 0,
      level: 0,
      coLevel: 0,
      clearing: false,
    };
    this.incidents.push(incident);
    this.state.emit('incident:started', incident);
    return incident;
  }

  // Operator stop: the incident is removed immediately, so every field reads clean on the next sample.
  stop(id) {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc) return;
    this.incidents = this.incidents.filter((i) => i !== inc);
    inc.stopped = true;
    this.state.emit('incident:ended', inc);
  }

  stopAll() {
    if (!this.incidents.length) return;
    const count = this.incidents.length;
    for (const inc of [...this.incidents]) this.stop(inc.id);
    this.state.emit('incidents:stopped', { count });
  }

  // Grow while active; decay once cleared (ventilation, pumping, extinguishing).
  static stateAt(inc, age, level, coLevel) {
    const p = inc.params;
    const grown = inc.clearing ? level : Math.min(1, age / p.ramp);
    const { SPREAD_MIN, SPREAD_MAX, SPREAD_GROWTH } = CONFIG.GAS;
    return {
      level: grown,
      coLevel: inc.type === 'fire' ? (inc.clearing ? coLevel : Math.max(coLevel, grown * 0.9)) : 0,
      spread: Math.min(SPREAD_MAX, SPREAD_MIN + SPREAD_GROWTH * age),
      reach: inc.type === 'water' ? p.reach * Math.pow(grown, 0.7) : 0,
      coSpread: Math.min(22, 5 + 0.5 * age),
    };
  }

  update(dt) {
    this.time += dt;
    for (const inc of this.incidents) {
      inc.age += dt;
      if (inc.clearing) {
        const tau = { methane: 12, water: 18, fire: 5 }[inc.type];
        inc.level *= Math.exp(-dt / tau);
        inc.coLevel *= Math.exp(-dt / 14);
      } else {
        inc.level = Math.min(1, inc.age / inc.params.ramp);
        if (inc.type === 'fire') {
          inc.coLevel += (inc.level - inc.coLevel) * Math.min(1, dt / 4);
          if (this.waterDepthAt(inc.source.x, inc.source.z) > SUPPRESS_DEPTH) {
            inc.clearing = true;
            this.state.emit('incident:suppressed', inc);
          }
        }
      }
      Object.assign(inc, HazardSystem.stateAt(inc, inc.age, inc.level, inc.coLevel));
    }

    const ended = this.incidents.filter((i) => i.clearing && i.level < 0.01 && i.coLevel < 0.01);
    if (ended.length) {
      this.incidents = this.incidents.filter((i) => !ended.includes(i));
      for (const inc of ended) this.state.emit('incident:ended', inc);
    }
  }

  distance(inc, x, z) {
    return this.layout.pathDistance({ x, z }, inc.source);
  }

  // Each field sums (or maxes) contributions from incidents of its type, using tunnel path distance.
  methaneAt(x, z, lookahead = 0) {
    let ppm = CONFIG.GAS.BACKGROUND_PPM;
    for (const inc of this.incidents) {
      if (inc.type !== 'methane') continue;
      const d = this.distance(inc, x, z);
      if (!Number.isFinite(d)) continue;
      const st = lookahead ? HazardSystem.stateAt(inc, inc.age + lookahead, inc.level, 0) : inc;
      ppm += inc.params.max * st.level * Math.exp(-d / st.spread);
    }
    return ppm;
  }

  coAt(x, z, lookahead = 0) {
    let co = 0;
    for (const inc of this.incidents) {
      if (inc.type !== 'fire') continue;
      const d = this.distance(inc, x, z);
      if (!Number.isFinite(d)) continue;
      const st = lookahead ? HazardSystem.stateAt(inc, inc.age + lookahead, inc.level, inc.coLevel) : inc;
      co += inc.params.co * st.coLevel * Math.exp(-d / st.coSpread);
    }
    return co;
  }

  temperatureAt(x, z) {
    let t = S.TEMPERATURE.AMBIENT;
    for (const inc of this.incidents) {
      if (inc.type !== 'fire') continue;
      const d = this.distance(inc, x, z);
      if (Number.isFinite(d)) t += inc.params.heat * inc.level * Math.exp(-d / 4.5);
    }
    return t;
  }

  smokeAt(x, z) {
    let smoke = 0;
    for (const inc of this.incidents) {
      if (inc.type !== 'fire') continue;
      const d = this.distance(inc, x, z);
      if (Number.isFinite(d)) smoke = Math.max(smoke, inc.coLevel * Math.exp(-d / inc.coSpread));
    }
    return smoke;
  }

  // Metres of standing water. A flat pool with a soft edge reads better than a linear slope.
  waterDepthAt(x, z, lookahead = 0) {
    let depth = 0;
    for (const inc of this.incidents) {
      if (inc.type !== 'water') continue;
      const d = this.distance(inc, x, z);
      if (!Number.isFinite(d)) continue;
      const st = lookahead ? HazardSystem.stateAt(inc, inc.age + lookahead, inc.level, 0) : inc;
      if (st.reach <= 0) continue;
      depth = Math.max(depth, inc.params.depth * st.level * Math.pow(clamp01(1 - d / st.reach), 0.35));
    }
    return depth;
  }

  // 1.0 = at an alert threshold for the worst hazard present.
  dangerAt(x, z, lookahead = 0) {
    const temp = lookahead ? S.TEMPERATURE.AMBIENT : this.temperatureAt(x, z);
    return Math.max(
      this.methaneAt(x, z, lookahead) / S.METHANE.ALERT_THRESHOLD,
      this.coAt(x, z, lookahead) / S.CO.ALERT_THRESHOLD,
      (temp - S.TEMPERATURE.AMBIENT) / (S.TEMPERATURE.ALERT_THRESHOLD - S.TEMPERATURE.AMBIENT),
      (this.waterDepthAt(x, z, lookahead) * 100) / S.WATER.ALERT_THRESHOLD
    );
  }
}

export default HazardSystem;
