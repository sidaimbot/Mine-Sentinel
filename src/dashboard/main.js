import { Store } from './Store.js';
import { NetworkModel } from './NetworkModel.js';
import { MapView } from './MapView.js';
import { TrendChart, drawAlarmTimeline } from './Charts.js';
import { SerialSource, BridgeSource, describeOpenError } from './sources.js';
import { rawToPpm, calibrateR0, MQ_MODELS } from './gas.js';
import { loadSettings, saveSettings, DEFAULTS } from './settings.js';
import { renderKpis, renderUnit, renderAnalysis, renderSensorGrid, renderAlarmTable, renderEvents, renderConsole, clock } from './Panels.js';
import { exportCsv, printReport } from './Report.js';
import { LossAlert } from './LossAlert.js';
import { SENSOR_NODES } from '../world/MineLayout.js';

const $ = (id) => document.getElementById(id);
const TICK_S = 0.5;
const CHART_MS = 250;
const CALIBRATION_S = 10;
const AUTO_CALIBRATION_S = 15;
const ERROR_LOG_MS = 10000;

const settings = loadSettings();
const store = new Store();
const network = new NetworkModel(settings);
let pinned = null;
let filter = 'all';
let consolePaused = false;
let calibration = null;
let lastErrorLog = 0;

// ---------- data sources ----------
function onReading(r) {
  // Boards may announce their ADC range; follow it so ppm conversion stays right.
  if (r.adc && r.adc !== settings.adcMax && (r.adc === 1023 || r.adc === 4095)) {
    settings.adcMax = r.adc;
    saveSettings(settings);
    store.event('link', `Board reports ${r.adc === 4095 ? '12' : '10'}-bit ADC`);
  }
  // A raw value above 1023 can only come from a 12-bit ADC (ESP32), even if the board never says so.
  if (r.gas > settings.adcMax && settings.adcMax === 1023) {
    settings.adcMax = 4095;
    settings.r0 = null;
    saveSettings(settings);
    store.event('link', 'Raw gas above 1023 — switched to 12-bit ADC (ESP32)');
  }
  // An uncalibrated MQ reading can be off by 10× or more, so the first packets set the clean-air baseline.
  if (settings.r0 === null && r.gas !== undefined && r.ppm === undefined && !calibration) startCalibration(true);
  const learning = !!calibration?.auto;
  let ppm = r.ppm;
  if (ppm === undefined) ppm = r.gas === undefined || learning ? store.live?.ppm ?? 0 : rawToPpm(r.gas, settings);
  store.packet({ ...r, ppm, hum: r.hum ?? store.live?.hum, temp: r.temp ?? store.live?.temp });
  store.calibrating = learning;
  if (calibration && r.gas !== undefined) calibration.raws.push(r.gas);
}

// Board log lines that explain why readings stop, and what to do about each.
const BOARD_DIAGNOSES = [
  [/lora.*(init|begin).*fail/i, 'crit', 'Board halted: LoRa failed to start, and the sketch stops before sending any sensor data. Check the LoRa wiring/antenna, or flash hardware/esp32_lora_node (keeps running without LoRa).'],
  [/brownout/i, 'crit', 'Board reset by brown-out: USB power is too weak for the MQ heater + LoRa + buzzer. Use a powered USB hub or an external 5 V supply.'],
  [/rst:0x|ets [a-z]{3} +\d|boot:0x/i, 'warn', 'Board rebooted (ESP32 boot log seen).'],
  [/dht.*fail|failed to read from dht/i, 'warn', 'DHT sensor read failed: check its DATA pin, power, and pull-up resistor.'],
];
const diagnosedAt = new Map();

function onLine(text) {
  store.line(text);
  for (const [re, level, msg] of BOARD_DIAGNOSES) {
    if (!re.test(text)) continue;
    if (Date.now() - (diagnosedAt.get(msg) ?? 0) > 30000) store.event(level, msg);
    diagnosedAt.set(msg, Date.now());
  }
}

function onError(message) {
  store.packets.errors++;
  store.line(`! ${message}`);
  if (Date.now() - lastErrorLog > ERROR_LOG_MS) {
    lastErrorLog = Date.now();
    store.event('warn', `Data link: ${message}`);
  }
}

const linkCallbacks = {
  onReading, onLine, onError,
  onStatus(state, detail) {
    if (state === 'waiting') {
      store.line(`# ${detail}`);
      if (/denied|not found|not reachable|no USB board/i.test(detail)) store.event('warn', `Serial: ${detail}`);
    } else if (state === 'connected') {
      store.source = { kind: 'usb', detail };
      store.event('link', `USB connected · ${detail} · ${settings.baud} baud`);
    } else {
      store.source = { kind: 'none', detail: '' };
      if (calibration?.auto) {
        calibration = null;
        store.calibrating = false;
        $('calibBanner').classList.add('hidden');
      }
      store.event('link', `USB disconnected (${detail})`);
      store.line('# board disconnected — waiting for USB');
      // Only an unexpected loss is an incident; the operator's own Disconnect / Release is not.
      if (!/closed by operator|port released/.test(detail)) lossAlert?.linkLost(detail);
    }
    renderHeader();
  },
};
const serial = new SerialSource(linkCallbacks);
const bridge = new BridgeSource(linkCallbacks);
// The server bridge is preferred when available; Web Serial ("Connect USB") is the fallback.
let link = serial;

