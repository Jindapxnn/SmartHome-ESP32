// =======================================================
// esp32-bedroom-sensor.ino — SHT31 Sensor, Room LED Control, Watchdog
// - USES MOCK DATA FOR SENSORS (Toggle 'USE_MOCK_SENSORS' to false for real SHT31)
// - Sends Realtime (1s) and Averaged Snapshot (60s) T/H data to custom topic.
// - Uses Shadow ONLY for LED control.
// =======================================================

#include "secrets.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <math.h>
#include <sntp.h>

// =======================================================
// MOCK DATA CONTROL
// =======================================================
const bool USE_MOCK_SENSORS = true;

// ---------------------------
// 1) Hardware & State
// ---------------------------
const int LED_ROOM_PIN = 2;
const int SDA_PIN = 21;
const int SCL_PIN = 22;
const char* DEVICE_ID = "sensor-led";

#ifndef USE_MOCK_SENSORS
Adafruit_SHT31 sht31 = Adafruit_SHT31();
#endif

int shadowRequestedLedState = LOW;
float lastTemp = 0.0;
float lastHumid = 0.0;
float mockCurrentTemp = 27.5;
float mockCurrentHumid = 65.0;

const int BUFFER_SIZE = 60;
float tempBuffer[BUFFER_SIZE];
float humidBuffer[BUFFER_SIZE];
int bufferIndex = 0;
bool bufferIsFull = false;

// ---------------------------
// 2) Topics
// ---------------------------
char shadowUpdateTopic[128];
char shadowDeltaTopic[128];
char shadowGetTopic[128];
char shadowGetAcceptedTopic[128];
char shadowGetRejectedTopic[128];

const char* SHT_DATA_TOPIC = "smarthome/sensor/bedroom";
const char* WATCHDOG_TOPIC = "smarthome/watchdog/bedroom";

// ---------------------------
// 3) MQTT / TLS / Timing
// ---------------------------
WiFiClientSecure net;
PubSubClient client(net);

unsigned long lastTelemetryMs = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 1000;
unsigned long lastShtSnapshotMs = 0;
const unsigned long SHT_SNAPSHOT_INTERVAL_MS = 60000;
unsigned long lastWatchdogMs = 0;
const unsigned long WDT_INTERVAL_MS = 300000;
bool waitingGetAccepted = false;
unsigned long shadowGetSentMs = 0;
const unsigned long GET_TIMEOUT_MS = 7000;

// ---------------------------
// 4) Prototypes
// ---------------------------
void connectWiFi();
void syncTime();
void connectAWS();
void ensureMqtt();
void requestShadow();
void publishShadowReported();
void publishWatchdog();
void publishShtData(const char* type, float temp, float humid);
void readSensors();
void readMockSensors();
void updateSensorBuffer();
float calculateAverage(float arr[], int count);
void handleDeltaPayload(const String& json);
void handleGetAcceptedPayload(const String& json);
void handleGetRejectedPayload(const String& json);
void messageHandler(char* topic, byte* payload, unsigned int length);

// =======================================================
// Wi-Fi
// =======================================================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.print("OK");
}

// =======================================================
// NTP
// =======================================================
void syncTime() {
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Syncing time");

  // 💡 แก้ไข: ใช้ฟังก์ชันตรวจสอบสถานะของ NTP โดยตรง
  sntp_sync_status_t sync_status = sntp_get_sync_status();
  while (sync_status == SNTP_SYNC_STATUS_RESET) {
    delay(500);
    Serial.print(".");
    sync_status = sntp_get_sync_status();
  }

  if (sync_status == SNTP_SYNC_STATUS_COMPLETED) {
    Serial.println("OK");
  } else {
    Serial.println("FAILED/TIMEOUT");
  }
}

