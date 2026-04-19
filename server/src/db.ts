/**
 * SQLite via sql.js (WebAssembly, zero native compilation).
 * Provides a better-sqlite3-compatible API:
 *   getDb().prepare(sql).all(params)
 *   getDb().prepare(sql).get(params)
 *   getDb().prepare(sql).run(params)
 *   getDb().transaction(fn)(items)
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// sql.js WASM — from server/src/, go up two levels to project root, then into server/node_modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, '../../server/node_modules/sql.js/dist/sql-wasm.wasm');

const dataDir = path.join(__dirname, '../data');
const dbPath = path.join(dataDir, 'photo-index.db');
const backupPath = dbPath + '.bak';

let _db: import('sql.js').Database | null = null;

// Captured during initDb so we can create a fresh DB in nukeDb() without `require()`.
let _SQLCtor: ReturnType<typeof import('sql.js').default> | null = null;

/**
 * When true, save() is a no-op.  Set during nukeDb() so that any in-flight
 * watcher callback that calls save() after the clear does NOT overwrite the
 * freshly-emptied on-disk file with stale data.
 */
let _frozen = false;
let _saveTimeout = null;

function save(): void {
  if (_frozen) return;
  if (_db) {
    try {
      // ✅ Sauvegarde incrémentale via les fichiers WAL (beaucoup plus rapide que export())
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';
      
      if (existsSync(walPath)) {
        try { copyFileSync(walPath, walPath + '.backup'); } catch(e) {}
      }
      if (existsSync(shmPath)) {
        try { copyFileSync(shmPath, shmPath + '.backup'); } catch(e) {}
      }
      
      // Forcer un checkpoint pour libérer le WAL
      _db.run('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (err) {
      console.error('[DB] Failed incremental save:', err);
    }
  }
  // Debounce: esperar 100ms avant de sauver pour batchifier
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    if (_db && !_frozen) {
      try {
        const walPath = dbPath + '-wal';
        const shmPath = dbPath + '-shm';
        if (existsSync(walPath)) copyFileSync(walPath, walPath + '.backup');
        if (existsSync(shmPath)) copyFileSync(shmPath, shmPath + '.backup');
        _db.run('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (err) {
        console.error('[DB] Failed debounced save:', err);
      }
    }
    _saveTimeout = null;
  }, 100);
}

/** Force an immediate flush of the in-memory DB to disk. Call after bulk operations. */
export function saveDb(): void {
  save();
}

/**
 * Directly execute one or more SQL statements on the raw sql.js DB and flush to disk.
 * Use ONLY for admin operations (e.g. clearing all data) where the normal wrapper
 * would add overhead or risk partial saves.
 */
export function execAndSave(sql: string): void {
  if (!_db) throw new Error('Database not initialized');
  _db.run(sql);
  save();
}

/**
 * Nuclear clear: the ONLY reliable way to empty a sql.js database.
 *
 * Strategy: delete the .db file from disk, close the old in-memory DB,
 * create a brand-new empty SQL.Database(), re-apply the schema, and save
 * the fresh empty file.  After this call the server keeps running normally
 * with a completely clean in-memory + on-disk state.
 *
 * Why not just DELETE FROM photos / DELETE FROM folders?
 * Because sql.js is async-I/O and any in-flight Stmt.run() that fires
 * between our DELETE and our writeFileSync can call save() and overwrite
 * the file with stale data.  Replacing _db entirely prevents that race.
 */
export function nukeDb(): void {
  if (!_db) throw new Error('Database not initialized');

  const t = new Date().toISOString();
  console.log(`[NUKE ${t}] Starting — full in-memory DB replacement`);

  // Step 0: create backup BEFORE nuking
  try {
    if (existsSync(dbPath)) {
      if (existsSync(backupPath)) unlinkSync(backupPath);
      const { copyFileSync } = require('fs');
      copyFileSync(dbPath, backupPath);
      const bakSize = statSync(backupPath).size;
      console.log(`[NUKE] 💾 Backup created: ${backupPath} (${bakSize} bytes)`);
    }
  } catch (e) {
    console.warn('[NUKE] ⚠️ Failed to create backup:', e);
  }

  // Step 1: freeze save() + stash reference to old DB immediately
  _frozen = true;
  const oldDb = _db;

  try {
    // Step 2: DELETE in old DB (captures any in-flight inserts)
    oldDb.run('DELETE FROM photos');
    oldDb.run('DELETE FROM folders');

    // Step 3: create a brand-new empty DB and apply schema
    const freshDb = new _SQLCtor!.Database();
    _initSchema(freshDb);

    // Step 4: replace _db BEFORE unfreezing so subsequent callbacks
    // operate on a clean DB, not the old nuke target
    _db = freshDb;

    // Step 5: write the fresh empty DB to disk
    if (existsSync(dbPath)) unlinkSync(dbPath);
    const data = freshDb.export();
    writeFileSync(dbPath, Buffer.from(data));
    const sizeAfter = statSync(dbPath).size;
    console.log(`[NUKE] ✅ Disk file rewritten (${sizeAfter} bytes). DB is empty and new.`);
  } catch (e) {
    console.error('[NUKE] ❌ Failed:', e);
    throw e;
  } finally {
    _frozen = false;
  }
}

