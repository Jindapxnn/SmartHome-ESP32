// =======================================================
// app.js (Hybrid Logic: POST Command, GET Status Polling)
// =======================================================

const API_COMMAND_URL_BASE =
  "https://pezrt9n512.execute-api.us-west-2.amazonaws.com/dev";

const WS_ENDPOINT = "wss://015wuxu9hh.execute-api.us-west-2.amazonaws.com/dev";

const apiStatus = document.getElementById("api-status");
const ROOMS = ["bedroom", "livingroom"];

const roomLedStates = {};
const roomSensorReadings = {};

function updateRoomUI(room, stateData, sensorData, { updateLed = true } = {}) {
  const tempElement = document.getElementById(`temp-dial-value-${room}`);
  const humidElement = document.getElementById(`humidity-value-${room}`);
  const motionElement = document.getElementById(`motion-status-${room}`);
  const ledTextElement = document.getElementById(`led-status-text-${room}`);
  const ledToggle = document.getElementById(`ledToggle-${room}`);
  const tempDisplay = document.getElementById(`temp-display-${room}`);

  // Update LED UI
  if (updateLed) {
    const ledState =
      stateData?.LedStatus?.toLowerCase() ||
      roomLedStates[room]?.LedStatus?.toLowerCase() ||
      "off";

    if (ledTextElement) ledTextElement.textContent = ledState.toUpperCase();
    if (ledToggle) ledToggle.checked = ledState === "on";
  }

  // Update sensor UI
  const currentSensorData = sensorData || roomSensorReadings[room] || {};
  const temp =
    currentSensorData.Temperature !== undefined
      ? parseFloat(currentSensorData.Temperature)
      : "--";
  const humid =
    currentSensorData.Humidity !== undefined
      ? parseFloat(currentSensorData.Humidity)
      : "--";
  const motion = currentSensorData.Motion || "No Motion";

  if (temp !== "--") {
    if (tempElement) tempElement.textContent = temp.toFixed(1);
    if (tempDisplay) tempDisplay.textContent = `${temp.toFixed(1)}°C`;

    const progressCircle = document.getElementById(
      `temp-dial-progress-${room}`
    );
    if (progressCircle) {
      const maxTemp = 40;
      const minTemp = 15;
      const normalizedTemp = Math.min(Math.max(temp, minTemp), maxTemp);
      const percentage = (normalizedTemp - minTemp) / (maxTemp - minTemp);
      const circumference = 2 * Math.PI * 40;
      const dashoffset = circumference * (1 - percentage);
      progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
      progressCircle.style.strokeDashoffset = dashoffset;
    }

    const tsEl = document.getElementById(`temp-last-update-${room}`);
    const motionTimeEl = document.getElementById(`last-motion-${room}`);
    if (tsEl) tsEl.textContent = new Date().toLocaleTimeString();
    if (motionTimeEl)
      motionTimeEl.textContent = new Date().toLocaleTimeString();
  } else {
    if (tempElement) tempElement.textContent = "--";
    if (tempDisplay) tempDisplay.textContent = "--°C";
  }

  if (humidElement)
    humidElement.textContent = `${humid !== "--" ? humid.toFixed(0) : "--"}%`;
  if (motionElement) motionElement.textContent = motion;
}

async function sendCommand(room) {
  const ledToggle = document.getElementById(`ledToggle-${room}`);
  const state = ledToggle && ledToggle.checked ? "on" : "off";

  const targetURL = `${API_COMMAND_URL_BASE}/${room}/led`;

  if (apiStatus)
    apiStatus.textContent = `Sending ${room} command (${state.toUpperCase()})...`;
  const payload = { room: room, cmd: state };

  try {
    const response = await fetch(targetURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      roomLedStates[room] = { LedStatus: state };
      updateRoomUI(room, roomLedStates[room], null, { updateLed: true });

      if (apiStatus)
        apiStatus.textContent = `Success: Command sent to ${room}. Awaiting device confirmation...`;
    } else {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (_) {}

      if (apiStatus)
        apiStatus.textContent = `API Error for ${room}: ${
          errorData.message || `HTTP ${response.status}`
        }`;

      if (ledToggle) ledToggle.checked = !ledToggle.checked;
      console.error("API Error:", errorData);
    }
  } catch (error) {
    if (apiStatus)
      apiStatus.textContent = error?.message?.includes("Failed to fetch")
        ? "Network/CORS Error: Check API URL & CORS on API Gateway"
        : "Network Error";
    console.error("Network Error:", error);

    if (ledToggle) ledToggle.checked = !ledToggle.checked;
  }
}

