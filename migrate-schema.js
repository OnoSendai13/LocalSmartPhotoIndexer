import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = __dirname;
const dataDir = path.join(projectRoot, 'server', 'data');
const dbPath = path.join(dataDir, 'photo-index.db');
const reportPath = path.join(projectRoot, 'schema-migration-report.txt');

const EXPECTED_TABLES = {
  folders: {
    createSql: `
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        registered_at INTEGER NOT NULL DEFAULT (unixepoch('now')),
        last_scanned_at INTEGER
      )
    `,
    columns: [
      { name: 'id', addSql: 'ALTER TABLE folders ADD COLUMN id TEXT', backfillSql: "UPDATE folders SET id = lower(hex(randomblob(16))) WHERE id IS NULL OR TRIM(id) = ''" },
      { name: 'path', addSql: 'ALTER TABLE folders ADD COLUMN path TEXT', backfillSql: "UPDATE folders SET path = '' WHERE path IS NULL" },
      { name: 'name', addSql: 'ALTER TABLE folders ADD COLUMN name TEXT', backfillSql: "UPDATE folders SET name = '' WHERE name IS NULL" },
      { name: 'registered_at', addSql: 'ALTER TABLE folders ADD COLUMN registered_at INTEGER', backfillSql: "UPDATE folders SET registered_at = unixepoch('now') WHERE registered_at IS NULL" },
      { name: 'last_scanned_at', addSql: 'ALTER TABLE folders ADD COLUMN last_scanned_at INTEGER' },
    ],
  },
  photos: {
    createSql: `
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
    `,
    columns: [
      { name: 'id', addSql: 'ALTER TABLE photos ADD COLUMN id TEXT', backfillSql: "UPDATE photos SET id = lower(hex(randomblob(16))) WHERE id IS NULL OR TRIM(id) = ''" },
      { name: 'name', addSql: 'ALTER TABLE photos ADD COLUMN name TEXT', backfillSql: "UPDATE photos SET name = '' WHERE name IS NULL" },
      { name: 'path', addSql: 'ALTER TABLE photos ADD COLUMN path TEXT', backfillSql: "UPDATE photos SET path = '' WHERE path IS NULL" },
      { name: 'folder_path', addSql: 'ALTER TABLE photos ADD COLUMN folder_path TEXT', backfillSql: "UPDATE photos SET folder_path = '' WHERE folder_path IS NULL" },
      { name: 'size', addSql: 'ALTER TABLE photos ADD COLUMN size INTEGER', backfillSql: 'UPDATE photos SET size = 0 WHERE size IS NULL' },
      { name: 'last_modified', addSql: 'ALTER TABLE photos ADD COLUMN last_modified INTEGER', backfillSql: "UPDATE photos SET last_modified = unixepoch('now') WHERE last_modified IS NULL" },
      { name: 'mime_type', addSql: 'ALTER TABLE photos ADD COLUMN mime_type TEXT', backfillSql: "UPDATE photos SET mime_type = 'application/octet-stream' WHERE mime_type IS NULL" },
      { name: 'tags', addSql: "ALTER TABLE photos ADD COLUMN tags TEXT DEFAULT '[]'", backfillSql: "UPDATE photos SET tags = '[]' WHERE tags IS NULL OR TRIM(tags) = ''" },
      { name: 'status', addSql: "ALTER TABLE photos ADD COLUMN status TEXT DEFAULT 'pending'", backfillSql: "UPDATE photos SET status = 'pending' WHERE status IS NULL OR TRIM(status) = ''" },
      { name: 'thumbnail', addSql: 'ALTER TABLE photos ADD COLUMN thumbnail TEXT' },
      { name: 'indexed_at', addSql: 'ALTER TABLE photos ADD COLUMN indexed_at INTEGER' },
      { name: 'error_message', addSql: 'ALTER TABLE photos ADD COLUMN error_message TEXT' },
      { name: 'created_at', addSql: 'ALTER TABLE photos ADD COLUMN created_at INTEGER', backfillSql: "UPDATE photos SET created_at = unixepoch('now') WHERE created_at IS NULL" },
      { name: 'updated_at', addSql: 'ALTER TABLE photos ADD COLUMN updated_at INTEGER', backfillSql: "UPDATE photos SET updated_at = unixepoch('now') WHERE updated_at IS NULL" },
    ],
  },
  settings: {
    createSql: `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
      )
    `,
    columns: [
      { name: 'key', addSql: 'ALTER TABLE settings ADD COLUMN key TEXT', backfillSql: "UPDATE settings SET key = 'legacy_' || rowid WHERE key IS NULL OR TRIM(key) = ''" },
      { name: 'value', addSql: 'ALTER TABLE settings ADD COLUMN value TEXT', backfillSql: "UPDATE settings SET value = '{}' WHERE value IS NULL" },
      { name: 'updated_at', addSql: 'ALTER TABLE settings ADD COLUMN updated_at INTEGER', backfillSql: "UPDATE settings SET updated_at = unixepoch('now') WHERE updated_at IS NULL" },
    ],
  },
  processing_state: {
    createSql: `
      CREATE TABLE IF NOT EXISTS processing_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL DEFAULT 'idle',
        done INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        current_photo TEXT NOT NULL DEFAULT '',
        start_time INTEGER,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
      )
    `,
    columns: [
      { name: 'id', addSql: 'ALTER TABLE processing_state ADD COLUMN id INTEGER' },
      { name: 'status', addSql: "ALTER TABLE processing_state ADD COLUMN status TEXT DEFAULT 'idle'", backfillSql: "UPDATE processing_state SET status = 'idle' WHERE status IS NULL OR TRIM(status) = ''" },
      { name: 'done', addSql: 'ALTER TABLE processing_state ADD COLUMN done INTEGER DEFAULT 0', backfillSql: 'UPDATE processing_state SET done = 0 WHERE done IS NULL' },
      { name: 'total', addSql: 'ALTER TABLE processing_state ADD COLUMN total INTEGER DEFAULT 0', backfillSql: 'UPDATE processing_state SET total = 0 WHERE total IS NULL' },
      { name: 'current_photo', addSql: "ALTER TABLE processing_state ADD COLUMN current_photo TEXT DEFAULT ''", backfillSql: "UPDATE processing_state SET current_photo = '' WHERE current_photo IS NULL" },
      { name: 'start_time', addSql: 'ALTER TABLE processing_state ADD COLUMN start_time INTEGER' },
      { name: 'updated_at', addSql: 'ALTER TABLE processing_state ADD COLUMN updated_at INTEGER', backfillSql: "UPDATE processing_state SET updated_at = unixepoch('now') WHERE updated_at IS NULL" },
    ],
  },
  transaction_log: {
    createSql: `
      CREATE TABLE IF NOT EXISTS transaction_log (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      )
    `,
    columns: [
      { name: 'id', addSql: 'ALTER TABLE transaction_log ADD COLUMN id TEXT', backfillSql: "UPDATE transaction_log SET id = lower(hex(randomblob(16))) WHERE id IS NULL OR TRIM(id) = ''" },
      { name: 'type', addSql: 'ALTER TABLE transaction_log ADD COLUMN type TEXT', backfillSql: "UPDATE transaction_log SET type = 'unknown' WHERE type IS NULL OR TRIM(type) = ''" },
      { name: 'data', addSql: "ALTER TABLE transaction_log ADD COLUMN data TEXT DEFAULT '{}'", backfillSql: "UPDATE transaction_log SET data = '{}' WHERE data IS NULL OR TRIM(data) = ''" },
      { name: 'timestamp', addSql: 'ALTER TABLE transaction_log ADD COLUMN timestamp INTEGER', backfillSql: "UPDATE transaction_log SET timestamp = unixepoch('now') WHERE timestamp IS NULL" },
      { name: 'status', addSql: "ALTER TABLE transaction_log ADD COLUMN status TEXT DEFAULT 'pending'", backfillSql: "UPDATE transaction_log SET status = 'pending' WHERE status IS NULL OR TRIM(status) = ''" },
    ],
  },
};

