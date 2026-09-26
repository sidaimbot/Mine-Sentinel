# Mine Sentinel · Physical Sensor Unit (PU-01)

The dashboard (`public/dashboard.html`) reads one live sensor unit over USB. That unit appears in the 16-node mine network as **PU-01** (default location G-13, Tunnel B; you can change it in ⚙ Settings).
- **Live readings:** gas (MQ-2, MQ-7 or MQ-9) and humidity (DHT11 or DHT22).
- **Simulated readings:** air pressure, water level and the other 15 nodes. They react to the live gas and humidity values.

## Parts
- Arduino Uno or Nano, or an ESP32 dev board
- MQ-2 (default, strong response) or MQ-7 / MQ-9 (carbon-monoxide) module (the analog `AO` output is used)
- DHT11 or DHT22 module
- USB cable

## Wiring

| Module pin | Arduino Uno/Nano | ESP32 |
|---|---|---|
| MQ `VCC` | 5V | VIN (5V), see the note below |
| MQ `GND` | GND | GND |
| MQ `AO`  | A0 | GPIO 34 |
| DHT `VCC` | 5V | 3V3 |
| DHT `GND` | GND | GND |
| DHT `DATA` | D2 | GPIO 4 |

> **ESP32 note:** the MQ heater needs 5 V, but ESP32 ADC pins tolerate at most 3.3 V. Put a divider between `AO` and GPIO 34 (for example 10 kΩ over 20 kΩ).
> Bare DHT sensors, as opposed to modules, need a 10 kΩ pull-up from DATA to VCC.

## Flash the sketch
1. Install the Arduino IDE. Add the libraries **DHT sensor library** (Adafruit) and **Adafruit Unified Sensor**.
2. Open `mine_sentinel_node/mine_sentinel_node.ino`. Set `DHT_TYPE` to `DHT11` or `DHT22`.
3. Select your board and port, then upload.
4. Close the Arduino Serial Monitor. Only one program can hold the port at a time.

## Connect the dashboard (recommended: server bridge)
Run the dashboard server. It reads the board's COM port itself, so any browser works and there is no USB permission prompt:
```bash
python tools/serve.py 8001
```
Then open http://localhost:8001/public/dashboard.html. The board is found automatically (CP210x / CH340 / CH9102 / FTDI / Espressif). Name the port if needed, e.g. `python tools/serve.py 8001 COM12`.
- Only one program can hold the COM port. Close the Arduino Serial Monitor. Before uploading a sketch, click **⏏ Release port** in the dashboard, or close the dashboard tab.

## Connect the dashboard (fallback: browser USB)
1. Serve the project and open the dashboard **in Chrome or Edge** (Web Serial API):
   ```bash
   python tools/serve.py 8001
   ```
   Open http://localhost:8001/public/dashboard.html.
2. Click **⏚ Connect USB** and pick the board. The status pill turns green (**LIVE · USB**).
   The browser remembers the port, so the next visit reconnects automatically.
3. Let the MQ sensor warm up for about 2 minutes in clean air. Then click **◎ Calibrate** (a 10-second clean-air average).
4. Without a board, the pill reads **NO BOARD**, the gas and humidity gauges show `—`, and the serial console stays empty apart from a waiting message.

## Line format
Send one reading per line at 115200 baud (you can change the rate in Settings). All of these formats work:

```
{"gas":412,"hum":55.2,"temp":27.1,"adc":1023}
gas=412,hum=55.2,temp=27.1
412,55.2,27.1
# anything starting with # is a log line
```

- `gas`: the raw ADC reading from the MQ analog output. The dashboard converts it to CO ppm using the datasheet curve and the calibrated R0.
- `hum` / `temp`: %RH and °C from the DHT.
- `adc`: 1023 or 4095. Optional. It tells the dashboard the ADC resolution.
- `pres` (hPa) and `water` (cm): optional. When present, those gauges switch from **SIM** to **LIVE**.

