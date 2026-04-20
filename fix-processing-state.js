import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = __dirname;
const dataDir = path.join(projectRoot, 'server', 'data');
const dbPath = path.join(dataDir, 'photo-index.db');
const reportPath = path.join(projectRoot, 'fix-processing-state-report.txt');

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

function getTableInfo(db, tableName) {
  if (!tableExists(db, tableName)) return [];
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function normalizeText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : fallback;
}

function normalizeInteger(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

function getEpochNow() {
  return Math.floor(Date.now() / 1000);
}

function pickCanonicalRow(rows) {
  if (!rows.length) return null;

  const rowsWithMeta = rows.map((row, idx) => {
    const updatedAt = normalizeInteger(row.updated_at, 0);
    const id = normalizeInteger(row.id, null);
    const rowid = normalizeInteger(row.__rowid, idx + 1);
    return { row, updatedAt, id, rowid };
  });

  const id1Rows = rowsWithMeta.filter((entry) => entry.id === 1);
  const pool = id1Rows.length > 0 ? id1Rows : rowsWithMeta;

  pool.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return b.rowid - a.rowid;
  });

  return pool[0].row;
}

function normalizeCanonicalRow(rawRow) {
  const now = getEpochNow();

  if (!rawRow) {
    return {
      id: 1,
      status: 'idle',
      done: 0,
      total: 0,
      current_photo: '',
      start_time: null,
      updated_at: now,
    };
  }

  return {
    id: 1,
    status: normalizeText(rawRow.status, 'idle'),
    done: normalizeInteger(rawRow.done, 0),
    total: normalizeInteger(rawRow.total, 0),
    current_photo: typeof rawRow.current_photo === 'string' ? rawRow.current_photo : '',
    start_time:
      rawRow.start_time === null || rawRow.start_time === undefined || rawRow.start_time === ''
        ? null
        : normalizeInteger(rawRow.start_time, null),
    updated_at: normalizeInteger(rawRow.updated_at, now),
  };
}

function writeReport(report) {
  fs.writeFileSync(reportPath, report, { encoding: 'utf8' });
  success(`Rapport généré: ${reportPath}`);
}

