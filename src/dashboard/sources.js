// Boards print in many styles, so the parser accepts (one reading per line):
//   JSON:          {"gas_raw":1840,"humidity_pct":55.2,"temperature_c":27.1}   (also embedded: "Received {...} RSSI -40")
//   label/value:   Gas Raw: 1840   ·   Humidity: 55.20 %   ·   gas=412,hum=55.2
//   bare CSV:      412,55.2,27.1   (gas raw, humidity, [temperature], [pressure], [water])
// Keys are matched loosely (case, '_' and units ignored). A key containing "ppm" is taken as an already
// converted CO concentration. Lines with no recognised value are board logs and are just shown.
const ALIASES = {
  gas: 'gas', gasraw: 'gas', gaslevel: 'gas', gasvalue: 'gas', raw: 'gas', mq: 'gas', g: 'gas',
  co: 'gas', coraw: 'gas', airquality: 'gas', aq: 'gas',
  hum: 'hum', humidity: 'hum', humiditypct: 'hum', humiditypercent: 'hum', rh: 'hum', h: 'hum',
  temp: 'temp', temperature: 'temp', temperaturec: 'temp', tempc: 'temp', t: 'temp',
  pres: 'pres', pressure: 'pres', pressurehpa: 'pres', p: 'pres', hpa: 'pres',
  water: 'water', waterlevel: 'water', watercm: 'water', level: 'water', w: 'water', wl: 'water',
  adc: 'adc', adcmax: 'adc',
};
// Settings and flags that sit next to real readings (e.g. "gas_threshold", "humidity_alert").
const IGNORE = /threshold|alert|alarm|valid|enable|status|limit|packet|setpoint|device|count|rssi|snr/;
const PREFIX = [['hum', 'hum'], ['rh', 'hum'], ['temp', 'temp'], ['pres', 'pres'], ['baro', 'pres'],
  ['water', 'water'], ['gas', 'gas'], ['mq', 'gas'], ['co', 'gas']];
const CSV_ORDER = ['gas', 'hum', 'temp', 'pres', 'water'];

function classify(rawKey) {
  const k = String(rawKey).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!k || IGNORE.test(k)) return null;
  if (k.includes('ppm') && (k.startsWith('co') || k.startsWith('gas') || k.startsWith('mq') || k === 'ppm')) return 'ppm';
  return ALIASES[k] ?? PREFIX.find(([p]) => k.startsWith(p))?.[1] ?? null;
}

function collect(pairs) {
  const out = {};
  for (const [k, v] of pairs) {
    const key = classify(k);
    const num = typeof v === 'number' ? v : Number.parseFloat(v);
    if (key && Number.isFinite(num) && out[key] === undefined) out[key] = num;
  }
  return out;
}

function fromJson(obj) {
  const out = collect(Object.entries(obj));
  // A failed DHT read is often reported as a flag plus zeros; zeros would look like a real (dry, freezing) reading.
  const dhtFailed = Object.entries(obj).some(([k, v]) => v === false && /dht|hum|valid/i.test(k) && /valid|ok/i.test(k));
  if (dhtFailed || (out.hum === 0 && (out.temp ?? 0) === 0)) {
    delete out.hum;
    delete out.temp;
  }
  return out;
}

// Returns { values, kind: 'json' | 'text' | 'csv' }, or null for a log line.
export function parseLine(line) {
  const text = line.trim();
  if (!text || text.startsWith('#')) return null;

  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    let obj;
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch {
      obj = null;
    }
    if (obj && typeof obj === 'object') {
      const values = fromJson(obj);
      if (values.gas === undefined && values.ppm === undefined && values.hum === undefined) {
        throw new Error(`JSON has no gas or humidity key (keys: ${Object.keys(obj).join(', ')})`);
      }
      return { values, kind: 'json' };
    }
  }

  if (/^[\s\d.,;+-]+$/.test(text)) {
    const values = collect(text.split(/[,;\s]+/).filter(Boolean).map((v, i) => [CSV_ORDER[i], v]));
    return values.gas === undefined && values.hum === undefined ? null : { values, kind: 'csv' };
  }

  const pairs = [...text.matchAll(/([A-Za-z][A-Za-z0-9 _()%.-]*?)\s*[:=]\s*(-?\d+(?:\.\d+)?)/g)].map((m) => [m[1], m[2]]);
  const values = collect(pairs);
  return Object.keys(values).length ? { values, kind: 'text' } : null;
}

