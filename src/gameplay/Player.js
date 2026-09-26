import * as THREE from 'three';
import CONFIG from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(camera, input, layout, state, hazard) {
    this.camera = camera;
    this.input = input;
    this.layout = layout;
    this.state = state;
    this.hazard = hazard;

    const { SPAWN, HEIGHT } = CONFIG.PLAYER;
    this.position = new THREE.Vector3(SPAWN.x, HEIGHT, SPAWN.z);
    this.yaw = SPAWN.yaw;
    this.pitch = 0;
    this.bobPhase = 0;

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.move = new THREE.Vector3();

    this.applyCamera(0);
    this.state.updatePlayerPosition(this.position.x, this.position.y, this.position.z);
  }

  update(dt) {
    const { input } = this;
    const { SPEED, SPRINT_MULTIPLIER, RADIUS, TURN_SPEED } = CONFIG.PLAYER;
    const look = input.getLook(dt);

    this.yaw -= look.x;
    this.pitch -= look.y;
    if (input.isKeyPressed('arrowleft')) this.yaw += TURN_SPEED * dt;
    if (input.isKeyPressed('arrowright')) this.yaw -= TURN_SPEED * dt;
    this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch));
    input.resetMouseDelta();

    // Analog: a half-pushed stick walks at half pace.
    const dir = input.getMoveVector();
    this.forward.set(0, 0, -1).applyAxisAngle(UP, this.yaw);
    this.right.set(1, 0, 0).applyAxisAngle(UP, this.yaw);
    this.move.set(0, 0, 0)
      .addScaledVector(this.forward, dir.y)
      .addScaledVector(this.right, dir.x);

    const moving = this.move.lengthSq() > 1e-4;
    if (moving) {
      const depth = this.hazard.waterDepthAt(this.position.x, this.position.z);
      // Wading: knee-deep water halves pace, waist-deep water roughly thirds it.
      const drag = 1 / (1 + depth * 2.2);
      const sprint = input.isSprinting() ? SPRINT_MULTIPLIER : 1;
      this.move.multiplyScalar(SPEED * sprint * drag * dt);

      // Resolve each axis separately so the player slides along walls instead of sticking.
      const nx = this.position.x + this.move.x;
      if (this.layout.canOccupy(nx, this.position.z, RADIUS)) this.position.x = nx;
      const nz = this.position.z + this.move.z;
      if (this.layout.canOccupy(this.position.x, nz, RADIUS)) this.position.z = nz;

      const prevPhase = this.bobPhase;
      this.bobPhase += dt * SPEED * sprint * drag * 1.6;
      if (Math.floor(prevPhase / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        this.state.emit('player:step', { sprint: sprint > 1, depth });
      }
      this.state.updatePlayerPosition(this.position.x, this.position.y, this.position.z);
    }

    this.applyCamera(moving ? 1 : 0);
  }

  applyCamera(bobWeight) {
    const bob = Math.sin(this.bobPhase) * 0.04 * bobWeight;
    this.camera.position.set(this.position.x, this.position.y + bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  get heading() {
    return this.yaw;
  }
}

export default Player;
