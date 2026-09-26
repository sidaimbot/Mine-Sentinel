import * as THREE from 'three';
import { TUNNEL_HEIGHT } from './MineLayout.js';

export const TYPE_COLORS = { methane: 0xe9c44c, water: 0x4fb3d9, fire: 0xff6a2a };

export class PlacementMarker {
  constructor(scene) {
    this.time = 0;
    this.group = new THREE.Group();

    const mat = (opacity) => new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.8, 48), mat(0.8));
    this.ring.rotation.x = -Math.PI / 2;
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.95, 48), mat(0.5));
    this.pulse.rotation.x = -Math.PI / 2;
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, TUNNEL_HEIGHT, 6, 1, true), mat(0.35));
    this.beam.position.y = TUNNEL_HEIGHT / 2;
    this.group.add(this.ring, this.pulse, this.beam);
    this.group.position.y = 0.12;
    scene.add(this.group);
  }

  set(x, z, type) {
    this.group.position.x = x;
    this.group.position.z = z;
    const color = TYPE_COLORS[type] ?? 0xffffff;
    for (const m of [this.ring, this.pulse, this.beam]) m.material.color.setHex(color);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  update(dt) {
    this.time += dt;
    const t = (this.time * 0.8) % 1;
    this.pulse.scale.setScalar(1 + t * 1.8);
    this.pulse.material.opacity = 0.6 * (1 - t);
    this.ring.rotation.z += dt * 0.6;
  }
}

export default PlacementMarker;
