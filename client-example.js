// Example browser-side Socket.IO connection.
// Install socket.io-client in your game project: npm install socket.io-client
// For Render, replace SERVER_URL with your deployed https://your-service.onrender.com URL.
// Socket.IO will automatically use a secure WebSocket connection (wss) over HTTPS.

import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3000";
export const socket = io(SERVER_URL, { transports: ["websocket", "polling"] });

socket.on("connect", () => console.log("Connected:", socket.id));
socket.on("server:hello", data => console.log("Server hello:", data));
socket.on("server:error", data => console.error(data.message));
socket.on("room:update", room => console.log("Room snapshot:", room));
socket.on("race:state", state => {
  // Use these server snapshots to update/interpolate remote cars.
  // Do not rebuild every 3D object on each packet; update existing objects.
  console.log("Race state:", state);
});

// Create a room:
// socket.emit("room:create", { name: "Racer", track: "neon-city", laps: 3 }, result => {
//   if (result.ok) console.log("Room code:", result.room.code);
// });

// Join a room:
// socket.emit("room:join", { name: "Racer 2", code: "ABCDE" }, result => {
//   if (!result.ok) console.error(result.error);
// });

// Ready up:
// socket.emit("player:ready", { ready: true, carId: "speedster" });

// Send controls at approximately 20-30 times per second from your game loop:
// socket.emit("player:input", { throttle: 1, steer: 0, brake: false });

// Host starts the race:
// socket.emit("race:start", {}, result => {
//   if (!result.ok) console.error(result.error);
// });
