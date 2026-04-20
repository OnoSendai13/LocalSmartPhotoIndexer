#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'data', 'photo-index.db');

function isTrulyAbsolute(p) {
  if (!p) return false;
  return path.isAbsolute(p) || path.win32.isAbsolute(p) || path.posix.isAbsolute(p);
}

function buildCandidatePaths(photo) {
  const seen = new Set();
  const candidates = [];

  const add = (candidate) => {
    if (!candidate || typeof candidate !== 'string') return;
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  add(photo.path);

  if (photo.path && photo.folder_path && !isTrulyAbsolute(photo.path)) {
    add(path.join(photo.folder_path, photo.path));
    add(path.win32.join(photo.folder_path, photo.path));
    add(path.posix.join(photo.folder_path, photo.path));
  }

  if (photo.folder_path && photo.name) {
    add(path.join(photo.folder_path, photo.name));
    add(path.win32.join(photo.folder_path, photo.name));
    add(path.posix.join(photo.folder_path, photo.name));
  }

  return candidates;
}

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function run() {
  console.log('='.repeat(80));
  console.log('DIAGNOSTIC PHOTOS - LocalSmartPhotoIndexer');
  console.log('='.repeat(80));
  console.log(`Base de données: ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.error('❌ Base de données introuvable.');
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    const statusRows = db
      .prepare('SELECT status, COUNT(*) AS count FROM photos GROUP BY status ORDER BY count DESC, status ASC')
      .all();

    console.log('\n### Comptage par statut');
    if (statusRows.length === 0) {
      console.log('Aucune photo dans la table photos.');
    } else {
      for (const row of statusRows) {
        console.log(`- ${String(row.status).padEnd(12, ' ')} : ${row.count}`);
      }
    }

    const sampleRows = db
      .prepare(`
        SELECT id, name, path, folder_path, status, error_message
        FROM photos
        WHERE status IN ('pending', 'error')
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 10
      `)
      .all();

    console.log('\n### Échantillon (10 photos pending/error)');
    if (sampleRows.length === 0) {
      console.log("Aucune photo avec status='pending' ou status='error'.");
      return;
    }

    sampleRows.forEach((photo, index) => {
      const candidates = buildCandidatePaths(photo);
      const existing = firstExistingPath(candidates);
      const builtPath = candidates[0] || '(aucun chemin construit)';

      console.log(`\n[${index + 1}] id=${photo.id} | status=${photo.status}`);
      console.log(`  folder_path        : ${photo.folder_path || '(vide)'}`);
      console.log(`  name               : ${photo.name || '(vide)'}`);
      console.log(`  path (DB)          : ${photo.path || '(vide)'}`);
      console.log(`  chemin construit   : ${builtPath}`);
      console.log(`  existe (builtPath) : ${builtPath !== '(aucun chemin construit)' ? fs.existsSync(builtPath) : false}`);
      console.log(`  premier existant   : ${existing || 'AUCUN'}`);
      if (photo.error_message) {
        console.log(`  error_message      : ${photo.error_message}`);
      }

      if (candidates.length > 1) {
        console.log('  candidats testés   :');
        for (const c of candidates) {
          console.log(`    - ${c} => ${fs.existsSync(c)}`);
        }
      }
    });
  } finally {
    db.close();
  }

  console.log('\n✅ Diagnostic terminé.');
}

run();
