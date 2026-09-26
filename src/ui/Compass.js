const SPAN = 140;
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

// Bearing in degrees clockwise from north (-z) toward east (+x).
export const bearing = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
export const headingFromYaw = (yaw) => bearing(-Math.sin(yaw), -Math.cos(yaw));

const wrap = (d) => ((d + 540) % 360) - 180;

export class Compass {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(heading, markers) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w) return;
    if (this.canvas.width !== w * dpr) { this.canvas.width = w * dpr; this.canvas.height = h * dpr; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pxPerDeg = w / SPAN;
    const cx = w / 2;
    const fade = ctx.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(223,226,214,0)');
    fade.addColorStop(0.2, 'rgba(223,226,214,0.7)');
    fade.addColorStop(0.8, 'rgba(223,226,214,0.7)');
    fade.addColorStop(1, 'rgba(223,226,214,0)');

    ctx.strokeStyle = fade;
    ctx.fillStyle = fade;
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    const start = Math.floor((heading - SPAN / 2) / 5) * 5;
    for (let deg = start; deg <= heading + SPAN / 2; deg += 5) {
      const norm = ((deg % 360) + 360) % 360;
      const x = cx + wrap(norm - heading) * pxPerDeg;
      const major = norm % 45 === 0;
      ctx.lineWidth = major ? 1.2 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x, h - 2);
      ctx.lineTo(x, h - (major ? 10 : norm % 15 === 0 ? 7 : 4));
      ctx.stroke();
      if (major) ctx.fillText(CARDINALS[norm], x, h - 14);
    }

    for (const m of markers) {
      const offset = wrap(m.bearing - heading);
      const clamped = Math.max(-SPAN / 2 + 4, Math.min(SPAN / 2 - 4, offset));
      const x = cx + clamped * pxPerDeg;
      ctx.fillStyle = m.color;
      ctx.shadowColor = m.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      if (m.shape === 'diamond') {
        ctx.moveTo(x, 2); ctx.lineTo(x + 5, 7); ctx.lineTo(x, 12); ctx.lineTo(x - 5, 7);
      } else {
        ctx.moveTo(x, 12); ctx.lineTo(x + 5, 3); ctx.lineTo(x - 5, 3);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = '#e9c44c';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillText(String(Math.round(heading) % 360).padStart(3, '0'), cx, 10);
    ctx.fillRect(cx - 0.5, h - 12, 1, 12);
  }
}

export default Compass;
