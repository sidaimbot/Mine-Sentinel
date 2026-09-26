import { SENSOR_CHAINS } from '../world/MineLayout.js';
import { BASE_PRESSURE } from './NetworkModel.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const wall = (ms) => new Date(ms).toISOString().slice(11, 19);
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const STALE_S = 3;
const LEVEL_DEPTH_M = 240;
const MINI_ZOOM = 1.7;

// A physical unit that stops reporting can mean a cable fault — or that the tunnel it sits in was hit by
// a fire, blast or roof fall. Signal loss is therefore handled as an incident: it demands a physical check
// of that location and a recorded outcome, not just a status change.
export class LossAlert {
  constructor({ store, network, map }) {
    Object.assign(this, { store, network, map });
    this.incident = null;
    this.audio = null;
    this.sirenTimer = null;
    // Armed by live data, so a board that was never connected (or is still silent after an
    // incident was closed) doesn't raise the alarm again and again.
    this.armed = false;
    this.dlg = $('lossDlg');
    this.dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.acknowledge();
    });
    $('lossDispatch').addEventListener('click', () => this.dispatch());
    $('lossClear').addEventListener('click', () => this.resolve(false));
    $('lossCasualty').addEventListener('click', () => this.resolve(true));
    $('lossAck').addEventListener('click', () => this.acknowledge());
    $('lossBanner').addEventListener('click', () => this.show());
  }

  get active() {
    return !!this.incident && !this.incident.resolved;
  }

  // Called every dashboard tick.
  update(sourceKind) {
    const { store } = this;
    const fresh = sourceKind === 'usb' && store.packetAge < STALE_S;
    if (fresh && !this.active) this.armed = true;
    if (!this.active && this.armed && sourceKind === 'usb' && store.packetAge > STALE_S) {
      this.trigger('the unit stopped sending data (powered, but silent)');
    }
    if (this.active && !this.incident.restoredAt && fresh && store.packets.lastAt > this.incident.lostAt) {
      this.incident.restoredAt = Date.now();
      store.event('ok', `${this.incident.label}: signal restored after ${dur((this.incident.restoredAt - this.incident.lostAt) / 1000)} — area check still required`);
      this.stopSiren();
    }
    if (this.active) this.render();
  }

  // USB unplugged / port lost — reported by the data source.
  linkLost(detail) {
    if (!this.active && this.armed) this.trigger(`USB link lost (${detail})`);
  }

  trigger(cause) {
    this.armed = false;
    const node = this.network.physical;
    const last = this.store.live ?? {};
    const lastAt = this.store.packets.lastAt || Date.now();
    const hist = this.store.historyWindow(node.id, 'gas', 30).filter((p) => p.v !== null);
    const rate = hist.length > 3 ? ((hist.at(-1).v - hist[0].v) / Math.max(1, hist.at(-1).t - hist[0].t)) * 60 : 0;
    this.incident = {
      id: `SL-${String(Date.now()).slice(-5)}`,
      label: `Sensor PU-01 (${node.id})`,
      nodeId: node.id,
      cause,
      lostAt: lastAt,
      last: { ppm: last.ppm, hum: last.hum, temp: last.temp, rate },
      restoredAt: null,
      dispatchedAt: null,
      resolved: false,
      acknowledged: false,
    };
    this.store.event('crit', `${this.incident.label} DISCONNECTED at ${titleCase(node.zone)} — ${cause}. Check the area for casualties.`);
    this.show();
    this.startSiren();
  }

  risk() {
    const { last } = this.incident;
    const s = this.network.settings;
    if (last.ppm >= s.gasAlarm) return ['crit', 'HIGH', `CO was ${Math.round(last.ppm)} ppm (alarm level) when contact was lost: treat as a possible fire or explosion. Send a rescue team with breathing apparatus.`];
    if (last.ppm >= s.gasWarn || last.rate > 5) return ['crit', 'ELEVATED', `CO was ${Math.round(last.ppm)} ppm${last.rate > 5 ? ` and rising (+${last.rate.toFixed(1)} ppm/min)` : ''} just before contact was lost: possible fire developing. Approach with self-rescuers and a gas detector.`];
    return ['warn', 'UNKNOWN', 'Readings were normal before contact was lost. It is most likely a cable or power fault, but a roof fall or blast cannot be ruled out: send a crew to check the area.'];
  }

  show() {
    if (!this.incident) return;
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
  }

  render() {
    const inc = this.incident;
    const node = this.network.nodes.find((n) => n.id === inc.nodeId);
    const now = Date.now();
    const lostFor = ((inc.restoredAt ?? now) - inc.lostAt) / 1000;
    const [tone, riskWord, riskText] = this.risk();
    const fromEntry = this.network.distance(node, this.network.nodes.find((n) => n.id === 'G-01'));

    this.dlg.className = inc.restoredAt ? 'loss restored' : 'loss';
    $('lossTitle').textContent = inc.restoredAt ? `${inc.label}: signal restored` : `${inc.label} DISCONNECTED`;
    $('lossSub').textContent = inc.restoredAt
      ? `Contact was lost for ${dur(lostFor)} (${wall(inc.lostAt)}–${wall(inc.restoredAt)} UTC). Confirm the area status below.`
      : `No contact for ${dur(lostFor)} · last packet ${wall(inc.lostAt)} UTC · ${inc.cause}`;

    $('lossLocation').innerHTML = `
      <div><span>Location</span><b>${esc(titleCase(node.zone))}</b></div>
      <div><span>Sensor node</span><b>${esc(node.id)} · ${node.mount === 'air' ? `arch-mounted, ${node.hang === 'roof' ? 'roof' : 'cap beam'}` : 'floor-mounted'}</b></div>
      <div><span>Depth</span><b>−${LEVEL_DEPTH_M} m level</b></div>
      <div><span>From Entry A</span><b>≈ ${Math.round(fromEntry)} m along the tunnels</b></div>
      <div><span>Grid position</span><b>x ${node.x.toFixed(1)} · z ${node.z.toFixed(1)}</b></div>
      <div><span>Incident</span><b>${inc.id}</b></div>`;

    const f = (v, d, u) => (v === undefined || v === null ? '—' : `${v.toFixed(d)} ${u}`);
    $('lossLast').innerHTML = `
      <div><span>CO</span><b>${f(inc.last.ppm, 0, 'ppm')}</b></div>
      <div><span>CO trend</span><b>${inc.last.rate > 0 ? '+' : ''}${inc.last.rate.toFixed(1)} ppm/min</b></div>
      <div><span>Humidity</span><b>${f(inc.last.hum, 1, '%RH')}</b></div>
      <div><span>Temperature</span><b>${f(inc.last.temp, 1, '°C')}</b></div>`;

    $('lossRisk').className = `loss-risk ${tone}`;
    $('lossRisk').innerHTML = `<b>Risk: ${riskWord}</b> ${esc(riskText)}`;

    const chain = SENSOR_CHAINS.find((c) => c.includes(node.id)) ?? [];
    const i = chain.indexOf(node.id);
    const neighbours = [chain[i - 1], chain[i + 1]].filter(Boolean).map((id) => this.network.nodes.find((n) => n.id === id));
    $('lossNeighbours').innerHTML = neighbours.map((n) => `<li><b>${n.id}</b> ${esc(titleCase(n.zone))} · CO ${Math.round(n.gas)} ppm · RH ${n.hum.toFixed(0)}% · ${(n.pres - BASE_PRESSURE >= 0 ? '+' : '') + (n.pres - BASE_PRESSURE).toFixed(1)} hPa <i class="${n.level === 'normal' ? 'ok' : 'warn'}">${n.level === 'normal' ? 'reporting normally' : n.level}</i></li>`).join('');

    $('lossDispatch').disabled = !!inc.dispatchedAt;
    $('lossDispatch').textContent = inc.dispatchedAt ? `Team dispatched ${wall(inc.dispatchedAt)}` : 'Dispatch inspection team';
    $('lossBanner').classList.toggle('hidden', !this.active || this.dlg.open);
    $('lossBannerText').textContent = `${inc.label} ${inc.restoredAt ? 'signal restored, area not yet confirmed' : `disconnected for ${dur(lostFor)}`} · ${titleCase(node.zone)}`;
    this.drawMini(node, now);
  }

  // Zoomed crop of the live network map around the lost unit.
  drawMini(node, now) {
    const c = $('lossMap');
    const { map } = this;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !map.scale) return;
    const dpr = map.dpr;
    if (c.width !== Math.round(w * dpr)) { c.width = w * dpr; c.height = h * dpr; }
    const ctx = c.getContext('2d');
    const [cx, cy] = map.toMap(node.x, node.z);
    const sw = (w / MINI_ZOOM) * dpr, sh = (h / MINI_ZOOM) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f5f7f5';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(map.canvas, cx * dpr - sw / 2, cy * dpr - sh / 2, sw, sh, 0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pulse = (now / 1000) % 1.2 / 1.2;
    ctx.strokeStyle = this.incident.restoredAt ? '#1f9d55' : '#d93a2b';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1 - pulse;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 14 + pulse * 30, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.textAlign = 'center';
    ctx.fillText(`${node.id} · PU-01 · LAST KNOWN POSITION`, w / 2, h / 2 + 36);
  }

  dispatch() {
    this.incident.dispatchedAt = Date.now();
    this.store.event('warn', `${this.incident.label}: inspection team dispatched to ${titleCase(this.network.physical.zone)}`);
    this.stopSiren();
    this.render();
  }

  acknowledge() {
    this.incident.acknowledged = true;
    this.stopSiren();
    this.dlg.close();
    this.render();
  }

  resolve(casualties) {
    const inc = this.incident;
    const zone = titleCase(this.network.nodes.find((n) => n.id === inc.nodeId).zone);
    if (casualties) {
      const count = Number($('lossCount').value) || 1;
      this.store.event('crit', `${inc.label}: CASUALTIES REPORTED at ${zone} (${count} person${count > 1 ? 's' : ''}): start the emergency response plan`);
    } else {
      this.store.event('ok', `${inc.label}: area ${zone} checked, no casualties`);
    }
    inc.resolved = true;
    this.stopSiren();
    this.dlg.close();
    $('lossBanner').classList.add('hidden');
  }

  // Two-tone alarm until someone acknowledges; browsers may block audio until the page was clicked once.
  startSiren() {
    this.stopSiren();
    const beep = () => {
      try {
        this.audio ??= new AudioContext();
        const t = this.audio.currentTime;
        for (const [i, f] of [[0, 880], [1, 660]]) {
          const o = this.audio.createOscillator();
          const g = this.audio.createGain();
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t + i * 0.35);
          g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.35 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.35 + 0.3);
          o.connect(g).connect(this.audio.destination);
          o.start(t + i * 0.35);
          o.stop(t + i * 0.35 + 0.32);
        }
      } catch {
        // No audio available: the popup and banner still alert the operator.
      }
    };
    beep();
    this.sirenTimer = setInterval(beep, 2500);
  }

  stopSiren() {
    clearInterval(this.sirenTimer);
    this.sirenTimer = null;
  }
}
