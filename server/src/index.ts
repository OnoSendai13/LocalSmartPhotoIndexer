import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as net from 'net';
import { exec } from 'child_process';
import { initDb, closeDb } from './db.js';
import * as processor from './processor.js';
import { photosRouter } from './routes/photos.js';
import { foldersRouter } from './routes/folders.js';
import { settingsRouter } from './routes/settings.js';
import { processorRouter } from './routes/processor.js';
import { startAllWatchers, startPeriodicScans, stopAllWatchers } from './watcher.js';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logFile = join(__dirname, '../data/server.log');

function log(...args: unknown[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const ts = new Date().toISOString().slice(11, 23);
  const line = `${ts} ${msg}`;
  console.log(msg);
  try { appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
}

/** Find and kill any process using the given port. */
async function killProcessOnPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    if (isWin) {
      exec(`powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`, (err, stdout) => {
        console.log(`[PORT] Killed processes on port ${port}`);
        resolve();
      });
    } else {
      exec(`lsof -ti:${port}`, (err, stdout) => {
        if (err || !stdout.trim()) return resolve();
        const pid = stdout.trim();
        console.log(`[PORT] Killing process ${pid} on port ${port}`);
        exec(`kill -9 ${pid}`, () => {});
        setTimeout(resolve, 500);
      });
    }
  });
}

const app = new Hono();
const DEFAULT_PORT = parseInt(process.env.PORT || '6800', 10);
const PORT_RANGE_MIN = 6800;
const PORT_RANGE_MAX = 7000;

async function findFreePort(startPort: number): Promise<number> {
  const net = await import('net');
  for (let port = startPort; port <= PORT_RANGE_MAX; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => { server.close(); resolve(false); });
      server.once('listening', () => { server.close(); resolve(true); });
      server.listen(port, '0.0.0.0');
    });
    if (free) return port;
  }
  for (let port = PORT_RANGE_MIN; port < startPort; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => { server.close(); resolve(false); });
      server.once('listening', () => { server.close(); resolve(true); });
      server.listen(port, '0.0.0.0');
    });
    if (free) return port;
  }
  throw new Error(`No free port found in range ${PORT_RANGE_MIN}-${PORT_RANGE_MAX}`);
}

async function ensurePortFree(port: number): Promise<number> {
  const net = await import('net');
  for (let p = port; p <= PORT_RANGE_MAX; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => { server.close(); resolve(false); });
      server.once('listening', () => { server.close(); resolve(true); });
      server.listen(p, '0.0.0.0');
    });
    if (free) return p;
  }
  throw new Error(`No free port in range ${PORT_RANGE_MIN}-${PORT_RANGE_MAX}`);
}

// CORS — origin dynamically includes the actual port used
app.use('/*', cors({
  origin: (origin, ctx) => {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      `http://localhost:${process.env.PORT || 6800}`,
      `http://127.0.0.1:${process.env.PORT || 6800}`,
    ];
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      ctx.header('Access-Control-Allow-Origin', origin || '*');
      return true;
    }
    ctx.header('Access-Control-Allow-Origin', '*');
    return true;
  },
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

// Serve built frontend from parent directory (npm run build output)
const distPath = join(__dirname, '../../dist');
if (existsSync(distPath)) {
  // Serve static files from dist/
  app.use('/*', async (c, next) => {
    const path = c.req.path === '/' ? '/index.html' : c.req.path;
    const filePath = join(distPath, path);
    
    // Try exact file first
    if (existsSync(filePath)) {
      const ext = filePath.split('.').pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        'html': 'text/html',
        'js': 'application/javascript',
        'css': 'text/css',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'woff': 'font/woff',
        'woff2': 'font/woff2',
      };
      const contentType = ext ? (mimeTypes[ext] || 'application/octet-stream') : 'application/octet-stream';
      c.header('Content-Type', contentType);
      c.header('Cache-Control', 'public, max-age=31536000');
      return c.body(readFileSync(filePath));
    }
    
    // Fallback to index.html for SPA routing
    const indexPath = join(distPath, 'index.html');
    if (existsSync(indexPath)) {
      c.header('Content-Type', 'text/html');
      return c.body(readFileSync(indexPath));
    }
    
    await next();
  });
  console.log(`[SERVER] Serving frontend from ${distPath}`);
} else {
  console.warn(`[SERVER] No dist folder found at ${distPath} — frontend not served. Run 'npm run build' first.`);
}

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
  const PORT = await ensurePortFree(DEFAULT_PORT);

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

  // Auto-start processing if there are pending photos
  setTimeout(() => {
    processor.startProcessing().catch(err => {
      console.error('[STARTUP] Failed to auto-start processing:', err);
    });
  }, 2000);

  const server = serve({ fetch: app.fetch, port: PORT });
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`PORT=${PORT}`);
}

let shutdownReason = 'unknown';
function shutdown() {
  console.log(`[SHUTDOWN] Called — reason: ${shutdownReason}`);
  processor.stopProcessing();
  stopAllWatchers();
  closeDb();
  process.exit(0);
}
process.on('SIGINT', () => { shutdownReason = 'SIGINT'; shutdown(); });
process.on('SIGTERM', () => { shutdownReason = 'SIGTERM'; shutdown(); });
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
