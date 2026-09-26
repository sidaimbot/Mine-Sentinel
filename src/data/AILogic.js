import CONFIG from '../config.js';
import { LOCATIONS, SENSOR_NODES } from '../world/MineLayout.js';

const S = CONFIG.SENSORS;
const AMBIENT = S.TEMPERATURE.AMBIENT;
const RANK = { normal: 0, elevated: 1, critical: 2 };
const TYPE_PRIORITY = { ignition: 4, fire: 3, methane: 2, water: 1 };
const NEIGHBOUR_RADIUS = 30;
const FORECAST_SECONDS = 30;
const UNRELIABLE = ['POSSIBLE SENSOR FAULT', 'HEAT ANOMALY', 'CO RELEASE'];

const ZONE_LABELS = {
  entry: 'ENTRY A', 'main-shaft': 'MAIN SHAFT', 'junction-a': 'JUNCTION A', 'cross-drift': 'CROSS DRIFT',
  'tunnel-b': 'TUNNEL B', chamber: 'CHAMBER', bypass: 'BYPASS', 'north-drift': 'NORTH DRIFT',
};

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const maxLevel = (...levels) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'normal');

export class AILogic {
  constructor(layout, hazard, state) {
    this.layout = layout;
    this.hazard = hazard;
    this.state = state;
    this.stages = { sensor: null, classified: null, response: null };
    this.decision = null;
    this.alerts = [];
    this.recommended = { target: LOCATIONS.JUNCTION_A, field: null, plan: null, rejected: [], via: [] };
    this.trace = [`Monitoring ${SENSOR_NODES.length} nodes · 2 Hz`, 'No anomalies detected', 'Standing by'];

    state.subscribe('sensors:sampled', ({ nodes }) => this.evaluate(nodes));
  }

  // Normalised hazard ratios (1.0 = alert threshold) at a point, now or `lookahead` seconds ahead.
  ratios(x, z, lookahead = 0) {
    const h = this.hazard;
    return {
      methane: h.methaneAt(x, z, lookahead) / S.METHANE.ALERT_THRESHOLD,
      co: h.coAt(x, z, lookahead) / S.CO.ALERT_THRESHOLD,
      heat: lookahead ? 0 : (h.temperatureAt(x, z) - AMBIENT) / (S.TEMPERATURE.ALERT_THRESHOLD - AMBIENT),
      water: (h.waterDepthAt(x, z, lookahead) * 100) / S.WATER.ALERT_THRESHOLD,
    };
  }

  routeCost = (x, z) => {
    const r = this.ratios(x, z);
    let cost = 0;
    if (r.methane > 0.3) cost += r.methane * 6;
    if (r.co > 0.3) cost += r.co * 6;
    if (r.heat > 0.3) cost += r.heat * 10;
    if (r.water > 0.5) cost += r.water * 3;
    return cost;
  };

