import { INCIDENT_LOCATIONS } from '../world/MineLayout.js';
import { INCIDENT_TYPES } from '../gameplay/HazardSystem.js';

const $ = (id) => document.getElementById(id);
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class SimConsole {
  constructor({ hazard, marker, zoneAt, getAimPoint, onPause, onSpeed }) {
    this.hazard = hazard;
    this.marker = marker;
    this.zoneAt = zoneAt;
    this.getAimPoint = getAimPoint;
    this.onPause = onPause;
    this.onSpeed = onSpeed;
    this.severity = 'medium';
    this.previewType = 'methane';
    this.listTimer = 0;

    const select = $('simLocation');
    select.innerHTML = INCIDENT_LOCATIONS.map((l) => `<option value="${l.id}">${l.label}</option>`).join('')
      + '<option value="custom" hidden>CUSTOM</option>';
    select.addEventListener('change', () => {
      const loc = INCIDENT_LOCATIONS.find((l) => l.id === select.value);
      if (loc) this.setLocation(loc);
    });
    this.setLocation(INCIDENT_LOCATIONS[0]);

    for (const btn of document.querySelectorAll('.inc-btn[data-type]')) {
      btn.addEventListener('click', () => this.trigger(btn.dataset.type));
      btn.addEventListener('mouseenter', () => this.preview(btn.dataset.type));
    }
    $('simAim').addEventListener('click', () => this.placeAtAim());
    $('simStop').addEventListener('click', () => this.stopAll());
    $('simPause').addEventListener('click', () => this.onPause());
    $('btnHud').addEventListener('click', () => this.toggleHud());

    this.bindSegment('simSeverity', 'sev', (v) => { this.severity = v; });
    this.bindSegment('simSpeed', 'speed', (v) => this.onSpeed(Number(v)));

    $('activeIncidents').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-stop]');
      if (btn) {
        hazard.stop(Number(btn.dataset.stop));
        this.renderActive();
      }
    });

    // Keyboard keys and controller buttons (`pad:*`, colour-matched: Y yellow, X blue, B red).
    const actions = {
      1: () => this.trigger('methane'), 'pad:y': () => this.trigger('methane'),
      2: () => this.trigger('water'), 'pad:x': () => this.trigger('water'),
      3: () => this.trigger('fire'), 'pad:b': () => this.trigger('fire'),
      0: () => this.stopAll(), 'pad:back': () => this.stopAll(),
      g: () => this.placeAtAim(), 'pad:a': () => this.placeAtAim(),
      h: () => this.toggleHud(), 'pad:down': () => this.toggleHud(),
      'pad:left': () => this.cycleLocation(-1), 'pad:right': () => this.cycleLocation(1),
      'pad:lb': () => this.cycleSegment('simSeverity', -1), 'pad:rb': () => this.cycleSegment('simSeverity', 1),
      'pad:rt': () => this.cycleSegment('simSpeed', 1, true),
    };
    window.addEventListener('inputKeyDown', ({ detail: { key } }) => actions[key]?.());

    this.renderActive();
  }

  cycleLocation(step) {
    const i = INCIDENT_LOCATIONS.findIndex((l) => l.id === this.location.id);
    const next = INCIDENT_LOCATIONS[(Math.max(i, 0) + step + INCIDENT_LOCATIONS.length) % INCIDENT_LOCATIONS.length];
    this.setLocation(next);
  }

  // Clicks the neighbouring option so the segment's own handler and highlight stay the single source of truth.
  cycleSegment(id, step, wrap = false) {
    const buttons = [...$(id).children];
    const i = buttons.findIndex((b) => b.classList.contains('on'));
    let next = i + step;
    if (wrap) next = (next + buttons.length) % buttons.length;
    buttons[Math.min(buttons.length - 1, Math.max(0, next))].click();
  }

  bindSegment(id, attr, onChange) {
    const seg = $(id);
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      for (const b of seg.children) b.classList.toggle('on', b === btn);
      onChange(btn.dataset[attr]);
    });
  }

  setLocation(loc, custom = false) {
    this.location = loc;
    const select = $('simLocation');
    const opt = select.querySelector('option[value="custom"]');
    if (custom) {
      opt.hidden = false;
      opt.textContent = loc.label;
      select.value = 'custom';
    } else {
      opt.hidden = true;
      select.value = loc.id;
    }
    this.marker.set(loc.x, loc.z, this.previewType);
  }

  // Custom points are named after the tunnel they fall in so the logs stay readable.
  pickPoint({ x, z }, how) {
    const zone = this.zoneAt(x, z) ?? 'MINE';
    this.setLocation({ id: 'custom', label: `${zone} · ${how}`, x, z }, true);
  }

  placeAtAim() {
    const p = this.getAimPoint();
    if (p) this.pickPoint(p, 'AIM');
  }

  preview(type) {
    this.previewType = type;
    this.marker.set(this.location.x, this.location.z, type);
  }

  trigger(type) {
    this.preview(type);
    this.hazard.trigger(type, this.location, this.severity);
    const btn = document.querySelector(`.inc-btn[data-type="${type}"]`);
    btn.classList.remove('fired');
    void btn.offsetWidth;
    btn.classList.add('fired');
    this.renderActive();
  }

  stopAll() {
    this.hazard.stopAll();
    const btn = $('simStop');
    btn.classList.remove('fired');
    void btn.offsetWidth;
    btn.classList.add('fired');
    this.renderActive();
  }

  toggleHud() {
    document.body.classList.toggle('hud-min');
    $('btnHud').classList.toggle('on', document.body.classList.contains('hud-min'));
  }

  setPaused(paused, speed) {
    $('simPause').textContent = paused ? '▶' : '❚❚';
    $('simPause').classList.toggle('on', paused);
    $('simConsole').classList.toggle('sc-paused', paused);
    const status = $('simStatus');
    status.textContent = paused ? 'PAUSED' : `LIVE ${speed}×`;
    status.className = paused ? 'sim-paused' : 'sim-live';
  }

  renderActive() {
    const list = $('activeIncidents');
    const incidents = this.hazard.incidents;
    $('simStop').disabled = !incidents.length;
    if (!incidents.length) {
      const keys = document.body.classList.contains('pad-active') ? 'Y / X / B' : '1 / 2 / 3';
      list.innerHTML = `<li class="none">No active incidents · press ${keys} to inject</li>`;
      return;
    }
    list.innerHTML = incidents.map((inc) => {
      const t = INCIDENT_TYPES[inc.type];
      const pct = Math.round(Math.max(inc.level, inc.coLevel) * 100);
      return `<li class="${inc.type}${inc.clearing ? ' clearing' : ''}">
        <i>${t.icon}</i>${t.short} · ${inc.label} · ${mmss(inc.age)}
        <span class="lvl"><i style="width:${pct}%"></i></span>
        ${inc.clearing ? '<span class="fading">FADING</span>' : ''}<button type="button" data-stop="${inc.id}" title="Stop this incident">✕</button>
      </li>`;
    }).join('');
  }

  update(dt) {
    this.marker.update(dt);
    this.listTimer += dt;
    if (this.listTimer >= 0.5) {
      this.listTimer = 0;
      this.renderActive();
    }
  }
}

export default SimConsole;