// =======================================================
// MQTT Message Callback
// =======================================================
void messageHandler(char* topic, byte* payload, unsigned int length) {
  String json;
  json.reserve(length + 1);
  for (unsigned int i = 0; i < length; i++) json += (char)payload[i];

  Serial.print("\n[MQTT] Incoming topic: ");
  Serial.println(topic);
  Serial.println(json);

  if (String(topic) == String(shadowDeltaTopic)) {
    handleDeltaPayload(json);
    return;
  }

  if (String(topic) == String(shadowGetAcceptedTopic)) {
    waitingGetAccepted = false;
    handleGetAcceptedPayload(json);
    return;
  }

  if (String(topic) == String(shadowGetRejectedTopic)) {
    waitingGetAccepted = false;
    handleGetRejectedPayload(json);
    return;
  }
}

// =======================================================
// handleGetAcceptedPayload
// =======================================================
void handleGetAcceptedPayload(const String& json) {
  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Serial.print("GetAccepted JSON error: ");
    Serial.println(err.f_str());
    return;
  }
  if (!doc.containsKey("state")) return;

  JsonObject state = doc["state"];
  String target = "";

  if (state.containsKey("desired") && state["desired"].containsKey("ledStatus")) {
    target = state["desired"]["ledStatus"].as<String>();
  } else if (state.containsKey("reported") && state["reported"].containsKey("ledStatus")) {
    target = state["reported"]["ledStatus"].as<String>();
  }

  if (target.length()) {
    if (target == "on") {
      shadowRequestedLedState = HIGH;
      Serial.println("LED State -> ON (get/accepted)");
    } else if (target == "off") {
      shadowRequestedLedState = LOW;
      Serial.println("LED State -> OFF (get/accepted)");
    }
    digitalWrite(LED_ROOM_PIN, shadowRequestedLedState);
    publishShadowReported();
  }
}

// =======================================================
// handleGetRejectedPayload
// =======================================================
void handleGetRejectedPayload(const String& json) {
  DynamicJsonDocument doc(512);
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Serial.println(json);
    return;
  }

  int code = doc["code"] | doc["statusCode"] | -1;
  Serial.printf("[MQTT] Shadow GET REJECTED -> code:%d\n", code);

  if (code == 404) {
    Serial.println("No existing shadow -> publish initial reported to create one.");
    publishShadowReported();
  }
}

// =======================================================
// handleDeltaPayload
// =======================================================
void handleDeltaPayload(const String& json) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Serial.print("Delta JSON error: ");
    Serial.println(err.f_str());
    return;
  }

  JsonObject st = doc["state"];
  if (st.containsKey("ledStatus")) {
    String cmd = st["ledStatus"].as<String>();
    if (cmd == "on") {
      shadowRequestedLedState = HIGH;
      Serial.println("LED State -> ON (delta)");
    } else if (cmd == "off") {
      shadowRequestedLedState = LOW;
      Serial.println("LED State -> OFF (delta)");
    }
    digitalWrite(LED_ROOM_PIN, shadowRequestedLedState);
  }
  publishShadowReported();
}

// =======================================================
// Mock Sensor Logic
// =======================================================
void readMockSensors() {
  // สุ่มค่า T/H ให้มีการเปลี่ยนแปลงเล็กน้อยเพื่อจำลองความผันผวนของสภาพแวดล้อม
  float random_change_t = ((float)random(0, 500) / 1000.0 - 0.25);  // สุ่มระหว่าง -0.25 ถึง +0.25
  float random_change_h = ((float)random(0, 800) / 1000.0 - 0.40);  // สุ่มระหว่าง -0.40 ถึง +0.40

  // อัปเดตค่า Mock
  mockCurrentTemp += random_change_t * 0.1;  // เปลี่ยนแปลงช้าลง
  mockCurrentHumid += random_change_h * 0.1;

  // จำกัดค่าให้อยู่ในช่วงที่สมเหตุสมผล
  mockCurrentTemp = constrain(mockCurrentTemp, 25.0, 35.0);
  mockCurrentHumid = constrain(mockCurrentHumid, 50.0, 80.0);

  // กำหนดค่า Mock ให้กับตัวแปรหลัก
  lastTemp = mockCurrentTemp;
  lastHumid = mockCurrentHumid;
}

