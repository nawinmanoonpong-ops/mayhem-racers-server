const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || "*")
  .split(",").map(s => s.trim()).filter(Boolean);
const MAX_PLAYERS = Math.min(8, Math.max(2, Number(process.env.MAX_PLAYERS) || 8));
const TICK_RATE = 20;
const DT = 1 / TICK_RATE;
const MAX_INPUT_AGE_MS = 1000;

const app = express();
app.use(cors({ origin: CLIENT_ORIGINS.includes("*") ? "*" : CLIENT_ORIGINS }));
app.use(express.json({ limit: "20kb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGINS.includes("*") ? "*" : CLIENT_ORIGINS, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

const rooms = new Map();
const socketToRoom = new Map();

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "Mayhem Racers Server",
    status: "ok",
    rooms: rooms.size,
    tickRate: TICK_RATE,
    message: "Socket.IO endpoint is ready."
  });
});

app.get("/health", (_req, res) => res.status(200).json({ ok: true, uptime: process.uptime() }));

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  if (typeof value !== "string") return "Racer";
  const name = value.trim().replace(/[<>]/g, "").slice(0, 18);
  return name || "Racer";
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    track: room.track,
    laps: room.laps,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, carId: p.carId, ready: p.ready,
      x: p.x, z: p.z, heading: p.heading, speed: p.speed,
      durability: p.durability, finished: p.finished, place: p.place,
      respawnUntil: p.respawnUntil, immuneUntil: p.immuneUntil
    }))
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function sendError(socket, message) {
  socket.emit("server:error", { message });
}

function leaveCurrentRoom(socket) {
  const code = socketToRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  socketToRoom.delete(socket.id);
  socket.leave(code);
  if (!room) return;

  room.players.delete(socket.id);
  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
    io.to(code).emit("host:changed", { hostId: room.hostId });
  }
  if (room.status === "racing" && room.players.size < 2) {
    room.status = "lobby";
    room.startedAt = null;
    for (const p of room.players.values()) p.ready = false;
    io.to(code).emit("race:stopped", { reason: "Not enough players remain." });
  }
  emitRoom(room);
}

function newPlayer(id, name) {
  return {
    id, name, carId: "all-rounder", ready: false,
    x: 0, z: 0, heading: 0, speed: 0, durability: 100,
    throttle: 0, steer: 0, brake: false, lastInputAt: Date.now(),
    finished: false, place: null, distance: 0,
    respawnUntil: 0, immuneUntil: 0, nextRespawnAt: 0
  };
}

