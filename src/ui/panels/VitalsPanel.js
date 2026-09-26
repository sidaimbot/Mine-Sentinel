import { tweenNumber } from '../effects.js';

const $ = (id) => document.getElementById(id);

// `higherIsBetter` flips the comparison: oxygen is bad when low, dose/heat are bad when high.
// `scale` maps the value onto the bar's 0–100% width.
const VITALS = [
  { key: 'oxygen', el: 'Oxygen', warn: 90, crit: 80, higherIsBetter: true, scale: (v) => v, pad: 0, status: 'Low O₂' },
  { key: 'exposure', el: 'Exposure', warn: 30, crit: 50, higherIsBetter: false, scale: (v) => v, pad: 2, status: 'High dose' },
  { key: 'heat', el: 'Heat', warn: 40, crit: 55, higherIsBetter: false, scale: (v) => (v / 100) * 100, pad: 0, status: 'Heat stress' },
];

export class VitalsPanel {
  render(vitals) {
    let worst = { severity: 0, text: null };

    for (const v of VITALS) {
      const value = vitals[v.key];
      const bad = (limit) => (v.higherIsBetter ? value < limit : value > limit);
      const severity = bad(v.crit) ? 2 : bad(v.warn) ? 1 : 0;
      if (severity > worst.severity) worst = { severity, text: v.status };

      $(`vital${v.el}`).className = `vital ${['', 'warn', 'crit'][severity]}`;
      tweenNumber($(`v${v.el}`), value, (n) => String(Math.round(n)).padStart(v.pad, '0'));
      $(`bar${v.el}`).style.width = `${Math.max(2, Math.min(100, v.scale(value)))}%`;
    }

    const status = $('vitalsStatus');
    status.className = `pill ${['ok', 'warn', 'crit blinking'][worst.severity]}`;
    status.textContent = worst.text ?? 'Nominal';
  }
}

export default VitalsPanel;
