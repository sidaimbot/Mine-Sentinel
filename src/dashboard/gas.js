// MQ-series gas sensors change resistance (Rs) with gas concentration. The module's load resistor RL
// forms a divider: Rs/RL = (Vcc - Vout) / Vout, so RL cancels once we work in ratios.
// ppm = A · (Rs/R0)^B, where the A/B pair is a log-log fit of the datasheet carbon-monoxide curve and
// R0 is Rs in a known reference condition (derived from clean air during calibration).
export const MQ_MODELS = {
  'MQ-135': { a: 605.18, b: -3.937, cleanAir: 3.6, label: 'MQ-135 (air quality, CO curve)' },
  'MQ-7': { a: 99.042, b: -1.518, cleanAir: 27.5, label: 'MQ-7 (carbon monoxide)' },
  'MQ-2': { a: 36974, b: -3.109, cleanAir: 9.83, label: 'MQ-2 (combustible gas, CO curve)' },
  'MQ-9': { a: 599.65, b: -2.244, cleanAir: 9.6, label: 'MQ-9 (CO / flammable, CO curve)' },
};
export const DEFAULT_MODEL = 'MQ-135';

export const CO_TWA_PPM = 25; // 8-hour time-weighted exposure limit
export const CO_IDLH_PPM = 1200; // immediately dangerous to life or health
// MQ curves are only characterised up to a few thousand ppm; beyond this the reading is 'over range'.
export const MAX_PPM = 2000;

// Full-scale ADC voltage: ESP32 (12-bit, 11 dB attenuation) ≈ 3.3 V; 5 V AVR boards (10-bit) = 5 V.
export const adcVref = (adcMax) => (adcMax === 4095 ? 3.3 : 5);

// A 5 V module read by a 3.3 V ADC is the usual ESP32 wiring; ignoring the supply/reference mismatch
// would skew Rs by up to ~2× and every ppm with it.
export function resistanceRatio(raw, { adcMax, sensorVcc = 5 }) {
  const vout = (Math.min(adcMax - 1, Math.max(1, raw)) / adcMax) * adcVref(adcMax);
  return Math.max(1e-3, (sensorVcc - vout) / vout);
}

// Without calibration assume clean air sits at ~10 % of the ADC range, typical for a warmed-up module.
export function defaultR0(settings) {
  return resistanceRatio(settings.adcMax * 0.1, settings) / MQ_MODELS[settings.sensorModel].cleanAir;
}

export function rawToPpm(raw, settings) {
  const m = MQ_MODELS[settings.sensorModel] ?? MQ_MODELS[DEFAULT_MODEL];
  const ratio = resistanceRatio(raw, settings) / (settings.r0 ?? defaultR0(settings));
  // The datasheet fits don't pass through zero (MQ-2 extrapolates to ~30 ppm in fresh air), so the
  // clean-air value is subtracted: fresh air reads 0 ppm and any rise the sensor sees is real CO.
  const ppm = m.a * Math.pow(ratio, m.b) - m.a * Math.pow(m.cleanAir, m.b);
  return Math.min(MAX_PPM, Math.max(0, ppm));
}

// Calibrate from a representative (median) raw reading taken in clean air.
export function calibrateR0(cleanRaw, settings) {
  return resistanceRatio(cleanRaw, settings) / MQ_MODELS[settings.sensorModel].cleanAir;
}
