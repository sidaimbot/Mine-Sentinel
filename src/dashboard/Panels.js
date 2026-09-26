import { THEME } from './theme.js';
import { CO_TWA_PPM, CO_IDLH_PPM, MQ_MODELS } from './gas.js';
import { BASE_PRESSURE } from './NetworkModel.js';
import { drawGauge } from './Charts.js';
import { METRIC_NAME } from './Store.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
export const wallTime = (ms) => new Date(ms).toISOString().slice(11, 19);
const TONE = { normal: 'ok', elevated: 'warn', critical: 'crit' };

// Magnus formula; valid for roughly −45…60 °C.
function dewPoint(tempC, rh) {
  const g = Math.log(Math.max(1, rh) / 100) + (17.62 * tempC) / (243.12 + tempC);
  return (243.12 * g) / (17.62 - g);
}

// Least-squares slope (units per second) of the last `seconds` of history.
function slope(points) {
  if (points.length < 4) return 0;
  const n = points.length;
  const mt = points.reduce((s, p) => s + p.t, 0) / n;
  const mv = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) ** 2; }
  return den ? num / den : 0;
}

function kpi(id, value, sub, tone = '') {
  const el = $(id);
  el.className = `kpi ${tone}`;
  el.querySelector('b').textContent = value;
  el.querySelector('small').textContent = sub;
}

export function renderKpis(store, settings) {
  const phys = store.nodes.find((n) => n.physical);
  if (!phys) return;
  const src = store.source.kind;
  if (src !== 'usb') kpi('kpiUnit', 'No board', 'click ⏚ Connect USB', 'warn');
  else kpi('kpiUnit', phys.offline ? 'No signal' : 'Live', phys.offline ? 'no packets from PU-01' : store.source.detail, phys.offline ? 'crit' : 'ok');

  const open = [...store.openAlarms.values()];
  kpi('kpiAlarms', open.length, open.length ? open.map((a) => `${a.nodeId} ${METRIC_NAME[a.metric]}`).join(', ') : 'none active',
    open.some((a) => a.level === 'critical') ? 'crit' : open.length ? 'warn' : 'ok');

  const alarming = store.nodes.filter((n) => n.level !== 'normal');
  kpi('kpiNodes', `${alarming.length}/${store.nodes.length}`, `${store.nodes.filter((n) => !n.offline).length}/${store.nodes.length} reporting`,
    alarming.some((n) => n.level === 'critical') ? 'crit' : alarming.length ? 'warn' : 'ok');

  const p = store.peaks;
  kpi('kpiPeakGas', p.gas ? fmt(p.gas.value) : '—', p.gas ? `ppm · ${p.gas.nodeId} at ${wallTime(p.gas.time)}` : 'session max',
    !p.gas ? '' : p.gas.value >= settings.gasAlarm ? 'crit' : p.gas.value >= settings.gasWarn ? 'warn' : 'ok');
  kpi('kpiPeakHum', p.hum ? `${p.hum.value.toFixed(1)}%` : '—', p.hum ? `${p.hum.nodeId} at ${wallTime(p.hum.time)}` : 'session max');

  const age = store.packetAge;
  if (src !== 'usb') kpi('kpiLink', '—', 'not connected');
  else kpi('kpiLink', `${store.packets.rate.toFixed(1)}/s`,
    `${fmt(store.packets.count)} packets · ${store.packets.errors} errors · last ${Number.isFinite(age) ? `${age.toFixed(1)} s` : '—'} ago`,
    age > 3 ? 'crit' : store.packets.errors > 0 ? 'warn' : 'ok');
}

