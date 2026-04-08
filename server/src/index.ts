import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as net from 'net';
import { execSync } from 'child_process';
import { initDb, closeDb } from './db.js';
import { photosRouter } from './routes/photos.js';
import { foldersRouter } from './routes/folders.js';
import { settingsRouter } from './routes/settings.js';
import { startAllWatchers, startPeriodicScans, stopAllWatchers } from './watcher.js';

/** Check if a port is in use, and optionally free it using PowerShell/taskkill.
 *  Windows-only — uses native PowerShell commands. */
async function ensurePortFree(port: number, force = false): Promise<void> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (_err: NodeJS.ErrnoException) => {
      if (_err.code === 'EADDRINUSE') {
        if (force) {
          try {
            // Windows PowerShell: use netstat to find PID, then taskkill
            const out = execSync(
              `netstat -ano | findstr :${port} | findstr LISTENING`,
              { encoding: 'utf8', shell: 'powershell.exe' }
            ).trim();
            // Format: "  TCP  0.0.0.0:6800  0.0.0.0:0  LISTENING  12345"
            const match = out.match(/LISTENING\s+(\d+)/);
            const pid = match ? parseInt(match[1], 10) : undefined;

            if (pid) {
              console.warn(`[PORT] Port ${port} in use by PID ${pid} — killing...`);
              execSync(`taskkill /PID ${pid} /F`, { shell: 'powershell.exe' });
              console.warn(`[PORT] Process killed. Retrying in 1s...`);
              setTimeout(resolve, 1000);
            } else {
              console.warn(`[PORT] Could not find PID for port ${port} — assuming free`);
              resolve();
            }
          } catch (killErr) {
            console.error(`[PORT] Failed to kill process on port ${port}:`, killErr);
            process.exit(1);
          }
        } else {
          console.error(`[PORT] Port ${port} is already in use. Run with FORCE_PORT=true to auto-kill.`);
          process.exit(1);
        }
      } else {
        resolve(); // different error, port is probably fine
      }
    });
    server.once('listening', () => {
      server.close();
      resolve();
    });
    server.listen(port);
  });
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

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// Debug: read DB state from disk (independent of in-memory state)
app.get('/api/debug/db', async (c) => {
  try {
    const { existsSync, readFileSync, statSync } = await import('fs');
    const { join } = await import('path');
    const dbFile = join(process.cwd(), 'data', 'photo-index.db');
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
  // Don't exit — try to keep running
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

async function start() {
  // Ensure port is free (auto-kill previous process if FORCE_PORT=true)
  const force = process.env.FORCE_PORT === 'true';
  await ensurePortFree(PORT, force);

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
