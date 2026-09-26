const MASTER_LEVEL = 0.9;
const MUTE_KEY = 'mineSentinel.muted';

const readMuted = () => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
};

// Everything is synthesised at runtime: no audio assets to load.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = readMuted();
    this.detectorAcc = 0;
    this.heartAcc = 0;
    this.crackleAcc = 0;
    this.alarmNext = 0;
    this.nextDrip = 0;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    this.master.connect(comp);

    this.whiteNoise = this.makeNoise(2, 'white');
    this.brownNoise = this.makeNoise(4, 'brown');
    this.buildEcho();
    this.buildAmbience();
    this.nextDrip = ctx.currentTime + 1;
  }

  makeNoise(seconds, color) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buf;
  }

  // Two cross-fed delay lines through a lowpass give a cheap "stone chamber" echo.
  buildEcho() {
    const { ctx } = this;
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1);
    d1.delayTime.value = 0.19;
    d2.delayTime.value = 0.31;
    const fb1 = ctx.createGain(), fb2 = ctx.createGain();
    fb1.gain.value = fb2.gain.value = 0.38;
    this.echoIn.connect(d1);
    this.echoIn.connect(d2);
    d1.connect(fb2); fb2.connect(d2);
    d2.connect(fb1); fb1.connect(d1);
    d1.connect(lp); d2.connect(lp);
    lp.connect(this.master);
  }

  buildAmbience() {
    const { ctx } = this;
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.brownNoise;
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    const amb = ctx.createGain();
    amb.gain.value = 0.45;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain).connect(amb.gain);
    rumble.connect(lp).connect(amb).connect(this.master);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.whiteNoise;
    hiss.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.6;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.022;
    hiss.connect(bp).connect(hissGain).connect(this.master);

    rumble.start();
    hiss.start();
    lfo.start();

    // Proximity beds: faded in/out by update() depending on how close the listener is.
    this.fireBed = this.loopBed(this.brownNoise, 'lowpass', 420, 0.7);
    this.waterBed = this.loopBed(this.whiteNoise, 'bandpass', 650, 0.5);
  }

  loopBed(buffer, type, freq, Q) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return g;
  }

  get running() {
    return this.ctx && this.ctx.state === 'running';
  }

  setMuted(muted) {
    this.muted = muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* storage may be blocked */ }
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.ctx.currentTime, 0.05);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    this.ctx?.resume();
  }

  tone({ type = 'sine', f0, f1 = f0, dur, gain, t = this.ctx.currentTime, pan = 0, filter = null, echo = 0 }) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.freq;
      f.Q.value = filter.Q ?? 1;
      node = node.connect(f);
    }
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(g).connect(p).connect(this.master);
    if (echo) {
      const e = ctx.createGain();
      e.gain.value = echo;
      p.connect(e).connect(this.echoIn);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noiseBurst({ dur, gain, type = 'bandpass', freq, Q = 1, t = this.ctx.currentTime, attack = 0.005, echo = 0 }) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    if (echo) {
      const e = ctx.createGain();
      e.gain.value = echo;
      g.connect(e).connect(this.echoIn);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  drip() {
    const f0 = 1100 + Math.random() * 900;
    this.tone({ f0, f1: f0 * 0.5, dur: 0.14, gain: 0.09, pan: Math.random() * 1.6 - 0.8, echo: 0.9 });
  }

  step(sprint, depth = 0) {
    if (!this.running) return;
    if (depth > 0.08) {
      this.noiseBurst({ dur: 0.28, gain: 0.3 + depth * 0.2, freq: 700 + Math.random() * 500, Q: 0.7, attack: 0.02, echo: 0.4 });
      this.noiseBurst({ dur: 0.12, gain: 0.06, type: 'highpass', freq: 3500 });
      return;
    }
    this.noiseBurst({ dur: 0.11, gain: sprint ? 0.4 : 0.3, freq: 250 + Math.random() * 200, Q: 0.9 });
    this.noiseBurst({ dur: 0.05, gain: 0.05, type: 'highpass', freq: 2600 });
  }

  blip(kind) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    if (kind === 'crit') {
      this.tone({ type: 'square', f0: 880, dur: 0.09, gain: 0.05, t, filter: { type: 'lowpass', freq: 2400 } });
      this.tone({ type: 'square', f0: 587, dur: 0.14, gain: 0.05, t: t + 0.1, filter: { type: 'lowpass', freq: 2400 } });
    } else if (kind === 'warn') {
      this.tone({ f0: 740, dur: 0.16, gain: 0.07, t });
    } else if (kind === 'ok') {
      this.tone({ f0: 520, f1: 780, dur: 0.16, gain: 0.06, t });
    } else {
      this.tone({ f0: 1400, dur: 0.05, gain: 0.03, t });
    }
  }

  update(dt, { ppm, exposure, alarm, fire, water }) {
    if (!this.running) return;
    const now = this.ctx.currentTime;

    if (now >= this.nextDrip) {
      this.drip();
      this.nextDrip = now + 1.2 + Math.random() * 3.5;
    }

    // Personal gas detector: clicks accelerate with the concentration at the wearer.
    const rate = ppm < 3000 ? 0 : Math.min(14, (ppm - 3000) / 1500 + 0.6);
    this.detectorAcc += dt * rate;
    while (this.detectorAcc >= 1) {
      this.detectorAcc -= 1;
      this.tone({ type: 'square', f0: 2300, dur: 0.018, gain: 0.05 });
    }

    if (alarm && now >= this.alarmNext) {
      const filter = { type: 'lowpass', freq: 1500 };
      this.tone({ type: 'sawtooth', f0: 587, dur: 0.38, gain: 0.045, t: now, filter, echo: 0.5 });
      this.tone({ type: 'sawtooth', f0: 440, dur: 0.38, gain: 0.045, t: now + 0.42, filter, echo: 0.5 });
      this.alarmNext = now + 0.84;
    }

    if (exposure > 35) {
      this.heartAcc += (dt * (60 + exposure)) / 60;
      if (this.heartAcc >= 1) {
        this.heartAcc -= 1;
        const g = 0.25 + 0.5 * (exposure / 100);
        this.tone({ f0: 60, f1: 38, dur: 0.14, gain: g, t: now });
        this.tone({ f0: 55, f1: 36, dur: 0.12, gain: g * 0.7, t: now + 0.2 });
      }
    }

    this.fireBed.gain.setTargetAtTime(fire * 0.7, now, 0.3);
    this.waterBed.gain.setTargetAtTime(water * 0.22, now, 0.3);

    // Crackle: random sharp pops whose rate follows fire proximity.
    this.crackleAcc += dt * fire * 22;
    while (this.crackleAcc >= 1) {
      this.crackleAcc -= 1;
      this.noiseBurst({
        dur: 0.02 + Math.random() * 0.04, gain: 0.1 + Math.random() * 0.25 * fire, type: 'highpass',
        freq: 1500 + Math.random() * 3000, t: now + Math.random() * 0.05,
      });
    }
  }
}

export default AudioEngine;
