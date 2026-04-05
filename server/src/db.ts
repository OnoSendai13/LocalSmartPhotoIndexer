/**
 * SQLite via sql.js (WebAssembly, zero native compilation).
 * Provides a better-sqlite3-compatible API:
 *   getDb().prepare(sql).all(params)
 *   getDb().prepare(sql).get(params)
 *   getDb().prepare(sql).run(params)
 *   getDb().transaction(fn)(items)
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// sql.js WASM — from server/src/, go up two levels to project root, then into server/node_modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, '../../server/node_modules/sql.js/dist/sql-wasm.wasm');

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'photo-index.db');

let _db: import('sql.js').Database | null = null;

function save(): void {
  if (_db) {
    const data = _db.export();
    writeFileSync(dbPath, Buffer.from(data));
  }
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

    const fileBuffer = existsSync(dbPath) ? readFileSync(dbPath) : undefined;
    _db = new SQL.Database(fileBuffer ?? undefined);
    _wrapper = new Database();

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
}

export function closeDb(): void {
  if (_db) {
    save();
    _db.close();
    _db = null;
    console.log('SQLite (sql.js) closed');
  }
}
