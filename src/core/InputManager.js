// Standard Gamepad mapping (Xbox names; PlayStation: A=✕ B=○ X=□ Y=△).
const PAD_BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right'];
const DEADZONE = 0.16;
const LOOK_SPEED = 2.8; // rad/s at full right-stick deflection
const MOUSE_SENSITIVITY = 0.0015;

const deadzone = (v) => (Math.abs(v) < DEADZONE ? 0 : (Math.sign(v) * (Math.abs(v) - DEADZONE)) / (1 - DEADZONE));
// Squaring the stick keeps fine aim near the centre while still allowing fast turns.
const curve = (v) => Math.sign(v) * v * v;

export class InputManager {
  constructor() {
    this.keys = {};
    this.mouseDelta = { x: 0, y: 0 };
    this.isMouseLocked = false;
    this.isMouseDown = false;

    this.pad = null;
    this.padPrev = [];
    this.stick = { mx: 0, my: 0, lx: 0, ly: 0 };
    this.padSprint = false;
    this.lastPoll = performance.now();

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', () => { this.isMouseDown = false; });
    document.addEventListener('pointerlockchange', () => {
      this.isMouseLocked = document.pointerLockElement === document.documentElement;
    });
    window.addEventListener('gamepadconnected', (e) => this.emit('padConnected', { id: e.gamepad.id }));
    window.addEventListener('gamepaddisconnected', (e) => this.emit('padDisconnected', { id: e.gamepad.id }));

    // Polled on its own loop so the controller also works on the start screen, before the engine runs.
    const loop = () => {
      this.pollGamepad();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // Hints on screen follow whichever device was used last.
  setDevice(pad) {
    if (document.body.classList.contains('pad-active') === pad) return;
    document.body.classList.toggle('pad-active', pad);
    this.emit('inputDevice', { pad });
  }

  onKeyDown(event) {
    const key = event.key.toLowerCase();
    this.keys[key] = true;
    this.setDevice(false);
    this.emit('inputKeyDown', { key });
    if (key === 'escape' && this.isMouseLocked) document.exitPointerLock();
  }

  onKeyUp(event) {
    this.keys[event.key.toLowerCase()] = false;
  }

  onMouseMove(event) {
    // Drag-to-look is the fallback when pointer lock is unavailable (e.g. embedded previews).
    if (this.isMouseLocked || this.isMouseDown) {
      this.mouseDelta.x += event.movementX || 0;
      this.mouseDelta.y += event.movementY || 0;
      this.setDevice(false);
    }
  }

  onMouseDown(event) {
    // HUD buttons sit above the canvas; only clicks on the 3D view should grab the mouse.
    if (event.target.tagName !== 'CANVAS' || !event.target.closest('#gameContainer')) return;
    this.isMouseDown = true;
    if (event.button === 0) this.requestPointerLock();
  }

  requestPointerLock() {
    if (this.isMouseLocked || !document.documentElement.requestPointerLock) return;
    // Rejects in embedded or unfocused contexts; mouse-look simply stays off.
    Promise.resolve(document.documentElement.requestPointerLock()).catch(() => {});
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    const pad = pads.find((p) => p && p.connected) ?? null;
    this.pad = pad;
    if (!pad) {
      this.stick = { mx: 0, my: 0, lx: 0, ly: 0 };
      this.padSprint = false;
      return;
    }

    const a = pad.axes;
    this.stick = { mx: deadzone(a[0] ?? 0), my: deadzone(a[1] ?? 0), lx: deadzone(a[2] ?? 0), ly: deadzone(a[3] ?? 0) };
    if (Object.values(this.stick).some((v) => v !== 0)) this.setDevice(true);

    pad.buttons.forEach((b, i) => {
      const name = PAD_BUTTONS[i];
      if (!name) return;
      const down = b.pressed || b.value > 0.5;
      if (down && !this.padPrev[i]) {
        this.setDevice(true);
        this.emit('inputKeyDown', { key: `pad:${name}` });
      }
      this.padPrev[i] = down;
    });

    this.padSprint = (pad.buttons[6]?.value ?? 0) > 0.35 || !!pad.buttons[10]?.pressed;
  }

  isKeyPressed(key) {
    return this.keys[key.toLowerCase()] === true;
  }

  // Analog move vector: x = strafe right, y = forward. Keyboard and left stick combine, clamped to length 1.
  getMoveVector() {
    const k = (key) => (this.isKeyPressed(key) ? 1 : 0);
    let x = k('d') - k('a') + this.stick.mx;
    let y = k('w') - k('s') + k('arrowup') - k('arrowdown') - this.stick.my;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  isSprinting() {
    return this.isKeyPressed('shift') || this.padSprint;
  }

  // Radians to turn this frame from mouse movement plus right stick.
  getLook(dt) {
    return {
      x: this.mouseDelta.x * MOUSE_SENSITIVITY + curve(this.stick.lx) * LOOK_SPEED * dt,
      y: this.mouseDelta.y * MOUSE_SENSITIVITY + curve(this.stick.ly) * LOOK_SPEED * 0.7 * dt,
    };
  }

  resetMouseDelta() {
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }

  rumble(duration, strong = 0.5, weak = 0.5) {
    const actuator = this.pad?.vibrationActuator;
    if (!actuator?.playEffect) return;
    actuator.playEffect('dual-rumble', { startDelay: 0, duration, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}

export default InputManager;
