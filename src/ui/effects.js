export const fmt = (n) => Math.round(n).toLocaleString('en-US');

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function utcStamp(ms, tenths = true) {
  const d = new Date(ms);
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return tenths ? `${base}.${Math.floor(d.getUTCMilliseconds() / 100)}` : base;
}

export function signed(n, digits = 0) {
  const v = Number(n.toFixed(digits));
  if (v === 0) return '±0';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function tweenNumber(el, to, format = fmt, duration = 450) {
  const from = el._tweenValue ?? to;
  cancelAnimationFrame(el._tweenRaf);
  if (from === to) {
    el._tweenValue = to;
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el._tweenValue = from + (to - from) * eased;
    el.textContent = format(el._tweenValue);
    if (t < 1) el._tweenRaf = requestAnimationFrame(step);
  };
  el._tweenRaf = requestAnimationFrame(step);
}

// No-op when the element already shows (or is typing) the same text, so frequent re-renders don't restart it.
export function typeText(el, text, { cps = 70, delay = 0 } = {}) {
  if (el._typedText === text) return;
  el._typedText = text;
  clearTimeout(el._typeTimer);
  el.classList.add('typing');
  el.textContent = '';
  let i = 0;
  const tick = () => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i < text.length) el._typeTimer = setTimeout(tick, 1000 / cps);
    else el.classList.remove('typing');
  };
  el._typeTimer = setTimeout(tick, delay);
}

export function drawSparkline(canvas, values, color, { threshold = null, min = null, max = null } = {}) {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;

  let lo = min ?? Math.min(...values);
  let hi = max ?? Math.max(...values);
  if (threshold !== null) { lo = Math.min(lo, threshold); hi = Math.max(hi, threshold * 1.05); }
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = 3;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);

  if (threshold !== null) {
    ctx.strokeStyle = 'rgba(233, 196, 76, 0.4)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y(threshold));
    ctx.lineTo(w, y(threshold));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '00');
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  const last = values[values.length - 1];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(w - 2, y(last), 2, 0, Math.PI * 2);
  ctx.fill();
}
