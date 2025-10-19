// =======================================================
// bedroom.ino
// =======================================================

#include "secrets.h" // ดึงค่า THINGNAME, WIFI_SSID, Certificates ฯลฯ
#include <WiFiClientSecure.h>
#include <PubSubClient.h> 
#include <ArduinoJson.h>
#include "WiFi.h"

// ---------------------------
// 1. กำหนดขา LED และตัวแปร
// ---------------------------
const int LED_PIN = 2; // ขา LED ภายใน (Built-in LED)
int ledState = LOW; // สถานะเริ่มต้นของ LED

// ---------------------------
// 2. กำหนด Topic แบบ Custom (ย้ายกลับมาที่นี่)
// ---------------------------
// Topic สำหรับส่งคำสั่งเปิด/ปิด (Subscribe)
const char* TOPIC_CONTROL = "smarthome/bedroom/led/control";
// Topic สำหรับรายงานสถานะจริงของ LED (Publish)
const char* TOPIC_STATUS = "smarthome/bedroom/led/status"; 


// ---------------------------
// 3. ตัวแปรสำหรับ MQTT และ SSL
// ---------------------------
WiFiClientSecure net;
PubSubClient client(net); 

// ---------------------------
// 4. Prototypes (ประกาศฟังก์ชันล่วงหน้า)
// ---------------------------
void connectAWS();
void publishStatus();
void messageHandler(char* topic, byte* payload, unsigned int length);


// ----------------------------------------------------
// ฟังก์ชันรายงานสถานะปัจจุบันกลับไปยัง AWS
// ----------------------------------------------------
void publishStatus() {
  StaticJsonDocument<100> doc;
  doc["id"] = THINGNAME;
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
void connectAWS(){
  // 1. เชื่อมต่อ Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");

  while (WiFi.status() != WL_CONNECTED){
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
  
  delay(10); 
}