const GAUGE_ZONES = {
  gas: (s) => ({ min: 0, max: s.gasAlarm * 1.5, zones: [[0, s.gasWarn, THEME.level.normal], [s.gasWarn, s.gasAlarm, THEME.level.elevated], [s.gasAlarm, s.gasAlarm * 1.5, THEME.level.critical]] }),
  hum: (s) => ({ min: 0, max: 100, zones: [[0, s.humWarn, THEME.level.normal], [s.humWarn, s.humAlarm, THEME.level.elevated], [s.humAlarm, 100, THEME.level.critical]] }),
  pres: () => ({ min: BASE_PRESSURE - 6, max: BASE_PRESSURE + 6, zones: [[BASE_PRESSURE - 6, BASE_PRESSURE - 4, THEME.level.elevated], [BASE_PRESSURE - 4, BASE_PRESSURE + 4, THEME.level.normal], [BASE_PRESSURE + 4, BASE_PRESSURE + 6, THEME.level.elevated]] }),
  water: (s) => ({ min: 0, max: s.waterAlarm * 1.4, zones: [[0, s.waterWarn, THEME.level.normal], [s.waterWarn, s.waterAlarm, THEME.level.elevated], [s.waterAlarm, s.waterAlarm * 1.4, THEME.level.critical]] }),
};

export function renderUnit(store, settings) {
  const n = store.nodes.find((x) => x.physical);
  if (!n) return;
  const live = store.live;
  $('unitTitle').textContent = `${n.id} · ${titleCase(n.zone)}`;
  const cal = settings.r0 === null ? 'uncalibrated (estimate)' : 'calibrated';
  $('unitMeta').textContent = `${MQ_MODELS[settings.sensorModel].label} · ${cal} · ${settings.adcMax === 4095 ? '12-bit' : '10-bit'} ADC · ${settings.baud} baud`;
  $('unitCard').classList.toggle('offline', n.offline);

  const card = (key, value, text, sub, level) => {
    const el = $(`m_${key}`);
    el.className = `metric ${TONE[level] ?? ''}`;
    el.querySelector('.value').textContent = text;
    el.querySelector('.sub').textContent = sub;
    const badge = el.querySelector('.src');
    const isLive = !!n.live[key] && !n.offline;
    const hw = key === 'gas' || key === 'hum';
    badge.textContent = n.offline && hw ? (store.source.kind === 'usb' ? 'NO SIGNAL' : 'NO BOARD') : isLive ? 'LIVE' : 'SIM';
    badge.className = `src ${n.offline && hw ? 'off' : isLive ? 'live' : 'sim'}`;
    drawGauge(el.querySelector('canvas'), value, GAUGE_ZONES[key](settings));
  };

  if (!live) {
    card('gas', null, '—', 'waiting for the board', 'normal');
    card('hum', null, '—', 'waiting for the board', 'normal');
  } else {
    card('gas', n.gas, store.calibrating ? '…' : fmt(n.gas), store.calibrating ? `learning clean-air baseline · raw ${live.gas ?? '—'}/${settings.adcMax}` : `${n.gas > CO_TWA_PPM ? 'above 8-h limit' : `8-h limit ${CO_TWA_PPM} ppm`} · raw ${live.gas ?? '—'}/${settings.adcMax}`, n.levels.gas);
    const dew = dewPoint(n.temp, n.hum);
    card('hum', n.hum, n.hum.toFixed(1), `${n.temp.toFixed(1)} °C${n.live.temp ? '' : ' (sim)'} · dew point ${dew.toFixed(1)} °C`, n.levels.hum);
  }
  const presTrend = slope(store.historyWindow(n.id, 'pres', 60)) * 60;
  card('pres', n.pres, n.pres.toFixed(1), `${presTrend >= 0 ? '+' : ''}${presTrend.toFixed(2)} hPa/min · ${n.pres - BASE_PRESSURE >= 0 ? '+' : ''}${(n.pres - BASE_PRESSURE).toFixed(2)} vs baseline`, n.levels.pres);
  card('water', n.water, Math.round(n.water), `floor probe · alarm at ${settings.waterAlarm} cm`, n.levels.water);
}

