import * as THREE from 'three';
import { SENSOR_CHAINS, TUNNEL_HEIGHT } from './MineLayout.js';

const RUN_Y = TUNNEL_HEIGHT - 0.62;
const PULSES_PER_LINK = 2;
const COLORS = {
  normal: new THREE.Color(0x5fd488),
  elevated: new THREE.Color(0xe9c44c),
  critical: new THREE.Color(0xff5d4a),
};

function pulseTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Signal cable between sensor units: up the wall, along the roof following the tunnel, down to the next unit.
// Data pulses travel toward the G-01 gateway, coloured by the sending node's status.
export class SensorNetwork {
  constructor(scene, layout, sensors) {
    this.links = [];
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.65, metalness: 0.1 });
    const texture = pulseTexture();

    for (const chain of SENSOR_CHAINS) {
      for (let i = 0; i < chain.length - 1; i++) {
        const a = sensors.getNode(chain[i]);
        const b = sensors.getNode(chain[i + 1]);
        const field = layout.costField(b);
        const plan = layout.planRoute(a, field);
        const roof = (plan?.points ?? [a, b]).slice(1, -1);

        const pts = [
          new THREE.Vector3(a.x - a.nx * 0.06, a.y + 0.2, a.z - a.nz * 0.06),
          new THREE.Vector3(a.x - a.nx * 0.06, RUN_Y, a.z - a.nz * 0.06),
          ...roof.map((p) => new THREE.Vector3(p.x, RUN_Y, p.z)),
          new THREE.Vector3(b.x - b.nx * 0.06, RUN_Y, b.z - b.nz * 0.06),
          new THREE.Vector3(b.x - b.nx * 0.06, b.y + 0.2, b.z - b.nz * 0.06),
        ];
        const path = new THREE.CurvePath();
        for (let k = 1; k < pts.length; k++) path.add(new THREE.LineCurve3(pts[k - 1], pts[k]));
        const length = path.getLength();

        scene.add(new THREE.Mesh(new THREE.TubeGeometry(path, Math.ceil(length * 2), 0.011, 5, false), cableMat));

        const pulses = [];
        for (let p = 0; p < PULSES_PER_LINK; p++) {
          const mat = new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
          const sprite = new THREE.Sprite(mat);
          sprite.scale.setScalar(0.2);
          scene.add(sprite);
          pulses.push({ sprite, t: p / PULSES_PER_LINK });
        }
        this.links.push({ from: a, path, length, pulses });
      }
    }
  }

  update(dt) {
    for (const link of this.links) {
      const level = link.from.reading?.level ?? 'normal';
      // Alarming nodes push data harder: faster, brighter pulses.
      const speed = level === 'critical' ? 11 : level === 'elevated' ? 7 : 4;
      for (const p of link.pulses) {
        p.t = (p.t + (dt * speed) / link.length) % 1;
        link.path.getPointAt(p.t, p.sprite.position);
        p.sprite.material.color.copy(COLORS[level]);
        p.sprite.material.opacity = level === 'normal' ? 0.55 : 0.95;
      }
    }
  }
}

export default SensorNetwork;
