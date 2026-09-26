import * as THREE from 'three';
import CONFIG from '../config.js';

const WARM = new THREE.Color(0xffd6a8);
const ALARM = new THREE.Color(0xff3a22);

export class Lighting {
  constructor(scene, camera, lamps) {
    this.lamps = lamps;
    this.time = 0;

    const { LAMP_INTENSITY, LAMP_DISTANCE, HEADLAMP_INTENSITY } = CONFIG.LIGHTING;

    for (const lamp of lamps) {
      lamp.light = new THREE.PointLight(WARM, LAMP_INTENSITY, LAMP_DISTANCE, 1.15);
      lamp.light.position.set(lamp.x, lamp.y - 0.15, lamp.z);
      lamp.phase = Math.random() * 100;
      lamp.alarm = 0;
      scene.add(lamp.light);
    }

    this.headlamp = new THREE.SpotLight(0xfff0d6, HEADLAMP_INTENSITY, 32, 0.5, 0.55, 1.2);
    this.headlamp.position.set(0.15, 0.1, 0);
    this.headlamp.target.position.set(0, -0.35, -5);
    camera.add(this.headlamp, this.headlamp.target);
    scene.add(camera);
  }

  update(dt, hazard) {
    this.time += dt;
    const { LAMP_INTENSITY } = CONFIG.LIGHTING;

    for (const lamp of this.lamps) {
      const target = hazard.dangerAt(lamp.x, lamp.z) >= 1 ? 1 : 0;
      lamp.alarm += (target - lamp.alarm) * Math.min(1, dt * 2);
      // Smoke swallows lamp light, which is what makes a fire drift readable from a distance.
      const smoke = hazard.smokeAt(lamp.x, lamp.z);

      const flicker = 0.92 + 0.08 * Math.sin(this.time * 13 + lamp.phase) * Math.sin(this.time * 7.1 + lamp.phase * 2);
      const strobe = 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 6 + lamp.phase));
      const level = (flicker * (1 - lamp.alarm) + strobe * lamp.alarm) * (1 - 0.65 * smoke);

      lamp.light.color.copy(WARM).lerp(ALARM, lamp.alarm);
      lamp.light.intensity = LAMP_INTENSITY * level;
      lamp.bulbMat.emissive.copy(lamp.light.color);
      lamp.bulbMat.emissiveIntensity = 2.2 * level;
      lamp.haloMat.color.copy(lamp.light.color);
      lamp.haloMat.opacity = 0.6 * level;
    }
  }
}

export default Lighting;