const EXPECTED_INDEXES = [
  { name: 'idx_photos_status', table: 'photos', sql: 'CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status)' },
  { name: 'idx_photos_folder_path', table: 'photos', sql: 'CREATE INDEX IF NOT EXISTS idx_photos_folder_path ON photos(folder_path)' },
  { name: 'idx_photos_name', table: 'photos', sql: 'CREATE INDEX IF NOT EXISTS idx_photos_name ON photos(name)' },
  { name: 'idx_transaction_log_status', table: 'transaction_log', sql: 'CREATE INDEX IF NOT EXISTS idx_transaction_log_status ON transaction_log(status)' },
  { name: 'idx_transaction_log_timestamp', table: 'transaction_log', sql: 'CREATE INDEX IF NOT EXISTS idx_transaction_log_timestamp ON transaction_log(timestamp)' },
  {
    name: 'idx_processing_state_id_unique',
    table: 'processing_state',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_state_id_unique ON processing_state(id) WHERE id IS NOT NULL',
  },
];

function horodatage() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(date);
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

function success(message) {
  console.log(`✅ ${message}`);
}

function warning(message) {
  console.warn(`⚠️  ${message}`);
}

function error(message) {
  console.error(`❌ ${message}`);
}

function loadBetterSqlite3Ctor() {
  const requireHere = createRequire(import.meta.url);

  try {
    return requireHere('better-sqlite3');
  } catch {
    const serverPkgUrl = pathToFileURL(path.join(projectRoot, 'server', 'package.json')).href;
    const requireFromServer = createRequire(serverPkgUrl);
    return requireFromServer('better-sqlite3');
  }
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return !!row;
}

