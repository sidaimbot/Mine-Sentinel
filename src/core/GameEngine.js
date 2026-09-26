/**
 * GAME ENGINE - THREE.JS SCENE MANAGEMENT
 * Handles 3D rendering, scene setup, and update loop
 */

import * as THREE from 'three';
import CONFIG from '../config.js';

export class GameEngine {
  constructor(containerElement) {
    this.container = containerElement;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.isRunning = false;
    this.frameCount = 0;
    this.deltaTime = 0;
    this.lastTime = performance.now();

    this.init();
  }

  init() {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0b09);
    this.scene.fog = new THREE.Fog(0x15110d, 14, 95);

    // Camera setup
    this.setupCamera();

    // Renderer setup
    this.setupRenderer();

    // Lighting setup
    this.setupLighting();

    // Event listeners
    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupCamera() {
    const { FOV, NEAR, FAR, POSITION } = CONFIG.CAMERA;

    this.camera = new THREE.PerspectiveCamera(
      FOV,
      this.container.clientWidth / this.container.clientHeight,
      NEAR,
      FAR
    );

    this.camera.position.set(POSITION.x, POSITION.y, POSITION.z);
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      precision: 'highp',
      powerPreference: 'high-performance',
    });

    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.container.appendChild(this.renderer.domElement);
  }

  setupLighting() {
    // Deliberately dim: lamps and the headlamp provide the real illumination underground.
    this.scene.add(new THREE.HemisphereLight(0xa59d92, 0x2e2822, CONFIG.LIGHTING.AMBIENT_INTENSITY));
  }

  addObject(object) {
    this.scene.add(object);
    return object;
  }

  removeObject(object) {
    this.scene.remove(object);
  }

  update(deltaTime) {
    this.deltaTime = deltaTime;
    // Renderer will handle the update
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.gameLoop();
  }

  stop() {
    this.isRunning = false;
  }

  gameLoop = () => {
    if (!this.isRunning) return;

    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = now;

    // Emit frame event for other systems
    window.dispatchEvent(
      new CustomEvent('engineFrame', {
        detail: { deltaTime, frameCount: this.frameCount }
      })
    );

    this.render();
    this.frameCount++;
    requestAnimationFrame(this.gameLoop);
  }

  onWindowResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  dispose() {
    this.stop();

    if (this.renderer) {
      this.renderer.dispose();
      this.container.removeChild(this.renderer.domElement);
    }

    if (this.scene) {
      this.scene.clear();
    }

    window.removeEventListener('resize', () => this.onWindowResize());
  }
}

export default GameEngine;