export function renderAnalysis(store, settings) {
  const n = store.nodes.find((x) => x.physical);
  if (!n) return;
  const rate = slope(store.historyWindow(n.id, 'gas', 20)) * 60;
  const pill = $('anPill');
  const lines = [];
  let headline, tone, advice;

  if (!store.live) {
    pill.className = 'pill warn';
    pill.textContent = 'No board';
    $('anHeadline').textContent = 'Waiting for sensor unit';
    $('anAdvice').textContent = 'Connect the board by USB and click ⏚ Connect USB. Gas and humidity come only from the hardware.';
    $('anLines').innerHTML = '';
    $('anLel').style.width = '0%';
    return;
  }

  if (n.offline) {
    headline = 'No data from PU-01';
    tone = 'crit';
    advice = 'Check the USB cable and board power. Readings are frozen at the last packet.';
  } else if (n.levels.gas === 'critical') {
    headline = 'CO at alarm level';
    tone = 'crit';
    advice = `Withdraw personnel from ${titleCase(n.zone)} and don self-rescuers — CO this high points to a fire or blast fumes.`;
  } else if (n.levels.gas === 'elevated') {
    headline = 'CO elevated';
    tone = 'warn';
    advice = `Increase ventilation in ${titleCase(n.zone)}, look for a heating, smouldering belt or diesel source, and limit exposure time.`;
  } else if (rate > 5) {
    headline = 'CO rising';
    tone = 'warn';
    advice = 'Readings are within limits but climbing — check for smoke or a heating with a portable detector.';
  } else if (n.levels.hum !== 'normal') {
    headline = n.levels.hum === 'critical' ? 'Air saturated' : 'Humidity high';
    tone = n.levels.hum === 'critical' ? 'crit' : 'warn';
    advice = 'Check drainage, dewatering pumps and ventilation; protect electrical equipment from condensation.';
  } else {
    headline = 'All readings within limits';
    tone = 'ok';
    advice = 'No action required.';
  }

  const trendWord = Math.abs(rate) < 2 ? 'steady' : rate > 0 ? 'rising' : 'falling';
  lines.push(`CO ${fmt(n.gas)} ppm · ${trendWord} ${rate >= 0 ? '+' : ''}${rate.toFixed(1)} ppm/min`);
  const secs = (settings.gasAlarm - n.gas) / (rate / 60);
  // Sensor noise produces small slopes; an ETA of hours would read as a false prediction.
  if (rate > 5 && n.gas < settings.gasAlarm && secs < 1800) {
    lines.push(`At this rate the alarm level (${fmt(settings.gasAlarm)} ppm) is reached in ${secs < 90 ? `${Math.round(secs)} s` : `${(secs / 60).toFixed(1)} min`}`);
  }
  lines.push(`${(n.gas / CO_TWA_PPM).toFixed(1)}× the 8-hour exposure limit (${CO_TWA_PPM} ppm) · ${((n.gas / CO_IDLH_PPM) * 100).toFixed(1)} % of IDLH (${fmt(CO_IDLH_PPM)} ppm)`);

  const followers = store.nodes.filter((x) => !x.physical && x.gas > Math.max(x.gasBase * 3, settings.gasWarn * 0.25)).sort((a, b) => b.gas - a.gas);
  if (followers.length) lines.push(`Spread detected at ${followers.slice(0, 4).map((x) => `${x.id} (${fmt(x.gas)})`).join(', ')}`);

  const dew = dewPoint(n.temp, n.hum);
  const margin = n.temp - dew;
  lines.push(`Dew point ${dew.toFixed(1)} °C · ${margin < 2 ? 'condensation likely' : `${margin.toFixed(1)} °C margin`}`);

  pill.className = `pill ${tone}`;
  pill.textContent = { ok: 'Normal', warn: 'Caution', crit: 'Action' }[tone];
  $('anHeadline').textContent = headline;
  $('anAdvice').textContent = advice;
  $('anLines').innerHTML = lines.map((l) => `<li>${esc(l)}</li>`).join('');
  $('anLel').style.width = `${Math.min(100, (n.gas / settings.gasAlarm) * 100)}%`;
  $('anLel').style.background = THEME.level[n.levels.gas];
}

