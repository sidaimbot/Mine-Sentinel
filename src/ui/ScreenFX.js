import * as THREE from 'three';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const CLEAR_FOG = new THREE.Color(0x15110d);
const SMOKE_FOG = new THREE.Color(0x2a2520);
const BASE_NEAR = 14;
const BASE_FAR = 95;

export class ScreenFX {
  constructor(fog) {
    this.fog = fog;
    this.danger = document.getElementById('fxDanger');
    this.root = document.documentElement;
    this.lastLevel = -1;
    this.smoke = 0;
  }

  // `danger` is 1.0 at the worst hazard's alert threshold; smoke thickens the scene fog.
  update(dt, danger, smoke) {
    const level = Math.round(smoothstep(0.6, 1.8, danger) * 100) / 100;
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.root.style.setProperty('--danger', level);
      this.danger.classList.toggle('pulse', danger >= 1.5);
    }

    this.smoke += (smoke - this.smoke) * Math.min(1, dt * 1.5);
    this.fog.near = BASE_NEAR * (1 - 0.85 * this.smoke);
    this.fog.far = BASE_FAR - (BASE_FAR - 9) * this.smoke;
    this.fog.color.copy(CLEAR_FOG).lerp(SMOKE_FOG, this.smoke);
  }
}

export default ScreenFX;
