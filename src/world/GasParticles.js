import * as THREE from 'three';
import CONFIG from '../config.js';
import { TUNNEL_HEIGHT } from './MineLayout.js';

const COUNT = 1400;
const FULL_STRENGTH = 40000;

function makeSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class GasParticles {
  constructor(scene, layout, hazard) {
    this.layout = layout;
    this.hazard = hazard;
    this.positions = new Float32Array(COUNT * 3);
    this.velocities = new Float32Array(COUNT * 3);
    this.life = new Float32Array(COUNT);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);

    this.material = new THREE.PointsMaterial({
      color: 0xc9d67a,
      size: 0.7,
      map: makeSprite(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  sources() {
    return this.hazard.incidents.filter((i) => i.type === 'methane' && i.level > 0.01);
  }

  respawn(i, sources) {
    const total = sources.reduce((s, inc) => s + inc.level * inc.params.max, 0);
    let pick = Math.random() * total;
    const inc = sources.find((s) => (pick -= s.level * s.params.max) <= 0) ?? sources[0];
    const radius = inc.spread * 1.4;
    let x = inc.source.x, z = inc.source.z;

    for (let attempt = 0; attempt < 6; attempt++) {
      const cx = inc.source.x + (Math.random() - 0.5) * 2 * radius;
      const cz = inc.source.z + (Math.random() - 0.5) * 2 * radius;
      if (this.layout.isWalkable(cx, cz) && this.hazard.methaneAt(cx, cz) > CONFIG.SENSORS.METHANE.ALERT_THRESHOLD * 0.3) {
        x = cx; z = cz;
        break;
      }
    }

    const p = i * 3;
    this.positions[p] = x;
    this.positions[p + 1] = 0.8 + Math.random() * (TUNNEL_HEIGHT - 1.2);
    this.positions[p + 2] = z;
    this.velocities[p] = (Math.random() - 0.5) * 0.25;
    this.velocities[p + 1] = 0.05 + Math.random() * 0.15;
    this.velocities[p + 2] = (Math.random() - 0.5) * 0.25;
    this.life[i] = 4 + Math.random() * 6;
  }

  update(dt) {
    const sources = this.sources();
    const strength = sources.reduce((s, inc) => s + inc.level * inc.params.max, 0);
    const intensity = Math.min(1, strength / FULL_STRENGTH);
    const active = Math.floor(COUNT * intensity);
    this.points.geometry.setDrawRange(0, active);
    this.material.opacity = 0.08 + 0.22 * intensity;
    if (active === 0) return;

    const ceiling = TUNNEL_HEIGHT - 0.3;
    for (let i = 0; i < active; i++) {
      const p = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.respawn(i, sources); continue; }

      const nx = this.positions[p] + this.velocities[p] * dt;
      const nz = this.positions[p + 2] + this.velocities[p + 2] * dt;
      if (this.layout.isWalkable(nx, nz)) {
        this.positions[p] = nx;
        this.positions[p + 2] = nz;
      } else {
        this.velocities[p] *= -1;
        this.velocities[p + 2] *= -1;
      }
      this.positions[p + 1] = Math.min(ceiling, this.positions[p + 1] + this.velocities[p + 1] * dt);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export default GasParticles;