// USB-serial chips used by Arduino / ESP32 boards. Filtering the picker to these hides Windows'
// Bluetooth COM ports, which look like boards in the list but never send data.
export const BOARD_USB_FILTERS = [
  { usbVendorId: 0x2341 }, // Arduino
  { usbVendorId: 0x2a03 }, // Arduino.org
  { usbVendorId: 0x1a86 }, // WCH CH340 / CH9102 (most clones, many ESP32 boards)
  { usbVendorId: 0x10c4 }, // Silicon Labs CP210x (ESP32 DevKit)
  { usbVendorId: 0x0403 }, // FTDI
  { usbVendorId: 0x303a }, // Espressif native USB (ESP32-S2/S3/C3)
];

const OPEN_TIMEOUT_MS = 5000;

export function describeOpenError(err) {
  const msg = err?.message ?? String(err);
  if (/timed out/i.test(msg)) return `${msg} — this is usually a Bluetooth COM port, not the board`;
  if (err?.name === 'NetworkError' || /failed to open/i.test(msg)) {
    return 'port is busy — close the Arduino IDE Serial Monitor / Plotter (or any other app using the port) and try again';
  }
  if (err?.name === 'SecurityError') return 'the browser blocked serial access — open the dashboard from http://localhost, not a file or LAN address';
  return msg;
}

// USB serial via the Web Serial API (Chrome / Edge, secure context such as localhost).
export class SerialSource {
  static get supported() {
    return 'serial' in navigator;
  }

  constructor({ onReading, onLine, onStatus, onError }) {
    Object.assign(this, { onReading, onLine, onStatus, onError });
    this.port = null;
    this.reader = null;
    this.loopDone = null;
    this.wanted = false;
    this.baud = 115200;
    if (SerialSource.supported) {
      // Boards with native USB (and some after a brown-out) vanish on reset and come back as a new
      // connection; reopen them so a reset doesn't need a manual reconnect.
      navigator.serial.addEventListener('connect', (e) => {
        if (!this.wanted || this.port || !e.target.getInfo().usbVendorId) return;
        this.onLine('# board re-appeared — reconnecting');
        this.open(e.target, this.baud).catch((err) => this.onError(`reconnect failed: ${describeOpenError(err)}`));
      });
    }
  }

  // Ports the user already allowed can be reopened without a new permission prompt.
  async autoConnect(baud) {
    if (!SerialSource.supported) return false;
    const port = (await navigator.serial.getPorts()).find((p) => p.getInfo().usbVendorId);
    if (!port) return false;
    await this.open(port, baud);
    return true;
  }

  // showAll lists every serial port, for boards whose USB chip isn't in BOARD_USB_FILTERS.
  async connect(baud, showAll = false) {
    const port = await navigator.serial.requestPort(showAll ? {} : { filters: BOARD_USB_FILTERS });
    await this.open(port, baud);
  }

