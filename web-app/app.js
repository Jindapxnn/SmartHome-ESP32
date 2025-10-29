// app.js
// =======================================================
// ⚙️ การตั้งค่า
// =======================================================

// **สำคัญ:** เปลี่ยนเป็น WSS Endpoint ของ WebSocket API Gateway ของคุณ
const WS_ENDPOINT =
  "wss://tbfn0z37i1.execute-api.ap-southeast-1.amazonaws.com/dev";

const REST_API_ENDPOINT =
  "https://bq4r44rhx6.execute-api.ap-southeast-1.amazonaws.com/dev";

let websocket;
const PI = Math.PI;
const homeStatusElement = document.getElementById("api-status-home");
const homeCircleStatusElement = document.getElementById(
  "api-status-circle-home"
);
const historyStatusElement = document.getElementById("api-status-history");
const historyCircleStatusElement = document.getElementById(
  "api-status-circle-history"
);

// =======================================================
// 1. ฟังก์ชันนาฬิกาดิจิทัล (Clock Function) ⏰
// =======================================================

/**
 * ฟังก์ชันสำหรับแสดงเวลาและวันที่ปัจจุบัน (Local Time) ในไทย
 */
function updateClock() {
  const now = new Date();

  // ตั้งค่าตัวเลือกการแสดงผล
  const timeOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false, // รูปแบบ 24 ชั่วโมง
  };
  const dateOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
  };

  // เวลา: HH:MM:SS
  const timeString = now.toLocaleTimeString("en-GB", timeOptions);

  // วันที่: DD Month, YYYY (ภาษาไทย)
  const dateString = now.toLocaleDateString("th-TH", dateOptions);

  document.getElementById("current-time").textContent = timeString;
  document.getElementById("current-date").textContent = dateString;
}

// =======================================================
// 2. การเชื่อมต่อ WebSocket และการจัดการข้อความ (Realtime Update) 🌐
// =======================================================

/**
 * เริ่มต้นการเชื่อมต่อ WebSocket ไปยัง API Gateway
 */
function connectWebSocket() {
  // console.log(`Attempting to connect to WebSocket: ${WS_ENDPOINT}`);

  // ตั้งค่าสถานะ UI เป็น Connecting
  homeStatusElement.textContent = "Connecting...";
  homeCircleStatusElement.className = "w-3 h-3 rounded-full bg-yellow-500 mr-2";

  // 1. สร้าง WebSocket Object
  websocket = new WebSocket(WS_ENDPOINT);

  // 2. เมื่อเชื่อมต่อสำเร็จ
  // AWS API Gateway จะจัดการ $connect route โดยอัตโนมัติ
  // และส่ง ConnectionId ไปยัง Lambda ของคุณเพื่อบันทึก
  websocket.onopen = () => {
    // console.log("WebSocket Connected! Ready to receive data.");
    homeStatusElement.textContent =
      "WebSocket Connected! Initializing state...";
    homeCircleStatusElement.className =
      "w-3 h-3 rounded-full bg-green-500 mr-2";

    // 🚨 การเรียกใช้: ดึงข้อมูลเริ่มต้นทันทีเมื่อเชื่อมต่อ WebSocket ได้
    fetchInitialData();
  };

  // 3. เมื่อได้รับข้อความ
  websocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      // console.log("Message received:", message);

      // ตรวจสอบ Topic: Update_Sensors (ตามที่ Lambda ส่งมา)
      if (message.Topic === "Update_Sensors" && message.Data) {
        // สร้าง TimeStamp ใหม่โดยใช้เวลาปัจจุบันของเบราว์เซอร์
        // และเพิ่มเข้าไปใน Data Object
        const nowISO = new Date().toISOString();
        const dataWithCurrentTime = {
          ...message.Data,
          // เพิ่ม TimeStamp ปัจจุบันในรูปแบบ ISO String
          // ซึ่ง formatTimeStamp สามารถใช้งานได้ทันที
          TimeStamp: nowISO,
        };
        // message.Data คือ Object ที่มี RoomId, Temperature, Humidity, TimeStamp
        updateDashboard(dataWithCurrentTime);
      }

      // ตรวจสอบ Topic: Motion_Alert
      if (message.Topic === "Motion_Alert" && message.Data) {
        // สร้าง TimeStamp ใหม่โดยใช้เวลาปัจจุบันของเบราว์เซอร์
        // และเพิ่มเข้าไปใน Data Object
        const nowISO = new Date().toISOString();
        const dataWithCurrentTime = {
          ...message.Data,
          // เพิ่ม TimeStamp ปัจจุบันในรูปแบบ ISO String
          // ซึ่ง formatTimeStamp สามารถใช้งานได้ทันที
          TimeStamp: nowISO,
        };
        // message.Data คือ Object ที่มี RoomId, Motion, TimeStamp
        alertMotion(dataWithCurrentTime);
      }
    } catch (error) {
      console.error("Error processing received message:", error);
    }
  };

  // 4. เมื่อเกิดข้อผิดพลาด
  websocket.onerror = (error) => {
    console.error("WebSocket Error:", error);
    homeStatusElement.textContent = "Error";
    homeStatusElement.parentElement.querySelector("span").className =
      "w-3 h-3 rounded-full bg-red-500 mr-2";
  };

  // 5. เมื่อการเชื่อมต่อถูกปิด
  websocket.onclose = () => {
    console.warn(
      "WebSocket Disconnected. Attempting to reconnect in 5 seconds..."
    );
    homeStatusElement.textContent = "Disconnected";
    homeStatusElement.parentElement.querySelector("span").className =
      "w-3 h-3 rounded-full bg-red-500 mr-2";

    // ลองเชื่อมต่อใหม่หลังจาก 5 วินาทีเพื่อความเสถียร
    setTimeout(connectWebSocket, 5000);
  };
}

