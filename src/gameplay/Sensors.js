import * as THREE from 'three';
import CONFIG from '../config.js';
import { SENSOR_NODES, MOUNT_HEIGHT } from '../world/MineLayout.js';
import { levelFor } from './HazardSystem.js';

const LED_COLORS = {
  normal: new THREE.Color(0x77d46d),
  elevated: new THREE.Color(0xdfca4c),
  critical: new THREE.Color(0xff6047),
  submerged: new THREE.Color(0x4fb3d9),
};
const RANK = { normal: 0, elevated: 1, critical: 2 };
const HISTORY_SECONDS = 60;
const UNIT_SCALE = 1.25;
export const METRICS = ['methane', 'co', 'temperature', 'water'];
const METRIC_KEY = { methane: 'METHANE', co: 'CO', temperature: 'TEMPERATURE', water: 'WATER' };

function makeLabelTexture(id, mount) {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101315';
  ctx.fillRect(0, 0, 192, 128);
  ctx.fillStyle = mount === 'air' ? '#6fa9a2' : '#4fb3d9';
  ctx.fillRect(0, 0, 192, 10);
  ctx.fillStyle = '#e6e8e0';
  ctx.font = 'bold 50px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(id, 96, 70);
  ctx.fillStyle = '#8b9692';
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillText(mount === 'air' ? 'AIR · CH₄ CO T' : 'FLOOR · H₂O', 96, 108);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Shared parts for the wall-mounted "black box" sensor unit. Local +z faces into the tunnel.
function unitParts() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x5d646a, metalness: 0.7, roughness: 0.45 });
  const shell = new THREE.MeshStandardMaterial({ color: 0x1b1f22, metalness: 0.55, roughness: 0.42 });
  const slot = new THREE.MeshBasicMaterial({ color: 0x07090a });
  return {
    metal, shell, slot,
    bracket: new THREE.BoxGeometry(0.42, 0.56, 0.03),
    body: new THREE.BoxGeometry(0.34, 0.46, 0.14),
    vent: new THREE.BoxGeometry(0.22, 0.014, 0.01),
    label: new THREE.PlaneGeometry(0.28, 0.187),
    led: new THREE.SphereGeometry(0.028, 10, 8),
    inlet: new THREE.CylinderGeometry(0.035, 0.06, 0.09, 12),
    strap: new THREE.BoxGeometry(0.05, 0.34, 0.03),
    rod: new THREE.CylinderGeometry(0.013, 0.013, 1, 6),
    float: new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12),
    glow: glowTexture(),
  };
}

export class Sensors {
  constructor(scene, layout, hazard, state) {
    this.layout = layout;
    this.hazard = hazard;
    this.state = state;
    this.time = 0;
    this.sampleTimer = 0;

    const P = unitParts();
    this.nodes = SENSOR_NODES.map((def, i) => {
      const y = MOUNT_HEIGHT[def.mount];
      const group = new THREE.Group();
      group.position.set(def.x, y, def.z);
      group.rotation.y = Math.atan2(def.nx, def.nz);
      group.scale.setScalar(UNIT_SCALE);

      const bracket = new THREE.Mesh(P.bracket, P.metal);
      bracket.position.z = -0.085;
      const body = new THREE.Mesh(P.body, P.shell);
      const label = new THREE.Mesh(P.label, new THREE.MeshBasicMaterial({ map: makeLabelTexture(def.id, def.mount) }));
      label.position.set(0, 0.07, 0.071);
      group.add(bracket, body, label);

      for (let v = 0; v < 4; v++) {
        const vent = new THREE.Mesh(P.vent, P.slot);
        vent.position.set(0, -0.085 - v * 0.03, 0.071);
        group.add(vent);
      }

      const ledMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: LED_COLORS.normal, emissiveIntensity: 3 });
      const led = new THREE.Mesh(P.led, ledMat);
      led.position.set(0.12, 0.19, 0.075);
      const haloMat = new THREE.SpriteMaterial({ map: P.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(0.34);
      halo.position.copy(led.position);
      group.add(led, halo);

      if (def.mount === 'air') {
        // Gas sampling inlet on the underside, where the operator looks up at it.
        const inlet = new THREE.Mesh(P.inlet, P.metal);
        inlet.position.set(0, -0.275, 0);
        group.add(inlet);
        if (def.hang === 'arch') {
          // Straps run up the bracket onto the cap beam's face.
          for (const sx of [-0.13, 0.13]) {
            const strap = new THREE.Mesh(P.strap, P.metal);
            strap.position.set(sx, 0.3, -0.09);
            group.add(strap);
          }
        } else {
          const rodLength = (4.5 - y) / UNIT_SCALE - 0.23;
          const rod = new THREE.Mesh(P.rod, P.metal);
          rod.scale.y = rodLength;
          rod.position.set(0, 0.23 + rodLength / 2, -0.02);
          group.add(rod);
        }
      } else {
        // Water-level probe: a rod from the unit down to the floor with a float collar.
        const rodLength = y / UNIT_SCALE - 0.23;
        const rod = new THREE.Mesh(P.rod, P.metal);
        rod.scale.y = rodLength;
        rod.position.set(0.1, -0.23 - rodLength / 2, 0.03);
        const float = new THREE.Mesh(P.float, P.shell);
        float.position.set(0.1, -0.23 - rodLength + 0.04, 0.03);
        group.add(rod, float);
      }
      scene.add(group);

      return {
        ...def, y, ledMat, haloMat, history: [], battery: 88 + Math.random() * 10, phase: i * 1.7,
        reading: null, submerged: false,
      };
    });
  }

