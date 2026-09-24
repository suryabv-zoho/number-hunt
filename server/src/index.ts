import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import { attachIo, boardClick, callNumber, narrateBot, submitPuzzle } from './game.js';
import { attachBotActions } from './bots.js';
import { registerHandlers, startJanitor } from './handlers.js';
import { rooms } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// `--port N` wins over $PORT: in dev the launcher exports PORT for the Vite server,
// and we must not fight it for the same socket. In production Render (and most hosts)
// hand us the port through $PORT.
const portArg = process.argv.indexOf('--port');
const PORT = Number(
  (portArg !== -1 ? process.argv[portArg + 1] : undefined) ?? process.env.PORT ?? 3001,
);
// Hosts route traffic to the container's external interface, so listening only on
// loopback would look like a service that never came up.
const HOST = process.env.HOST ?? '0.0.0.0';

const app = express();
const http = createServer(app);
const io = new Server(http, {
  // The client is served from this same origin, so nothing cross-origin is needed by
  // default. Set ALLOWED_ORIGIN (comma separated) if you ever host the client elsewhere.
  cors: {
    origin: process.env.ALLOWED_ORIGIN
      ? process.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim())
      : true,
    credentials: true,
  },
  // Players on flaky wifi get a moment to come back before we treat them as gone.
  pingTimeout: 20_000,
});

attachIo(io);
// Bots reach the game through the same entry points a socket does. Injecting them here
// rather than importing `game.js` from `bots.js` keeps the two files acyclic.
attachBotActions({ callNumber, boardClick, submitPuzzle, narrate: narrateBot });
registerHandlers(io);
startJanitor();

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() });
});

// In production the built client is served from the same origin as the socket.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

http.listen(PORT, HOST, () => {
  const where = HOST === '0.0.0.0' ? `port ${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Number Hunt server listening on ${where}`);
  if (!fs.existsSync(clientDist)) {
    console.log('No client build found — run `npm run build` to serve the game itself.');
  }
});

// A crash inside a socket handler shouldn't take the whole room down with it.
process.on('unhandledRejection', (err) => console.error('unhandled rejection', err));
