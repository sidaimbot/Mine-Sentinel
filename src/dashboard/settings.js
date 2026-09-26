import { DEFAULT_MODEL, MQ_MODELS } from './gas.js';

const KEY = 'mineSentinel.dashboard.settings.v3';
// Older versions assumed methane (v1) or a 10-bit board without supply correction (v2): their gas model,
// ADC and R0 would give wrong ppm on an ESP32 + MQ-135, so only the non-gas choices carry over.
const LEGACY_KEYS = ['mineSentinel.dashboard.settings.v2', 'mineSentinel.dashboard.settings'];
const LEGACY_KEEP = ['baud', 'humWarn', 'humAlarm', 'waterWarn', 'waterAlarm', 'physicalNode'];

export const DEFAULTS = {
  baud: 115200,
  adcMax: 4095, // 4095 = 12-bit (ESP32), 1023 = 10-bit (Arduino Uno/Nano)
  sensorVcc: 5, // volts powering the MQ module (its heater and load resistor)
  sensorModel: DEFAULT_MODEL,
  r0: null, // MQ sensor baseline resistance (in RL units) from clean-air calibration; null = uncalibrated estimate
  gasWarn: 35, // ppm CO: short-term exposure caution
  gasAlarm: 100, // ppm CO: withdraw — typical fire / fume alarm level underground
  humWarn: 85,
  humAlarm: 95,
  waterWarn: 20,
  waterAlarm: 50,
  physicalNode: 'G-13',
};

function read(key) {
  return JSON.parse(localStorage.getItem(key) ?? 'null');
}

export function loadSettings() {
  try {
    let saved = read(KEY);
    if (!saved) {
      const legacy = LEGACY_KEYS.map(read).find(Boolean) ?? {};
      saved = Object.fromEntries(LEGACY_KEEP.filter((k) => k in legacy).map((k) => [k, legacy[k]]));
    }
    const s = { ...DEFAULTS, ...saved };
    if (!MQ_MODELS[s.sensorModel]) Object.assign(s, { sensorModel: DEFAULT_MODEL, r0: null });
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage may be blocked (private mode); settings then last for this session only.
  }
}
