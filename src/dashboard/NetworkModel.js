import { SENSOR_NODES, MineLayout } from '../world/MineLayout.js';
import { mulberry32 } from '../utils/noise.js';

export const METRICS = ['gas', 'hum', 'pres', 'water'];
// Barometric pressure at the −240 m level: 1013.25 · e^(240 / 8434) ≈ 1042.4 hPa.
export const BASE_PRESSURE = 1042.4;
const STALE_MS = 3000;
const ZONE_HUMIDITY = {
  'NORTH DRIFT': 81, 'JUNCTION A': 79, 'CROSS DRIFT': 78, 'TUNNEL B': 76,
  CHAMBER: 79, 'MAIN SHAFT': 72, BYPASS: 70, 'ENTRY A': 64,
};
// Background CO in a ventilated mine is a few ppm (diesel traces).
const CO_BACKGROUND = 3;
// Pressure rise (hPa) as CO builds up: CO underground means combustion (a fire or heating), whose hot
// gases expand and back-pressure the district, so pressure tracks CO with a soft ceiling. Scaled to the
// alarm threshold so pressure is clearly 'elevated' (>4 hPa) around the CO alarm level.
const GAS_PRESSURE_MAX = 7;
const gasPressure = (ppm, base, alarm) => GAS_PRESSURE_MAX * (1 - Math.exp(-Math.max(0, ppm - base) / (alarm * 1.2)));

const RANK = { normal: 0, elevated: 1, critical: 2 };
const band = (v, warn, alarm) => (v === null ? 'normal' : v >= alarm ? 'critical' : v >= warn ? 'elevated' : 'normal');

// The one physical unit reports real gas/humidity (and anything else it sends); every other node is a
// plausible simulated neighbour whose gas and humidity respond to the physical unit with tunnel-distance lag.
export class NetworkModel {
  constructor(settings) {
    this.settings = settings;
    this.layout = new MineLayout();
    this.t = 0;
    const rand = mulberry32(42);
    this.nodes = SENSOR_NODES.map((def) => {
      const floor = def.mount === 'floor';
      const gasBase = 0.5 + rand() * 3;
      const humBase = (ZONE_HUMIDITY[def.zone] ?? 74) + (rand() - 0.5) * 4;
      const waterBase = floor ? 0 : null;
      const presOffset = (rand() - 0.5) * 0.6;
      return {
        id: def.id, zone: def.zone, mount: def.mount, x: def.x, z: def.z,
        gasBase, humBase, waterBase,
        presOffset,
        phase: rand() * 100,
        gas: gasBase, hum: humBase, pres: BASE_PRESSURE + presOffset, water: waterBase, temp: 26 + rand() * 2,
        rssi: -58 - rand() * 24,
        battery: 78 + rand() * 20,
        live: {},
        offline: false,
        levels: { gas: 'normal', hum: 'normal', pres: 'normal', water: 'normal' },
        level: 'normal',
      };
    });
  }

  get physical() {
    return this.nodes.find((n) => n.id === this.settings.physicalNode);
  }

  distance(a, b) {
    const d = this.layout.pathDistance(a, b);
    return Number.isFinite(d) ? d : 200;
  }

  // Lags a few seconds behind the gas so the pressure trace visibly follows the gas trace.
  followPressure(n, ambient, dt) {
    const target = ambient + gasPressure(n.gas, n.gasBase, this.settings.gasAlarm);
    return n.pres + (target - n.pres) * Math.min(1, dt / 3);
  }

  // `live` = latest decoded hardware reading { ppm, raw, hum, temp?, pres?, water?, at } or null.
  tick(dt, live) {
    this.t += dt;
    const s = this.settings;
    const phys = this.physical;
    const fresh = live && Date.now() - live.at < STALE_MS;
    const gasExcess = fresh ? Math.max(0, live.ppm - CO_BACKGROUND) : 0;
    const humDelta = fresh ? live.hum - phys.humBase : 0;
    const vent = Math.sin((this.t * 2 * Math.PI) / 90) * 0.15;
    const noise = (a) => (Math.random() - 0.5) * a;

    for (const n of this.nodes) {
      const isPhys = n === phys;
      n.physical = isPhys;
      const k = Math.min(1, dt / 20);
      const presAmbient = BASE_PRESSURE + n.presOffset + vent + noise(0.04);

      if (isPhys) {
        n.offline = !fresh;
        if (fresh) {
          n.gas = live.ppm;
          n.hum = live.hum ?? n.hum;
          if (live.temp !== undefined) n.temp = live.temp;
        }
        n.pres = fresh && live.pres !== undefined ? live.pres : this.followPressure(n, presAmbient, dt);
        // The physical unit always reports a water reading (probe or simulated), whatever its mount.
        n.water = fresh && live.water !== undefined ? live.water : 0;
        n.live = {
          gas: fresh, hum: fresh && live.hum !== undefined, temp: fresh && live.temp !== undefined,
          pres: fresh && live.pres !== undefined, water: fresh && live.water !== undefined,
        };
      } else {
        const d = this.distance(n, phys);
        // Gas "arrives" later and weaker the further a node is from the physical unit, like real spread.
        const tau = 1.5 + d / 5;
        const gasTarget = n.gasBase * (1 + noise(0.25)) + gasExcess * Math.exp(-d / 14);
        n.gas = Math.max(0, n.gas + (gasTarget - n.gas) * Math.min(1, dt / tau) + noise(0.2));
        const humTarget = n.humBase + humDelta * 0.5 * Math.exp(-d / 30) + Math.sin(this.t / 120 + n.phase) * 1.2;
        n.hum = Math.min(100, Math.max(0, n.hum + (humTarget - n.hum) * k + noise(0.15)));
        n.pres = this.followPressure(n, presAmbient, dt);
        n.water = n.waterBase;
        // CO comes from combustion, so simulated air temperature climbs with it.
        n.temp += (26.5 + n.gas / 40 - n.temp) * k + noise(0.03);
        n.live = {};
        n.offline = false;
      }

      n.rssi = Math.min(-45, Math.max(-95, n.rssi + noise(1.2)));
      n.battery = Math.max(0, n.battery - dt * 0.0005);
      n.levels = {
        gas: band(n.gas, s.gasWarn, s.gasAlarm),
        hum: band(n.hum, s.humWarn, s.humAlarm),
        water: band(n.water, s.waterWarn, s.waterAlarm),
        // A sustained pressure excursion usually means a ventilation fan has stopped or reversed.
        pres: Math.abs(n.pres - BASE_PRESSURE) > 4 ? 'elevated' : 'normal',
      };
      n.level = n.offline ? 'normal' : METRICS.map((m) => n.levels[m]).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'normal');
    }
    return this.nodes;
  }
}

export default NetworkModel;