/**
 * Restore database from backup file.
 * Replaces the current in-memory DB with the data from .bak file.
 */
export function restoreDb(): { success: boolean; photosRestored: number; foldersRestored: number; error?: string } {
  try {
    if (!existsSync(backupPath)) {
      return { success: false, photosRestored: 0, foldersRestored: 0, error: 'No backup file found' };
    }

    const backupBuffer = readFileSync(backupPath);
    const restoredDb = new _SQLCtor!.Database(backupBuffer);

    const photosCount = (restoredDb.exec('SELECT COUNT(*) FROM photos')[0]?.values[0]?.[0] as number) ?? 0;
    const foldersCount = (restoredDb.exec('SELECT COUNT(*) FROM folders')[0]?.values[0]?.[0] as number) ?? 0;

    _frozen = true;
    const oldDb = _db;
    oldDb.close();

    _db = restoredDb;
    _wrapper = new Database();

    const data = restoredDb.export();
    writeFileSync(dbPath, Buffer.from(data));

    _frozen = false;
    console.log(`[RESTORE] ✅ Restored ${photosCount} photos and ${foldersCount} folders from backup`);

    return { success: true, photosRestored: photosCount, foldersRestored: foldersCount };
  } catch (e) {
    _frozen = false;
    const err = e instanceof Error ? e.message : String(e);
    console.error('[RESTORE] ❌ Failed:', err);
    return { success: false, photosRestored: 0, foldersRestored: 0, error: err };
  }
}

/**
 * Get information about the current backup file.
 */
export function getBackupInfo(): { exists: boolean; sizeBytes: number; sizeMB: string; createdAt: string | null } {
  try {
    if (!existsSync(backupPath)) {
      return { exists: false, sizeBytes: 0, sizeMB: '0', createdAt: null };
    }
    const stats = statSync(backupPath);
    return {
      exists: true,
      sizeBytes: stats.size,
      sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
      createdAt: new Date(stats.mtimeMs).toLocaleString(),
    };
  } catch {
    return { exists: false, sizeBytes: 0, sizeMB: '0', createdAt: null };
  }
}

// ─── Statement wrapper ───────────────────────────────────────────────────────

class Stmt {
  constructor(
    private db: import('sql.js').Database,
    private sql: string,
  ) {}

  all(params?: Record<string, unknown>): unknown[] {
    return this._rows(params, false);
  }

  get(params?: Record<string, unknown>): unknown {
    return this._rows(params, true)[0] ?? undefined;
  }

  run(params?: Record<string, unknown>): { changes: number } {
    const mappedSql = this.sql.replace(/@(\w+)/g, '?');
    const names = [...this.sql.matchAll(/@(\w+)/g)].map(m => m[1]);
    const values = names.map(k => {
      const v = params?.[k];
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    });
    this.db.run(mappedSql, values as import('sql.js').BindParameters[]);
    const changes = this.db.getRowsModified();
    // Only save to disk if we are NOT inside an explicit transaction.
    // Inside a transaction, save() is called once at the end by transaction().
    if (!_inTransaction) save();
    return { changes };
  }

  private _rows(params: Record<string, unknown> | undefined, single: boolean): unknown[] {
    const mappedSql = this.sql.replace(/@(\w+)/g, '?');
    const names = [...this.sql.matchAll(/@(\w+)/g)].map(m => m[1]);
    const values = names.map(k => {
      const v = params?.[k];
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    });

    const stmt = this.db.prepare(mappedSql);
    if (values.length) stmt.bind(values as import('sql.js').BindParameters[]);

    const rows: unknown[] = [];
    while (stmt.step()) {
      const cols = stmt.getColumnNames();
      const vals = stmt.get();
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => { row[c] = vals[i]; });
      rows.push(row);
      if (single) break;
    }
    stmt.free();
    return rows;
  }
}

// ─── Database wrapper ────────────────────────────────────────────────────────

class Database {
  prepare(sql: string): Stmt {
    return new Stmt(_db!, sql);
  }

