import CONFIG from '../../config.js';
import { fmt, signed, tweenNumber, drawSparkline } from '../effects.js';

const $ = (id) => document.getElementById(id);
const S = CONFIG.SENSORS;
const LEVEL_COLOR = { normal: '#6fa9a2', elevated: '#e9c44c', critical: '#ff5d4a' };
const ROW_CLASS = { normal: '', elevated: 'warn', critical: 'crit' };

const ROWS = [
  { id: 'rowMethane', key: 'methane', format: fmt, digits: 0, threshold: S.METHANE.ALERT_THRESHOLD, min: 0, upAlarm: 500 },
  { id: 'rowCo', key: 'co', format: (v) => Math.round(v), digits: 0, threshold: S.CO.ALERT_THRESHOLD, min: 0, upAlarm: 10 },
  { id: 'rowTemperature', key: 'temperature', format: (v) => v.toFixed(1), digits: 1, threshold: S.TEMPERATURE.ALERT_THRESHOLD, min: null, upAlarm: 3 },
  { id: 'rowWater', key: 'water', format: (v) => Math.round(v), digits: 0, threshold: S.WATER.ALERT_THRESHOLD, min: 0, upAlarm: 3 },
];

export class SensorPanel {
  constructor() {
    this.rows = ROWS.map((r) => {
      const tr = $(r.id);
      return { ...r, tr, val: tr.querySelector('[data-val]'), chg: tr.querySelector('[data-chg]'), spark: tr.querySelector('.spark') };
    });
  }

  render(node) {
    const r = node?.reading;
    if (!r) return;

    $('matrixNode').textContent = `${node.id} · ${node.zone}`;
    $('matrixMount').textContent = node.mount === 'air' ? 'AIR UNIT' : 'FLOOR UNIT';
    const nodeLevel = $('nodeLevel');
    nodeLevel.textContent = r.level === 'normal' ? 'Nominal' : r.level === 'elevated' ? 'Elevated' : 'Critical';
    nodeLevel.className = `pill ${{ normal: 'ok', elevated: 'warn', critical: 'crit' }[r.level]}`;
    $('nodeFooter').textContent = `Battery ${Math.round(r.battery)}% · ${r.submerged ? 'submerged, still reporting' : 'link OK'}`;

    for (const row of this.rows) {
      const level = r.levels[row.key];
      const change = r.change[row.key];
      tweenNumber(row.val, r[row.key], row.format, 350);
      row.chg.textContent = signed(change, row.digits);
      row.chg.classList.toggle('up', change > row.upAlarm);
      row.tr.className = ROW_CLASS[level];
      // Only draw the threshold line once the series gets near it, otherwise it flattens quiet data.
      const peak = Math.max(...r.history[row.key]);
      drawSparkline(row.spark, r.history[row.key], LEVEL_COLOR[level], {
        threshold: peak > row.threshold * 0.5 ? row.threshold : null,
        min: row.min,
      });
    }
  }
}

export default SensorPanel;