// =======================================================
// 3. ฟังก์ชันอัปเดต UI (ตามข้อมูลจาก Lambda) ✨
// =======================================================
/**
 * ดึงข้อมูลเซ็นเซอร์ล่าสุดทั้งหมดสำหรับใช้ในการโหลดหน้าจอครั้งแรก (ผ่าน REST API)
 * @param {string} type - ชนิดของการเรียกใช้ (e.g., 'initial' เพื่อใช้ TimeStamp จากเบราว์เซอร์)
 */
async function fetchInitialData() {
  // ใช้ REST_API_ENDPOINT ที่เชื่อมกับ Lambda สำหรับดึงข้อมูลล่าสุด
  const url = `${REST_API_ENDPOINT}/smarthome/data?type=initial`;
  // console.log(`Fetching initial data from: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // ข้อมูลที่ได้จะเป็น Object ที่มี RoomId เป็น Key: {"bedroom": {...}, "livingroom": {...}}
    const latestData = await response.json();

    // 🚨 NEW: สร้าง TimeStamp ปัจจุบันของเบราว์เซอร์ ไว้สำหรับ 'initial'
    const nowISO = new Date().toISOString();

    // วนลูปอัปเดต Dashboard สำหรับทุกห้อง
    for (const roomId in latestData) {
      if (latestData.hasOwnProperty(roomId)) {
        const sensorData = latestData[roomId];

        // สร้าง Object ใหม่เพื่อส่งเข้า updateDashboard
        const dataWithFinalTime = {
          ...sensorData,
          RoomId: roomId, // เพิ่ม RoomId กลับเข้าไปใน Object ย่อย
          TimeStamp: nowISO, // 💡 ใช้ TimeStamp ที่ถูกเลือกแล้ว
        };

        // เรียกใช้ updateDashboard (เดิม) เพื่ออัปเดต UI
        updateDashboard(dataWithFinalTime);
      }
    }

    // console.log(`Initial Dashboard state updated successfully.`);
  } catch (error) {
    console.error("Failed to fetch initial data:", error);
    homeStatusElement.textContent = "Error fetching initial data";
    homeCircleStatusElement.className = "w-3 h-3 rounded-full bg-red-500 mr-2";
  }
}