function connectWebSocket() {
  let websocket = new WebSocket(WS_ENDPOINT);

  websocket.onopen = () => {
    if (apiStatus)
      apiStatus.textContent = "WebSocket Connected! Initializing state...";
    fetchInitialState();
  };

  websocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // ------------------------------
      // REALTIME or SNAPSHOT SENSOR DATA
      // ------------------------------
      if (
        (data.Type === "REALTIME" || data.Type === "SNAPSHOT") &&
        Array.isArray(data.data)
      ) {
        data.data.forEach((sensorItem) => {
          const room = sensorItem.RoomId?.toLowerCase();
          if (!room || !ROOMS.includes(room)) return;

          const sensorData = {
            Temperature: sensorItem.Temperature,
            Humidity: sensorItem.Humidity,
            Motion: sensorItem.Motion,
          };

          roomSensorReadings[room] = sensorData;
          updateRoomUI(room, null, sensorData, { updateLed: false });

          if (apiStatus)
            apiStatus.textContent = `Sensor update for ${room.toUpperCase()} @ ${new Date().toLocaleTimeString()}`;
        });
        return;
      }

      // ------------------------------
      // DEVICE STATE UPDATE
      // ------------------------------
      if (data.Type === "DEVICE_STATE_UPDATE" && data.RoomId && data.State) {
        const room = data.RoomId.toLowerCase();
        if (!ROOMS.includes(room)) return;

        const ledStatus =
          data.State.ledStatus || data.State.LedStatus || data.State.status;
        if (ledStatus) {
          roomLedStates[room] = { LedStatus: String(ledStatus) };
          updateRoomUI(room, roomLedStates[room], null, { updateLed: true });
        }
        return;
      }

      // ------------------------------
      // MOTION ALERT
      // ------------------------------
      if (data.Type === "MOTION_ALERT") {
        const room = (data.detail?.RoomId ?? "").toLowerCase();
        const motionRaw = data.detail?.Motion ?? "No Motion";
        const ts = data.detail?.TimeStamp
          ? new Date(data.detail.TimeStamp)
          : new Date();

        if (!room || !ROOMS.includes(room)) return;

        // Update internal state
        roomSensorReadings[room] = {
          ...(roomSensorReadings[room] || {}),
          Motion: motionRaw,
        };

        // Update motion UI
        const motionElement = document.getElementById(`motion-status-${room}`);
        const motionTimeEl = document.getElementById(`last-motion-${room}`);
        if (motionElement) motionElement.textContent = motionRaw;
        if (motionTimeEl) motionTimeEl.textContent = ts.toLocaleTimeString();

        if (apiStatus)
          apiStatus.textContent = `${room.toUpperCase()} - ${motionRaw.toUpperCase()} @ ${ts.toLocaleTimeString()}`;
      }
    } catch (e) {
      console.error("Error processing WebSocket message:", e, event.data);
    }
  };

  websocket.onerror = (error) => {
    if (apiStatus) apiStatus.textContent = "WebSocket Error. Retrying in 5s...";
    console.error("WebSocket Error:", error);
    setTimeout(connectWebSocket, 5000);
  };

  websocket.onclose = () => {
    if (apiStatus)
      apiStatus.textContent = "WebSocket Disconnected. Retrying...";
    setTimeout(connectWebSocket, 5000);
  };
}

async function fetchInitialState() {
  try {
    const fetchPromises = ROOMS.map((room) => {
      const DataURL = `${API_COMMAND_URL_BASE}/data/?room=${room}`;
      return fetch(DataURL, { method: "GET" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
          return res.json();
        })
        .then((data) => ({ room, data }))
        .catch((error) => ({
          room,
          error: error.message || "Failed to fetch state",
        }));
    });

    const results = await Promise.all(fetchPromises);

    results.forEach((res) => {
      if (res.data) {
        const stateData = res.data.deviceState;
        const sensorData = res.data.sensorReadings;

        if (stateData && stateData.LedStatus) {
          roomLedStates[res.room] = stateData;
        }

        if (sensorData) {
          roomSensorReadings[res.room] = {
            Temperature: sensorData.Temperature,
            Humidity: sensorData.Humidity,
            Motion: sensorData.Motion,
          };
        }

        updateRoomUI(
          res.room,
          roomLedStates[res.room],
          roomSensorReadings[res.room],
          { updateLed: !!roomLedStates[res.room] }
        );
      } else if (res.error) {
        console.warn(`Polling warning for ${res.room}: ${res.error}`);
      }
    });

    if (apiStatus)
      apiStatus.textContent = `Status updated @ ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    if (apiStatus)
      apiStatus.textContent = "Polling Failed (Database/API Read Error)";
    console.error("Polling Error:", error);
  }
}

function updateClock() {
  const now = new Date();
  const timeElement = document.getElementById("current-time");
  const dateElement = document.getElementById("current-date");

  if (timeElement && dateElement) {
    timeElement.textContent = now.toLocaleTimeString("th-TH", {
      hour12: false,
    });
    dateElement.textContent = now.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
}

function initApp() {
  ROOMS.forEach((room) => {
    const ledToggle = document.getElementById(`ledToggle-${room}`);
    if (ledToggle) ledToggle.disabled = false;
  });

  if (apiStatus)
    apiStatus.textContent = "App Initialized. Connecting WebSocket...";
  connectWebSocket();
}

setInterval(updateClock, 1000);
updateClock();

window.sendCommand = sendCommand;
window.toggleLED = function (room) {
  sendCommand(room);
};
window.onload = initApp;