  zoneAt(x, z) {
    // Rects overlap at junctions; the smallest containing rect is the most specific name.
    const rect = this.layout.rects
      .filter((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)
      .sort((a, b) => (a.x1 - a.x0) * (a.z1 - a.z0) - (b.x1 - b.x0) * (b.z1 - b.z0))[0];
    return rect ? ZONE_LABELS[rect.id] : null;
  }

  zonesAlong(points) {
    const zones = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let s = 0; s <= steps; s++) {
        const label = this.zoneAt(a.x + ((b.x - a.x) * s) / steps, a.z + ((b.z - a.z) * s) / steps);
        if (label && zones[zones.length - 1] !== label) zones.push(label);
      }
    }
    return zones;
  }

  neighbours(node, nodes) {
    return nodes.filter((n) => n !== node && this.layout.pathDistance(n, node) <= NEIGHBOUR_RADIUS);
  }

  worstBy(nodes, metric) {
    return nodes.reduce((a, b) => (b.reading[metric] > a.reading[metric] ? b : a));
  }

  detect(nodes) {
    const alerts = [];
    const alert = (type, node, level, metric, value, classification, confidence, corroborating = []) =>
      alerts.push({ type, nodeId: node.id, zone: node.zone, level, metric, value, classification, confidence, corroborating });

    const g = this.worstBy(nodes, 'methane');
    if (g.reading.levels.methane !== 'normal') {
      const near = this.neighbours(g, nodes);
      const corr = near.filter((n) => n.reading.methane > CONFIG.GAS.BACKGROUND_PPM * 4 || n.reading.change.methane > 500);
      const real = near.length === 0 || corr.length > 0;
      alert('methane', g, g.reading.levels.methane, 'CH₄', `${fmt(g.reading.methane)} ppm`,
        real ? 'GAS ACCUMULATION' : 'POSSIBLE SENSOR FAULT', real ? Math.min(0.99, 0.7 + corr.length * 0.1) : 0.55,
        corr.map((n) => n.id));
    }

    const hot = this.worstBy(nodes, 'temperature');
    const smoky = this.worstBy(nodes, 'co');
    const fireLevel = maxLevel(hot.reading.levels.temperature, smoky.reading.levels.co);
    if (fireLevel !== 'normal') {
      const node = RANK[hot.reading.levels.temperature] >= RANK[smoky.reading.levels.co] ? hot : smoky;
      const heat = node.reading.levels.temperature !== 'normal';
      const co = node.reading.levels.co !== 'normal';
      const [cls, conf] = heat && co ? ['FIRE · COMBUSTION CONFIRMED', 0.95]
        : heat ? ['HEAT ANOMALY', 0.7]
        : hot.reading.levels.temperature !== 'normal' ? ['FIRE · CO DRIFTING FROM ' + hot.id, 0.88]
        : ['CO RELEASE', 0.6];
      alert('fire', node, fireLevel, 'T/CO',
        `${Math.round(node.reading.temperature)} °C · CO ${Math.round(node.reading.co)} ppm`, cls, conf);
    }

    const w = this.worstBy(nodes, 'water');
    if (w.reading.levels.water !== 'normal') {
      const rising = w.reading.change.water;
      const wet = this.neighbours(w, nodes).filter((n) => n.reading.water > 5);
      const real = wet.length > 0 || rising > 5;
      alert('water', w, w.reading.levels.water, 'WATER', `${Math.round(w.reading.water)} cm (${rising >= 0 ? '+' : '−'}${Math.abs(Math.round(rising))}/min)`,
        real ? 'WATER INGRESS' : 'POSSIBLE SENSOR FAULT', real ? 0.9 : 0.55, wet.map((n) => n.id));
    }

    // Methane meeting heat is the scenario the operator most needs flagged.
    const ignition = nodes.find((n) =>
      n.reading.methane >= S.METHANE.ALERT_THRESHOLD * 0.5
      && (n.reading.levels.temperature !== 'normal' || n.reading.levels.co === 'critical'));
    if (ignition) {
      alert('ignition', ignition, 'critical', 'CH₄+HEAT', `${fmt(ignition.reading.methane)} ppm @ ${Math.round(ignition.reading.temperature)} °C`,
        'IGNITION RISK', 0.9);
    }

    return alerts.sort((a, b) => RANK[b.level] - RANK[a.level] || TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type]);
  }

  chooseSafeZone(playerPos) {
    const options = CONFIG.EVACUATION.SAFE_ZONES.map((key) => {
      const loc = LOCATIONS[key];
      const field = this.layout.costField(loc, this.routeCost);
      const r = this.ratios(loc.x, loc.z, FORECAST_SECONDS);
      const [worstHazard, worstRatio] = Object.entries(r).reduce((a, b) => (b[1] > a[1] ? b : a));
      return { loc, field, plan: this.layout.planRoute(playerPos, field), worstHazard, worstRatio };
    });

    const viable = options.filter((o) => o.plan && o.worstRatio < 0.5);
    const names = { methane: 'CH₄', co: 'CO', heat: 'heat', water: 'water' };
    const rejected = options
      .filter((o) => !viable.includes(o))
      .map((o) => (o.plan ? `${o.loc.label} rejected · ${names[o.worstHazard]} forecast ${Math.round(o.worstRatio * 100)}% of limit` : `${o.loc.label} unreachable`));
    const pool = (viable.length ? viable : options.filter((o) => o.plan)).sort((a, b) => a.plan.cost - b.plan.cost);
    const best = pool[0];
    if (!best) return { target: LOCATIONS.ENTRY_A, field: null, plan: null, rejected, via: [], compromised: true };

    const via = this.zonesAlong(best.plan.points).filter((z) => z !== best.loc.label).slice(1, 3);
    return { target: best.loc, field: best.field, plan: best.plan, rejected, via, compromised: viable.length === 0 };
  }

  evaluate(nodes) {
    const player = this.state.getState().player.position;
    const now = Date.now();
    this.alerts = this.detect(nodes);
    this.recommended = this.chooseSafeZone({ x: player.x, z: player.z });
    const rec = this.recommended;
    const routeText = rec.plan ? `${Math.round(rec.plan.length)} m${rec.via.length ? ` via ${rec.via.join(' → ')}` : ''}` : 'no viable route';

    if (!this.alerts.length) {
      this.trace = [`Monitoring ${nodes.length} nodes · 2 Hz`, 'No anomalies detected', `Standby route → ${rec.target.label} · ${routeText}`];
      if (this.decision) {
        this.decision = null;
        this.stages = { sensor: null, classified: null, response: null };
        this.state.setState({ ai: { status: 'nominal', decision: null } });
        this.state.emit('ai:cleared');
      }
      return;
    }

    const primary = this.alerts[0];
    const critical = this.alerts.some((a) => a.level === 'critical' && !UNRELIABLE.includes(a.classification));
    this.stages.sensor ??= now;
    this.stages.classified ??= now + 400;
    if (critical) this.stages.response ??= now + 900;

    this.trace = [
      ...this.alerts.slice(0, 3).map((a) => `${a.nodeId} ${a.metric} ${a.value} → ${a.classification}`),
      ...(primary.corroborating.length ? [`Corroborated by ${primary.corroborating.join(', ')}`] : []),
      ...rec.rejected.slice(0, rec.compromised ? 2 : 1),
      ...(rec.compromised ? ['All safe zones compromised · least-risk route'] : []),
      critical ? `Route ${routeText}` : 'Continue monitoring',
      ...(critical ? [`Evacuation objective → ${rec.target.label}`] : []),
    ];

    this.decision = {
      type: primary.type,
      nodeId: primary.nodeId,
      zone: primary.zone,
      level: critical ? 'critical' : primary.level === 'critical' ? 'elevated' : primary.level,
      metric: primary.metric,
      value: primary.value,
      classification: primary.classification,
      confidence: primary.confidence,
      alerts: this.alerts,
      response: critical ? 'EVACUATE' : 'MONITOR',
      target: critical ? rec.target : null,
      stages: { ...this.stages },
      trace: this.trace,
    };

    this.state.setState({ ai: { status: this.decision.level, decision: this.decision } });
    this.state.emit('ai:decision', this.decision);
  }
}

export default AILogic;