async function connectUsb(e) {
  if (link === bridge) {
    // Releasing lets the Arduino IDE upload or open its Serial Monitor.
    if (bridge.active) bridge.stop();
    else bridge.start();
    renderHeader();
    return;
  }
  try {
    if (serial.connected) {
      await serial.disconnect();
    } else {
      await serial.connect(settings.baud, e?.shiftKey);
    }
  } catch (err) {
    if (err.name === 'NotFoundError') {
      // Picker cancelled, or it was empty because no Arduino/ESP32 USB chip is plugged in.
      store.line('# no board selected — if the list was empty: check the USB cable is a data cable (not charge-only), try another port, install the CH340/CP210x driver; Shift+click Connect USB lists every port');
    } else {
      const why = describeOpenError(err);
      store.line(`! connect failed: ${why}`);
      store.event('warn', `USB connect failed: ${why}`);
    }
    refreshPanels();
  }
  renderHeader();
}

// Connected but silent usually means a wrong baud rate, a sketch that isn't running, or a non-board port.
const SILENT_MS = 6000;
let silenceWarned = false;
function checkSilence() {
  if (!link.connected) { silenceWarned = false; return; }
  if (Date.now() - Math.max(link.openedAt, store.packets.lastAt) < SILENT_MS) { silenceWarned = false; return; }
  if (silenceWarned) return;
  silenceWarned = true;
  const msg = link.linesSinceOpen
    ? `board is sending text but no sensor readings for ${SILENT_MS / 1000} s — the sketch may have halted; check the serial console for an error`
    : `connected but no data for ${SILENT_MS / 1000} s — check the sketch is uploaded, baud is ${settings.baud} on both sides, and the port is the board (not Bluetooth)`;
  store.line(`! ${msg}`);
  store.event('warn', msg);
}

function renderHeader() {
  const phys = network.physical;
  const noSignal = store.source.kind === 'usb' && store.packetAge > 3;
  const kind = noSignal ? 'nosignal' : store.source.kind;
  const el = $('srcState');
  el.className = `src-state ${kind}`;
  el.querySelector('span').textContent = { usb: 'LIVE · USB', none: 'NO BOARD', nosignal: 'USB · NO SIGNAL' }[kind];
  if (link === bridge) {
    $('btnConnect').textContent = bridge.active ? '⏏ Release port' : '⏚ Connect board';
    $('btnConnect').title = 'Server bridge: release the COM port so the Arduino IDE can upload / monitor';
    $('btnConnect').disabled = false;
  } else {
    $('btnConnect').textContent = serial.connected ? '⏏ Disconnect' : '⏚ Connect USB';
    $('btnConnect').disabled = !SerialSource.supported;
  }
  $('trendNode').textContent = `${selectedNode()}${pinned ? '' : phys && selectedNode() === phys.id ? ' (PU-01)' : ''}`;
}

// ---------- calibration ----------
function startCalibration(auto = false) {
  if (calibration) return;
  if (!auto && (store.source.kind !== 'usb' || store.packetAge > 3)) {
    store.event('warn', 'Calibration needs live USB readings — connect the board first');
    return;
  }
  const duration = auto ? AUTO_CALIBRATION_S : CALIBRATION_S;
  calibration = { raws: [], started: Date.now(), auto, duration };
  $('calibTitle').textContent = auto ? 'Learning the clean-air baseline…' : 'Calibrating in clean air…';
  $('calibBanner').classList.remove('hidden');
  store.event('link', auto
    ? `Gas sensor uncalibrated — learning clean-air baseline (${duration} s). Recalibrate with ◎ Calibrate if gas was present.`
    : `Calibration started (${duration} s clean-air sample)`);
}

function updateCalibration() {
  if (!calibration) return;
  const { duration } = calibration;
  const elapsed = (Date.now() - calibration.started) / 1000;
  $('calibBar').style.width = `${Math.min(100, (elapsed / duration) * 100)}%`;
  $('calibText').textContent = `${Math.min(duration, elapsed).toFixed(0)} / ${duration} s · ${calibration.raws.length} samples`;
  if (elapsed < duration) return;
  const { raws } = calibration;
  calibration = null;
  store.calibrating = false;
  $('calibBanner').classList.add('hidden');
  if (raws.length < 5) {
    store.event('warn', 'Calibration failed: too few samples');
    return;
  }
  // Median, so a stray spike during sampling can't skew the baseline.
  const clean = raws.slice().sort((a, b) => a - b)[Math.floor(raws.length / 2)];
  settings.r0 = calibrateR0(clean, settings);
  saveSettings(settings);
  store.event('ok', `Gas sensor calibrated · clean-air raw ${clean} · R0 ${settings.r0.toFixed(3)}`);
}