function indexExists(db, indexName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName);
  return !!row;
}

function getTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function normalizeProcessingStateTable(db, reportData) {
  if (!tableExists(db, 'processing_state')) {
    return;
  }

  const columns = getTableColumns(db, 'processing_state');
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has('id')) {
    db.exec('ALTER TABLE processing_state ADD COLUMN id INTEGER');
    reportData.columnsAdded.push('processing_state.id');
    reportData.processingStateFixes.push('Ajout de la colonne id (INTEGER).');
  }

  db.exec("UPDATE processing_state SET status = 'idle' WHERE status IS NULL OR TRIM(status) = ''");
  db.exec('UPDATE processing_state SET done = 0 WHERE done IS NULL');
  db.exec('UPDATE processing_state SET total = 0 WHERE total IS NULL');
  db.exec("UPDATE processing_state SET current_photo = '' WHERE current_photo IS NULL");
  db.exec("UPDATE processing_state SET updated_at = unixepoch('now') WHERE updated_at IS NULL");

  const rows = db
    .prepare(`
      SELECT rowid, id, updated_at
      FROM processing_state
      ORDER BY COALESCE(updated_at, 0) DESC, rowid DESC
    `)
    .all();

  if (rows.length === 0) {
    db.prepare(`
      INSERT INTO processing_state (id, status, done, total, current_photo, start_time, updated_at)
      VALUES (1, 'idle', 0, 0, '', NULL, unixepoch('now'))
    `).run();
    reportData.processingStateFixes.push('Table vide: insertion de la ligne par défaut id=1.');
    return;
  }

  let nextId = 2;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const targetId = i === 0 ? 1 : nextId++;
    if (row.id !== targetId) {
      db.prepare('UPDATE processing_state SET id = ? WHERE rowid = ?').run(targetId, row.rowid);
    }
  }

  const hasMainRow = db.prepare('SELECT 1 FROM processing_state WHERE id = 1 LIMIT 1').get();
  if (!hasMainRow) {
    db.prepare(`
      INSERT INTO processing_state (id, status, done, total, current_photo, start_time, updated_at)
      VALUES (1, 'idle', 0, 0, '', NULL, unixepoch('now'))
    `).run();
    reportData.processingStateFixes.push('Aucune ligne id=1 détectée: insertion d\'une ligne par défaut.');
  }

  if (rows.length > 1) {
    reportData.warnings.push(
      `processing_state contient ${rows.length} lignes; normalisation en id uniques (id=1 réservé à l\'état actif).`,
    );
  }
}