// =======================================================
// Read sensors
// =======================================================
void readSensors() {
  if (USE_MOCK_SENSORS) {
    readMockSensors();
  } else {
#ifndef USE_MOCK_SENSORS
    float temp = sht31.readTemperature();
    float hum = sht31.readHumidity();
    if (!isnan(temp) && !isnan(hum) && !isinf(temp) && !isinf(hum)) {
      lastTemp = temp;
      lastHumid = hum;
    } else {
      Serial.println("[SHT31] อ่านค่า SHT3x ไม่ได้! (ใช้ค่าล่าสุด)");
    }
#endif
  }

  digitalWrite(LED_ROOM_PIN, shadowRequestedLedState);
  Serial.printf("[SENSOR] Temp: %.2f °C | Humidity: %.2f %% | RoomLED:%s\n",
                lastTemp, lastHumid, (shadowRequestedLedState == HIGH ? "ON" : "OFF"));
}

// =======================================================
// Buffer Update
// =======================================================
void updateSensorBuffer() {
  tempBuffer[bufferIndex] = lastTemp;
  humidBuffer[bufferIndex] = lastHumid;
  bufferIndex++;
  if (bufferIndex >= BUFFER_SIZE) {
    bufferIndex = 0;
    bufferIsFull = true;
  }
}

// =======================================================
// Average
// =======================================================
float calculateAverage(float arr[], int count) {
  float sum = 0.0;
  for (int i = 0; i < count; i++) sum += arr[i];
  return sum / count;
}

// =======================================================
// Shadow Report
// =======================================================
void publishShadowReported() {
  if (!client.connected()) return;
  StaticJsonDocument<256> doc;
  JsonObject state = doc.createNestedObject("state");
  state["desired"] = nullptr;
  JsonObject rep = state.createNestedObject("reported");
  rep["ledStatus"] = (shadowRequestedLedState == HIGH) ? "on" : "off";
  char buf[256];
  size_t n = serializeJson(doc, buf);
  bool ok = client.publish(shadowUpdateTopic, (uint8_t*)buf, n);
  Serial.print("\n[MQTT] Publish Shadow Update (LED Status): ");
  Serial.println(ok ? "OK" : "FAILED");
}

// =======================================================
// SHT Data
// =======================================================
void publishShtData(const char* type, float temp, float humid) {
  if (!client.connected()) return;
  StaticJsonDocument<256> doc;
  doc["Temperature"] = temp;
  doc["Humidity"] = humid;
  doc["Type"] = type;
  doc["TimeStamp"] = (uint32_t)time(nullptr);
  char buf[256];
  size_t n = serializeJson(doc, buf);
  bool ok = client.publish(SHT_DATA_TOPIC, (uint8_t*)buf, n);
  Serial.printf("[SHT DATA:%s] Publish: %s\n", type, ok ? "OK" : "FAILED");
  Serial.printf("Topic: %s, Payload: %s\n", SHT_DATA_TOPIC, buf);
}

// =======================================================
// Watchdog
// =======================================================
void publishWatchdog() {
  if (!client.connected()) return;
  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = (uint32_t)time(nullptr);
  char buf[128];
  size_t n = serializeJson(doc, buf);
  bool ok = client.publish(WATCHDOG_TOPIC, (uint8_t*)buf, n);
  Serial.print("[WDT] Publish Heartbeat: ");
  Serial.println(ok ? "OK" : "FAILED");
  Serial.printf("  Topic: %s, Device: %s\n", WATCHDOG_TOPIC, DEVICE_ID);
}

// =======================================================
// MQTT Ensure Connection
// =======================================================
void ensureMqtt() {
  if (client.connected()) return;
  Serial.print("Connecting AWS IoT MQTT");
  while (!client.connected()) {
    if (client.connect(THINGNAME)) {
      Serial.println(" OK");
      client.subscribe(shadowDeltaTopic);
      client.subscribe(shadowGetAcceptedTopic);
      client.subscribe(shadowGetRejectedTopic);
      Serial.printf("Subscribed to Shadow Delta/Get topics for %s\n", THINGNAME);
      unsigned long t0 = millis();
      while (millis() - t0 < 300) {
        client.loop();
        delay(5);
      }
      requestShadow();
      break;
    } else {
      Serial.print(" rc=");
      Serial.print(client.state());
      Serial.println(" retry in 5s");
      delay(5000);
    }
  }
}