// ---------- settings dialog ----------
const form = $('settingsForm');
form.sensorModel.innerHTML = Object.entries(MQ_MODELS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
form.physicalNode.innerHTML = SENSOR_NODES.map((n) => `<option value="${n.id}">${n.id} · ${n.zone} (${n.mount === 'air' ? 'arch' : 'floor'})</option>`).join('');

function openSettings() {
  for (const key of Object.keys(DEFAULTS)) if (form[key]) form[key].value = settings[key];
  $('calStatus').textContent = settings.r0 === null
    ? 'Uncalibrated — ppm uses a typical clean-air estimate. Use ◎ Calibrate with the sensor warmed up (≥ 2 min) in clean air.'
    : `Calibrated · R0 ${settings.r0.toFixed(3)} (resets if you change gas sensor or ADC).`;
  $('settingsDlg').showModal();
}

$('settingsDlg').addEventListener('close', async () => {
  if ($('settingsDlg').returnValue !== 'save') return;
  const prev = { ...settings };
  for (const key of ['baud', 'adcMax', 'sensorVcc', 'gasWarn', 'gasAlarm', 'humWarn', 'humAlarm', 'waterWarn', 'waterAlarm']) settings[key] = Number(form[key].value);
  settings.sensorModel = form.sensorModel.value;
  settings.physicalNode = form.physicalNode.value;
  // R0 is only meaningful for the sensor model, ADC and supply it was measured with.
  if (prev.sensorModel !== settings.sensorModel || prev.adcMax !== settings.adcMax || prev.sensorVcc !== settings.sensorVcc) settings.r0 = null;
  saveSettings(settings);
  store.event('link', 'Settings saved');
  if (serial.connected && prev.baud !== settings.baud) {
    await serial.disconnect(false);
    await serial.autoConnect(settings.baud).catch((err) => store.event('warn', `Reconnect failed: ${err.message}`));
  }
  refreshPanels();
});

$('btnResetCal').addEventListener('click', () => {
  settings.r0 = null;
  saveSettings(settings);
  $('calStatus').textContent = 'Reset to the uncalibrated estimate.';
  store.event('link', 'Gas calibration reset');
});

// ---------- UI ----------
const selectedNode = () => pinned ?? network.physical.id;
const select = (id) => {
  pinned = pinned === id ? null : id;
  refreshPanels();
};

const map = new MapView($('mapCanvas'), $('mapTip'), store, network, settings, select);
const lossAlert = new LossAlert({ store, network, map });
const charts = [...document.querySelectorAll('.chart canvas')].map((c) => new TrendChart(c, c.dataset.metric, store, settings, $(`cv_${c.dataset.metric}`)));

function refreshPanels() {
  renderKpis(store, settings);
  renderUnit(store, settings);
  renderAnalysis(store, settings);
  renderAlarmTable(store);
  renderSensorGrid(store, selectedNode(), select);
  renderConsole(store, consolePaused);
  map.selected = selectedNode();
  renderHeader();
}

store.onChange((kind) => {
  if (kind === 'event') renderEvents(store, filter);
});

$('btnConnect').addEventListener('click', connectUsb);
$('btnCalibrate').addEventListener('click', startCalibration);
$('btnSettings').addEventListener('click', openSettings);
$('btnCsv').addEventListener('click', () => exportCsv(store, settings));
$('btnReport').addEventListener('click', () => printReport(store, settings, $('mapCanvas')));
$('btnPauseConsole').addEventListener('click', (e) => {
  consolePaused = !consolePaused;
  e.target.textContent = consolePaused ? 'Resume' : 'Pause';
  e.target.classList.toggle('on', consolePaused);
});
$('btnClearConsole').addEventListener('click', () => {
  store.console.length = 0;
  renderConsole(store, false);
});
$('eventFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  filter = btn.dataset.f;
  for (const b of $('eventFilters').children) b.classList.toggle('on', b === btn);
  renderEvents(store, filter);
});

// ---------- loops ----------
setInterval(() => {
  store.update(network.tick(TICK_S, store.live));
  updateCalibration();
  checkSilence();
  lossAlert.update(store.source.kind);
  refreshPanels();
  $('sessionClock').textContent = clock(store.now);
  $('utcClock').textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
}, TICK_S * 1000);

let lastCharts = 0;
function frame(now) {
  map.draw(now / 1000);
  if (now - lastCharts > CHART_MS) {
    lastCharts = now;
    for (const c of charts) c.draw(selectedNode());
    drawAlarmTimeline($('timeline'), store);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- start ----------
store.event('link', 'Dashboard started');
if (await BridgeSource.available()) {
  link = bridge;
  store.line('# reading the board through the dashboard server (tools/serve.py) — no browser USB permission needed');
  bridge.start();
  renderHeader();
} else if (!SerialSource.supported) {
  $('serialNotice').classList.remove('hidden');
  $('serialNotice').innerHTML = '<b>USB sensors need Chrome or Edge.</b> This browser has no Web Serial API, so the board cannot be read here.';
} else {
  store.line('# no board connected — plug in the sensor unit and click ⏚ Connect USB');
  serial.autoConnect(settings.baud)
    .catch((err) => {
      const why = describeOpenError(err);
      store.line(`! auto-connect failed: ${why}`);
      store.event('warn', `USB auto-connect failed: ${why}`);
    });
}