/**
 * ดึงข้อมูลประวัติ (Temperature, Humidity, Motion) ทั้งหมดจาก Lambda (ผ่าน REST API)
 * @returns {object | null} - ข้อมูลประวัติที่จัดรูปแบบแล้ว หรือ null หากล้มเหลว
 */
async function fetchHistoryData() {
  const url = `${REST_API_ENDPOINT}/smarthome/data?type=history`;
  // console.log(`Fetching history data from: ${url}`);

  // Set System Status to Loading
  historyStatusElement.textContent = "Fetching History Data...";
  historyCircleStatusElement.className =
    "w-3 h-3 rounded-full bg-yellow-500 mr-2";

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // ข้อมูลที่ได้จะเป็น Object ตามที่คุณกำหนด
    const rawHistoryData = await response.json();

    // จัดรูปแบบข้อมูลให้เป็นโครงสร้างตามที่ต้องการ
    const nowISO = new Date().toISOString();
    const fullTimeString = formatTimeStamp(nowISO);
    const formattedData = formatHistoryData(rawHistoryData);

    // แสดงผลใน Console ตามที่ผู้ใช้ต้องการ
    // console.log("=======================================");
    // console.log("History Data (Formatted by fetchHistoryData):");
    // console.log(formattedData);
    // console.log("=======================================");

    // Set System Status back to Ready/Connected
    historyStatusElement.textContent = `History Data Loaded @ ${extractTime(
      fullTimeString
    )}`;
    historyCircleStatusElement.className =
      "w-3 h-3 rounded-full bg-green-500 mr-2";

    renderHistoryData(formattedData);

    return formattedData;
  } catch (error) {
    console.error("Failed to fetch history data:", error);
    historyStatusElement.textContent = `Error fetching history data @ ${extractTime(
      fullTimeString
    )}`;
    historyCircleStatusElement.className =
      "w-3 h-3 rounded-full bg-red-500 mr-2";
    return null;
  }
}

/**
 * จัดรูปแบบข้อมูลดิบที่ได้จาก API ให้เป็นโครงสร้างที่ใช้งานง่าย
 * @param {object} rawData - ข้อมูลดิบที่ได้จาก Lambda History API
 * @returns {object} - โครงสร้างใหม่ที่แบ่งตาม SensorType และ RoomId
 * ตัวอย่าง: { sensors: { bedroom: [...], livingroom: [...] }, motion: { bedroom: [...], livingroom: [...] } }
 */
function formatHistoryData(rawData) {
  const formatted = {
    sensors: {}, // สำหรับ Temperature และ Humidity
    motion: {}, // สำหรับ Motion
  };

  for (const roomId in rawData) {
    if (rawData.hasOwnProperty(roomId)) {
      const roomData = rawData[roomId];

      // Sensor Data (Temperature, Humidity)
      if (roomData.sensors && Array.isArray(roomData.sensors)) {
        formatted.sensors[roomId] = roomData.sensors;
      }

      // Motion Data
      if (roomData.motion && Array.isArray(roomData.motion)) {
        formatted.motion[roomId] = roomData.motion;
      }
    }
  }
  return formatted;
}

let currentSensorPage = 1;
let currentMotionPage = 1;
const itemsPerPage = 10;
let globalHistoryData = null;

function renderHistoryData(data) {
  globalHistoryData = data;
  renderHistoryTables();
}

