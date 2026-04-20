import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, copyFileSync, statSync, unlinkSync } from 'fs';
import { rm, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');
const thumbnailsDir = path.join(dataDir, 'thumbnails');
const dbPath = path.join(dataDir, 'photo-index.db');
const backupPath = `${dbPath}.bak`;

let _db: BetterSqlite3.Database | null = null;
let _wrapper: DatabaseWrapper | null = null;
let _frozen = false;

function ensureDirs(): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(thumbnailsDir)) mkdirSync(thumbnailsDir, { recursive: true });
}

function initSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      registered_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
      last_scanned_at INTEGER
    );

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
    );

    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
    CREATE INDEX IF NOT EXISTS idx_photos_folder_path ON photos(folder_path);
    CREATE INDEX IF NOT EXISTS idx_photos_name ON photos(name);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
    );

    CREATE TABLE IF NOT EXISTS processing_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      done INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      current_photo TEXT NOT NULL DEFAULT '',
      start_time INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
    );

    CREATE TABLE IF NOT EXISTS transaction_log (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_transaction_log_status ON transaction_log(status);
    CREATE INDEX IF NOT EXISTS idx_transaction_log_timestamp ON transaction_log(timestamp);
  `);
}

function migrateSchema(db: BetterSqlite3.Database): void {
  const columns = db.prepare('PRAGMA table_info(photos)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has('thumbnail')) {
    db.exec('ALTER TABLE photos ADD COLUMN thumbnail TEXT');
    console.log('[DB] Migration: colonne photos.thumbnail ajoutée');
  }

  const processingStateExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='processing_state'")
    .get();
  if (!processingStateExists) {
    db.exec(`
      CREATE TABLE processing_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL DEFAULT 'idle',
        done INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        current_photo TEXT NOT NULL DEFAULT '',
        start_time INTEGER,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
      )
    `);
  }

  const txLogExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transaction_log'")
    .get();
  if (!txLogExists) {
    db.exec(`
      CREATE TABLE transaction_log (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_transaction_log_status ON transaction_log(status);
      CREATE INDEX IF NOT EXISTS idx_transaction_log_timestamp ON transaction_log(timestamp);
    `);
  }
}

class DatabaseWrapper {
  prepare(sql: string) {
    return _db!.prepare(sql);
  }

  runTransaction(fn: () => void): void {
    _db!.transaction(fn)();
  }

  transaction<T extends unknown[]>(fn: (items: T) => void): (items: T) => void {
    const tx = _db!.transaction((items: T) => fn(items));
    return (items: T) => tx(items);
  }
}

export async function initDb(): Promise<DatabaseWrapper> {
  if (_wrapper) return _wrapper;

  ensureDirs();

  _db = new BetterSqlite3(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('temp_store = MEMORY');

  initSchema(_db);
  migrateSchema(_db);

  _wrapper = new DatabaseWrapper();
  console.log(`SQLite (better-sqlite3) initialisé — ${dbPath}`);
  return _wrapper;
}

export function getDb(): DatabaseWrapper {
  if (!_wrapper) {
    throw new Error('Database not initialized — call initDb() first');
  }
  return _wrapper;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    _wrapper = null;
    console.log('SQLite (better-sqlite3) closed');
  }
}

export function saveDb(): void {
  // no-op with better-sqlite3 (writes are persisted natively)
}

export function isNuking(): boolean {
  return _frozen;
}

export function isNukingFlag(): boolean {
  return _frozen;
}

export function execAndSave(sql: string): void {
  if (!_db) throw new Error('Database not initialized');
  _db.exec(sql);
}

export function execAndSaveRaw(sql: string): void {
  execAndSave(sql);
}

export function backupDb(): void {
  try {
    if (!existsSync(dbPath)) return;
    if (existsSync(backupPath)) unlinkSync(backupPath);
    copyFileSync(dbPath, backupPath);
    console.log(`[BACKUP] Database backed up to ${backupPath}`);
  } catch (err) {
    console.error('[BACKUP] Failed to create backup:', err);
  }
}

async function clearThumbnailsCache(): Promise<void> {
  if (!existsSync(thumbnailsDir)) return;
  const entries = await readdir(thumbnailsDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => rm(path.join(thumbnailsDir, entry.name), { force: true })),
  );
}

export async function nukeDb(): Promise<void> {
  if (!_db) throw new Error('Database not initialized');
  _frozen = true;
  try {
    backupDb();
    _db.transaction(() => {
      _db!.prepare('DELETE FROM photos').run();
      _db!.prepare('DELETE FROM folders').run();
      _db!.prepare('DELETE FROM settings').run();
      _db!.prepare('DELETE FROM processing_state').run();
      _db!.prepare('DELETE FROM transaction_log').run();
    })();
    await clearThumbnailsCache();
  } finally {
    _frozen = false;
  }
}

export function restoreDb(): { success: boolean; photosRestored: number; foldersRestored: number; error?: string } {
  try {
    if (!existsSync(backupPath)) {
      return { success: false, photosRestored: 0, foldersRestored: 0, error: 'No backup file found' };
    }

    closeDb();
    copyFileSync(backupPath, dbPath);

    _db = new BetterSqlite3(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
    migrateSchema(_db);
    _wrapper = new DatabaseWrapper();

    const photosRestored = (_db.prepare('SELECT COUNT(*) as cnt FROM photos').get() as { cnt: number }).cnt;
    const foldersRestored = (_db.prepare('SELECT COUNT(*) as cnt FROM folders').get() as { cnt: number }).cnt;

    return { success: true, photosRestored, foldersRestored };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error('[RESTORE] ❌ Failed:', err);
    return { success: false, photosRestored: 0, foldersRestored: 0, error: err };
  }
}

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

export function getDbPath(): string {
  return dbPath;
}

export function getThumbnailsDir(): string {
  ensureDirs();
  return thumbnailsDir;
}
