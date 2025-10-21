// =======================================================
// bedroom.ino (โค้ดพร้อม Logic ส่ง Sensor Data)
// =======================================================

#include "secrets.h"
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "WiFi.h"

// ---------------------------
// 1. กำหนดขา LED และตัวแปร
// ---------------------------
const int LED_PIN = 2;
int ledState = LOW;

// ---------------------------
// 2. กำหนด Topic แบบ Custom (เพิ่ม Topic Sensor/Event)
// ---------------------------
const char* TOPIC_CONTROL = "smarthome/bedroom/led/control";
const char* TOPIC_STATUS = "smarthome/bedroom/led/status";
const char* TOPIC_TELEMETRY = "smarthome/bedroom/sensor/telemetry";  // อุณหภูมิ/ความชื้น
const char* TOPIC_MOTION_EVENT = "smarthome/bedroom/event/motion";   // การเคลื่อนไหว (PIR)

// ---------------------------
// 3. ตัวแปรสำหรับ MQTT, SSL และ Timing
// ---------------------------
WiFiClientSecure net;
PubSubClient client(net);

// ตัวแปรสำหรับจับเวลาการส่ง Sensor Data (30 วินาที)
unsigned long lastTelemetryTime = 0;
const long TELEMETRY_INTERVAL = 30000;  // 30000 มิลลิวินาที = 30 วินาที

// ---------------------------
// 4. Prototypes
// ---------------------------
void connectAWS();
void publishStatus();
void messageHandler(char* topic, byte* payload, unsigned int length);
void publishTelemetry();    // NEW
void publishMotionEvent();  // NEW

// ----------------------------------------------------
// ฟังก์ชันใหม่: ส่งค่าอุณหภูมิและความชื้น (Telemetry)
// ----------------------------------------------------
void publishTelemetry() {
  if (!client.connected()) return;

  // *** MOCK DATA: ใช้ค่าจำลอง ***
  float mockTemp = 28.5 + (sin(millis() / 60000.0) * 1.5);  // 28.5 ± 1.5
  int mockHumid = 65 + (sin(millis() / 30000.0) * 5);       // 65 ± 5

  StaticJsonDocument<200> doc;
  doc["deviceId"] = THINGNAME;
  doc["temp"] = serialized(String(mockTemp, 2));  // ทศนิยม 2 ตำแหน่ง
  doc["humidity"] = mockHumid;

  char jsonBuffer[200];
  serializeJson(doc, jsonBuffer);

  client.publish(TOPIC_TELEMETRY, jsonBuffer);
  Serial.print("Published Telemetry: ");
  Serial.println(jsonBuffer);
}


// ----------------------------------------------------
// ฟังก์ชันใหม่: ส่ง Event การเคลื่อนไหว (Motion Event)
// ----------------------------------------------------
void publishMotionEvent() {
  if (!client.connected()) return;

  // *** MOCK EVENT: ส่ง Event จำลองเมื่อมี Logic Trigger ***
  // ในโค้ดจริง ฟังก์ชันนี้จะถูกเรียกเมื่อ PIR Sensor เปลี่ยนสถานะ (HIGH/LOW)

  StaticJsonDocument<100> doc;
  doc["deviceId"] = THINGNAME;
  doc["event"] = "motion_detected";

  char jsonBuffer[100];
  serializeJson(doc, jsonBuffer);

  client.publish(TOPIC_MOTION_EVENT, jsonBuffer);
  Serial.print("Published Event: ");
  Serial.println(jsonBuffer);
}

// ----------------------------------------------------
// ฟังก์ชันรายงานสถานะปัจจุบันกลับไปยัง AWS
// ----------------------------------------------------
void publishStatus() {
  StaticJsonDocument<100> doc;
  doc["deviceId"] = THINGNAME;
  doc["led_status"] = (ledState == HIGH) ? "on" : "off";

  char jsonBuffer[100];
  serializeJson(doc, jsonBuffer);

  // 1. ใช้ client.publish()
  client.publish(TOPIC_STATUS, jsonBuffer);
  Serial.print("Published status to ");
  Serial.print(TOPIC_STATUS);
  Serial.print(": ");
  Serial.println(jsonBuffer);
}