function renderHistoryTables() {
  if (!globalHistoryData) return;

  const dataType = document.getElementById("data-type").value;
  const sensorRoom = document.getElementById("sensor-room").value;
  const motionRoom = document.getElementById("motion-room").value;
  const sortOrder = document.getElementById("sort-order").value;

  const sensorSection = document.getElementById("sensor-section");
  const motionSection = document.getElementById("motion-section");

  // ดึงข้อมูล
  let sensorData = [];
  let motionData = [];

  // รวมข้อมูล sensor ตามห้อง
  if (sensorRoom === "all") {
    Object.values(globalHistoryData.sensors).forEach((roomData) => {
      sensorData = sensorData.concat(roomData);
    });
  } else {
    sensorData = globalHistoryData.sensors[sensorRoom] || [];
  }

  // รวมข้อมูล motion ตามห้อง
  if (motionRoom === "all") {
    Object.values(globalHistoryData.motion).forEach((roomData) => {
      motionData = motionData.concat(roomData);
    });
  } else {
    motionData = globalHistoryData.motion[motionRoom] || [];
  }

  // เรียงข้อมูลตามเวลา
  sensorData.sort((a, b) =>
    sortOrder === "desc"
      ? new Date(b.TimeStamp) - new Date(a.TimeStamp)
      : new Date(a.TimeStamp) - new Date(b.TimeStamp)
  );
  motionData.sort((a, b) =>
    sortOrder === "desc"
      ? new Date(b.TimeStamp) - new Date(a.TimeStamp)
      : new Date(a.TimeStamp) - new Date(b.TimeStamp)
  );

  // แสดงตารางตามประเภทที่เลือก
  if (dataType === "sensor") {
    sensorSection.style.display = "block";
    motionSection.style.display = "none";
    renderTable("sensor", sensorData, currentSensorPage);
  } else if (dataType === "motion") {
    sensorSection.style.display = "none";
    motionSection.style.display = "block";
    renderTable("motion", motionData, currentMotionPage);
  } else {
    sensorSection.style.display = "block";
    motionSection.style.display = "block";
    renderTable("sensor", sensorData, currentSensorPage);
    renderTable("motion", motionData, currentMotionPage);
  }
}

function renderTable(type, data, currentPage) {
  const container =
    type === "sensor"
      ? document.getElementById("sensor-table-container")
      : document.getElementById("motion-table-container");

  if (!container) return;

  // ถ้าไม่มีข้อมูล
  if (!data || data.length === 0) {
    container.innerHTML = `
      <div class="text-center text-gray-500 py-6 rounded-lg">
        ไม่พบข้อมูลในฐานข้อมูล
      </div>
    `;
    return;
  }

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = data.slice(startIndex, endIndex);

  let tableHTML = `
    <table class="min-w-full border border-gray-200 text-sm">
      <thead class="bg-gray-100">
        <tr>
          <th class="border px-3 py-2 text-left">#</th>
          <th class="border px-3 py-2 text-left">Room</th>
          <th class="border px-3 py-2 text-left">Timestamp</th>
          ${
            type === "sensor"
              ? `<th class="border px-3 py-2 text-left">Temperature (°C)</th>
                 <th class="border px-3 py-2 text-left">Humidity (%)</th>`
              : `<th class="border px-3 py-2 text-left">Motion</th>`
          }
        </tr>
      </thead>
      <tbody>
  `;

  paginatedData.forEach((item, index) => {
    const formattedTime = formatTimeStamp(item.TimeStamp);
    tableHTML += `
      <tr class="hover:bg-gray-50">
        <td class="border px-3 py-2">${startIndex + index + 1}</td>
        <td class="border px-3 py-2">${item.RoomId}</td>
        <td class="border px-3 py-2">${formattedTime}</td>
        ${
          type === "sensor"
            ? `<td class="border px-3 py-2">${item.Temperature.toFixed(2)}</td>
               <td class="border px-3 py-2">${item.Humidity.toFixed(2)}</td>`
            : `<td class="border px-3 py-2">${item.Motion}</td>`
        }
      </tr>
    `;
  });

  tableHTML += `</tbody></table>`;

  // Pagination
  const totalPages = Math.ceil(data.length / itemsPerPage);
  let paginationHTML = `
    <div class="flex justify-between items-center mt-4">
      <button
        onclick="changePage('${type}', ${currentPage - 1})"
        class="px-3 py-1 rounded bg-blue-500 text-white disabled:bg-gray-300"
        ${currentPage === 1 ? "disabled" : ""}
      >
        Previous
      </button>
      <span class="text-gray-700">Page ${currentPage} / ${totalPages}</span>
      <button
        onclick="changePage('${type}', ${currentPage + 1})"
        class="px-3 py-1 rounded bg-blue-500 text-white disabled:bg-gray-300"
        ${currentPage === totalPages ? "disabled" : ""}
      >
        Next
      </button>
    </div>
  `;

  container.innerHTML = tableHTML + paginationHTML;
}

