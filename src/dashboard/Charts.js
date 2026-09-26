import { THEME } from './theme.js';
import { BASE_PRESSURE } from './NetworkModel.js';

const WINDOW = 300;
const LEVEL = THEME.trend;

export const METRIC_UI = {
  gas: { unit: 'ppm', format: (v) => `${Math.round(v).toLocaleString('en-US')} ppm` },
  hum: { unit: '%RH', format: (v) => `${v.toFixed(1)} %RH` },
  pres: { unit: 'hPa', format: (v) => `${v.toFixed(2)} hPa` },
  water: { unit: 'cm', format: (v) => `${Math.round(v)} cm` },
};

export function thresholds(metric, s) {
  if (metric === 'gas') return [s.gasWarn, s.gasAlarm];
  if (metric === 'hum') return [s.humWarn, s.humAlarm];
  if (metric === 'water') return [s.waterWarn, s.waterAlarm];
  return [];
}

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// One metric across every node: others faint, the selected node bright, thresholds dashed, hover readout.
export class TrendChart {
  constructor(canvas, metric, store, settings, valueEl) {
    Object.assign(this, { canvas, metric, store, settings, valueEl });
    this.hoverX = null;
    canvas.addEventListener('mousemove', (e) => { this.hoverX = e.clientX - canvas.getBoundingClientRect().left; });
    canvas.addEventListener('mouseleave', () => { this.hoverX = null; });
  }

  draw(selectedId) {
    const { ctx, w, h } = setup(this.canvas);
    const { store, metric } = this;
    const now = store.now;
    const t0 = now - WINDOW;
    const pad = { l: 50, r: 10, t: 10, b: 20 };
    const limits = thresholds(metric, this.settings);

    const values = [];
    for (const hist of store.history.values()) for (const v of hist[metric]) if (v !== null) values.push(v);
    if (!values.length) return;
    let lo, hi;
    if (metric === 'pres') {
      lo = Math.min(BASE_PRESSURE - 1, ...values) - 0.2;
      hi = Math.max(BASE_PRESSURE + 1, ...values) + 0.2;
    } else {
      lo = 0;
      hi = Math.max(limits[0] * 1.15, Math.max(...values) * 1.08);
    }

    const x = (t) => pad.l + ((t - t0) / WINDOW) * (w - pad.l - pad.r);
    const y = (v) => h - pad.b - ((v - lo) / (hi - lo)) * (h - pad.t - pad.b);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = THEME.dim;
    ctx.strokeStyle = THEME.grid;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3;
      ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
      const label = metric === 'pres' ? v.toFixed(1) : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : Math.round(v);
      ctx.fillText(label, pad.l - 6, y(v) + 3);
    }
    ctx.textAlign = 'center';
    for (let s = 0; s <= WINDOW; s += 60) ctx.fillText(s === WINDOW ? 'now' : `−${(WINDOW - s) / 60}m`, x(t0 + s), h - 5);

    [[limits[0], THEME.alertLine], [limits[1], THEME.critLine]].forEach(([v, color]) => {
      if (v === undefined || v > hi) return;
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
      ctx.setLineDash([]);
    });

    const line = (hist, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      hist.t.forEach((t, i) => {
        const v = hist[metric][i];
        if (t < t0 || v === null) return;
        started ? ctx.lineTo(x(t), y(v)) : ctx.moveTo(x(t), y(v));
        started = true;
      });
      ctx.stroke();
    };

    for (const [id, hist] of store.history) if (id !== selectedId) line(hist, THEME.otherLine, 1);
    const sel = store.history.get(selectedId);
    const node = store.nodes.find((n) => n.id === selectedId);
    const color = LEVEL[node?.levels[metric] ?? 'normal'];
    if (sel) line(sel, color, 2.2);