io.on("connection", socket => {
  socket.emit("server:hello", { id: socket.id, tickRate: TICK_RATE, maxPlayers: MAX_PLAYERS });

  socket.on("room:create", (payload = {}, ack = () => {}) => {
    leaveCurrentRoom(socket);
    const code = makeCode();
    const room = {
      code, hostId: socket.id, status: "lobby",
      track: typeof payload.track === "string" ? payload.track.slice(0, 40) : "neon-city",
      laps: Number.isInteger(payload.laps) ? Math.min(9, Math.max(1, payload.laps)) : 3,
      players: new Map(), startedAt: null, finishCount: 0, lastTick: Date.now()
    };
    room.players.set(socket.id, newPlayer(socket.id, cleanName(payload.name)));
    rooms.set(code, room);
    socketToRoom.set(socket.id, code);
    socket.join(code);
    ack({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:join", (payload = {}, ack = () => {}) => {
    const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: "Room not found." });
    if (room.status !== "lobby") return ack({ ok: false, error: "That race has already started." });
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, error: "Room is full." });
    leaveCurrentRoom(socket);
    room.players.set(socket.id, newPlayer(socket.id, cleanName(payload.name)));
    socketToRoom.set(socket.id, code);
    socket.join(code);
    ack({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("player:ready", (payload = {}) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    const player = room?.players.get(socket.id);
    if (!room || !player || room.status !== "lobby") return;
    player.ready = Boolean(payload.ready);
    if (typeof payload.carId === "string") {
      player.carId = payload.carId.replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "all-rounder";
    }
    emitRoom(room);
  });

  socket.on("room:settings", (payload = {}) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.hostId !== socket.id || room.status !== "lobby") return;
    if (typeof payload.track === "string") room.track = payload.track.slice(0, 40);
    if (Number.isInteger(payload.laps)) room.laps = Math.min(9, Math.max(1, payload.laps));
    emitRoom(room);
  });

  socket.on("race:start", (_payload, ack = () => {}) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room) return ack({ ok: false, error: "Join a room first." });
    if (room.hostId !== socket.id) return ack({ ok: false, error: "Only the host can start the race." });
    if (room.status !== "lobby") return ack({ ok: false, error: "Race is not in the lobby." });
    if (room.players.size < 2) return ack({ ok: false, error: "At least two players are required." });

    room.status = "racing";
    room.startedAt = Date.now();
    room.finishCount = 0;
    let index = 0;
    for (const p of room.players.values()) {
      p.x = (index - (room.players.size - 1) / 2) * 3;
      p.z = 0; p.heading = 0; p.speed = 0; p.durability = 100;
      p.distance = 0; p.finished = false; p.place = null;
      p.respawnUntil = 0; p.immuneUntil = 0; p.nextRespawnAt = 0;
      p.throttle = 0; p.steer = 0; p.brake = false;
      index++;
    }
    ack({ ok: true });
    io.to(room.code).emit("race:started", { startedAt: room.startedAt, track: room.track, laps: room.laps });
    emitRoom(room);
  });

  // Clients send controls only. The server calculates this starter's simple movement state.
  // Replace this lightweight model with your shared Rapier/vehicle simulation for full game physics.
  socket.on("player:input", (input = {}) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    const p = room?.players.get(socket.id);
    if (!room || room.status !== "racing" || !p || p.finished || Date.now() < p.respawnUntil) return;
    p.throttle = clamp(Number(input.throttle) || 0, -1, 1);
    p.steer = clamp(Number(input.steer) || 0, -1, 1);
    p.brake = Boolean(input.brake);
    p.lastInputAt = Date.now();
  });

  socket.on("player:respawn", () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    const p = room?.players.get(socket.id);
    if (!room || room.status !== "racing" || !p || Date.now() < p.nextRespawnAt) return;
    beginRespawn(p);
  });

  socket.on("race:finish", () => {
    // A real production game must validate finish line/checkpoints on the server.
    const room = rooms.get(socketToRoom.get(socket.id));
    const p = room?.players.get(socket.id);
    if (!room || room.status !== "racing" || !p || p.finished) return;
    p.finished = true;
    p.speed = 0;
    p.place = ++room.finishCount;
    io.to(room.code).emit("race:playerFinished", { playerId: p.id, place: p.place });
    if ([...room.players.values()].every(player => player.finished)) {
      room.status = "results";
      io.to(room.code).emit("race:results", {
        results: [...room.players.values()].sort((a, b) => a.place - b.place)
          .map(p => ({ id: p.id, name: p.name, place: p.place }))
      });
    }
    emitRoom(room);
  });

  socket.on("race:returnToLobby", () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.hostId !== socket.id || !["results", "racing"].includes(room.status)) return;
    room.status = "lobby";
    room.startedAt = null;
    for (const p of room.players.values()) {
      p.ready = false; p.finished = false; p.place = null; p.speed = 0;
      p.durability = 100; p.distance = 0;
    }
    io.to(room.code).emit("race:stopped", { reason: "Host returned the room to the lobby." });
    emitRoom(room);
  });

  socket.on("disconnect", () => leaveCurrentRoom(socket));
});

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function beginRespawn(p) {
  const now = Date.now();
  p.speed = 0;
  p.throttle = 0; p.steer = 0; p.brake = false;
  p.durability = 100;
  p.respawnUntil = now + 2000;
  p.immuneUntil = now + 4000; // 2s respawn delay, then 2s immunity
  p.nextRespawnAt = now + 5000;
  p.x = 0; p.z = Math.max(0, p.distance - 10); p.heading = 0;
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== "racing") continue;
    for (const p of room.players.values()) {
      if (p.finished) continue;
      if (now < p.respawnUntil) {
        p.speed = 0;
        continue;
      }
      if (now - p.lastInputAt > MAX_INPUT_AGE_MS) {
        p.throttle = 0; p.steer = 0; p.brake = true;
      }
      const accel = p.brake ? -16 : p.throttle * 22;
      p.speed = clamp(p.speed + accel * DT, 0, 55);
      p.speed *= p.brake ? 0.96 : 0.995;
      p.heading += p.steer * (0.7 + p.speed / 55) * DT;
      p.x += Math.sin(p.heading) * p.speed * DT;
      p.z += Math.cos(p.heading) * p.speed * DT;
      p.distance += p.speed * DT;
    }
    // Broadcast a compact authoritative snapshot at the server tick rate.
    io.to(room.code).volatile.emit("race:state", {
      serverTime: now,
      players: [...room.players.values()].map(p => ({
        id: p.id, x: p.x, z: p.z, heading: p.heading, speed: p.speed,
        durability: p.durability, finished: p.finished, place: p.place,
        respawnUntil: p.respawnUntil, immuneUntil: p.immuneUntil, distance: p.distance
      }))
    });
  }
}, 1000 / TICK_RATE);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mayhem Racers server listening on port ${PORT}`);
});