function ensureTableAndColumns(db, tableName, tableSpec, reportData) {
  const beforeExists = tableExists(db, tableName);
  if (!beforeExists) {
    db.exec(tableSpec.createSql);
    reportData.tablesCreated.push(tableName);
    success(`Table créée: ${tableName}`);
  }

  const columns = getTableColumns(db, tableName);
  const currentColumns = new Set(columns.map((c) => c.name));
  const missingColumns = tableSpec.columns.filter((col) => !currentColumns.has(col.name));

  for (const col of missingColumns) {
    db.exec(col.addSql);
    reportData.columnsAdded.push(`${tableName}.${col.name}`);
    success(`Colonne ajoutée: ${tableName}.${col.name}`);

    if (col.backfillSql) {
      db.exec(col.backfillSql);
      reportData.backfills.push(`${tableName}.${col.name}`);
    }
  }

  for (const col of tableSpec.columns) {
    if (col.backfillSql && !missingColumns.find((m) => m.name === col.name)) {
      db.exec(col.backfillSql);
      reportData.backfills.push(`${tableName}.${col.name}`);
    }
  }

  const afterColumns = getTableColumns(db, tableName).map((c) => c.name);
  const unexpected = afterColumns.filter((name) => !tableSpec.columns.some((c) => c.name === name));

  reportData.tableChecks.push({
    table: tableName,
    beforeExists,
    expectedColumns: tableSpec.columns.map((c) => c.name),
    actualColumns: afterColumns,
    missingColumns: missingColumns.map((c) => c.name),
    unexpectedColumns: unexpected,
  });
}

function ensureIndexes(db, reportData) {
  for (const idx of EXPECTED_INDEXES) {
    if (!tableExists(db, idx.table)) {
      reportData.warnings.push(`Index ${idx.name} non créé: table ${idx.table} introuvable.`);
      continue;
    }

    const existedBefore = indexExists(db, idx.name);
    db.exec(idx.sql);

    if (!existedBefore) {
      reportData.indexesCreated.push(idx.name);
      success(`Index créé: ${idx.name}`);
    }
  }
}

function writeReport(report) {
  fs.writeFileSync(reportPath, report, { encoding: 'utf8' });
  success(`Rapport de migration généré: ${reportPath}`);
}

