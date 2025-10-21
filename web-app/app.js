// =======================================================
// app.js (Hybrid Logic: POST Command, GET Status Polling)
// =======================================================

// *** 1. Configuration (ต้องเปลี่ยน URL) ***
// URL BASE: ใช้เป็น Root ของ API Gateway เช่น https://.../dev/smarthome
const API_COMMAND_URL_BASE =
  "https://YOUR_API_GATEWAY";

// ลบ: API_LED_STATE_URL และ API_SENSOR_READINGS_URL ออก

const POLLING_INTERVAL = 3000; // ดึงสถานะทุก 3 วินาที

// *** 2. Global DOM Elements ***
const apiStatus = document.getElementById("api-status");
const ROOMS = ["bedroom", "livingroom"];

// ----------------------------------------------------
// ฟังก์ชันอัปเดต UI (แยกตาม Room ID)
// ----------------------------------------------------
function updateRoomUI(room, stateData, sensorData) {
  // Note: stateData มาจาก smarthome-state (LED), sensorData มาจาก smarthome-readings (Temp/Humid/Motion)

  const tempElement = document.getElementById(`temp-dial-value-${room}`);
  const humidElement = document.getElementById(`humidity-value-${room}`);
  const motionElement = document.getElementById(`motion-status-${room}`);
  const ledTextElement = document.getElementById(`led-status-text-${room}`);
  const ledToggle = document.getElementById(`ledToggle-${room}`);
  const tempDisplay = document.getElementById(`temp-display-${room}`);

  // 1. Update LED Status (จาก smarthome-state)
  const ledState =
    stateData && stateData.LedStatus
      ? stateData.LedStatus.toLowerCase()
      : "off";
  ledTextElement.textContent = ledState.toUpperCase();
  ledToggle.checked = ledState === "on"; // ตั้งค่า Toggle Switch

  // 2. Update Sensor Data (จาก smarthome-readings)
  // ตรวจสอบและแปลงค่าให้เป็น Number (อาจมาจาก DynamoDB 'N' type)
  const temp =
    sensorData && sensorData.Temperature
      ? parseFloat(sensorData.Temperature)
      : "--";
  const humid = sensorData && sensorData.Humidity ? sensorData.Humidity : "--";
  const motion =
    sensorData && sensorData.MotionStatus ? sensorData.MotionStatus : "Unknown";

  if (temp !== "--") {
    tempElement.textContent = temp.toFixed(1);
    tempDisplay.textContent = `${temp.toFixed(1)}°C`;
  }
  humidElement.textContent = `${humid}%`;
  motionElement.textContent = motion;
}

// ----------------------------------------------------
// ฟังก์ชันส่งคำสั่ง (HTTP POST) - รองรับ 2 ห้อง
// ----------------------------------------------------
async function sendCommand(room) {
  const ledToggle = document.getElementById(`ledToggle-${room}`);
  const state = ledToggle.checked ? "on" : "off"; 

  // URL สั่งงาน: /smarthome/{room}/led/control
  const targetURL = `${API_COMMAND_URL_BASE}/${room}/led/control`;

  apiStatus.textContent = `Sending ${room} command...`;

  // Payload: { room: "bedroom", cmd: "on" }
  const payload = { room: room, cmd: state };

  try {
    const response = await fetch(targetURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      apiStatus.textContent = `Success: Command sent to ${room}. Awaiting ESP32 feedback...`;
    } else {
      const errorData = await response.json();
      apiStatus.textContent = `API Error for ${room}: ${
        errorData.message || "Unknown"
      }`;
      console.error("API Error:", errorData);
    }
  } catch (error) {
    apiStatus.textContent = "Network Error (Check CORS/URL)";
    console.error("Network Error:", error);
  }
}

// ----------------------------------------------------
// ฟังก์ชัน Polling (ดึงสถานะล่าสุดจาก DB)
// ----------------------------------------------------
async function startPolling() {
  try {
    const fetchPromises = [];

    // 1. สร้าง Promises สำหรับการดึงข้อมูลทั้ง 2 API และทั้ง 2 ห้อง
    ROOMS.forEach((room) => {
      // URL LED State: /smarthome/{room}/led/status
      const ledStatusURL = `${API_COMMAND_URL_BASE}/${room}/led/status?room=${room}`;
      fetchPromises.push(
        fetch(ledStatusURL, { method: "GET" })
          .then((res) => res.json())
          .then((data) => ({ room: room, type: "state", data: data }))
          .catch((error) => ({
            room: room,
            type: "state",
            error: "Failed to fetch LED State",
          }))
      );

      // URL Sensor Readings: /smarthome/{room}/sensor/status
      const sensorStatusURL = `${API_COMMAND_URL_BASE}/${room}/sensor/status?room=${room}`;
      fetchPromises.push(
        fetch(sensorStatusURL, { method: "GET" })
          .then((res) => res.json())
          .then((data) => ({ room: room, type: "sensor", data: data }))
          .catch((error) => ({
            room: room,
            type: "sensor",
            error: "Failed to fetch Sensor Readings",
          }))
      );
    });

    // 2. รัน Promises ทั้งหมดพร้อมกัน
    const results = await Promise.all(fetchPromises);

    // 3. จัดกลุ่มข้อมูล
    const roomData = {};
    ROOMS.forEach((room) => (roomData[room] = { state: null, sensor: null }));

    results.forEach((res) => {
      if (res.data) {
        if (res.type === "state") roomData[res.room].state = res.data;
        if (res.type === "sensor") roomData[res.room].sensor = res.data;
      } else if (res.error) {
        console.warn(
          `Polling warning for ${res.room} (${res.type}): ${res.error}`
        );
      }
    });

    // 4. อัปเดต UI
    ROOMS.forEach((room) => {
      // ตรวจสอบว่ามีข้อมูลทั้งสถานะไฟและเซ็นเซอร์ก่อนอัปเดต UI
      if (roomData[room].state && roomData[room].sensor) {
        updateRoomUI(room, roomData[room].state, roomData[room].sensor);
      }
    });

    apiStatus.textContent = `Status updated @ ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    apiStatus.textContent = "Polling Failed (Database/API Read Error)";
    console.error("Polling Error:", error);
  }
}

function updateClock() {
  const now = new Date();
  // DOM IDs จาก index.html
  const timeElement = document.getElementById("current-time");
  const dateElement = document.getElementById("current-date");

  if (timeElement && dateElement) {
    // Time (HH:MM:SS format)
    const timeString = now.toLocaleTimeString("th-TH", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    // Date (Day, Month, Year)
    const dateString = now.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    timeElement.textContent = timeString;
    dateElement.textContent = dateString;
  }
}

// ----------------------------------------------------
// ฟังก์ชันเริ่มต้น App
// ----------------------------------------------------
function initApp() {
  ROOMS.forEach((room) => {
    const ledToggle = document.getElementById(`ledToggle-${room}`);
    if (ledToggle) ledToggle.disabled = false;
  });

  apiStatus.textContent = "App Initialized. Starting Polling...";

  // 2. เริ่มดึงข้อมูลสถานะทันทีและตั้ง Interval
  startPolling();
  setInterval(startPolling, POLLING_INTERVAL);
}

setInterval(updateClock, 1000);
updateClock(); // Initial call to display time immediately

// Global exposure for event handlers (Toggle Switch)
window.sendCommand = sendCommand;
window.toggleLED = function (room) {
  sendCommand(room);
};