function changePage(type, newPage) {
  if (type === "sensor") {
    currentSensorPage = newPage;
  } else {
    currentMotionPage = newPage;
  }
  renderHistoryTables();
}

document.addEventListener("change", (e) => {
  if (
    e.target.id === "sensor-room" ||
    e.target.id === "motion-room" ||
    e.target.id === "data-type" ||
    e.target.id === "sort-order"
  ) {
    currentSensorPage = 1;
    currentMotionPage = 1;
    renderHistoryTables();
  }
});

/**
 * ฟังก์ชันหลักสำหรับอัปเดตข้อมูลเซ็นเซอร์ทั้งหมดบนหน้าจอ
 * @param {object} data - ข้อมูลเซ็นเซอร์ที่ได้รับจาก Lambda (RoomId, Temperature, Humidity, TimeStamp)
 */
function updateDashboard(data) {
  const { RoomId, TimeStamp, Temperature, Humidity, LED } = data;

  if (!RoomId) return;

  const room = RoomId.toLowerCase(); // 'bedroom' หรือ 'livingroom'
  // สร้าง Time String แบบเต็ม (e.g., "20:23:21 (26 ต.ค.)")
  const fullTimeString = formatTimeStamp(TimeStamp);

  // 1. อัปเดตอุณหภูมิ (Dial และ Header)
  updateTempDial(room, Temperature);

  // 2. อัปเดตความชื้น
  const humidityElement = document.getElementById(`humidity-value-${room}`);
  if (humidityElement) {
    humidityElement.textContent = `${
      Temperature !== undefined ? Humidity.toFixed(1) : "--"
    }%`;
  }

  // 3. อัปเดตสถานะ LED (ถ้ามีการส่งมาใน Realtime Update)
  if (LED) {
    updateLEDStatusUI(room, LED);
    updateLEDStatusCheckbox(room, LED);
  }

  // 3. อัปเดตเวลาอัปเดตล่าสุด
  const updateElement = document.getElementById(`temp-last-update-${room}`);
  if (updateElement) {
    // TimeStamp ที่ได้รับมาเป็น String Thai Zone ISO 8601 อยู่แล้ว
    // ถ้าต้องการแสดงทั้ง วันที่และเวลา ให้ใช้ updateElement.textContent = fullTimeString;
    updateElement.textContent = extractTime(fullTimeString);
  }

  // 4. อัปเดตสถานะ API
  homeStatusElement.textContent = `Update Dashboard - ${
    room.charAt(0).toUpperCase() + room.slice(1)
  } @ ${extractTime(fullTimeString)}`;

  // สำหรับเช็คว่าทำงานสำเร็จ
  // console.log(`UI updated for ${RoomId}.`);
}

/**
 * อัปเดต Dial SVG สำหรับการแสดงอุณหภูมิ
 * @param {string} room - ชื่อห้อง
 * @param {number} temp - ค่าอุณหภูมิปัจจุบัน
 */
function updateTempDial(room, temp) {
  const dialProgress = document.getElementById(`temp-dial-progress-${room}`);
  const dialValue = document.getElementById(`temp-dial-value-${room}`);
  const tempDisplay = document.getElementById(`temp-display-${room}`);

  if (!dialProgress || temp === undefined) {
    // ถ้าค่าเป็น undefined ให้แสดง --
    if (dialValue) dialValue.textContent = "--";
    if (tempDisplay) tempDisplay.textContent = "--°C";
    return;
  }

  const circumference = 2 * PI * 40;
  dialProgress.setAttribute("stroke-dasharray", circumference);

  // กำหนดช่วงอุณหภูมิ (ปรับได้ตามความเหมาะสม)
  const MIN_TEMP = 15;
  const MAX_TEMP = 40;

  let percentage = (temp - MIN_TEMP) / (MAX_TEMP - MIN_TEMP);
  percentage = Math.max(0, Math.min(1, percentage)); // จำกัดค่าระหว่าง 0 ถึง 1

  const offset = circumference * (1 - percentage);

  dialProgress.setAttribute("stroke-dashoffset", offset);

  // อัปเดตข้อความ
  const tempFixed = temp.toFixed(1);
  dialValue.textContent = tempFixed;
  tempDisplay.textContent = `${tempFixed}°C`;
}