function run() {
  const startedAt = new Date();
  const startedMs = Date.now();

  const reportData = {
    tablesCreated: [],
    columnsAdded: [],
    backfills: [],
    indexesCreated: [],
    warnings: [],
    errors: [],
    tableChecks: [],
    processingStateFixes: [],
    backupPath: '',
  };

  let db = null;

  try {
    info('Démarrage de la migration de schéma...');
    info(`Projet: ${projectRoot}`);

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Base de données introuvable: ${dbPath}`);
    }

    reportData.backupPath = `${dbPath}.schema-migration-${horodatage()}.bak`;
    fs.copyFileSync(dbPath, reportData.backupPath);
    success(`Sauvegarde créée: ${reportData.backupPath}`);

    const BetterSqlite3 = loadBetterSqlite3Ctor();
    db = new BetterSqlite3(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const runMigrationTx = db.transaction(() => {
      for (const [tableName, tableSpec] of Object.entries(EXPECTED_TABLES)) {
        ensureTableAndColumns(db, tableName, tableSpec, reportData);
      }

      normalizeProcessingStateTable(db, reportData);
      ensureIndexes(db, reportData);
    });

    runMigrationTx();

    const durationSec = ((Date.now() - startedMs) / 1000).toFixed(2);
    const endedAt = new Date();

    const tableDetails = reportData.tableChecks
      .map((item) => [
        `Table: ${item.table}`,
        `  - Existant avant migration: ${item.beforeExists ? 'Oui' : 'Non'}`,
        `  - Colonnes attendues: ${item.expectedColumns.join(', ')}`,
        `  - Colonnes actuelles : ${item.actualColumns.join(', ') || '(aucune)'}`,
        `  - Colonnes ajoutées  : ${item.missingColumns.join(', ') || 'Aucune'}`,
        `  - Colonnes inattendues: ${item.unexpectedColumns.join(', ') || 'Aucune'}`,
      ].join('\n'))
      .join('\n\n');

    const report = [
      '=== RAPPORT DE MIGRATION DE SCHÉMA ===',
      '',
      `Date de début : ${formatDate(startedAt)}`,
      `Date de fin   : ${formatDate(endedAt)}`,
      `Durée         : ${durationSec} s`,
      '',
      `Base SQLite : ${dbPath}`,
      `Sauvegarde  : ${reportData.backupPath || '(non créée)'}`,
      '',
      '--- Résumé ---',
      `Tables créées              : ${reportData.tablesCreated.length}`,
      `Colonnes ajoutées          : ${reportData.columnsAdded.length}`,
      `Backfills exécutés         : ${reportData.backfills.length}`,
      `Indexes créés              : ${reportData.indexesCreated.length}`,
      `Avertissements             : ${reportData.warnings.length}`,
      `Erreurs                    : ${reportData.errors.length}`,
      '',
      '--- Détails processing_state ---',
      ...(reportData.processingStateFixes.length ? reportData.processingStateFixes : ['Aucun correctif spécifique nécessaire.']),
      '',
      '--- Tables créées ---',
      ...(reportData.tablesCreated.length ? reportData.tablesCreated : ['Aucune']),
      '',
      '--- Colonnes ajoutées ---',
      ...(reportData.columnsAdded.length ? reportData.columnsAdded : ['Aucune']),
      '',
      '--- Indexes créés ---',
      ...(reportData.indexesCreated.length ? reportData.indexesCreated : ['Aucun']),
      '',
      '--- Vérification détaillée des tables ---',
      tableDetails || 'Aucun détail disponible.',
      '',
      '--- Avertissements ---',
      ...(reportData.warnings.length ? reportData.warnings : ['Aucun avertissement']),
      '',
      '--- Erreurs ---',
      ...(reportData.errors.length ? reportData.errors : ['Aucune erreur']),
      '',
      'Fin du rapport.',
    ].join('\n');

    writeReport(report);

    if (reportData.errors.length > 0) {
      warning('Migration terminée avec erreurs. Consultez schema-migration-report.txt.');
      process.exitCode = 2;
    } else if (reportData.warnings.length > 0) {
      warning('Migration terminée avec avertissements. Consultez schema-migration-report.txt.');
      process.exitCode = 2;
    } else {
      success('Migration de schéma terminée avec succès.');
      process.exitCode = 0;
    }
  } catch (fatalError) {
    const message = fatalError instanceof Error ? fatalError.stack || fatalError.message : String(fatalError);
    error('Échec de la migration de schéma.');
    error(message);

    const report = [
      '=== RAPPORT DE MIGRATION DE SCHÉMA ===',
      '',
      `Date : ${formatDate(new Date())}`,
      '',
      'Statut: ÉCHEC FATAL',
      '',
      `Base SQLite : ${dbPath}`,
      `Sauvegarde  : ${reportData.backupPath || '(non créée)'}`,
      '',
      'Erreur:',
      message,
      '',
      'Conseil: restaurez la sauvegarde .bak si nécessaire.',
    ].join('\n');

    try {
      writeReport(report);
    } catch (reportErr) {
      error(`Impossible d\'écrire le rapport: ${String(reportErr)}`);
    }

    process.exitCode = 1;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // no-op
      }
    }
  }
}

run();