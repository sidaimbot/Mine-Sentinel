export const CONFIG = {
  CAMERA: {
    FOV: 75,
    NEAR: 0.1,
    FAR: 200,
    POSITION: { x: 0, y: 1.7, z: 0 },
  },

  PLAYER: {
    SPEED: 4.5,
    SPRINT_MULTIPLIER: 1.8,
    TURN_SPEED: 2.2,
    HEIGHT: 1.7,
    RADIUS: 0.55,
    SPAWN: { x: 20, z: -40, yaw: Math.PI },
  },

  GAS: {
    BACKGROUND_PPM: 400,
    SPREAD_MIN: 4,
    SPREAD_MAX: 18,
    SPREAD_GROWTH: 0.35,
  },

  SENSORS: {
    UPDATE_INTERVAL: 500,
    // Thresholds drive sensor levels, AI rules and HUD colouring.
    METHANE: { ALERT_THRESHOLD: 10000, CRITICAL_THRESHOLD: 15000 },
    CO: { ALERT_THRESHOLD: 50, CRITICAL_THRESHOLD: 200 },
    TEMPERATURE: { AMBIENT: 27, ALERT_THRESHOLD: 40, CRITICAL_THRESHOLD: 60 },
    WATER: { ALERT_THRESHOLD: 20, CRITICAL_THRESHOLD: 50 }, // cm
  },

  // Severity presets for operator-triggered incidents (sim console).
  INCIDENTS: {
    methane: {
      low: { max: 18000, ramp: 45 },
      medium: { max: 32000, ramp: 40 },
      high: { max: 48000, ramp: 30 },
    },
    water: {
      low: { depth: 0.35, reach: 14, ramp: 50 },
      medium: { depth: 0.75, reach: 24, ramp: 45 },
      high: { depth: 1.2, reach: 36, ramp: 40 },
    },
    fire: {
      low: { heat: 140, co: 450, ramp: 18 },
      medium: { heat: 300, co: 900, ramp: 14 },
      high: { heat: 520, co: 1600, ramp: 10 },
    },
  },

  EVACUATION: {
    // Keys into LOCATIONS in world/MineLayout.js.
    SAFE_ZONES: ['JUNCTION_A', 'ENTRY_A'],
  },

  LIGHTING: {
    AMBIENT_INTENSITY: 0.95,
    LAMP_INTENSITY: 13,
    LAMP_DISTANCE: 26,
    HEADLAMP_INTENSITY: 22,
  },

  DEBUG: {
    SHOW_AXES: false,
  },
};

export default CONFIG;
