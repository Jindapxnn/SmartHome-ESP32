// =======================================================
// app.js (Hybrid Logic: POST Command, GET Status Polling)
// =======================================================

// *** 1. Configuration (ต้องเปลี่ยน URL) ***
// URL BASE: ใช้เป็น Root ของ API Gateway เช่น https://.../dev/
const API_COMMAND_URL_BASE =
  "YOUR_API_GATEWAY_URL";

// WebSocket Endpoint (จาก API Gateway WebSocket)
const WS_ENDPOINT = "YOUR_WEBSOCKET_API_GATEWAY_URL";

// *** 2. Global DOM Elements ***
const apiStatus = document.getElementById("api-status");
const ROOMS = ["bedroom", "livingroom"];

// *** 3. Global State Cache (เพิ่มใหม่เพื่อเก็บสถานะ LED) ***
const roomLedStates = {};

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
  const tempDisplay = document.getElementById(`temp-display-${room}`); // 1. Update LED Status (จาก stateData หรือ Cache) // ตรวจสอบว่ามี stateData ถูกส่งมาไหม ถ้าไม่มีจะใช้ค่าใน Cache (หรือ "off" เป็น Default)

  const ledState =
    stateData && stateData.LedStatus
      ? stateData.LedStatus.toLowerCase()
      : roomLedStates[room]?.LedStatus
      ? roomLedStates[room].LedStatus.toLowerCase()
      : "off";

  ledTextElement.textContent = ledState.toUpperCase();
  ledToggle.checked = ledState === "on"; // ตั้งค่า Toggle Switch // 2. Update Sensor Data (จาก smarthome-readings) // ตรวจสอบและแปลงค่าให้เป็น Number (อาจมาจาก DynamoDB 'N' type)

  const temp =
    sensorData && sensorData.Temperature
      ? parseFloat(sensorData.Temperature)
      : "--";
  const humid =
    sensorData && sensorData.Humidity
      ? parseFloat(sensorData.Humidity) // ให้แน่ใจว่าเป็น Number
      : "--";
  const motion =
    sensorData && sensorData.MotionStatus ? sensorData.MotionStatus : "Unknown";

  if (temp !== "--") {
    tempElement.textContent = temp.toFixed(1);
    tempDisplay.textContent = `${temp.toFixed(1)}°C`;

    // อัปเดต Dial Progress
    const progressCircle = document.getElementById(
      `temp-dial-progress-${room}`
    );
    if (progressCircle) {
      // Map Temperature (e.g., 20-40C) to 251.2 max circumference
      const maxTemp = 40;
      const minTemp = 15;
      const normalizedTemp = Math.min(Math.max(temp, minTemp), maxTemp);
      const percentage = (normalizedTemp - minTemp) / (maxTemp - minTemp);
      const circumference = 2 * Math.PI * 40; // r=40
      const dashoffset = circumference * (1 - percentage);
      progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
      progressCircle.style.strokeDashoffset = dashoffset;
    }

    document.getElementById(`temp-last-update-${room}`).textContent =
      new Date().toLocaleTimeString();
  } else {
    tempElement.textContent = "--";
    tempDisplay.textContent = "--°C";
  }
  // อัปเดตค่า Humidity และ Motion
  humidElement.textContent = `${humid !== "--" ? humid.toFixed(0) : "--"}%`;
  motionElement.textContent = motion;
}

// ----------------------------------------------------
// ฟังก์ชันส่งคำสั่ง (HTTP POST) - รองรับ 2 ห้อง
// ----------------------------------------------------
async function sendCommand(room) {
  const ledToggle = document.getElementById(`ledToggle-${room}`);
  const state = ledToggle.checked ? "on" : "off"; // URL สั่งงาน: /smarthome/{room}/led

  const targetURL = `${API_COMMAND_URL_BASE}/command/${room}/led`; // 💡 แก้ไข URL ให้ชัดเจนขึ้น

  apiStatus.textContent = `Sending ${room} command...`; // Payload: { room: "bedroom", cmd: "on" }

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
      apiStatus.textContent = `Success: Command sent to ${room}.`;
      // Note: การอัปเดต UI จะรอรับผลลัพธ์ผ่าน WebSocket (Shadow)
    } else {
      const errorData = await response.json();
      apiStatus.textContent = `API Error for ${room}: ${
        errorData.message || "Unknown"
      }`;
      console.error("API Error:", errorData);
      // ถ้าส่งไม่สำเร็จ ให้ย้อนสถานะ Toggle กลับ
      ledToggle.checked = !ledToggle.checked;
    }
  } catch (error) {
    apiStatus.textContent = "Network Error (Check CORS/URL)";
    console.error("Network Error:", error);
    // ถ้าส่งไม่สำเร็จ ให้ย้อนสถานะ Toggle กลับ
    ledToggle.checked = !ledToggle.checked;
  }
}

