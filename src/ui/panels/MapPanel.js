import CONFIG from '../../config.js';
import { LOCATIONS } from '../../world/MineLayout.js';

const LEVEL_COLOR = { normal: '#5fd488', elevated: '#e9c44c', critical: '#ff5d4a' };
const TYPE_COLOR = { methane: '#e9c44c', water: '#4fb3d9', fire: '#ff6a2a' };
const TYPE_ICON = { methane: '◆', water: '▼', fire: '▲' };
// Rotated so north (-z) points right: the long main shaft fits the wide panel.
const VIEW = { zMin: -91, zMax: 7, xMin: -7, xMax: 27 };
const LABELS = [
  [LOCATIONS.ENTRY_A, -10, 15], [LOCATIONS.JUNCTION_A, -18, -16],
  [LOCATIONS.TUNNEL_B, -4, 14], [LOCATIONS.NORTH_DRIFT, -26, -9],
];
const S = CONFIG.SENSORS;

export class MapPanel {
  constructor(canvas, layout, hazard, sensors, onPick) {
    this.canvas = canvas;
    this.layout = layout;
    this.hazard = hazard;
    this.sensors = sensors;
    this.ctx = canvas.getContext('2d');
    this.baseLayer = document.createElement('canvas');
    this.hazardLayer = document.createElement('canvas');
    this.time = 0;
    this.placement = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());

    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const { x, z } = this.fromMap(e.clientX - r.left, e.clientY - r.top);
      if (layout.isWalkable(x, z)) onPick({ x, z });
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = this.canvas.clientWidth || 226;
    const h = this.canvas.clientHeight || 96;
    for (const c of [this.canvas, this.baseLayer, this.hazardLayer]) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    this.dpr = dpr;
    this.scale = Math.min(w / (VIEW.zMax - VIEW.zMin), h / (VIEW.xMax - VIEW.xMin));
    this.offsetX = (w - (VIEW.zMax - VIEW.zMin) * this.scale) / 2;
    this.offsetY = (h - (VIEW.xMax - VIEW.xMin) * this.scale) / 2;
    this.renderBase();
    this.renderHazards();
  }

  toMap(x, z) {
    return [this.offsetX + (VIEW.zMax - z) * this.scale, this.offsetY + (x - VIEW.xMin) * this.scale];
  }

  fromMap(sx, sy) {
    return { x: (sy - this.offsetY) / this.scale + VIEW.xMin, z: VIEW.zMax - (sx - this.offsetX) / this.scale };
  }

  forEachCell(fn) {
    const { layout } = this;
    for (let iz = 0; iz < layout.rows; iz++) {
      for (let ix = 0; ix < layout.cols; ix++) {
        if (layout.isWalkableCell(ix, iz)) fn(layout.cellCenter(ix, iz), ix, iz);
      }
    }
  }

  renderBase() {
    const ctx = this.baseLayer.getContext('2d');
    const s = this.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.baseLayer.width, this.baseLayer.height);

    ctx.fillStyle = 'rgba(111, 169, 162, 0.22)';
    this.forEachCell(({ x, z }) => {
      const [sx, sy] = this.toMap(x, z);
      ctx.fillRect(sx - s / 2, sy - s / 2, s + 0.5, s + 0.5);
    });

    ctx.fillStyle = 'rgba(160, 205, 198, 0.55)';
    this.forEachCell(({ x, z }, ix, iz) => {
      const [sx, sy] = this.toMap(x, z);
      if (!this.layout.isWalkableCell(ix + 1, iz)) ctx.fillRect(sx - s / 2, sy + s / 2 - 0.6, s, 1);
      if (!this.layout.isWalkableCell(ix - 1, iz)) ctx.fillRect(sx - s / 2, sy - s / 2 - 0.4, s, 1);
      if (!this.layout.isWalkableCell(ix, iz + 1)) ctx.fillRect(sx - s / 2 - 0.4, sy - s / 2, 1, s);
      if (!this.layout.isWalkableCell(ix, iz - 1)) ctx.fillRect(sx + s / 2 - 0.6, sy - s / 2, 1, s);
    });

    ctx.font = '500 8px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8f9b96';
    for (const [loc, dx, dy] of LABELS) {
      const [sx, sy] = this.toMap(loc.x, loc.z);
      ctx.fillText(loc.label, sx + dx, sy + dy);
    }
  }

  // One cell pass paints all three hazard kinds; the worst (by ratio) wins the cell colour.
  renderHazards() {
    const ctx = this.hazardLayer.getContext('2d');
    const s = this.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.hazardLayer.width, this.hazardLayer.height);
    if (!this.hazard.incidents.length) return;

    const h = this.hazard;
    this.forEachCell(({ x, z }) => {
      const gas = h.methaneAt(x, z) / S.METHANE.ALERT_THRESHOLD;
      const fire = Math.max(h.coAt(x, z) / S.CO.ALERT_THRESHOLD, (h.temperatureAt(x, z) - S.TEMPERATURE.AMBIENT) / 13);
      const water = (h.waterDepthAt(x, z) * 100) / S.WATER.ALERT_THRESHOLD;
      const top = Math.max(gas, fire, water);
      if (top < 0.3) return;
      const a = Math.min(0.75, 0.15 + top * 0.3);
      ctx.fillStyle = top === water ? `rgba(79, 179, 217, ${a})`
        : top === fire ? `rgba(255, 106, 42, ${a})`
        : gas >= 1 ? `rgba(255, 93, 74, ${a})` : `rgba(233, 196, 76, ${a})`;
      const [sx, sy] = this.toMap(x, z);
      ctx.fillRect(sx - s / 2, sy - s / 2, s + 0.5, s + 0.5);
    });
  }

  draw(dt, player, route) {
    this.time += dt;
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.baseLayer, 0, 0);
    ctx.drawImage(this.hazardLayer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (route.length > 1) {
      ctx.strokeStyle = '#e9c44c';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -this.time * 12;
      ctx.beginPath();
      route.forEach((p, i) => {
        const [sx, sy] = this.toMap(p.x, p.z);
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const node of this.sensors.nodes) {
      const [sx, sy] = this.toMap(node.x, node.z);
      const level = node.reading?.level ?? 'normal';
      if (level !== 'normal') {
        const phase = (this.time * 0.8 + node.phase) % 1;
        ctx.strokeStyle = LEVEL_COLOR[level];
        ctx.globalAlpha = 1 - phase;
        ctx.beginPath();
        ctx.arc(sx, sy, 2 + phase * 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = LEVEL_COLOR[level];
      // Air units are dots, floor units are squares — matches the zig-zag mounting in the tunnels.
      if (node.mount === 'floor') {
        ctx.fillRect(sx - 1.7, sy - 1.7, 3.4, 3.4);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const inc of this.hazard.incidents) {
      const [sx, sy] = this.toMap(inc.source.x, inc.source.z);
      ctx.fillStyle = TYPE_COLOR[inc.type];
      ctx.globalAlpha = inc.clearing ? 0.4 : 1;
      ctx.fillText(TYPE_ICON[inc.type], sx, sy);
      ctx.globalAlpha = 1;
    }

    if (this.placement) {
      const [sx, sy] = this.toMap(this.placement.x, this.placement.z);
      ctx.strokeStyle = '#dfe2d6';
      ctx.lineWidth = 1;
      const r = 3.5 + Math.sin(this.time * 5) * 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.moveTo(sx - r - 2, sy); ctx.lineTo(sx - r + 1, sy);
      ctx.moveTo(sx + r - 1, sy); ctx.lineTo(sx + r + 2, sy);
      ctx.stroke();
    }

    const [px, py] = this.toMap(player.position.x, player.position.z);
    const angle = Math.atan2(-Math.sin(player.heading), Math.cos(player.heading));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(233, 196, 76, 0.14)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 12, -0.5, 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f0d85b';
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-3.5, -3.5);
    ctx.lineTo(-1.5, 0);
    ctx.lineTo(-3.5, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export default MapPanel;