  /**
   * Run a function inside an atomic SQL transaction, writing to disk exactly once.
   * Use this for bulk operations (e.g. "clear all data") where multiple statements
   * must succeed or fail together.
   */
  runTransaction(fn: () => void): void {
    _inTransaction = true;
    try {
      _db!.run('BEGIN');
      fn();
      _db!.run('COMMIT');
      save(); // single atomic flush after all statements complete
    } catch (err) {
      try { _db!.run('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      _inTransaction = false;
    }
  }

  transaction<T extends unknown[]>(fn: (items: T) => void): (items: T) => void {
    return (items: T) => {
      // Suppress per-statement save() calls inside the transaction;
      // write to disk exactly once at the end.
      _inTransaction = true;
      try {
        _db!.run('BEGIN');
        fn(items);
        _db!.run('COMMIT');
        save(); // single atomic flush
      } catch (err) {
        try { _db!.run('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        _inTransaction = false;
      }
    };
  }

  get rowsModified(): number {
    return _db?.getRowsModified() ?? 0;
  }
}

/** Set to true while a transaction() is running, to suppress per-statement save() calls. */
let _inTransaction = false;

let _wrapper: Database;

export async function initDb(): Promise<Database> {
  if (_db) return _wrapper!;

  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  try {
    // sql.js init with explicit wasmBinary
    const initSqlJs = (await import('sql.js')).default;
    const wasmBinary = readFileSync(wasmPath);
    const SQL = await initSqlJs({ wasmBinary });
    _SQLCtor = SQL;

    const fileBuffer = existsSync(dbPath) ? readFileSync(dbPath) : undefined;
    _db = new SQL.Database(fileBuffer ?? undefined);
    _wrapper = new Database();

    // 🔴 CRITICAL: Optimisations SQLite pour Windows NAS
    _db.run("PRAGMA journal_mode = WAL");
    _db.run("PRAGMA synchronous = NORMAL");
    _db.run("PRAGMA cache_size = -128000");
    _db.run("PRAGMA temp_store = FILE");
    _db.run("PRAGMA mmap_size = 536870912");
    _db.run("PRAGMA wal_autocheckpoint = 1000");
    _db.run("PRAGMA wal_compress = ON");
    _db.run("PRAGMA foreign_keys = ON");
    _initSchema(_db);
    console.log(`SQLite (sql.js) initialised — ${dbPath}`);
  } catch (err) {
    console.error('[DB] Failed to initialise SQLite:', err);
    throw err; // Let the caller decide what to do
  }

  return _wrapper!;
}

export function getDb(): Database {
  if (!_wrapper) {
    throw new Error('Database not initialized — call initDb() first');
  }
  return _wrapper;
}

function _initSchema(db: import('sql.js').Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      registered_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
      last_scanned_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      last_modified INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      thumbnail TEXT,
      indexed_at INTEGER,
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
      UNIQUE(folder_path, name)
    )
  `);
  // Migration: add thumbnail column if it doesn't exist yet (for existing DBs)
  try { db.run('ALTER TABLE photos ADD COLUMN thumbnail TEXT'); } catch { /* already exists */ }
  db.run(`CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_photos_folder_path ON photos(folder_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_photos_name ON photos(name)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
    )
  `);
  // Processing state for background indexing (survives server restarts)
  db.run(`
    CREATE TABLE IF NOT EXISTS processing_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
    )
  `);
}

/** Set to true during nukeDb() so concurrent operations can check and bail out. */
export function isNuking(): boolean {
  return _frozen;
}

export function closeDb(): void {
  if (_db) {
    save();
    _db.close();
    _db = null;
    console.log('SQLite (sql.js) closed');
  }
}

// ─── Processing State ──────────────────────────────────────────────────────────

export interface ProcessingState {
  status: 'idle' | 'running' | 'stopping';
  done: number;
  total: number;
  currentPhoto: string;
  startTime: number | null;
}

const DEFAULT_STATE: ProcessingState = {
  status: 'idle',
  done: 0,
  total: 0,
  currentPhoto: '',
  startTime: null,
};

/**
 * Save processing state to the database.
 */
export function saveProcessingState(state: Partial<ProcessingState>): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const existing = db.prepare('SELECT key FROM processing_state').all();
  const rows = existing.map(r => (r as { key: string }).key);

  const entries = Object.entries(state) as [keyof ProcessingState, unknown][];
  for (const [key, value] of entries) {
    const dbKey = `processing_${key}`;
    const dbValue = typeof value === 'string' ? value : JSON.stringify(value);

    if (rows.includes(dbKey)) {
      db.prepare('UPDATE processing_state SET value = @value, updated_at = @now WHERE key = @key').run({ value: dbValue, now, key: dbKey });
    } else {
      db.prepare('INSERT INTO processing_state (key, value, updated_at) VALUES (@key, @value, @now)').run({ key: dbKey, value: dbValue, now });
      rows.push(dbKey);
    }
  }

  saveDb();
}

/**
 * Load processing state from the database.
 */
export function loadProcessingState(): ProcessingState {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM processing_state WHERE key LIKE @pattern').all({ pattern: 'processing_%' });
  const state: Record<string, string> = {};

  for (const row of rows) {
    const r = row as { key: string; value: string };
    const field = r.key.replace('processing_', '');
    state[field] = r.value;
  }

  return {
    status: (state.status as ProcessingState['status']) || 'idle',
    done: parseInt(state.done || '0', 10),
    total: parseInt(state.total || '0', 10),
    currentPhoto: state.currentPhoto || '',
    startTime: state.startTime ? parseInt(state.startTime, 10) : null,
  };
}

/**
 * Reset processing state to idle.
 */
export function resetProcessingState(): void {
  saveProcessingState(DEFAULT_STATE);
}
