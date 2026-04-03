import Database from 'better-sqlite3';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    import('fs').then(fs => {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    });
    db = new Database(path.join(dataDir, 'photo-index.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    console.log('✅ SQLite initialized');
  }
  return db;
}

function initSchema(db: Database.Database) {
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
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('📦 SQLite closed');
  }
}