// =======================================================
// AWS Connect
// =======================================================
void connectAWS() {
  net.setCACert(AWS_CERT_CA);
  net.setCertificate(AWS_CERT_CRT);
  net.setPrivateKey(AWS_CERT_PRIVATE);
  client.setServer(AWS_IOT_ENDPOINT, 8883);
  client.setCallback(messageHandler);
  snprintf(shadowUpdateTopic, sizeof(shadowUpdateTopic),
           "$aws/things/%s/shadow/update", THINGNAME);
  snprintf(shadowDeltaTopic, sizeof(shadowDeltaTopic),
           "$aws/things/%s/shadow/update/delta", THINGNAME);
  snprintf(shadowGetTopic, sizeof(shadowGetTopic),
           "$aws/things/%s/shadow/get", THINGNAME);
  snprintf(shadowGetAcceptedTopic, sizeof(shadowGetAcceptedTopic),
           "$aws/things/%s/shadow/get/accepted", THINGNAME);
  snprintf(shadowGetRejectedTopic, sizeof(shadowGetRejectedTopic),
           "$aws/things/%s/shadow/get/rejected", THINGNAME);
  ensureMqtt();
}

// =======================================================
// Shadow Request
// =======================================================
void requestShadow() {
  if (!client.connected()) return;
  const char* emptyJson = "{}";
  bool ok = client.publish(shadowGetTopic, emptyJson);
  if (ok) {
    waitingGetAccepted = true;
    shadowGetSentMs = millis();
  }
}

// =======================================================
// setup / loop
// =======================================================
void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));
  lastTelemetryMs = millis();
  lastShtSnapshotMs = millis();
  lastWatchdogMs = millis();

  if (!USE_MOCK_SENSORS) {
    Wire.begin(SDA_PIN, SCL_PIN);
#ifndef USE_MOCK_SENSORS
    if (!sht31.begin(0x44)) {
      Serial.println("ไม่พบ SHT3x sensor!");
    }
#endif
  } else {
    Serial.println("--- [MOCK MODE] SHT31 Sensor Disabled ---");
  }

  client.setBufferSize(2048);
  client.setKeepAlive(60);

  pinMode(LED_ROOM_PIN, OUTPUT);
  digitalWrite(LED_ROOM_PIN, shadowRequestedLedState);

  readSensors();
  connectWiFi();
  syncTime();
  connectAWS();
}

void loop() {
  if (!client.loop()) {
    ensureMqtt();
  }

  readSensors();
  const unsigned long now = millis();

  if (!waitingGetAccepted && (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS)) {
    lastTelemetryMs = now;
    updateSensorBuffer();
    publishShtData("realtime", lastTemp, lastHumid);
  }

  if (!waitingGetAccepted && (now - lastShtSnapshotMs >= SHT_SNAPSHOT_INTERVAL_MS)) {
    lastShtSnapshotMs = now;
    int count = bufferIsFull ? BUFFER_SIZE : bufferIndex;
    if (count > 0) {
      float avgTemp = calculateAverage(tempBuffer, count);
      float avgHumid = calculateAverage(humidBuffer, count);
      Serial.printf("--- [SNAPSHOT] Averaging %d samples: T=%.2f, H=%.2f ---\n", count, avgTemp, avgHumid);
      publishShtData("snapshot", avgTemp, avgHumid);
      bufferIndex = 0;
      bufferIsFull = false;
    }
    publishShadowReported();
  }

  if (!waitingGetAccepted && (now - lastWatchdogMs >= WDT_INTERVAL_MS)) {
    lastWatchdogMs = now;
    publishWatchdog();
  }

  if (waitingGetAccepted && (now - shadowGetSentMs > GET_TIMEOUT_MS)) {
    Serial.println("GET timeout -> fallback publishShadowReported()");
    waitingGetAccepted = false;
    publishShadowReported();
  }

  delay(200);
}