export function renderSensorGrid(store, selected, onSelect) {
  const grid = $('sensorGrid');
  if (grid.children.length !== store.nodes.length) {
    grid.innerHTML = store.nodes.map((n) => `<button type="button" class="tile" data-id="${esc(n.id)}"></button>`).join('');
    grid.onclick = (e) => {
      const tile = e.target.closest('.tile');
      if (tile) onSelect(tile.dataset.id);
    };
  }
  const cls = (level) => (level === 'critical' ? 'hot' : level === 'elevated' ? 'warm' : '');
  store.nodes.forEach((n, i) => {
    const tile = grid.children[i];
    tile.className = `tile ${n.level !== 'normal' ? n.level : ''} ${n.id === selected ? 'selected' : ''} ${n.physical ? 'physical' : ''} ${n.offline ? 'offline' : ''}`;
    const kind = n.physical ? (n.offline ? '◉ NO SIGNAL' : '◉ PU-01 LIVE') : n.mount === 'air' ? '● ARCH' : '■ FLOOR';
    tile.innerHTML = `<div class="tile-top"><b>${esc(n.id)}</b><span>${kind}</span></div>`
      + `<div class="zone">${esc(n.zone)} · ${Math.round(n.rssi)} dBm</div>`
      + `<div class="vals">`
      + `<span class="${cls(n.levels.gas)}"><em>CO</em> ${fmt(n.gas)}</span>`
      + `<span class="${cls(n.levels.hum)}"><em>RH</em> ${n.hum.toFixed(0)}%</span>`
      + `<span class="${cls(n.levels.pres)}"><em>P</em> ${n.pres.toFixed(1)}</span>`
      + `<span class="${cls(n.levels.water)}"><em>H₂O</em> ${n.water === null ? '—' : `${Math.round(n.water)}cm`}</span>`
      + `</div>`;
  });
}

const UNIT = { gas: (v) => `${fmt(v)} ppm`, hum: (v) => `${v.toFixed(1)} %`, water: (v) => `${Math.round(v)} cm`, pres: (v) => `${v.toFixed(1)} hPa` };

export function renderAlarmTable(store) {
  const now = store.now;
  $('alarmCount').textContent = `${store.alarms.length} this session`;
  $('alarmRows').innerHTML = store.alarms.length
    ? store.alarms.slice().reverse().slice(0, 40).map((a) => `<tr>`
      + `<td class="m-${a.metric}">${METRIC_NAME[a.metric]}</td><td>${esc(a.nodeId)}${a.physical ? ' <i class="live">PU-01</i>' : ''}</td><td>${esc(titleCase(a.zone))}</td>`
      + `<td class="${a.level === 'critical' ? 'crit' : 'warn'}">${a.level === 'critical' ? 'Critical' : 'Warning'}</td>`
      + `<td>${clock(a.start)}</td><td>${clock((a.end ?? now) - a.start)}</td><td>${UNIT[a.metric](a.peak)}</td>`
      + `<td>${a.end === null ? '<b>Active</b>' : 'Cleared'}</td></tr>`).join('')
    : '<tr><td class="empty" colspan="8">No alarms yet</td></tr>';
}

const FILTERS = {
  all: () => true,
  crit: (e) => e.level === 'crit',
  warn: (e) => e.level === 'warn',
  link: (e) => e.level === 'link',
};

export function renderEvents(store, filter) {
  $('eventList').innerHTML = store.events
    .filter(FILTERS[filter])
    .slice(0, 200)
    .map((e) => `<li class="${e.level}"><time>${wallTime(e.time)}</time><i class="d"></i><span>${esc(e.text)}</span></li>`)
    .join('');
}

export function renderConsole(store, paused) {
  if (paused) return;
  $('consoleLines').innerHTML = store.console
    .slice(0, 60)
    .map((l) => `<li class="${l.text.startsWith('#') ? 'note' : ''}"><time>${wallTime(l.time)}</time>${esc(l.text)}</li>`)
    .join('');
}
