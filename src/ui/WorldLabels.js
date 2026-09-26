import * as THREE from 'three';
import { fmt } from './effects.js';
import { INCIDENT_TYPES } from '../gameplay/HazardSystem.js';

const $ = (id) => document.getElementById(id);
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const INSPECT_RANGE = 10;
const INSPECT_CONE = Math.cos((7 * Math.PI) / 180);
const INCIDENT_LABEL_RANGE = 60;

export class WorldLabels {
  constructor(camera) {
    this.camera = camera;
    this.route = $('labelRoute');
    this.incidentLayer = $('incidentLabels');
    this.incidentEls = new Map();
    this.tip = $('inspectTip');
    this.tmp = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.toNode = new THREE.Vector3();
  }

  project(x, y, z) {
    const v = this.tmp.set(x, y, z).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind: v.z > 1, w, h };
  }

  // Off-screen targets are pinned to an ellipse around the crosshair, like a waypoint indicator.
  placeClamped(el, p) {
    const { w, h } = p;
    const cx = w / 2, cy = h / 2;
    let dx = p.x - cx, dy = p.y - cy;
    if (p.behind) { dx = -dx; dy = -dy; }
    const rx = w * 0.26, ry = h * 0.26;
    const inside = !p.behind && (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    const angle = Math.atan2(dy, dx);
    const halfW = el.offsetWidth / 2 + 12;
    const x = Math.min(w - halfW, Math.max(halfW, inside ? p.x : cx + Math.cos(angle) * rx));
    const y = Math.min(h - 12, Math.max(el.offsetHeight + 60, inside ? p.y : cy + Math.sin(angle) * ry));
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    el.classList.toggle('edge', !inside);
    return { inside, angle };
  }

  update(objectives, hazard, sensors, playerPos) {
    const { target, distance, evacuating, complete } = objectives;
    const showRoute = evacuating && Number.isFinite(distance) && distance > 3 && !complete;
    this.route.classList.toggle('hidden', !showRoute);
    if (showRoute) {
      const p = this.project(target.x, 2.6, target.z);
      const { inside, angle } = this.placeClamped(this.route, p);
      $('labelRouteKicker').textContent = 'SAFE RETURN ROUTE';
      $('labelRouteName').textContent = titleCase(target.label);
      $('labelRouteDist').textContent = distance;
      this.route.querySelector('.wl-arrow').style.transform = `rotate(${inside ? 90 : (angle * 180) / Math.PI}deg)`;
    }

    this.updateIncidents(hazard, playerPos);
    this.updateInspect(sensors);
  }

  updateIncidents(hazard, playerPos) {
    const seen = new Set();
    for (const inc of hazard.incidents) {
      seen.add(inc.id);
      let el = this.incidentEls.get(inc.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `world-label inc-label ${inc.type}`;
        this.incidentLayer.appendChild(el);
        this.incidentEls.set(inc.id, el);
      }
      const p = this.project(inc.source.x, inc.type === 'water' ? 1.2 : 2.8, inc.source.z);
      const dist = Math.hypot(inc.source.x - playerPos.x, inc.source.z - playerPos.z);
      const visible = !p.behind && p.x > 0 && p.x < p.w && p.y > 0 && p.y < p.h && dist < INCIDENT_LABEL_RANGE;
      el.classList.toggle('hidden', !visible);
      if (!visible) continue;
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(0, -50%)`;
      const t = INCIDENT_TYPES[inc.type];
      const pct = Math.round(Math.max(inc.level, inc.coLevel) * 100);
      el.innerHTML = `<div class="il-top">${t.icon} ${t.label}</div>`
        + `<div class="il-sub">${inc.label} · ${inc.severity.toUpperCase()} · ${inc.clearing ? 'CLEARING' : 'ACTIVE'} ${pct}% · ${Math.round(dist)} m</div>`;
    }
    for (const [id, el] of this.incidentEls) {
      if (seen.has(id)) continue;
      el.remove();
      this.incidentEls.delete(id);
    }
  }

  updateInspect(sensors) {
    this.camera.getWorldDirection(this.forward);
    let hit = null;
    for (const node of sensors.nodes) {
      this.toNode.set(node.x - this.camera.position.x, node.y - this.camera.position.y, node.z - this.camera.position.z);
      if (this.toNode.length() > INSPECT_RANGE) continue;
      if (this.toNode.normalize().dot(this.forward) > INSPECT_CONE) { hit = node; break; }
    }

    document.body.classList.toggle('targeting', !!hit);
    this.tip.classList.toggle('hidden', !hit || !hit.reading);
    if (hit?.reading) {
      const r = hit.reading;
      this.tip.innerHTML =
        `<b>${hit.id}</b> · ${hit.zone} · ${hit.mount === 'air' ? 'AIR UNIT' : 'FLOOR UNIT'} · ${r.submerged ? 'SUBMERGED' : r.level === 'normal' ? 'NOMINAL' : r.level.toUpperCase()}<br>`
        + `CH₄ ${fmt(r.methane)} ppm · CO ${Math.round(r.co)} ppm<br>`
        + `${r.temperature.toFixed(1)} °C · water ${Math.round(r.water)} cm · BAT ${Math.round(r.battery)}%`;
    }
  }
}

export default WorldLabels;
