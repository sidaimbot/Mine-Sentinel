// Mine Sentinel · physical sensor unit PU-01
// MQ-7 / MQ-2 / MQ-9 carbon-monoxide sensor + DHT11 / DHT22 humidity sensor → USB serial → dashboard (Chrome/Edge).
//
// Boards: Arduino Uno / Nano (10-bit ADC) or ESP32 (12-bit ADC).
// Library: "DHT sensor library" by Adafruit (+ "Adafruit Unified Sensor").
// Output: one JSON line every 500 ms at 115200 baud, e.g.
//   {"gas":412,"hum":55.2,"temp":27.1,"adc":1023}
// Lines starting with '#' are shown in the dashboard console as board logs.

#include <DHT.h>

// ---------- configuration ----------
#define DHT_TYPE DHT11          // DHT11 or DHT22
const unsigned long BAUD = 115200;
const unsigned long PERIOD_MS = 500;
const unsigned long WARMUP_MS = 20000;  // MQ heaters need time; full stability takes ~2 min

#if defined(ESP32)
const int GAS_PIN = 34;         // ADC1 pin — ADC2 pins stop working while Wi-Fi is on
const int DHT_PIN = 4;
const int ADC_MAX = 4095;
#else
const int GAS_PIN = A0;
const int DHT_PIN = 2;
const int ADC_MAX = 1023;
#endif

// Optional extra sensors. Uncomment to make those dashboard readings live instead of simulated.
// #define WATER_PIN A1          // analog water-level probe; maps 0..ADC_MAX to 0..WATER_MAX_CM
// const float WATER_MAX_CM = 100.0;

DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSend = 0;
bool warmedUp = false;

// Averaging smooths the MQ output, which jitters by a few counts on USB power.
int readGas() {
  long sum = 0;
  for (int i = 0; i < 8; i++) {
    sum += analogRead(GAS_PIN);
    delay(2);
  }
  return sum / 8;
}

void setup() {
  Serial.begin(BAUD);
#if defined(ESP32)
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);  // full 0–3.3 V range
#endif
  dht.begin();
  Serial.println(F("# Mine Sentinel PU-01 booting"));
  Serial.print(F("# DHT type "));
  Serial.println(DHT_TYPE == DHT22 ? F("DHT22") : F("DHT11"));
  Serial.println(F("# MQ heater warming up..."));
}

void loop() {
  unsigned long now = millis();
  if (now - lastSend < PERIOD_MS) return;
  lastSend = now;

  if (!warmedUp && now > WARMUP_MS) {
    warmedUp = true;
    Serial.println(F("# warm-up done, readings valid (calibrate after ~2 min in clean air)"));
  }

  int gas = readGas();
  float hum = dht.readHumidity();
  float temp = dht.readTemperature();

  Serial.print(F("{\"gas\":"));
  Serial.print(gas);
  // The DHT11 needs ~1 s between reads; NaN here just means "no new value", so the key is skipped.
  if (!isnan(hum)) {
    Serial.print(F(",\"hum\":"));
    Serial.print(hum, 1);
  }
  if (!isnan(temp)) {
    Serial.print(F(",\"temp\":"));
    Serial.print(temp, 1);
  }
#ifdef WATER_PIN
  Serial.print(F(",\"water\":"));
  Serial.print(analogRead(WATER_PIN) * WATER_MAX_CM / ADC_MAX, 0);
#endif
  Serial.print(F(",\"adc\":"));
  Serial.print(ADC_MAX);
  Serial.println('}');
}
