import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { initDb, closeDb } from './db.js';
import { photosRouter } from './routes/photos.js';
import { foldersRouter } from './routes/folders.js';
import { settingsRouter } from './routes/settings.js';
import { startAllWatchers, startPeriodicScans, stopAllWatchers } from './watcher.js';

const app = new Hono();

// CORS
app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  maxAge: 86400,
}));

// API routes
app.route('/api', photosRouter);
app.route('/api', foldersRouter);
app.route('/api', settingsRouter);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

const PORT = parseInt(process.env.PORT || '3001', 10);

async function start() {
  // Init SQLite (async — must load WASM first)
  await initDb();

  // Start file watchers for already-registered folders
  startAllWatchers();
  startPeriodicScans();

  const server = serve({ fetch: app.fetch, port: PORT });
  console.log(`Server running on http://localhost:${PORT}`);
}

function shutdown() {
  stopAllWatchers();
  closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