/**
 * ฟังก์ชันหลักสำหรับแจ้งเตือนการเคลื่อนไหว (Event-Driven)
 * @param {object} data - ข้อมูลเซ็นเซอร์ที่ได้รับจาก Lambda (RoomId, TimeStamp, Motion)
 */
function alertMotion(data) {
  const { RoomId, TimeStamp, Motion } = data;
  // อัปเดตสถานะ Motion
  const motionStatusElement = document.getElementById(
    `motion-status-${RoomId}`
  );
  const lastMotionElement = document.getElementById(`last-motion-${RoomId}`);
  if (motionStatusElement) {
    if (Motion === "Motion Detected") {
      motionStatusElement.textContent = "Motion Detected";
      motionStatusElement.classList.remove("text-gray-600");
      motionStatusElement.classList.add("text-red-500");
      if (lastMotionElement) {
        lastMotionElement.textContent = extractTime(formatTimeStamp(TimeStamp));
      }
    } else {
      motionStatusElement.textContent = "No Motion";
      motionStatusElement.classList.remove("text-red-500");
      motionStatusElement.classList.add("text-gray-600");
      if (lastMotionElement) {
        lastMotionElement.textContent = extractTime(formatTimeStamp(TimeStamp));
      }
    }
    // alert("พบการเคลื่อนไหวในห้อง " + RoomId + formatTimeStamp(TimeStamp));
    homeStatusElement.textContent = `Motion Alert - ${RoomId} @ ${extractTime(
      formatTimeStamp(TimeStamp)
    )}`;
  }
}

/**
 * แปลง TimeStamp (ISO 8601 String ที่มาจาก Lambda) ให้อยู่ในรูปแบบเวลาที่อ่านง่าย
 * @param {string} isoString - ISO 8601 String ที่เป็น Thai Zone (e.g., "2025-10-26T20:23:21.000+07:00")
 * @returns {string} - e.g., "20:23:21 (26 ต.ค.)"
 */
function formatTimeStamp(isoString) {
  try {
    const date = new Date(isoString);

    // ใช้ Local Time Zone ของเบราว์เซอร์ ซึ่งจะแปลง +07:00 ให้แสดงผลได้อย่างถูกต้อง
    const timePart = date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const datePart = date.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
    });

    return `${timePart} (${datePart})`;
  } catch (error) {
    return "Invalid Time";
  }
}

/**
 * ฟังก์ชันตัวช่วย: แยกเฉพาะส่วนเวลาออกจาก String ที่มีรูปแบบ "HH:MM:SS (DD Month)"
 * @param {string} formattedString - String ที่ถูก format แล้วโดย formatTimeStamp
 * @returns {string} - เฉพาะส่วนเวลา เช่น "20:23:21"
 */
function extractTime(formattedString) {
  // ใช้วิธีหา index ของช่องว่างแรก (หลังเวลา)
  const spaceIndex = formattedString.indexOf(" ");
  if (spaceIndex > 0) {
    return formattedString.substring(0, spaceIndex);
  }
  // คืนค่าเดิมหากหาไม่พบ (เป็นค่า Invalid Time หรือรูปแบบอื่น)
  return formattedString;
}

// =======================================================
// 4. Initialization & Event Handlers
// =======================================================

/**
 * ฟังก์ชันสำหรับควบคุม LED (ส่งคำสั่งผ่าน REST API)
 * โดยใช้หลักการ Optimistic UI Update (อัปเดตก่อน, Rollback ถ้า Error)
 * @param {string} room - ชื่อห้อง ('bedroom' หรือ 'livingroom')
 */