    let shown = sel?.[metric].at(-1) ?? null;
    if (sel && this.hoverX !== null && this.hoverX > pad.l) {
      const tHover = t0 + ((this.hoverX - pad.l) / (w - pad.l - pad.r)) * WINDOW;
      let best = -1, bestD = Infinity;
      sel.t.forEach((t, i) => { const d = Math.abs(t - tHover); if (d < bestD) { bestD = d; best = i; } });
      if (best >= 0 && sel[metric][best] !== null) {
        shown = sel[metric][best];
        ctx.strokeStyle = THEME.hoverLine;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x(sel.t[best]), pad.t); ctx.lineTo(x(sel.t[best]), h - pad.b); ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x(sel.t[best]), y(shown), 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (this.valueEl) this.valueEl.textContent = shown === null ? '—' : METRIC_UI[metric].format(shown);
  }
}

// Semicircle gauge with normal / warning / alarm zones and a needle.
export function drawGauge(canvas, value, { min, max, zones }) {
  const { ctx, w, h } = setup(canvas);
  const cx = w / 2, cy = h - 8, r = Math.min(w / 2 - 8, h - 16);
  const a = (v) => Math.PI + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * Math.PI;
  ctx.lineWidth = 10;
  ctx.lineCap = 'butt';
  for (const [from, to, color] of zones) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a(from), a(to));
    ctx.stroke();
  }
  if (value === null || value === undefined) return;
  const ang = a(value);
  ctx.strokeStyle = THEME.text;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(ang) * (r - 4), cy + Math.sin(ang) * (r - 4));
  ctx.stroke();
  ctx.fillStyle = THEME.text;
  ctx.beginPath();
  ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

const METRIC_COLOR = { gas: THEME.type.methane, hum: THEME.trend.normal, water: THEME.type.water, pres: '#7a5cc4' };
const METRIC_SHORT = { gas: 'CO', hum: 'RH', water: 'H₂O', pres: 'hPa' };

// Gantt of alarms this session (latest rows), coloured by metric; critical alarms outlined.
export function drawAlarmTimeline(canvas, store) {
  const { ctx, w, h } = setup(canvas);
  const now = store.now;
  const list = store.alarms.slice(-7);
  const start = list.length ? Math.max(0, Math.min(...list.map((a) => a.start)) - 10) : Math.max(0, now - 120);
  const end = Math.max(now, start + 60);
  const pad = { l: 12, r: 12, t: 8, b: 18 };
  const x = (t) => pad.l + ((t - start) / (end - start)) * (w - pad.l - pad.r);

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = THEME.dim;
  ctx.textAlign = 'center';
  const step = Math.max(10, Math.ceil((end - start) / 8 / 10) * 10);
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) {
    ctx.strokeStyle = THEME.grid;
    ctx.beginPath(); ctx.moveTo(x(t), pad.t); ctx.lineTo(x(t), h - pad.b); ctx.stroke();
    ctx.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, x(t), h - 5);
  }

  if (!list.length) {
    ctx.fillStyle = THEME.muted;
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText('No alarms this session', w / 2, h / 2);
    return;
  }

  const rowH = (h - pad.t - pad.b) / list.length;
  list.forEach((al, i) => {
    const y0 = pad.t + i * rowH + 3;
    const bh = rowH - 6;
    const x0 = x(al.start), x1 = x(al.end ?? now);
    ctx.fillStyle = METRIC_COLOR[al.metric];
    ctx.globalAlpha = al.end === null ? 0.9 : 0.4;
    ctx.fillRect(x0, y0, Math.max(3, x1 - x0), bh);
    ctx.globalAlpha = 1;
    if (al.level === 'critical') {
      ctx.strokeStyle = THEME.level.critical;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y0, Math.max(3, x1 - x0), bh);
    }
    ctx.fillStyle = x1 - x0 > 110 ? '#ffffff' : THEME.soft;
    ctx.textAlign = 'left';
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillText(`${METRIC_SHORT[al.metric]} · ${al.nodeId}${al.physical ? ' PU-01' : ''}`, x1 - x0 > 110 ? x0 + 6 : x1 + 6, y0 + bh / 2 + 3.5);
  });

  ctx.strokeStyle = THEME.nowLine;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x(now), pad.t); ctx.lineTo(x(now), h - pad.b); ctx.stroke();
  ctx.setLineDash([]);
}
