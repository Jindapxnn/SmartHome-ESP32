// =======================================================
// app.js (ใช้ Fetch API เพื่อส่ง HTTP POST ไปยัง API Gateway)
// =======================================================

// *** 1. ข้อมูลสำคัญ: ต้องเปลี่ยน URL นี้เป็น Invoke URL ที่ได้จาก API Gateway ***
// ตัวอย่าง URL: https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/prod/command
const API_GATEWAY_URL = "YOUR_API_GATEWAY_INVOKE_URL_HERE";

// *** 2. ตัวแปร Global และ DOM Elements ***
const statusDisplay = document.getElementById("status-display");
const apiStatus = document.getElementById("api-status");
const onButton = document.getElementById("onButton");
const offButton = document.getElementById("offButton");

// ----------------------------------------------------
// A. ฟังก์ชันอัปเดต UI
// ----------------------------------------------------
function updateStatusDisplay(state, isError = false) {
  // ใช้เพื่ออัปเดต badge สถานะ
  const upperState = state.toUpperCase();
  statusDisplay.textContent = upperState;
  let className = "bg-secondary";

  if (upperState === "ON") {
    className = "bg-success";
  } else if (upperState === "OFF") {
    className = "bg-danger";
  } else if (isError) {
    className = "bg-warning text-dark";
  } else if (upperState.startsWith("SENDING")) {
    className = "bg-info";
  }

  statusDisplay.className = `badge ${className}`;
}

// ----------------------------------------------------
// B. ฟังก์ชันส่งคำสั่ง (ถูกเรียกโดยปุ่ม ON/OFF)
// ----------------------------------------------------
async function sendCommand(state) {
  // state ที่รับเข้ามาจะเป็น 'on' หรือ 'off' (ตัวพิมพ์เล็ก)

  // 1. ปิดปุ่มชั่วคราวขณะส่งคำสั่ง
  onButton.disabled = true;
  offButton.disabled = true;
  apiStatus.textContent = "Sending HTTP POST command...";
  updateStatusDisplay(`Sending ${state}`, false);

  // 2. สร้าง Payload ที่ Lambda คาดหวัง: {"state": "on"}
  const payload = { cmd: state };

  try {
    const response = await fetch(API_GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // 3. ตรวจสอบผลลัพธ์
    if (response.ok) {
      // คำสั่งถูกส่งไปถึง Lambda และ Lambda ส่ง MQTT ไปแล้ว
      apiStatus.textContent = "Success: IoT Command Published.";
      updateStatusDisplay(state); // อัปเดตสถานะด้วย 'on' หรือ 'off'
    } else {
      // API Gateway/Lambda ตอบกลับเป็น Error
      const errorData = await response.json();
      apiStatus.textContent = "API Error";
      updateStatusDisplay("Failed", true);
      console.error("API Error:", errorData);
      // ใช้วิธีแสดงข้อความผิดพลาดที่ไม่ใช่ alert() ใน production
    }
  } catch (error) {
    // 4. จัดการข้อผิดพลาดเครือข่าย/CORS
    apiStatus.textContent = "Network Error (Check CORS/URL)";
    updateStatusDisplay("Error", true);
    console.error("Network or Fetch Error:", error);
  } finally {
    // 5. เปิดปุ่มกลับมาทำงาน
    onButton.disabled = false;
    offButton.disabled = false;
  }
}

// ----------------------------------------------------
// C. ฟังก์ชันเริ่มต้น (ถูกเรียกโดย onload="initApp()")
// ----------------------------------------------------
function initApp() {
  // 1. เปิดปุ่มทันทีที่ App พร้อม (เพราะไม่มีการรอ Connect MQTT)
  onButton.disabled = false;
  offButton.disabled = false;

  apiStatus.textContent = "Ready.";
  updateStatusDisplay("Ready", false);
}