  async open(port, baud) {
    await this.disconnect(false);
    // A port left open by an earlier failed session must be closed before it can be reopened.
    if (port.readable) await port.close().catch(() => {});
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('opening the port timed out')), OPEN_TIMEOUT_MS); });
    try {
      // DTR/RTS are left as the browser sets them: toggling them resets an ESP32 through its auto-reset circuit.
      await Promise.race([port.open({ baudRate: baud, bufferSize: 16384 }), timeout]);
    } finally {
      clearTimeout(timer);
    }
    this.port = port;
    this.baud = baud;
    this.wanted = true;
    this.openedAt = Date.now();
    this.linesSinceOpen = 0;
    this.sawJson = false;
    const info = port.getInfo();
    this.onStatus('connected', info.usbVendorId ? `USB ${info.usbVendorId.toString(16)}:${info.usbProductId.toString(16)}` : 'USB serial');
    this.loopDone = this.readLoop(port);
  }

  // Framing / overrun / break errors (an ESP32 reset prints its boot log at 74880 baud) only spoil the
  // current reader: the port stays open, so a fresh reader is taken. Only a lost device ends the loop.
  async readLoop(port) {
    const decoder = new TextDecoder();
    let buffer = '';
    let glitches = 0;
    while (this.port === port && port.readable) {
      const reader = port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop();
          if (buffer.length > 8192) buffer = '';
          for (const line of lines) this.handleLine(line);
        }
      } catch (err) {
        if (this.port === port) {
          glitches++;
          this.onLine(`# serial ${err.name}: ${err.message} — continuing`);
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        reader.releaseLock();
      }
      if (glitches > 50) break;
    }
    if (this.port === port) {
      this.port = null;
      await port.close().catch(() => {});
      this.onStatus('disconnected', 'board unplugged or reset');
    }
  }

  handleLine(line) {
    // Boot-ROM noise decodes to replacement characters; strip them so they don't look like data.
    line = line.replace(/[�\u0000-\u0008\u000B-\u001F]/g, '');
    if (!line.trim()) return;
    this.linesSinceOpen++;
    this.onLine(line);
    try {
      const parsed = parseLine(line);
      if (!parsed) return;
      // Sketches often print the same packet twice (debug text + JSON); once JSON is seen, it alone counts.
      if (parsed.kind === 'json') this.sawJson = true;
      else if (this.sawJson) return;
      this.onReading(parsed.values);
    } catch (err) {
      this.onError(`unparsed line: ${err.message}`);
    }
  }

  async disconnect(report = true) {
    if (report) this.wanted = false;
    const port = this.port;
    if (!port) return;
    this.port = null;
    try {
      await this.reader?.cancel();
      await this.loopDone;
      await port.close();
    } catch {
      // Already closed (e.g. unplugged mid-read).
    }
    if (report) this.onStatus('disconnected', 'closed by operator');
  }

  get connected() {
    return !!this.port;
  }
}

// Lines relayed by the local server (tools/serve.py), which reads the COM port itself. Works in any
// browser and avoids Web Serial's permission, port-locking and reset quirks.
export class BridgeSource {
  static async available() {
    try {
      const res = await fetch('/serial/status', { cache: 'no-store' });
      return res.ok && (await res.json()).state !== 'unavailable';
    } catch {
      return false;
    }
  }

  constructor({ onReading, onLine, onStatus, onError }) {
    Object.assign(this, { onReading, onLine, onStatus, onError });
    this.es = null;
    this.state = 'idle';
    this.detail = '';
    this.openedAt = Date.now();
    this.linesSinceOpen = 0;
    this.sawJson = false;
  }

  get active() {
    return !!this.es;
  }

  get connected() {
    return this.state === 'open';
  }

  start() {
    if (this.es) return;
    this.es = new EventSource('/serial/stream');
    this.es.addEventListener('line', (e) => this.handleLine(e.data));
    this.es.addEventListener('status', (e) => {
      const [state, port, ...rest] = e.data.split('|');
      this.setState(state, port, rest.join('|'));
    });
    // EventSource retries by itself; this only reports that the server went away meanwhile.
    this.es.onerror = () => this.setState('error', '', 'dashboard server not reachable — is tools/serve.py running?');
  }

  stop() {
    this.es?.close();
    this.es = null;
    this.setState('idle', '', 'port released');
  }

  setState(state, port, detail) {
    if (state === this.state && detail === this.detail) return;
    const was = this.state;
    this.state = state;
    this.detail = detail;
    if (state === 'open') {
      this.openedAt = Date.now();
      this.linesSinceOpen = 0;
      this.sawJson = false;
      this.onStatus('connected', `${port} via server bridge`);
      return;
    }
    if (was === 'open') this.onStatus('disconnected', detail);
    if (state !== 'idle') this.onStatus('waiting', detail);
  }
}
BridgeSource.prototype.handleLine = SerialSource.prototype.handleLine;
