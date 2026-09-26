import { esc, clock, wallTime } from './Panels.js';
import { MQ_MODELS, CO_TWA_PPM } from './gas.js';
import { METRIC_NAME } from './Store.js';

const UNIT = { gas: 'ppm', hum: '%RH', water: 'cm', pres: 'hPa' };

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function alarmRows(store) {
  const now = store.now;
  return store.alarms.map((a) => ({
    metric: METRIC_NAME[a.metric],
    node: `${a.nodeId}${a.physical ? ' (PU-01)' : ''}`,
    zone: a.zone,
    level: a.level,
    start: clock(a.start),
    duration: clock((a.end ?? now) - a.start),
    peak: `${a.metric === 'hum' || a.metric === 'pres' ? a.peak.toFixed(1) : Math.round(a.peak)} ${UNIT[a.metric]}`,
    status: a.end === null ? 'active' : 'cleared',
  }));
}

export function exportCsv(store, settings) {
  const lines = [
    '# MINE SENTINEL sensor export',
    `# generated ${new Date().toISOString()}`,
    `# source ${store.source.kind} ${store.source.detail}`,
    `# gas sensor ${settings.sensorModel}, ADC max ${settings.adcMax}, R0 ${settings.r0 === null ? 'uncalibrated' : settings.r0.toFixed(4)}`,
    '',
    '# PHYSICAL UNIT SAMPLES (PU-01)',
    csvRow(['time (UTC)', 'gas raw', 'CO ppm', 'humidity %RH', 'temperature C', 'pressure hPa', 'water cm']),
  ];
  for (const s of store.samples) {
    lines.push(csvRow([new Date(s.time).toISOString(), s.gas ?? '', s.ppm === undefined ? '' : Math.round(s.ppm),
      s.hum ?? '', s.temp ?? '', s.pres ?? '', s.water ?? '']));
  }
  lines.push('', '# ALARMS', csvRow(['metric', 'node', 'zone', 'level', 'start (session)', 'duration', 'peak', 'status']));
  for (const r of alarmRows(store)) lines.push(csvRow(Object.values(r)));
  lines.push('', '# EVENTS', csvRow(['time (UTC)', 'level', 'event']));
  for (const e of store.events.slice().reverse()) lines.push(csvRow([new Date(e.time).toISOString(), e.level, e.text]));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  download(`mine-sentinel-sensors-${stamp}.csv`, lines.join('\n'));
}

// Fills the print-only report section, then opens the browser print dialog (save as PDF from there).
export function printReport(store, settings, mapCanvas) {
  const phys = store.nodes.find((n) => n.physical);
  const rows = alarmRows(store);
  const peak = (k, unit, digits = 0) => (store.peaks[k] ? `${store.peaks[k].value.toFixed(digits)} ${unit} (${store.peaks[k].nodeId})` : '—');
  const map = mapCanvas.width ? `<img src="${mapCanvas.toDataURL('image/png')}" alt="Sensor network at report time">` : '';

  document.getElementById('report').innerHTML = `
    <h1>MINE SENTINEL — Sensor Report</h1>
    <div class="meta">Generated ${esc(new Date().toUTCString())} · session ${clock(store.now)} · source ${esc(store.source.kind.toUpperCase())} ${esc(store.source.detail)}</div>
    <h2>Physical unit PU-01</h2>
    <div class="kpi-row">
      <div>Location<br><b>${esc(phys ? `${phys.id} · ${phys.zone}` : '—')}</b></div>
      <div>Gas sensor<br><b>${esc(MQ_MODELS[settings.sensorModel].label)}</b></div>
      <div>Calibration<br><b>${settings.r0 === null ? 'Uncalibrated estimate' : `R0 ${settings.r0.toFixed(3)}`}</b></div>
      <div>Packets<br><b>${store.packets.count} (${store.packets.errors} errors)</b></div>
      <div>CO now<br><b>${phys ? `${Math.round(phys.gas)} ppm · ${(phys.gas / CO_TWA_PPM).toFixed(1)}× 8-h limit` : '—'}</b></div>
      <div>Humidity now<br><b>${phys ? `${phys.hum.toFixed(1)} %RH` : '—'}</b></div>
      <div>Peak CO<br><b>${esc(peak('gas', 'ppm'))}</b></div>
      <div>Peak humidity<br><b>${esc(peak('hum', '%RH', 1))}</b></div>
    </div>
    <h2>Sensor network</h2>
    ${map}
    <h2>Alarms</h2>
    <table><thead><tr><th>Metric</th><th>Node</th><th>Zone</th><th>Level</th><th>Start</th><th>Duration</th><th>Peak</th><th>Status</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>${Object.values(r).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="8">No alarms</td></tr>'}</tbody></table>
    <h2>Event log (latest 120)</h2>
    <table><thead><tr><th>Time (UTC)</th><th>Level</th><th>Event</th></tr></thead>
    <tbody>${store.events.slice(0, 120).map((e) => `<tr><td>${wallTime(e.time)}</td><td>${esc(e.level)}</td><td>${esc(e.text)}</td></tr>`).join('')}</tbody></table>`;
  window.print();
}