function run() {
  const startedAt = new Date();
  const startedMs = Date.now();

  const reportData = {
    backupPath: '',
    legacyDumpPath: '',
    tableExisted: false,
    rowsBefore: 0,
    rowsAfter: 0,
    oldSchema: [],
    newSchema: [],
    selectedSource: 'default',
    warnings: [],
    errors: [],
    canonicalRow: null,
  };

  let db = null;

  try {
    info('Démarrage du correctif processing_state...');
    info(`Projet: ${projectRoot}`);

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Base de données introuvable: ${dbPath}`);
    }

    const stamp = horodatage();
    reportData.backupPath = `${dbPath}.processing-state-fix-${stamp}.bak`;
    fs.copyFileSync(dbPath, reportData.backupPath);
    success(`Sauvegarde DB créée: ${reportData.backupPath}`);

    const BetterSqlite3 = loadBetterSqlite3Ctor();
    db = new BetterSqlite3(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    reportData.tableExisted = tableExists(db, 'processing_state');
    reportData.oldSchema = getTableInfo(db, 'processing_state');

    let legacyRows = [];
    if (reportData.tableExisted) {
      legacyRows = db.prepare('SELECT rowid as __rowid, * FROM processing_state').all();
      reportData.rowsBefore = legacyRows.length;
    } else {
      reportData.rowsBefore = 0;
    }

    reportData.legacyDumpPath = path.join(projectRoot, `processing-state-legacy-rows-${stamp}.json`);
    fs.writeFileSync(reportData.legacyDumpPath, JSON.stringify(legacyRows, null, 2), { encoding: 'utf8' });
    success(`Dump JSON des lignes legacy créé: ${reportData.legacyDumpPath}`);

    const selectedRaw = pickCanonicalRow(legacyRows);
    reportData.selectedSource = selectedRaw ? 'legacy' : 'default';
    reportData.canonicalRow = normalizeCanonicalRow(selectedRaw);

    if (legacyRows.length > 1) {
      reportData.warnings.push(
        `processing_state contenait ${legacyRows.length} lignes. Une seule ligne canonique (id=1) a été retenue, les autres sont préservées dans le dump JSON et la sauvegarde .bak.`,
      );
    }

    const migrateTx = db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS processing_state_new');
      db.exec(`
        CREATE TABLE processing_state_new (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          status TEXT,
          done INTEGER,
          total INTEGER,
          current_photo TEXT,
          start_time INTEGER,
          updated_at INTEGER
        )
      `);

      db.prepare(`
        INSERT INTO processing_state_new (id, status, done, total, current_photo, start_time, updated_at)
        VALUES (@id, @status, @done, @total, @current_photo, @start_time, @updated_at)
      `).run(reportData.canonicalRow);

      if (tableExists(db, 'processing_state')) {
        db.exec('DROP TABLE processing_state');
      }

      db.exec('ALTER TABLE processing_state_new RENAME TO processing_state');
    });

    migrateTx();

    // Vérification post-migration
    reportData.newSchema = getTableInfo(db, 'processing_state');
    reportData.rowsAfter = db.prepare('SELECT COUNT(*) as cnt FROM processing_state').get().cnt;

    const idColumn = reportData.newSchema.find((c) => c.name === 'id');
    if (!idColumn || idColumn.pk !== 1) {
      throw new Error('La colonne id de processing_state n\'est pas PRIMARY KEY après migration.');
    }

    // Vérification de compatibilité ON CONFLICT(id)
    db.prepare(`
      INSERT INTO processing_state (id, status, done, total, current_photo, start_time, updated_at)
      VALUES (1, @status, @done, @total, @current_photo, @start_time, unixepoch('now'))
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        done = excluded.done,
        total = excluded.total,
        current_photo = excluded.current_photo,
        start_time = excluded.start_time,
        updated_at = unixepoch('now')
    `).run({
      status: reportData.canonicalRow.status,
      done: reportData.canonicalRow.done,
      total: reportData.canonicalRow.total,
      current_photo: reportData.canonicalRow.current_photo,
      start_time: reportData.canonicalRow.start_time,
    });

    const endedAt = new Date();
    const durationSec = ((Date.now() - startedMs) / 1000).toFixed(2);

    const oldSchemaLines = reportData.oldSchema.length
      ? reportData.oldSchema.map((c) => `- ${c.name} (${c.type || 'UNKNOWN'}) pk=${c.pk} notnull=${c.notnull} dflt=${c.dflt_value ?? 'NULL'}`)
      : ['(table absente avant correctif)'];

    const newSchemaLines = reportData.newSchema.length
      ? reportData.newSchema.map((c) => `- ${c.name} (${c.type || 'UNKNOWN'}) pk=${c.pk} notnull=${c.notnull} dflt=${c.dflt_value ?? 'NULL'}`)
      : ['(schéma non disponible)'];

    const report = [
      '=== RAPPORT FIX processing_state ===',
      '',
      `Date de début : ${formatDate(startedAt)}`,
      `Date de fin   : ${formatDate(endedAt)}`,
      `Durée         : ${durationSec} s`,
      '',
      `Base SQLite : ${dbPath}`,
      `Sauvegarde DB : ${reportData.backupPath || '(non créée)'}`,
      `Dump legacy   : ${reportData.legacyDumpPath || '(non créé)'}`,
      '',
      '--- Résumé ---',
      `Table processing_state existait : ${reportData.tableExisted ? 'Oui' : 'Non'}`,
      `Lignes avant correctif          : ${reportData.rowsBefore}`,
      `Lignes après correctif          : ${reportData.rowsAfter}`,
      `Source retenue pour id=1        : ${reportData.selectedSource}`,
      '',
      '--- Ligne canonique conservée ---',
      JSON.stringify(reportData.canonicalRow, null, 2),
      '',
      '--- Schéma AVANT ---',
      ...oldSchemaLines,
      '',
      '--- Schéma APRÈS ---',
      ...newSchemaLines,
      '',
      '--- Vérification ON CONFLICT(id) ---',
      'Requête INSERT ... ON CONFLICT(id) exécutée avec succès.',
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

    if (reportData.warnings.length > 0) {
      warning('Correctif terminé avec avertissements. Consultez fix-processing-state-report.txt.');
      process.exitCode = 2;
    } else {
      success('Correctif processing_state terminé avec succès.');
      process.exitCode = 0;
    }
  } catch (fatalError) {
    const message = fatalError instanceof Error ? fatalError.stack || fatalError.message : String(fatalError);
    error('Échec du correctif processing_state.');
    error(message);

    reportData.errors.push(message);

    const report = [
      '=== RAPPORT FIX processing_state ===',
      '',
      `Date : ${formatDate(new Date())}`,
      '',
      'Statut: ÉCHEC FATAL',
      '',
      `Base SQLite : ${dbPath}`,
      `Sauvegarde DB : ${reportData.backupPath || '(non créée)'}`,
      `Dump legacy   : ${reportData.legacyDumpPath || '(non créé)'}`,
      '',
      'Erreur:',
      message,
      '',
      'Conseil: restaurez la sauvegarde .bak si nécessaire.',
    ].join('\n');

    try {
      writeReport(report);
    } catch (reportErr) {
      error(`Impossible d'écrire le rapport: ${String(reportErr)}`);
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
