// Mine Sentinel · ESP32 node (based on sketch_sep25a)
// ESP32 + MQ-135 (GPIO34) + DHT11 (GPIO4) + LoRa RA-02 + LEDs/buzzer.
// Same pins, thresholds and JSON as the original, with two changes so the USB dashboard always gets data:
//   1. A LoRa failure no longer halts the board: sensors keep reporting over USB and LoRa is retried.
//   2. The JSON carries "adc":4095 so the dashboard knows the ADC range.
// Libraries: LoRa (Sandeep Mistry), DHT sensor library (Adafruit), ArduinoJson 7.

#include <SPI.h>
#include <LoRa.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ---------- LoRa RA-02 ----------
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_NSS    5
#define LORA_RST   14
#define LORA_DIO0   2

// ---------- Sensors ----------
#define DHTPIN     4
#define DHTTYPE    DHT11
#define MQ135_PIN 34

// ---------- Indicators ----------
#define GREEN_LED 25
#define RED_LED   26
#define BUZZER    27

const unsigned long TRANSMIT_INTERVAL = 1000;
const unsigned long LORA_RETRY_INTERVAL = 30000;
const unsigned long STARTUP_DELAY = 5000;
const int GAS_THRESHOLD = 3000;
const float HUMIDITY_THRESHOLD = 62.0;
const long LORA_FREQUENCY = 433E6;

DHT dht(DHTPIN, DHTTYPE);

unsigned long lastTransmitTime = 0;
unsigned long lastLoraAttempt = 0;
unsigned long startupTime = 0;
uint32_t packetNumber = 0;
bool alarmEnabled = false;
bool loraReady = false;

// The DHT11 only updates about once per second; keep the last good values so one failed read
// doesn't send 0 %RH / 0 °C to the dashboard.
float lastTemperature = NAN;
float lastHumidity = NAN;

bool startLora() {
  lastLoraAttempt = millis();
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  loraReady = LoRa.begin(LORA_FREQUENCY);
  Serial.println(loraReady ? "# LoRa initialized successfully." : "# LoRa not available - continuing with USB only, will retry");
  return loraReady;
}

// Averaging 16 samples removes most of the ESP32 ADC's jitter on the MQ output.
int readGas() {
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(MQ135_PIN);
    delayMicroseconds(200);
  }
  return sum / 16;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("# ESP32 ENVIRONMENT MONITOR (Mine Sentinel node)");

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);  // full ~0–3.3 V range

  dht.begin();
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  startLora();

  startupTime = millis();
  Serial.println("# Sensors stabilizing, alarm enabled after 5 s");
  digitalWrite(GREEN_LED, HIGH);
}

void loop() {
  unsigned long now = millis();

  if (!alarmEnabled && now - startupTime >= STARTUP_DELAY) {
    alarmEnabled = true;
    Serial.println("# ALARM SYSTEM ENABLED");
  }

  if (!loraReady && now - lastLoraAttempt >= LORA_RETRY_INTERVAL) startLora();

  if (now - lastTransmitTime < TRANSMIT_INTERVAL) return;
  lastTransmitTime = now;

  float t = dht.readTemperature();
  float h = dht.readHumidity();
  bool dhtValid = !isnan(t) && !isnan(h);
  if (dhtValid) {
    lastTemperature = t;
    lastHumidity = h;
  } else {
    Serial.println("# WARNING: DHT11 reading failed");
  }

  int gasLevel = readGas();
  bool gasAlert = gasLevel > GAS_THRESHOLD;
  bool humidityAlert = dhtValid && h > HUMIDITY_THRESHOLD;
  bool alertStatus = alarmEnabled && (gasAlert || humidityAlert);

  digitalWrite(GREEN_LED, alertStatus ? LOW : HIGH);
  digitalWrite(RED_LED, alertStatus ? HIGH : LOW);
  digitalWrite(BUZZER, alertStatus ? HIGH : LOW);

  JsonDocument doc;
  doc["device_id"] = "ESP32_Node_1";
  doc["packet_number"] = packetNumber++;
  doc["dht_valid"] = dhtValid;
  if (!isnan(lastTemperature)) {
    doc["temperature_c"] = lastTemperature;
    doc["humidity_pct"] = lastHumidity;
  }
  doc["humidity_threshold"] = HUMIDITY_THRESHOLD;
  doc["humidity_alert"] = humidityAlert;
  doc["gas_raw"] = gasLevel;
  doc["gas_threshold"] = GAS_THRESHOLD;
  doc["gas_alert"] = gasAlert;
  doc["alarm_enabled"] = alarmEnabled;
  doc["alert_status"] = alertStatus;
  doc["lora"] = loraReady;
  doc["adc"] = 4095;

  String json;
  serializeJson(doc, json);
  Serial.println(json);  // one JSON line per reading: the dashboard's input

  if (loraReady) {
    LoRa.beginPacket();
    LoRa.print(json);
    LoRa.endPacket();
  }
}
