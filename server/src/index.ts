import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as net from 'net';
import { initDb, closeDb } from './db.js';
import * as processor from './processor.js';
import { photosRouter } from './routes/photos.js';
import { foldersRouter } from './routes/folders.js';
import { settingsRouter } from './routes/settings.js';
import { processorRouter } from './routes/processor.js';
import { startAllWatchers, startPeriodicScans, stopAllWatchers } from './watcher.js';

/** Check if port is free, wait if needed (max 10s). */
async function ensurePortFree(port: number): Promise<void> {
  const maxWait = 10000;
  const start = Date.now();
  
  while (Date.now() - start < maxWait) {
    const server = net.createServer();
    const free = await new Promise<boolean>((resolve) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        resolve(err.code !== 'EADDRINUSE');
      });
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
    if (free) return;
    console.warn(`[PORT] Port ${port} in use, waiting...`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.error(`[PORT] Port ${port} still in use after ${maxWait}ms. Kill the process manually or change PORT in .env`);
  process.exit(1);
}

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
app.route('/api', processorRouter);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// Debug: read DB state from disk (independent of in-memory state)
app.get('/api/debug/db', async (c) => {
  try {
    const { existsSync, readFileSync, statSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const dbFile = join(__dirname, '../data', 'photo-index.db');
    if (!existsSync(dbFile)) {
      return c.json({ exists: false, message: 'DB file does not exist on disk' });
    }
    const stat = statSync(dbFile);
    // Also count from in-memory DB
    const { getDb } = await import('./db.js');
    const db = getDb();
    const photosInMemory = (db.prepare('SELECT COUNT(*) as cnt FROM photos').get() as { cnt: number }).cnt;
    const foldersInMemory = (db.prepare('SELECT COUNT(*) as cnt FROM folders').get() as { cnt: number }).cnt;
    return c.json({
      exists: true,
      fileSizeBytes: stat.size,
      fileModifiedAt: new Date(stat.mtimeMs).toISOString(),
      inMemory: { photos: photosInMemory, folders: foldersInMemory },
      cwd: process.cwd(),
      dbPath: dbFile,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

const PORT = parseInt(process.env.PORT || '6800', 10);

// ─── Server start ─────────────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  console.warn('[RECOVERY] Attempting graceful recovery...');
  try {
    processor.stopProcessing();
    stopAllWatchers();
  } catch (e) {
    console.error('[RECOVERY] Failed to stop services:', e);
  }
  console.warn('[RECOVERY] Process will exit to allow supervisor to restart');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

async function start() {
  await ensurePortFree(PORT);

  // Init SQLite (async — must load WASM first)
  await initDb();

  // BUG FIX #4: Reset any photos stuck in 'processing' state from a previous interrupted run
  try {
    const db = (await import('./db.js')).getDb();
    const result = db.prepare(
      "UPDATE photos SET status = 'pending', updated_at = unixepoch('now') WHERE status = 'processing'"
    ).run();
    if (result.changes > 0) {
      console.log(`[STARTUP] Reset ${result.changes} interrupted 'processing' photos back to 'pending'`);
    }
  } catch (err) {
    console.warn('[STARTUP] Could not reset processing photos:', err);
  }

  // Start file watchers for already-registered folders
  try {
    startAllWatchers();
    startPeriodicScans();
  } catch (err) {
    console.warn('[WATCHER] Could not start watchers:', err);
  }

  // Enable auto-restart for processor so indexing resumes after crashes
  processor.enableAutoRestart();

  const server = serve({ fetch: app.fetch, port: PORT });
  console.log(`Server running on http://localhost:${PORT}`);
}

function shutdown() {
  processor.stopProcessing();
  stopAllWatchers();
  closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
