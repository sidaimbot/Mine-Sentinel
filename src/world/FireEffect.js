import * as THREE from 'three';
import { TUNNEL_HEIGHT } from './MineLayout.js';

const FLAMES = 260;
const SMOKE = 520;
const HOT = new THREE.Color(0xffe08a);
const COOL = new THREE.Color(0xff3d12);

function softSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class FireInstance {
  constructor(scene, layout, incident, sprite) {
    this.scene = scene;
    this.layout = layout;
    this.incident = incident;
    this.time = Math.random() * 10;
    const { x, z } = incident.source;

    this.light = new THREE.PointLight(0xff7a2a, 0, 22, 1.6);
    this.light.position.set(x, 1.2, z);

    this.flamePos = new Float32Array(FLAMES * 3);
    this.flameCol = new Float32Array(FLAMES * 3);
    this.flameLife = new Float32Array(FLAMES).map(() => Math.random());
    this.flameMax = new Float32Array(FLAMES).map(() => 0.4 + Math.random() * 0.6);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flamePos, 3));
    fg.setAttribute('color', new THREE.BufferAttribute(this.flameCol, 3));
    this.flames = new THREE.Points(fg, new THREE.PointsMaterial({
      size: 0.55, map: sprite, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));

    this.smokePos = new Float32Array(SMOKE * 3);
    this.smokeVel = new Float32Array(SMOKE * 3);
    this.smokeLife = new Float32Array(SMOKE);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0x2b2622, size: 2.4, map: sprite, transparent: true, opacity: 0, depthWrite: false,
    }));

    for (let i = 0; i < FLAMES; i++) {
      this.respawnFlame(i, 0.3);
      this.flameLife[i] = Math.random();
    }
    for (let i = 0; i < SMOKE; i++) this.respawnSmoke(i);
    for (const obj of [this.flames, this.smoke]) obj.frustumCulled = false;
    scene.add(this.light, this.flames, this.smoke);
  }

  respawnFlame(i, level) {
    const r = 0.25 + 0.7 * level;
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    this.flamePos[i * 3] = this.incident.source.x + Math.cos(a) * d;
    this.flamePos[i * 3 + 1] = 0.05;
    this.flamePos[i * 3 + 2] = this.incident.source.z + Math.sin(a) * d;
    this.flameLife[i] = 0;
  }

  respawnSmoke(i) {
    const p = i * 3;
    this.smokePos[p] = this.incident.source.x + (Math.random() - 0.5) * 1.2;
    this.smokePos[p + 1] = 1 + Math.random() * 1.5;
    this.smokePos[p + 2] = this.incident.source.z + (Math.random() - 0.5) * 1.2;
    const a = Math.random() * Math.PI * 2, speed = 0.6 + Math.random() * 1.4;
    this.smokeVel[p] = Math.cos(a) * speed;
    this.smokeVel[p + 1] = 0.8 + Math.random() * 0.6;
    this.smokeVel[p + 2] = Math.sin(a) * speed;
    this.smokeLife[i] = 6 + Math.random() * 8;
  }

  update(dt) {
    this.time += dt;
    const { level, coLevel } = this.incident;

    this.light.intensity = level * (22 + 10 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3) + Math.random() * 6);

    const activeFlames = Math.floor(FLAMES * Math.min(1, level * 1.2));
    this.flames.geometry.setDrawRange(0, activeFlames);
    const height = 0.6 + 2.2 * level;
    const c = new THREE.Color();
    for (let i = 0; i < activeFlames; i++) {
      this.flameLife[i] += dt / (0.45 + this.flameMax[i] * 0.5);
      if (this.flameLife[i] >= 1) this.respawnFlame(i, level);
      const t = this.flameLife[i];
      const p = i * 3;
      this.flamePos[p + 1] = t * height * this.flameMax[i];
      // Flames lean inward as they rise, like a real licking fire.
      this.flamePos[p] += (this.incident.source.x - this.flamePos[p]) * dt * 1.5 + (Math.random() - 0.5) * dt * 0.8;
      this.flamePos[p + 2] += (this.incident.source.z - this.flamePos[p + 2]) * dt * 1.5 + (Math.random() - 0.5) * dt * 0.8;
      c.copy(HOT).lerp(COOL, t).multiplyScalar(0.5 * (1 - t * 0.85));
      this.flameCol[p] = c.r;
      this.flameCol[p + 1] = c.g;
      this.flameCol[p + 2] = c.b;
    }
    this.flames.geometry.attributes.position.needsUpdate = true;
    this.flames.geometry.attributes.color.needsUpdate = true;

    const activeSmoke = Math.floor(SMOKE * Math.min(1, coLevel));
    this.smoke.geometry.setDrawRange(0, activeSmoke);
    this.smoke.material.opacity = 0.42 * Math.min(1, coLevel * 1.3);
    const ceiling = TUNNEL_HEIGHT - 0.5;
    for (let i = 0; i < activeSmoke; i++) {
      const p = i * 3;
      this.smokeLife[i] -= dt;
      if (this.smokeLife[i] <= 0) { this.respawnSmoke(i); continue; }
      const nx = this.smokePos[p] + this.smokeVel[p] * dt;
      const nz = this.smokePos[p + 2] + this.smokeVel[p + 2] * dt;
      if (this.layout.isWalkable(nx, nz)) {
        this.smokePos[p] = nx;
        this.smokePos[p + 2] = nz;
      } else {
        this.smokeVel[p] *= -0.6;
        this.smokeVel[p + 2] *= -0.6;
      }
      // Hot smoke hugs the roof and then slowly banks down.
      this.smokePos[p + 1] = Math.min(ceiling, this.smokePos[p + 1] + this.smokeVel[p + 1] * dt);
      if (this.smokePos[p + 1] >= ceiling) this.smokeVel[p + 1] = -0.05;
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.light, this.flames, this.smoke);
    this.flames.geometry.dispose();
    this.smoke.geometry.dispose();
  }
}

export class FireEffects {
  constructor(scene, layout, state) {
    this.scene = scene;
    this.layout = layout;
    this.sprite = softSprite();
    this.fires = new Map();

    state.subscribe('incident:started', (inc) => {
      if (inc.type === 'fire') this.fires.set(inc.id, new FireInstance(scene, layout, inc, this.sprite));
    });
    state.subscribe('incident:ended', (inc) => {
      this.fires.get(inc.id)?.dispose();
      this.fires.delete(inc.id);
    });
  }

  update(dt) {
    for (const fire of this.fires.values()) fire.update(dt);
  }
}

export default FireEffects;
