// =======================================================
// esp32-bedroom-event.ino — PIR Motion Sensor (Mock 5s Toggle)
// Full working sketch: WiFi + TLS + MQTT + Watchdog + Mock PIR
// =======================================================

#include "secrets.h"  // WIFI_SSID, WIFI_PASSWORD, AWS_CERT_CA, AWS_CERT_CRT, AWS_CERT_PRIVATE, AWS_IOT_ENDPOINT
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ---------------------------
// 1) Hardware & State
// ---------------------------
const int PIR_PIN = 19;
const int LED_MOTION_PIN = 23;
const char* DEVICE_ID = "motion";

int previousPIRState = LOW;
String lastMotion = "No Motion";

// --- MOCK SENSOR VARIABLES ---
bool isMocking = true;  // false ถ้าใช้เซ็นเซอร์จริง
unsigned long lastMockChangeMs = 0;
const unsigned long MOCK_TOGGLE_INTERVAL_MS = 5000;  // Toggle ทุก 5 วิ
int mockPIRState = LOW;

// ---------------------------
// 2) Topics
// ---------------------------
const char* MOTION_EVENT_TOPIC = "smarthome/event/livingroom/motion";
const char* WATCHDOG_TOPIC = "smarthome/watchdog/livingroom";

// ---------------------------
// 3) MQTT / TLS / Timing
// ---------------------------
WiFiClientSecure net;
PubSubClient client(net);

unsigned long lastWatchdogMs = 0;
const unsigned long WDT_INTERVAL_MS = 300000;  // 5 นาที

// ---------------------------
// 4) Prototypes
// ---------------------------
void connectWiFi();
void syncTime();
void connectAWS();
void ensureMqtt();
void publishMotionEvent();
void publishWatchdog();
void readPIRLogic();
int mockPIRRead();

// =======================================================
// 5) WiFi + NTP + AWS IoT Functions
// =======================================================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.print(" OK IP=");
  Serial.println(WiFi.localIP());
}

void syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("[Time] Syncing NTP");
  time_t now = time(nullptr);
  while (now < 24 * 3600) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println(" OK");
}

void connectAWS() {
  net.setCACert(AWS_CERT_CA);
  net.setCertificate(AWS_CERT_CRT);
  net.setPrivateKey(AWS_CERT_PRIVATE);

  client.setServer(AWS_IOT_ENDPOINT, 8883);
  client.setCallback([](char* topic, byte* payload, unsigned int length) {
    Serial.println("[MQTT] Received message (ignored)");
  });

  ensureMqtt();
}

void ensureMqtt() {
  if (client.connected()) return;

  Serial.print("[MQTT] Connecting to AWS IoT");
  while (!client.connected()) {
    if (client.connect(DEVICE_ID)) {
      Serial.println(" OK");
      break;
    } else {
      Serial.print(" rc=");
      Serial.print(client.state());
      Serial.println(" retry in 5s");
      delay(5000);
    }
  }
  client.loop();
}

// =======================================================
// 6) Publish Functions
// =======================================================
void publishMotionEvent() {
  if (!client.connected()) return;

  StaticJsonDocument<256> doc;
  doc["Motion"] = lastMotion;
  doc["TimeStamp"] = (uint32_t)time(nullptr);

  char buf[256];
  size_t n = serializeJson(doc, buf);
  bool ok = client.publish(MOTION_EVENT_TOPIC, (uint8_t*)buf, n);
  Serial.print("[EVENT] Publish Motion: ");
  Serial.println(ok ? "OK" : "FAILED");
  Serial.printf("  Topic: %s, Payload: %s\n", MOTION_EVENT_TOPIC, buf);
}

void publishWatchdog() {
  if (!client.connected()) return;

  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = "alive";
  doc["timestamp"] = (uint32_t)time(nullptr);

  char buf[128];
  size_t n = serializeJson(doc, buf);
  bool ok = client.publish(WATCHDOG_TOPIC, (uint8_t*)buf, n);
  Serial.print("[WDT] Watchdog: ");
  Serial.println(ok ? "OK" : "FAILED");
}

// =======================================================
// 7) Mock PIR Sensor Read (Toggle every 5s)
// =======================================================
int mockPIRRead() {
  unsigned long now = millis();

  if (now - lastMockChangeMs >= MOCK_TOGGLE_INTERVAL_MS) {
    mockPIRState = (mockPIRState == LOW) ? HIGH : LOW;
    lastMockChangeMs = now;

    lastMotion = (mockPIRState == HIGH) ? "Motion Detected" : "No Motion";
    Serial.printf("[MOCK] %s\n", lastMotion.c_str());

    // ส่ง event ทันทีเมื่อเปลี่ยนสถานะ
    publishMotionEvent();
  }

  return mockPIRState;
}

// =======================================================
// 8) Read PIR Logic (Support real + mock)
// =======================================================
void readPIRLogic() {
  int motion;
  if (isMocking) {
    motion = mockPIRRead();
  } else {
    motion = digitalRead(PIR_PIN);
    lastMotion = (motion == HIGH) ? "Motion Detected" : "No Motion";
  }

  digitalWrite(LED_MOTION_PIN, (motion == HIGH) ? HIGH : LOW);
  Serial.printf("[PIR] Motion: %s | LED: %s\n",
                lastMotion.c_str(),
                (motion == HIGH ? "ON" : "OFF"));
}

// =======================================================
// 9) Arduino Setup / Loop
// =======================================================
void setup() {
  Serial.begin(115200);

  lastWatchdogMs = millis();
  lastMockChangeMs = millis();

  client.setBufferSize(512);
  client.setKeepAlive(60);

  pinMode(LED_MOTION_PIN, OUTPUT);
  if (!isMocking) pinMode(PIR_PIN, INPUT);

  digitalWrite(LED_MOTION_PIN, LOW);

  connectWiFi();
  syncTime();
  connectAWS();
}

void loop() {
  if (!client.loop()) ensureMqtt();

  readPIRLogic();

  unsigned long now = millis();
  if (now - lastWatchdogMs >= WDT_INTERVAL_MS) {
    lastWatchdogMs = now;
    publishWatchdog();
  }

  delay(200);
}