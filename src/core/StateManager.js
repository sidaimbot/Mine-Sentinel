/**
 * STATE MANAGER - GLOBAL GAME STATE & EVENTS
 * Central hub for game state and event broadcasting
 */

export class StateManager {
  constructor() {
    this.state = {
      // Game state
      gameStarted: false,
      gamePaused: false,
      gameEnded: false,

      // Player state
      player: {
        position: { x: 0, y: 5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        health: 100,
        stamina: 100,
      },

      // Environment state
      environment: {
        temperature: 20,
        humidity: 60,
        lighting: 'normal', // normal, hazard, emergency
      },

      // Sensor readings
      sensors: {
        active: null, // Currently selected sensor node
        readings: {}, // { nodeId: { methane, temp, vibration, humidity, battery } }
      },

      // Hazard state
      hazards: {
        active: [], // Array of active hazard IDs
        methaneLevel: 0,
        vibrationLevel: 0,
        oxygenLevel: 100,
      },

      // Vitals
      vitals: {
        oxygen: 99,
        exposure: 0,
        heat: 27,
      },

      // Evacuation
      evacuation: {
        isEvacuating: false,
        currentWaypoint: 0,
        distanceToSafety: 100,
        safeZoneIndex: 0,
      },

      // UI state
      ui: {
        hudVisible: false,
        hazardPanelVisible: false,
        selectedPanel: null,
      },

      // Game time
      time: {
        elapsed: 0,
        utcHours: 0,
        utcMinutes: 0,
        utcSeconds: 0,
      },
    };

    this.subscribers = {}; // Event subscription map
    this.history = []; // State change history for debugging
    this.maxHistorySize = 100;
  }

  // Subscribe to state changes
  subscribe(eventName, callback) {
    if (!this.subscribers[eventName]) {
      this.subscribers[eventName] = [];
    }

    this.subscribers[eventName].push(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers[eventName] = this.subscribers[eventName].filter(
        cb => cb !== callback
      );
    };
  }

  // Publish state change event
  emit(eventName, data = {}) {
    if (this.subscribers[eventName]) {
      this.subscribers[eventName].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in subscriber for ${eventName}:`, error);
        }
      });
    }

    // Log to history
    this.addToHistory(eventName, data);
  }

  // Update game state
  setState(updates) {
    const prevState = JSON.parse(JSON.stringify(this.state));

    // Deep merge updates
    this.deepMerge(this.state, updates);

    // Compare and emit events for changed properties
    this.diffAndEmit(prevState, this.state, updates);
  }

  // Deep merge objects
  deepMerge(target, source) {
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {};
        }
        this.deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  // Emit events for changed state properties
  diffAndEmit(prev, curr, updates) {
    for (const key in updates) {
      if (typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        // Check nested properties
        for (const subKey in updates[key]) {
          if (prev[key] && prev[key][subKey] !== curr[key][subKey]) {
            this.emit(`${key}:${subKey}Changed`, {
              prev: prev[key][subKey],
              curr: curr[key][subKey],
            });
          }
        }
      } else {
        // Top-level property
        if (prev[key] !== curr[key]) {
          this.emit(`${key}Changed`, {
            prev: prev[key],
            curr: curr[key],
          });
        }
      }
    }
  }

  // Get current state
  getState() {
    return this.state;
  }

  // Get specific state value
  getValue(path) {
    const keys = path.split('.');
    let value = this.state;

    for (const key of keys) {
      if (value && typeof value === 'object') {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  // Game lifecycle
  startGame() {
    this.setState({ gameStarted: true });
    this.emit('gameStarted');
  }

  pauseGame() {
    this.setState({ gamePaused: true });
    this.emit('gamePaused');
  }

  resumeGame() {
    this.setState({ gamePaused: false });
    this.emit('gameResumed');
  }

  endGame(reason = 'unknown') {
    this.setState({ gameEnded: true });
    this.emit('gameEnded', { reason });
  }

  // Player movement
  updatePlayerPosition(x, y, z) {
    this.setState({
      player: {
        ...this.state.player,
        position: { x, y, z },
      },
    });
  }

  updatePlayerRotation(x, y, z) {
    this.setState({
      player: {
        ...this.state.player,
        rotation: { x, y, z },
      },
    });
  }

  // Sensor data
  setSensorReading(nodeId, readings) {
    this.setState({
      sensors: {
        ...this.state.sensors,
        readings: {
          ...this.state.sensors.readings,
          [nodeId]: readings,
        },
      },
    });

    this.emit(`sensor:${nodeId}Updated`, readings);
  }

  selectSensor(nodeId) {
    this.setState({
      sensors: { ...this.state.sensors, active: nodeId },
    });
  }

  // Hazard management
  activateHazard(hazardId) {
    if (!this.state.hazards.active.includes(hazardId)) {
      this.setState({
        hazards: {
          ...this.state.hazards,
          active: [...this.state.hazards.active, hazardId],
        },
      });
      this.emit('hazardActivated', { hazardId });
    }
  }

  deactivateHazard(hazardId) {
    const filtered = this.state.hazards.active.filter(id => id !== hazardId);
    if (filtered.length < this.state.hazards.active.length) {
      this.setState({
        hazards: {
          ...this.state.hazards,
          active: filtered,
        },
      });
      this.emit('hazardDeactivated', { hazardId });
    }
  }

  // Time update
  updateTime(deltaTime) {
    const newTime = this.state.time.elapsed + deltaTime;
    const hours = Math.floor((newTime / 3600) % 24);
    const minutes = Math.floor((newTime / 60) % 60);
    const seconds = Math.floor(newTime % 60);

    this.setState({
      time: {
        elapsed: newTime,
        utcHours: hours,
        utcMinutes: minutes,
        utcSeconds: seconds,
      },
    });
  }

  // HUD visibility
  showHUD() {
    this.setState({
      ui: { ...this.state.ui, hudVisible: true },
    });
  }

  hideHUD() {
    this.setState({
      ui: { ...this.state.ui, hudVisible: false },
    });
  }

  showHazardPanel() {
    this.setState({
      ui: { ...this.state.ui, hazardPanelVisible: true },
    });
  }

  hideHazardPanel() {
    this.setState({
      ui: { ...this.state.ui, hazardPanelVisible: false },
    });
  }

  // History tracking
  addToHistory(eventName, data) {
    this.history.push({
      timestamp: Date.now(),
      eventName,
      data,
    });

    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  getHistory() {
    return this.history;
  }

  clearHistory() {
    this.history = [];
  }

  // Debug: dump current state
  dump() {
    console.log('=== GAME STATE ===');
    console.log(JSON.stringify(this.state, null, 2));
  }

  dispose() {
    this.subscribers = {};
    this.history = [];
  }
}

export default StateManager;
