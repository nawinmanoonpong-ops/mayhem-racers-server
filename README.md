# Mayhem Racers Server

A small Node.js + Express + Socket.IO multiplayer backend starter.

## What this starter includes

- Health endpoint at `/health`
- Create/join rooms with 5-character room codes
- Host ownership and host migration
- Lobby settings, ready status, and car selection IDs
- A 20 Hz server snapshot for racing state
- Basic server-calculated movement from player inputs
- Finish/result events and a starter respawn timer
- Socket.IO CORS configuration for browser clients

## Important limitations

This is a backend foundation, not the finished Mayhem Racers game server. The movement simulation is deliberately simple and is **not** a substitute for your game's 3D vehicle physics, track collision system, checkpoints, weapon simulation, durability damage, or production anti-cheat.

The `race:finish` event is a starter placeholder and currently trusts a client event. Before public competitive play, implement server-side track geometry/checkpoint validation and server-authoritative weapon hits, damage, coins, chest rolls, and rewards. The starter respawn endpoint demonstrates timing only; integrate destruction events and your real track recovery points.

Rooms and progression live in server memory. Rooms disappear when empty and all data resets when the service restarts. Add a database (for example PostgreSQL) for persistent accounts/progression before launch.

## Run locally

Install Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000/health`. Expected response resembles:

```json
{"ok":true,"uptime":1.2}
```

The server listens on `PORT` if provided by the host, otherwise port 3000.

## GitHub upload

1. Create a new GitHub repository, for example `mayhem-racers-server`.
2. Upload `server.js`, `package.json`, `README.md`, `.gitignore`, and optionally `client-example.js` to the repository root.
3. Ensure `package.json` is at the repository root (not buried in an extra folder).
4. Commit the files to the default branch.

Alternatively, from this folder in a terminal:

```bash
git init
git add .
git commit -m "Initial Mayhem Racers server"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/mayhem-racers-server.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username. If Git asks you to sign in, use GitHub's normal authentication flow or Git Credential Manager; do not put passwords or tokens in source files.

## Deploy to Render

1. Sign in to Render.
2. Choose **New +** → **Web Service**.
3. Connect your GitHub account if asked, then select the `mayhem-racers-server` repository.
4. Set:
   - Runtime/language: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: choose an available plan suitable for testing
5. Click **Create Web Service**.
6. Wait for the deploy to finish. Render will provide a URL such as `https://your-service-name.onrender.com`.
7. Open `https://YOUR-SERVICE.onrender.com/health`. Confirm you get JSON with `"ok": true`.

Do not set a fixed `PORT`; Render supplies it automatically.

### Environment variables

In Render → your service → **Environment**, optionally add:

- `MAX_PLAYERS` = `8`
- `CLIENT_ORIGINS` = `*` for initial testing only

For better security, set `CLIENT_ORIGINS` to the exact origin of your deployed frontend, e.g. `https://your-game.pages.dev` or `https://your-game.onrender.com`. For local testing with a deployed frontend, include each allowed origin separated by commas. CORS is not an authentication or anti-cheat system.

After changing environment variables, redeploy if Render requests it.

## Connect your game client

Install Socket.IO client in the frontend project:

```bash
npm install socket.io-client
```

Copy the pattern from `client-example.js` into your game. Set the URL to:
- Local: `http://localhost:3000`
- Deployed: your Render HTTPS service URL

Example create-room call:

```js
socket.emit("room:create", { name: "Player", track: "neon-city", laps: 3 }, result => {
  if (!result.ok) return console.error(result.error);
  console.log("Room code:", result.room.code);
});
```

Example join-room call:

```js
socket.emit("room:join", { name: "Player 2", code: "ABCDE" }, result => {
  if (!result.ok) return console.error(result.error);
  console.log("Joined room:", result.room.code);
});
```

Example input call (call from your game loop, not on every React render):

```js
socket.emit("player:input", { throttle: 1, steer: 0, brake: false });
```

Listen to `room:update` for lobby information and `race:state` for server snapshots. For smooth remote cars, interpolate between snapshots rather than snapping models to every received position.

## Troubleshooting

- **Build fails:** check Render logs and ensure `package.json` is at the repository root.
- **Service starts but crashes:** check logs for syntax errors and confirm Node 20+.
- **Health URL does not work:** verify the service URL and that deployment succeeded.
- **Frontend cannot connect:** confirm the correct Render URL, Socket.IO client is installed, and `CLIENT_ORIGINS` includes your frontend origin.
- **Works locally but not online:** check browser console and Render logs; use `https://` for the deployed frontend and Render URL.
- **Free service wakes slowly:** some Render free services may spin down after inactivity; the first connection can take time.

## Before public release

Implement and test server-side:
- Actual vehicle and track physics shared with the game
- Checkpoint/lap/finish validation
- Collision and damage resolution, including the exact respawn/immunity rules
- Weapon ownership, range, cooldowns, hit validation, and damage
- Server-side chest RNG and economy transactions
- Persistent player accounts and progression
- Rate limits, input validation, reconnects, and abuse protection
- Room cleanup and server resource limits
