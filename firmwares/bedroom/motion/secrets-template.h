// =======================================================
// secrets.h
// ไฟล์สำหรับเก็บข้อมูลสำคัญที่ใช้ในการเชื่อมต่อ
// =======================================================

// ---------------------------
// 1. กำหนดค่า Wi-Fi และ AWS IoT
// ---------------------------
#define THINGNAME "YOUR_THING_NAME" // Client ID และชื่อ Thing
const char WIFI_SSID[] = "YOUR_WIFI_SSID";
const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
const char AWS_IOT_ENDPOINT[] = "YOUR_AWS_IOT_ENDPOINT_HERE"; // ตัวอย่าง: "xxxxxxxxxxxxxx-ats.iot.us-west-2.amazonaws.com"

// ---------------------------
// 2. Certificates (ใช้รูปแบบ R"EOF(...)EOF" และ PROGMEM)
// ---------------------------

// Amazon Root CA 1
static const char AWS_CERT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
YOUR_ROOT_CA_CERTIFICATE_HERE
-----END CERTIFICATE-----
)EOF";

// Device Certificate
static const char AWS_CERT_CRT[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
YOUR_DEVICE_CERTIFICATE_HERE
-----END CERTIFICATE-----
)EOF";

// Device Private Key
static const char AWS_CERT_PRIVATE[] PROGMEM = R"EOF(
-----BEGIN RSA PRIVATE KEY-----
YOUR_PRIVATE_KEY_HERE
-----END RSA PRIVATE KEY-----
)EOF";