  get count() {
    return this.nodes.length;
  }

  // Sampling runs on simulation time so the console's speed control applies to telemetry too.
  update(simDt, realDt, playerPos) {
    this.time += realDt;
    this.sampleTimer += simDt * 1000;
    if (this.sampleTimer >= CONFIG.SENSORS.UPDATE_INTERVAL) {
      this.sampleTimer = 0;
      this.sampleAll();
    }

    for (const node of this.nodes) {
      const level = node.reading?.level ?? 'normal';
      let color = LED_COLORS[level];
      let pulse = level === 'critical'
        ? 1 + 3 * Math.max(0, Math.sin(this.time * 9 + node.phase))
        : level === 'elevated' ? 2 + Math.sin(this.time * 4 + node.phase) : 2.5;
      if (node.submerged) {
        color = LED_COLORS.submerged;
        pulse = 1.5 + 2 * Math.max(0, Math.sin(this.time * 5 + node.phase));
      }
      node.ledMat.emissive.copy(color);
      node.ledMat.emissiveIntensity = pulse;
      node.haloMat.color.copy(color);
      node.haloMat.opacity = Math.min(1, 0.25 + pulse * 0.18);
    }

    this.selectNearest(playerPos);
  }

  sampleAll() {
    const now = this.hazard.time;
    const h = this.hazard;
    for (const node of this.nodes) {
      const noise = (scale) => 1 + (Math.random() - 0.5) * scale;
      const depth = h.waterDepthAt(node.x, node.z);
      const sample = {
        t: now,
        methane: h.methaneAt(node.x, node.z) * noise(0.04),
        co: h.coAt(node.x, node.z) * noise(0.06),
        temperature: h.temperatureAt(node.x, node.z) + (Math.random() - 0.5) * 0.2,
        water: depth * 100 * noise(0.03),
      };
      node.battery = Math.max(0, node.battery - Math.random() * 0.01);
      node.history.push(sample);
      while (node.history.length && now - node.history[0].t > HISTORY_SECONDS) node.history.shift();

      const submerged = depth >= node.y;
      if (submerged !== node.submerged) {
        node.submerged = submerged;
        this.state.emit('sensor:submerged', { id: node.id, submerged });
      }

      const first = node.history[0];
      const levels = {};
      const change = {};
      const history = {};
      for (const m of METRICS) {
        levels[m] = this.levelWithHysteresis(m, sample[m], node.reading?.levels[m]);
        change[m] = sample[m] - first[m];
        history[m] = node.history.map((s) => s[m]);
      }
      const level = METRICS.map((m) => levels[m]).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'normal');

      node.reading = {
        methane: Math.round(sample.methane),
        co: sample.co,
        temperature: sample.temperature,
        water: sample.water,
        battery: node.battery,
        submerged,
        levels,
        level,
        change,
        history,
      };
    }
    this.state.emit('sensors:sampled', { nodes: this.nodes });
  }

  // Readings hovering on a threshold would flap between levels; stepping down needs a 6% margin.
  levelWithHysteresis(metric, value, previous) {
    const level = levelFor(METRIC_KEY[metric], value);
    if (!previous || RANK[level] >= RANK[previous]) return level;
    const t = CONFIG.SENSORS[METRIC_KEY[metric]];
    const threshold = previous === 'critical' ? t.CRITICAL_THRESHOLD : t.ALERT_THRESHOLD;
    return value > threshold * 0.94 ? previous : level;
  }

  selectNearest(playerPos) {
    let best = null, bestD = Infinity;
    for (const node of this.nodes) {
      const d = this.layout.pathDistance(playerPos, node);
      if (d < bestD) { bestD = d; best = node; }
    }
    if (best && this.state.getState().sensors.active !== best.id) this.state.selectSensor(best.id);
  }

  getNode(id) {
    return this.nodes.find((n) => n.id === id);
  }
}

export default Sensors;