// ----------------------------------------------------
// ฟังก์ชันจัดการข้อความที่ได้รับ (Callback function)
// ----------------------------------------------------
void messageHandler(char* topic, byte* payload, unsigned int length) {
  Serial.print("Incoming: ");
  Serial.println(topic);

  // 1. แปลง payload เป็น String
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.println(message);

  // 2. แยกวิเคราะห์ JSON
  StaticJsonDocument<100> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (error) {
    Serial.print("deserializeJson() failed: ");
    Serial.println(error.f_str());
    return;
  }

  // 3. ตรวจสอบค่าคำสั่ง 'cmd' ที่ถูกส่งมา
  if (doc.containsKey("cmd")) {
    String ledCmd = doc["cmd"].as<String>();

    // 4. ควบคุม LED ตามคำสั่ง
    if (ledCmd == "on") {
      digitalWrite(LED_PIN, HIGH);
      ledState = HIGH;
      Serial.println("LED turned ON");
    } else if (ledCmd == "off") {
      digitalWrite(LED_PIN, LOW);
      ledState = LOW;
      Serial.println("LED turned OFF");
    }

    // 5. รายงานสถานะปัจจุบันกลับไปยัง AWS ทันที
    publishStatus();
  }
}

// ----------------------------------------------------
// ฟังก์ชันเชื่อมต่อ AWS IoT Core
// ----------------------------------------------------
void connectAWS() {
  // 1. เชื่อมต่อ Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Connected!");

  // 2. ตั้งค่า Certificate และ Key
  net.setCACert(AWS_CERT_CA);
  net.setCertificate(AWS_CERT_CRT);
  net.setPrivateKey(AWS_CERT_PRIVATE);

  // 3. ตั้งค่า Server และ Callback (รูปแบบ PubSubClient)
  client.setServer(AWS_IOT_ENDPOINT, 8883);
  client.setCallback(messageHandler);

  Serial.print("Connecting to AWS IOT");

  // 4. พยายามเชื่อมต่อ MQTT
  while (!client.connected()) {
    // client.connect() ของ PubSubClient รับ Client ID
    if (client.connect(THINGNAME)) {
      Serial.println("AWS IoT Connected!");

      // 5. Subscribe และ Publish สถานะเริ่มต้น
      client.subscribe(TOPIC_CONTROL);
      publishStatus();
      break;
    } else {
      Serial.print("Failed, rc=");
      Serial.print(client.state());
      Serial.println(" Retrying in 5 seconds...");
      delay(5000);
    }
  }
}

// ====================================================
// SETUP
// ====================================================
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, ledState);

  connectAWS();
}

// ====================================================
// LOOP
// ====================================================
void loop() {
  // รักษาสถานะการเชื่อมต่อ MQTT
  if (!client.loop()) {
    // ถ้า client.loop() return false (หลุด), ให้เชื่อมต่อใหม่
    Serial.println("Connection dropped. Reconnecting...");
    connectAWS();
  }
  // 2. Logic การส่ง Telemetry (Non-blocking timing)
  unsigned long currentMillis = millis();
  if (currentMillis - lastTelemetryTime >= TELEMETRY_INTERVAL) {
    lastTelemetryTime = currentMillis;
    publishTelemetry();

    // ******* Logic สำหรับการทดสอบ Motion Event *******
    // สำหรับการทดสอบ เราจะส่ง Motion Event จำลองไปพร้อมกับ Telemetry
    // ในโค้ดจริง ส่วนนี้จะถูกย้ายไปเรียกใช้เมื่อ PIR Sensor มีการเปลี่ยนแปลง
    publishMotionEvent();
    // *************************************************
  }

  delay(10);
}