function connectWebSocket() {
  let websocket = new WebSocket(WS_ENDPOINT); // 💡 ใช้ let เพื่อให้สามารถกำหนดค่าใหม่ได้

  websocket.onopen = () => {
    apiStatus.textContent = "WebSocket Connected! Initializing state..."; // 1. เมื่อเชื่อมต่อสำเร็จ ให้ดึงสถานะเริ่มต้นทันที (Initial Load)
    fetchInitialState();
  };

  websocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // *** START NEW LOGIC FOR SENSOR_UPDATE (from lambda-shadow-to-dynamodb) ***
      if (data.type === "SENSOR_UPDATE" && Array.isArray(data.data)) {
        data.data.forEach((sensorItem) => {
          const room = sensorItem.RoomId;

          // 1. จัดโครงสร้าง Sensor Data (สังเกต: MotionDetected ถูกเปลี่ยนชื่อเป็น MotionStatus ใน UI)
          const sensorData = {
            Temperature: sensorItem.Temperature,
            Humidity: sensorItem.Humidity,
            MotionStatus: sensorItem.MotionDetected,
          };

          // 2. ดึง State Data (LED) ล่าสุดจาก Cache
          const stateData = roomLedStates[room]; // ดึงสถานะไฟล่าสุดที่เคยโหลดไว้

          // 3. อัปเดตเฉพาะ UI ของห้องนั้น ๆ
          if (room) {
            updateRoomUI(room, stateData, sensorData); // ใช้ stateData จาก Cache และ sensorData ใหม่
            apiStatus.textContent = `Real-time sensor update for ${room} @ ${new Date().toLocaleTimeString()}`;
          }
        });
        return;
      }
    } catch (e) {
      console.error("Error processing WebSocket message:", e, event.data);
    }
  };

  websocket.onerror = (error) => {
    apiStatus.textContent = "WebSocket Error. Retrying in 5s...";
    console.error("WebSocket Error:", error);
    setTimeout(connectWebSocket, 5000); // พยายามเชื่อมต่อใหม่
  };

  websocket.onclose = () => {
    apiStatus.textContent = "WebSocket Disconnected. Retrying...";
    setTimeout(connectWebSocket, 5000);
  };
}

// ----------------------------------------------------
// ฟังก์ชัน Polling (ดึงสถานะล่าสุดจาก DB)
// ----------------------------------------------------
async function fetchInitialState() {
  try {
    const fetchPromises = []; // 1. สร้าง Promises สำหรับการดึงข้อมูล API ของทั้ง 2 ห้อง

    ROOMS.forEach((room) => {
      // URL Combined State: /data/?room=bedroom
      // **ต้องสร้าง API Gateway Resource และ Method ใหม่สำหรับ Lambda นี้**
      const DataURL = `${API_COMMAND_URL_BASE}/data/?room=${room}`; // <<< URL ใหม่

      fetchPromises.push(
        fetch(DataURL, { method: "GET" })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.json();
          })
          .then((data) => ({ room: room, data: data })) // เก็บข้อมูลรวม
          .catch((error) => ({
            room: room,
            error: error.message || "Failed to fetch Combined State",
          }))
      );
    }); // 2. รัน Promises ทั้งหมดพร้อมกัน

    const results = await Promise.all(fetchPromises); // 3. อัปเดต UI และ Cache

    results.forEach((res) => {
      if (res.data) {
        // ดึงข้อมูลจากโครงสร้าง JSON ใหม่ของ Lambda (combinedState)
        const stateData = res.data.deviceState;
        const sensorData = res.data.sensorReadings; // 💡 Caching LED status: เก็บสถานะไฟล่าสุดที่โหลดได้

        if (stateData && stateData.LedStatus) {
          roomLedStates[res.room] = stateData;
        } // ตรวจสอบว่ามีข้อมูลทั้งสถานะไฟและเซ็นเซอร์ก่อนอัปเดต UI (ตาม Logic เดิม)

        if (stateData && sensorData) {
          updateRoomUI(res.room, stateData, sensorData);
        }
      } else if (res.error) {
        console.warn(`Polling warning for ${res.room}: ${res.error}`);
      }
    });

    apiStatus.textContent = `Status updated @ ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    apiStatus.textContent = "Polling Failed (Database/API Read Error)";
    console.error("Polling Error:", error);
  }
}

function updateClock() {
  const now = new Date(); // DOM IDs จาก index.html
  const timeElement = document.getElementById("current-time");
  const dateElement = document.getElementById("current-date");

  if (timeElement && dateElement) {
    // Time (HH:MM:SS format)
    const timeString = now.toLocaleTimeString("th-TH", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }); // Date (Day, Month, Year)
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

  apiStatus.textContent = "App Initialized. Connecting WebSocket..."; // 2. เชื่อมต่อ WebSocket ทันที

  connectWebSocket();
}

setInterval(updateClock, 1000);
updateClock(); // Initial call to display time immediately

// Global exposure for event handlers (Toggle Switch)
window.sendCommand = sendCommand;
window.toggleLED = function (room) {
  sendCommand(room);
};
