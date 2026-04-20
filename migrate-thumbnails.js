import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = __dirname;
const dataDir = path.join(projectRoot, 'server', 'data');
const dbPath = path.join(dataDir, 'photo-index.db');
const thumbnailsDir = path.join(dataDir, 'thumbnails');
const reportPath = path.join(projectRoot, 'migration-report.txt');

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

function barProgression(index, total, stats) {
  const current = Math.min(index + 1, total);
  const ratio = total > 0 ? current / total : 1;
  const percent = Math.floor(ratio * 100);
  const length = 30;
  const filled = Math.round(ratio * length);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, length - filled))}`;

  const line = `\r[${bar}] ${String(percent).padStart(3, ' ')}% | `
    + `Traitées: ${current}/${total} | Migrées: ${stats.migrated} | `
    + `Déjà fichier: ${stats.alreadyFile} | Erreurs: ${stats.errors}`;

  process.stdout.write(line);

  if (current === total) {
    process.stdout.write('\n');
  }
}

function sanitizeForFilename(value) {
  const safe = String(value)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');

  if (safe.length > 0) return safe;
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function looksLikeFilePath(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  return (
    v.startsWith('\\\\')
    || /^[A-Za-z]:\\/.test(v)
    || v.includes('/')
    || v.includes('\\')
    || /\.(jpg|jpeg|png|webp|gif|bmp|tiff?)$/i.test(v)
  );
}

function extractBase64Payload(thumbnailValue) {
  if (typeof thumbnailValue !== 'string') return null;

  const raw = thumbnailValue.trim();
  if (!raw) return null;

  if (raw.startsWith('data:')) {
    const match = raw.match(/^data:[^;]+;base64,(.+)$/i);
    return match?.[1]?.trim() || null;
  }

  if (looksLikeFilePath(raw)) return null;

  const compact = raw.replace(/\s+/g, '');

  // Heuristique de sécurité: éviter de traiter des chaînes courtes/atypiques comme du base64.
  if (compact.length < 80) return null;
  if (compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return null;

  return compact;
}

function decodeBase64Strict(payload) {
  const buffer = Buffer.from(payload, 'base64');
  if (!buffer || buffer.length === 0) {
    throw new Error('Décodage base64 vide.');
  }

  // Validation simple: un aller-retour base64 doit rester cohérent (sans padding final).
  const normalizedInput = payload.replace(/=+$/, '');
  const normalizedOutput = buffer.toString('base64').replace(/=+$/, '');
  if (!normalizedOutput.startsWith(normalizedInput.slice(0, Math.min(normalizedInput.length, 24)))) {
    throw new Error('Le contenu ne ressemble pas à un base64 valide.');
  }

  return buffer;
}

function loadBetterSqlite3Ctor() {
  const requireHere = createRequire(import.meta.url);

  try {
    return requireHere('better-sqlite3');
  } catch {
    // Fallback: dépendance installée dans /server
    const serverPkgUrl = pathToFileURL(path.join(projectRoot, 'server', 'package.json')).href;
    const requireFromServer = createRequire(serverPkgUrl);
    return requireFromServer('better-sqlite3');
  }
}

function writeReport(content) {
  fs.writeFileSync(reportPath, content, { encoding: 'utf8' });
  success(`Rapport de migration généré: ${reportPath}`);
}

function run() {
  const startedAt = new Date();
  const startedMs = Date.now();

  const stats = {
    totalRowsWithThumbnail: 0,
    base64Detected: 0,
    migrated: 0,
    alreadyFile: 0,
    errors: 0,
    integrityOk: 0,
    integrityFailures: 0,
    remainingBase64: 0,
    vacuumDone: false,
  };

  const migrationErrors = [];
  const integrityErrors = [];
  const migratedRows = [];

  let db = null;
  let backupPath = '';

  try {
    info('Démarrage de la migration des thumbnails (base64 -> fichiers JPEG)...');
    info(`Projet: ${projectRoot}`);

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Base de données introuvable: ${dbPath}`);
    }

    // SAFE: sauvegarde avant toute modification
    backupPath = `${dbPath}.migration-${horodatage()}.bak`;
    fs.copyFileSync(dbPath, backupPath);
    success(`Sauvegarde créée: ${backupPath}`);

    fs.mkdirSync(thumbnailsDir, { recursive: true });
    success(`Dossier thumbnails prêt: ${thumbnailsDir}`);

    const BetterSqlite3 = loadBetterSqlite3Ctor();
    db = new BetterSqlite3(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const rows = db
      .prepare("SELECT id, thumbnail FROM photos WHERE thumbnail IS NOT NULL AND TRIM(thumbnail) <> ''")
      .all();

    stats.totalRowsWithThumbnail = rows.length;

    if (rows.length === 0) {
      warning('Aucune photo avec thumbnail non vide. Rien à migrer.');
    }

    const updateStmt = db.prepare('UPDATE photos SET thumbnail = @thumbnail, updated_at = unixepoch(\'now\') WHERE id = @id');

    info(`Nombre de photos à examiner: ${rows.length}`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const payload = extractBase64Payload(row.thumbnail);

        if (!payload) {
          stats.alreadyFile += 1;
          barProgression(i, rows.length, stats);
          continue;
        }

        stats.base64Detected += 1;

        const buffer = decodeBase64Strict(payload);
        const safeId = sanitizeForFilename(row.id);
        const thumbFileName = `thumb_${safeId}.jpg`;
        const targetPath = path.join(thumbnailsDir, thumbFileName);
        const tmpPath = `${targetPath}.tmp`;

        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, targetPath);

        updateStmt.run({ id: row.id, thumbnail: targetPath });

        migratedRows.push({ id: row.id, path: targetPath });
        stats.migrated += 1;
      } catch (rowError) {
        stats.errors += 1;
        const message = rowError instanceof Error ? rowError.message : String(rowError);
        migrationErrors.push(`[photo id=${row.id}] ${message}`);
      }

      barProgression(i, rows.length, stats);
    }

    info('Contrôle d’intégrité des données migrées...');

    const getThumbnailStmt = db.prepare('SELECT thumbnail FROM photos WHERE id = @id');
    for (const item of migratedRows) {
      const row = getThumbnailStmt.get({ id: item.id });
      const dbValue = row?.thumbnail;

      if (dbValue !== item.path) {
        stats.integrityFailures += 1;
        integrityErrors.push(`[photo id=${item.id}] valeur DB inattendue (${dbValue ?? 'NULL'})`);
        continue;
      }

      if (!fs.existsSync(item.path)) {
        stats.integrityFailures += 1;
        integrityErrors.push(`[photo id=${item.id}] fichier thumbnail manquant (${item.path})`);
        continue;
      }

      const fileSize = fs.statSync(item.path).size;
      if (fileSize <= 0) {
        stats.integrityFailures += 1;
        integrityErrors.push(`[photo id=${item.id}] fichier vide (${item.path})`);
        continue;
      }

      stats.integrityOk += 1;
    }

    const remainingRows = db
      .prepare("SELECT id, thumbnail FROM photos WHERE thumbnail IS NOT NULL AND TRIM(thumbnail) <> ''")
      .all();

    stats.remainingBase64 = remainingRows.reduce((acc, row) => {
      return acc + (extractBase64Payload(row.thumbnail) ? 1 : 0);
    }, 0);

    if (stats.remainingBase64 > 0) {
      warning(`Il reste ${stats.remainingBase64} thumbnails en base64 (non migrés).`);
    }

    info('Exécution de VACUUM pour optimiser la base SQLite...');
    db.exec('VACUUM');
    stats.vacuumDone = true;
    success('VACUUM terminé.');

    const endedAt = new Date();
    const durationSec = ((Date.now() - startedMs) / 1000).toFixed(2);

    const report = [
      '=== RAPPORT DE MIGRATION THUMBNAILS ===',
      '',
      `Date de début : ${formatDate(startedAt)}`,
      `Date de fin   : ${formatDate(endedAt)}`,
      `Durée         : ${durationSec} s`,
      '',
      `Base SQLite   : ${dbPath}`,
      `Sauvegarde    : ${backupPath || '(non créée)'}`,
      `Dossier thumbs: ${thumbnailsDir}`,
      '',
      '--- Résumé ---',
      `Lignes avec thumbnail non vide : ${stats.totalRowsWithThumbnail}`,
      `Thumbnails base64 détectés     : ${stats.base64Detected}`,
      `Thumbnails migrés              : ${stats.migrated}`,
      `Déjà au format fichier         : ${stats.alreadyFile}`,
      `Erreurs de migration           : ${stats.errors}`,
      '',
      '--- Intégrité ---',
      `Contrôles OK                   : ${stats.integrityOk}`,
      `Échecs intégrité               : ${stats.integrityFailures}`,
      `Base64 restants                : ${stats.remainingBase64}`,
      '',
      '--- Optimisation ---',
      `VACUUM exécuté                 : ${stats.vacuumDone ? 'Oui' : 'Non'}`,
      '',
      '--- Détails des erreurs migration ---',
      ...(migrationErrors.length ? migrationErrors : ['Aucune erreur']),
      '',
      '--- Détails des erreurs intégrité ---',
      ...(integrityErrors.length ? integrityErrors : ['Aucune erreur']),
      '',
      'Fin du rapport.',
    ].join('\n');

    writeReport(report);

    if (stats.errors > 0 || stats.integrityFailures > 0 || stats.remainingBase64 > 0) {
      warning('Migration terminée avec avertissements. Consultez migration-report.txt.');
      process.exitCode = 2;
    } else {
      success('Migration terminée avec succès, sans perte détectée.');
      process.exitCode = 0;
    }
  } catch (fatalError) {
    const message = fatalError instanceof Error ? fatalError.stack || fatalError.message : String(fatalError);
    error('Échec de la migration.');
    error(message);

    const report = [
      '=== RAPPORT DE MIGRATION THUMBNAILS ===',
      '',
      `Date : ${formatDate(new Date())}`,
      '',
      'Statut: ÉCHEC FATAL',
      '',
      `Base SQLite   : ${dbPath}`,
      `Sauvegarde    : ${backupPath || '(non créée)'}`,
      `Dossier thumbs: ${thumbnailsDir}`,
      '',
      'Erreur:',
      message,
      '',
      'Conseil: restaurez la sauvegarde .bak si nécessaire.',
    ].join('\n');

    try {
      writeReport(report);
    } catch (reportErr) {
      error(`Impossible d’écrire le rapport: ${String(reportErr)}`);
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
