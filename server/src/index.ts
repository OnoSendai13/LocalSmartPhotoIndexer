import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, closeDb } from './db.js';
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

// Init DB + watchers
getDb();
startAllWatchers();
startPeriodicScans();

const PORT = parseInt(process.env.PORT || '3001', 10);
const server = serve({ fetch: app.fetch, port });

console.log(`🚀 Server running on http://localhost:${PORT}`);

function shutdown() {
  stopAllWatchers();
  closeDb();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
