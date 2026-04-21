import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DB_PATH = path.join(__dirname, 'server', 'data', 'photo-index.db');
const DEFAULT_PHOTOS_ROOT = 'Z:\\nvme11-onosendai13\\Photos';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif',
]);

const INVALID_TAGS = new Set(['Uncategorized', 'Error-EmptyResponse']);

function tsStamp() {
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
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'long' }).format(date);
}

function parseArgs(argv) {
  const parsed = {
    apply: false,
    strictExifOnly: false,
    dbPath: DEFAULT_DB_PATH,
    photosRoots: [],
    reportPath: path.join(__dirname, `rebuild-db-from-exif-report-${tsStamp()}.txt`),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--strict-exif-only') parsed.strictExifOnly = true;
    else if (arg === '--db-path') parsed.dbPath = path.resolve(argv[++i] || '');
    else if (arg === '--report-path') parsed.reportPath = path.resolve(argv[++i] || '');
    else if (arg === '--photos-root') {
      const raw = argv[++i] || '';
      const values = raw
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      parsed.photosRoots.push(...values);
    }
  }

  return parsed;
}

function loadBetterSqlite3Ctor(projectRoot) {
  const requireHere = createRequire(import.meta.url);
  try {
    return requireHere('better-sqlite3');
  } catch {
    const serverPkgUrl = pathToFileURL(path.join(projectRoot, 'server', 'package.json')).href;
    const requireFromServer = createRequire(serverPkgUrl);
    return requireFromServer('better-sqlite3');
  }
}

function loadExifToolCtor(projectRoot) {
  const requireHere = createRequire(import.meta.url);
  try {
    return requireHere('exiftool-vendored').ExifTool;
  } catch {
    const serverPkgUrl = pathToFileURL(path.join(projectRoot, 'server', 'package.json')).href;
    const requireFromServer = createRequire(serverPkgUrl);
    return requireFromServer('exiftool-vendored').ExifTool;
  }
}

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function sanitizeTags(rawTags) {
  return Array.from(
    new Set(
      (Array.isArray(rawTags) ? rawTags : [])
        .map((t) => String(t || '').trim())
        .filter((t) => t && !INVALID_TAGS.has(t) && !t.startsWith('Error-')),
    ),
  );
}

function parseDbTags(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return sanitizeTags(parsed);
  } catch {
    return [];
  }
}

function extractTagsFromMetadata(metadata) {
  const candidates = [metadata?.Keywords, metadata?.Subject, metadata?.XPKeywords]
    .flat()
    .filter(Boolean)
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') return value.split(/[;,]/g);
      return [];
    })
    .map((tag) => String(tag || '').trim())
    .filter(Boolean);

  return sanitizeTags(candidates);
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.avif': 'image/avif',
  };
  return map[ext] || 'application/octet-stream';
}

function ensurePhotosTableSchema(db) {
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

function readOldDbPhotos(db) {
  const hasPhotos = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photos'").get();
  if (!hasPhotos) return [];

  return db.prepare('SELECT id, name, path, folder_path, tags, status FROM photos').all();
}

function readConfiguredRootsFromDb(db) {
  const roots = [];

  const hasFolders = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='folders'").get();
  if (hasFolders) {
    const folderRows = db.prepare('SELECT path FROM folders ORDER BY registered_at DESC').all();
    for (const row of folderRows) {
      const p = String(row.path || '').trim();
      if (p) roots.push(p);
    }
  }

  const hasSettings = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
  if (hasSettings) {
    const settingRows = db.prepare('SELECT key, value FROM settings').all();
    const candidateKeys = new Set([
      'photosRoot', 'photoRoot', 'photosPath', 'photoPath', 'watchPath', 'watchPaths', 'folderPath', 'folderPaths',
    ]);

    for (const row of settingRows) {
      if (!candidateKeys.has(String(row.key || ''))) continue;
      try {
        const value = JSON.parse(String(row.value || 'null'));
        if (typeof value === 'string' && value.trim()) roots.push(value.trim());
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string' && item.trim()) roots.push(item.trim());
          }
        }
      } catch {
        // ignore malformed setting values
      }
    }
  }

  return Array.from(new Set(roots));
}