async function controlLED(room) {
  const checkbox = document.getElementById(`ledToggle-${room}`);

  // สถานะที่ผู้ใช้ต้องการ (ค่าใหม่)
  const newStatus = checkbox.checked ? "on" : "off";
  // สถานะเดิม (ก่อนการเปลี่ยนแปลง)
  const oldChecked = !checkbox.checked;
  const oldStatus = oldChecked ? "on" : "off";

  // 1. **Optimistic Update (อัปเดต UI ทันที)**
  //   - สถานะ Checkbox ได้เปลี่ยนไปแล้วโดยเบราว์เซอร์
  //   - อัปเดตข้อความสถานะทันที
  updateLEDStatusUI(room, newStatus);

  // console.log(`[LED Control] Sending command: ${room} -> ${newStatus}`);

  // 2. สร้าง Payload และ Endpoint
  // 💡 สมมติว่า Thing Name คือ 'smarthome-' ตามด้วยชื่อห้อง เช่น 'smarthome-bedroom'
  const CONTROLLED_ENDPOINT = `${REST_API_ENDPOINT}/smarthome/led/${room}`;
  const thingName = `smarthome-${room}`;
  const payload = {
    THING_NAME: thingName,
    ledStatus: newStatus,
  };

  try {
    const response = await fetch(CONTROLLED_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // โยน Error หาก Response ไม่ใช่ 2xx
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    // const data = await response.json();
    // console.log(`[LED Control] Command successful:`, data);

    // 3. หากสำเร็จ: ไม่ต้องทำอะไร UI ถูกอัปเดตไปแล้ว
  } catch (error) {
    // 4. หาก Error: **Rollback UI**
    console.error(`[LED Control] ERROR. Rolling back UI for ${room}.`, error);

    // Rollback Checkbox state
    checkbox.checked = oldChecked;

    // Rollback Status Text
    updateLEDStatusUI(room, oldStatus);

    alert(
      `Failed to control ${room} LED. Status rolled back. (Error: ${error.message})`
    );
  }
}

/**
 * 🚨 NEW Helper Function: อัปเดตสถานะ Checkbox (ใช้สำหรับการโหลดเริ่มต้น/Real-time)
 * @param {string} room - ชื่อห้อง
 * @param {string} status - สถานะ 'on' หรือ 'off'
 */
function updateLEDStatusCheckbox(room, status) {
  const checkbox = document.getElementById(`ledToggle-${room}`);
  if (checkbox) {
    // ตั้งค่า Checkbox ให้ตรงกับสถานะล่าสุดที่โหลดมา
    checkbox.checked = status.toLowerCase() === "on";
    // เรียก updateLEDStatusUI เพื่ออัปเดตข้อความสถานะด้วย
    updateLEDStatusUI(room, status);
  }
}

/**
 * ฟังก์ชันตัวช่วยสำหรับอัปเดตสถานะ LED บน UI (เพื่อใช้ในการ Optimistic และ Rollback) (มีการเพิ่มการเรียกใช้)
 * @param {string} room - ชื่อห้อง
 * @param {string} status - สถานะ 'on' หรือ 'off'
 */
function updateLEDStatusUI(room, status) {
  const statusText = document.getElementById(`led-status-text-${room}`);
  const displayStatus = status.toUpperCase();

  if (statusText) {
    statusText.textContent = displayStatus;
    statusText.classList.toggle("text-gray-300", displayStatus === "OFF");
    statusText.classList.toggle("primary-blue-text", displayStatus === "ON");
  }
}

/**
 * ฟังก์ชันเริ่มต้นการทำงานทั้งหมด (ถูกเรียกใช้ใน body onload)
 */
function initApp() {
  // 1. เริ่มต้นนาฬิกา
  updateClock();
  setInterval(updateClock, 1000);

  // 2. เริ่มต้นการเชื่อมต่อ WebSocket
  connectWebSocket();
}

function initHistoryPage() {
  // 1. เริ่มต้นนาฬิกา
  updateClock();
  setInterval(updateClock, 1000);

  // 2. ดึงข้อมูลประวัติทันที
  fetchHistoryData();
}

// ทำให้ฟังก์ชันเข้าถึงได้จาก HTML
window.controlLED = controlLED;
window.initApp = initApp;
window.fetchHistoryData = fetchHistoryData;
window.initHistoryPage = initHistoryPage;