## Testing tips
- Blow out a match or candle next to the gas sensor. The smoke contains CO, so CO should rise on PU-01, go amber at 35 ppm and red at 100 ppm, and spread to neighbouring nodes. Air pressure rises with it. (An MQ-2 also reacts to lighter gas and alcohol.)
- Breathe on the DHT to raise humidity.
- Pulling the USB cable shows **NO SIGNAL** after 3 s. The console reports the disconnect, and the dashboard waits for the board to come back.

## Troubleshooting: "board won't connect"
| Symptom | Fix |
|---|---|
| Connect USB picker is empty | Windows doesn't see a board. Use a **data** USB cable (many are charge-only), try another port, and install the **CH340** or **CP210x** driver. The board should appear in Device Manager → Ports as e.g. `USB-SERIAL CH340 (COM3)`. |
| Only "Standard Serial over Bluetooth link" ports show up (Shift+click) | Those are Bluetooth ports, not the board. Same fix as above. |
| "port is busy" | Close the Arduino IDE **Serial Monitor/Plotter**. Only one app can hold the port. |
| Connected but "no data" | Upload the sketch, and check that the baud rate in ⚙ Settings matches `BAUD` in the sketch (115200). |
| Button disabled / notice about Chrome | Use Chrome or Edge at `http://localhost:8001`. The Claude preview pane and other browsers can't reach USB. |

## CO sensor notes
- Pick the sensor you wired in ⚙ Settings → Gas sensor. Each sensor has its own CO curve, and changing it resets the calibration.
- The MQ-7 is designed to cycle its heater (60 s at 5 V, then 90 s at 1.4 V). On a plain 5 V supply it still works as a rough CO indicator, but it responds less than the MQ-2.
- Default alarm levels are a 35 ppm warning and a 100 ppm alarm. You can change them in Settings. The 8-hour exposure limit (25 ppm) and IDLH (1,200 ppm) are shown in the Analysis card.

## Using your own sketch
You don't need `mine_sentinel_node.ino`. The dashboard reads most sketches as they are, for example:
```
{"device_id":"ESP32_Node_1","humidity_pct":58.0,"temperature_c":27.0,"gas_raw":1412, ...}
Humidity: 58.00 %
Gas Raw: 1412
```
- Keys are matched loosely: `gas_raw`, `gas`, `mq135`, `co` → gas raw; `humidity_pct`, `hum`, `rh` → humidity; `temperature_c`, `temp` → temperature. A key like `co_ppm` is used directly as ppm.
- Thresholds, alerts and flags (`gas_threshold`, `humidity_alert`, …) are ignored. `dht_valid:false` hides that humidity reading.
- If a sketch prints both debug text and JSON, only the JSON is used.

## Accuracy checklist
1. In ⚙ Settings, check **Gas sensor** (MQ-135 by default), **Board ADC** (ESP32 = 12-bit) and **Gas module supply** (5 V if the module is on VIN/5V).
2. Warm the MQ sensor for at least 2 minutes (24–48 h burn-in for a brand-new sensor).
3. On first connect, the dashboard learns the clean-air baseline in 15 s. **Keep gas away during that time**, or press ◎ Calibrate again in clean air afterwards.
4. MQ sensors give an estimate (roughly ±20–30 %), and humidity and temperature affect them. The DHT11 is accurate to about ±5 %RH and ±2 °C.
5. ESP32 ADC pins take at most 3.3 V. A 5 V module's AO can exceed that, so readings clip near 4095. Use a divider (10 kΩ / 20 kΩ), or power the module at 3.3 V and select 3.3 V in Settings.

## ESP32 + LoRa node (`esp32_lora_node/`)
This is your `sketch_sep25a` with the same pins and output, but it **keeps sending sensor data over USB even if the LoRa module fails**. The original stops forever (`while (true)`) after "LoRa initialization failed". It retries LoRa every 30 s.
If the dashboard shows "Board halted: LoRa failed to start", flash this sketch or fix the LoRa wiring (NSS 5, RST 14, DIO0 2, SCK 18, MISO 19, MOSI 23, 3.3 V only, antenna attached).