async function scanImagesFromRoot(rootPath) {
  const files = [];

  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) files.push(full);
      }
    }
  }

  await walk(rootPath);
  return files;
}

function writeReport(reportPath, lines) {
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
}

async function main() {
  const startedAt = new Date();
  const args = parseArgs(process.argv.slice(2));

  const report = {
    backupPath: '',
    oldDbPreservedPath: '',
    newDbWorkingPath: '',
    finalDbPath: args.dbPath,
    applyMode: args.apply,
    strictExifOnly: args.strictExifOnly,
    selectedRoots: [],
    inaccessibleRoots: [],
    scannedFiles: 0,
    importedProcessed: 0,
    importedPending: 0,
    processedFromExif: 0,
    processedFromDbFallback: 0,
    skippedDuplicatesByPath: 0,
    exifReadErrors: 0,
    exifTaggedCount: 0,
    oldDbTaggedCount: 0,
    tagsMatchCount: 0,
    exifTaggedButDbMissing: 0,
    dbTaggedButExifMissing: 0,
    tagMismatchCount: 0,
    warnings: [],
    errors: [],
  };

  const projectRoot = __dirname;
  const BetterSqlite3 = loadBetterSqlite3Ctor(projectRoot);
  const ExifTool = loadExifToolCtor(projectRoot);

  if (!fs.existsSync(args.dbPath)) {
    throw new Error(`Base de données introuvable: ${args.dbPath}`);
  }

  const oldDb = new BetterSqlite3(args.dbPath, { readonly: false });
  oldDb.pragma('journal_mode = WAL');
  oldDb.pragma('foreign_keys = ON');
  oldDb.pragma('wal_checkpoint(FULL)');

  const configuredRoots = readConfiguredRootsFromDb(oldDb);
  let roots = args.photosRoots.length > 0 ? args.photosRoots : configuredRoots;
  if (roots.length === 0) roots = [DEFAULT_PHOTOS_ROOT];
  roots = Array.from(new Set(roots.map((r) => r.trim()).filter(Boolean)));

  report.selectedRoots = roots;

  const oldRows = readOldDbPhotos(oldDb);
  const oldByPath = new Map();
  for (const row of oldRows) {
    const rawPath = String(row.path || '').trim();
    const fullPath = rawPath || path.join(String(row.folder_path || ''), String(row.name || ''));
    const key = normalizePath(fullPath);
    const dbTags = parseDbTags(row.tags);

    if (!oldByPath.has(key)) {
      oldByPath.set(key, { tags: dbTags, status: row.status || 'pending' });
      continue;
    }

    const prev = oldByPath.get(key);
    if (dbTags.length > prev.tags.length) oldByPath.set(key, { tags: dbTags, status: row.status || 'pending' });
  }

  const stamp = tsStamp();
  report.backupPath = args.apply ? `${args.dbPath}.rebuild-${stamp}.bak` : '(dry-run: sauvegarde non créée)';
  report.newDbWorkingPath = args.apply
    ? `${args.dbPath}.rebuild-working-${stamp}`
    : path.join(os.tmpdir(), `photo-index.rebuild-dryrun-${stamp}.db`);

  if (args.apply) {
    fs.copyFileSync(args.dbPath, report.backupPath);
    const walPath = `${args.dbPath}-wal`;
    const shmPath = `${args.dbPath}-shm`;
    if (fs.existsSync(walPath)) fs.copyFileSync(walPath, `${report.backupPath}-wal`);
    if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, `${report.backupPath}-shm`);
  }

  if (fs.existsSync(report.newDbWorkingPath)) fs.unlinkSync(report.newDbWorkingPath);
  const newDb = new BetterSqlite3(report.newDbWorkingPath);
  newDb.pragma('journal_mode = WAL');
  newDb.pragma('foreign_keys = ON');
  ensurePhotosTableSchema(newDb);

  const insertFolder = newDb.prepare(`
    INSERT INTO folders (id, path, name, registered_at, last_scanned_at)
    VALUES (@id, @path, @name, unixepoch('now'), unixepoch('now'))
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      last_scanned_at = unixepoch('now')
  `);

  const insertPhoto = newDb.prepare(`
    INSERT INTO photos (
      id, name, path, folder_path, size, last_modified, mime_type,
      tags, status, thumbnail, indexed_at, error_message, created_at, updated_at
    ) VALUES (
      @id, @name, @path, @folderPath, @size, @lastModified, @mimeType,
      @tags, @status, NULL, @indexedAt, NULL, unixepoch('now'), unixepoch('now')
    )
  `);

  const exiftool = new ExifTool({ taskTimeoutMillis: 120_000 });
  const seenByPath = new Set();

  const insertTx = newDb.transaction((items) => {
    for (const item of items) insertPhoto.run(item);
  });

  try {
    for (const root of roots) {
      if (!fs.existsSync(root)) {
        report.inaccessibleRoots.push(root);
        continue;
      }

      const rootName = path.basename(root) || root;
      insertFolder.run({ id: randomUUID(), path: root, name: rootName });

      const files = await scanImagesFromRoot(root);
      report.scannedFiles += files.length;

      const batch = [];
      for (const filePath of files) {
        const key = normalizePath(filePath);
        if (seenByPath.has(key)) {
          report.skippedDuplicatesByPath++;
          continue;
        }
        seenByPath.add(key);

        let stats;
        try {
          stats = await fs.promises.stat(filePath);
        } catch {
          continue;
        }

        let exifTags = [];
        try {
          const metadata = await exiftool.read(filePath);
          exifTags = extractTagsFromMetadata(metadata);
        } catch {
          report.exifReadErrors++;
        }

        const oldInfo = oldByPath.get(key);
        const oldDbTags = oldInfo ? sanitizeTags(oldInfo.tags) : [];

        if (exifTags.length > 0) report.exifTaggedCount++;
        if (oldDbTags.length > 0) report.oldDbTaggedCount++;

        if (exifTags.length > 0 && oldDbTags.length === 0) report.exifTaggedButDbMissing++;
        if (exifTags.length === 0 && oldDbTags.length > 0) report.dbTaggedButExifMissing++;

        if (exifTags.length > 0 && oldDbTags.length > 0) {
          const a = JSON.stringify([...exifTags].sort());
          const b = JSON.stringify([...oldDbTags].sort());
          if (a === b) report.tagsMatchCount++;
          else report.tagMismatchCount++;
        }

        const tagsToKeep = exifTags.length > 0 ? exifTags : (!args.strictExifOnly ? oldDbTags : []);
        const isProcessed = tagsToKeep.length > 0;

        if (isProcessed) {
          report.importedProcessed++;
          if (exifTags.length > 0) report.processedFromExif++;
          else report.processedFromDbFallback++;
        } else {
          report.importedPending++;
        }

        batch.push({
          id: randomUUID(),
          name: path.basename(filePath),
          path: filePath,
          folderPath: root,
          size: Number.isFinite(stats.size) ? stats.size : 0,
          lastModified: Math.floor(stats.mtimeMs),
          mimeType: getMimeType(filePath),
          tags: JSON.stringify(tagsToKeep),
          status: isProcessed ? 'done' : 'pending',
          indexedAt: isProcessed ? Math.floor(Date.now() / 1000) : null,
        });

        if (batch.length >= 500) {
          insertTx(batch.splice(0, batch.length));
        }
      }

      if (batch.length > 0) insertTx(batch);
    }
  } finally {
    await exiftool.end().catch(() => {});
  }

  if (report.inaccessibleRoots.length === report.selectedRoots.length) {
    report.warnings.push('Aucun dossier source accessible. Aucune photo importée.');
  }

  if (!args.apply) {
    report.warnings.push('Mode DRY-RUN: aucune base existante n\'a été remplacée. Utilisez --apply pour appliquer la reconstruction.');
  }

  let finalPhotosCount = 0;
  let finalDoneCount = 0;
  let finalPendingCount = 0;

  try {
    finalPhotosCount = newDb.prepare('SELECT COUNT(*) as cnt FROM photos').get().cnt;
    finalDoneCount = newDb.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status='done'").get().cnt;
    finalPendingCount = newDb.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status='pending'").get().cnt;
  } catch (err) {
    report.errors.push(`Erreur de vérification des compteurs: ${err instanceof Error ? err.message : String(err)}`);
  }

  oldDb.close();
  newDb.pragma('wal_checkpoint(FULL)');
  newDb.close();

  if (args.apply) {
    const preservedPath = `${args.dbPath}.pre-rebuild-${stamp}`;
    report.oldDbPreservedPath = preservedPath;

    fs.renameSync(args.dbPath, preservedPath);
    try {
      fs.renameSync(report.newDbWorkingPath, args.dbPath);
    } catch (swapErr) {
      fs.renameSync(preservedPath, args.dbPath);
      throw new Error(`Échec du remplacement de la DB (rollback effectué): ${swapErr instanceof Error ? swapErr.message : String(swapErr)}`);
    }
  } else {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${report.newDbWorkingPath}${suffix}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

  const endedAt = new Date();
  const duration = ((endedAt.getTime() - startedAt.getTime()) / 1000).toFixed(2);

  writeReport(args.reportPath, [
    '=== RAPPORT REBUILD DB FROM EXIF ===',
    '',
    `Date de début : ${formatDate(startedAt)}`,
    `Date de fin   : ${formatDate(endedAt)}`,
    `Durée         : ${duration} s`,
    '',
    '--- Paramètres ---',
    `DB source/cible      : ${args.dbPath}`,
    `Mode                 : ${args.apply ? 'APPLY (reconstruction appliquée)' : 'DRY-RUN (audit seulement)'}`,
    `Strict EXIF only     : ${args.strictExifOnly ? 'Oui' : 'Non (fallback DB actif)'}`,
    `Dossiers source      : ${report.selectedRoots.join(' ; ') || '(aucun)'}`,
    '',
    '--- Sécurité / sauvegardes ---',
    `Backup DB            : ${report.backupPath}`,
    `DB de travail        : ${report.newDbWorkingPath}`,
    `Ancienne DB préservée: ${report.oldDbPreservedPath || '(non remplacée en dry-run)'}`,
    '',
    '--- Audit EXIF ↔ DB (avant reconstruction) ---',
    `Photos scannées                : ${report.scannedFiles}`,
    `Photos avec tags EXIF          : ${report.exifTaggedCount}`,
    `Photos avec tags en DB legacy  : ${report.oldDbTaggedCount}`,
    `Tags EXIF = DB                 : ${report.tagsMatchCount}`,
    `Tags EXIF présents mais DB vide: ${report.exifTaggedButDbMissing}`,
    `DB taggée mais EXIF vide       : ${report.dbTaggedButExifMissing}`,
    `Mismatches EXIF vs DB          : ${report.tagMismatchCount}`,
    `Erreurs lecture EXIF           : ${report.exifReadErrors}`,
    '',
    '--- Résultat reconstruction ---',
    `Importées en processed (done): ${report.importedProcessed}`,
    `  - depuis EXIF              : ${report.processedFromExif}`,
    `  - fallback DB legacy       : ${report.processedFromDbFallback}`,
    `Importées en pending         : ${report.importedPending}`,
    `Doublons chemin ignorés      : ${report.skippedDuplicatesByPath}`,
    '',
    '--- Vérification DB reconstruite ---',
    `Photos totales: ${finalPhotosCount}`,
    `Done         : ${finalDoneCount}`,
    `Pending      : ${finalPendingCount}`,
    '',
    '--- Dossiers inaccessibles ---',
    ...(report.inaccessibleRoots.length ? report.inaccessibleRoots : ['Aucun']),
    '',
    '--- Avertissements ---',
    ...(report.warnings.length ? report.warnings : ['Aucun']),
    '',
    '--- Erreurs ---',
    ...(report.errors.length ? report.errors : ['Aucune']),
    '',
    'Fin du rapport.',
  ]);

  console.log('');
  console.log('✅ rebuild-db-from-exif terminé');
  console.log(`📄 Rapport: ${args.reportPath}`);
  console.log(`📊 Processed=${report.importedProcessed}, Pending=${report.importedPending}, Scannées=${report.scannedFiles}`);

  if (!args.apply) {
    console.log('ℹ️ Mode DRY-RUN: relancez avec --apply pour appliquer la reconstruction.');
  }
}

main().catch((err) => {
  console.error('❌ Échec rebuild-db-from-exif:', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
