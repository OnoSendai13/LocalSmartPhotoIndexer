import { watch } from 'chokidar';
import { statSync, existsSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const SCAN_INTERVAL_MS = 5 * 60 * 1000;

const watchers = new Map<string, ReturnType<typeof watch>>();
let periodicInterval: ReturnType<typeof setInterval> | null = null;

function getMimeType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  return map[ext] || 'image/jpeg';
}

function addPhotoSync(folderId: string, folderPath: string, fullPath: string): boolean {
  const db = getDb();
  const name = fullPath.split(/[\/\\]/).pop() || fullPath;
  const relPath = relative(folderPath, fullPath);
  if (!relPath) return false;

  const existing = db.prepare('SELECT id FROM photos WHERE folder_path = ? AND name = ?').get(folderPath, name);
  if (existing) return false;

  let stats;
  try { stats = statSync(fullPath); } catch { return false; }

  db.prepare(`
    INSERT INTO photos (id, name, path, folder_path, size, last_modified, mime_type, tags, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'pending')
  `).run(randomUUID(), name, relPath, folderPath, stats.size, Math.floor(stats.mtimeMs), getMimeType(name));

  return true;
}

export async function scanFolder(folderId: string, folderPath: string): Promise<{ newPhotos: number }> {
  const db = getDb();
  if (!existsSync(folderPath)) return { newPhotos: 0 };

  console.log(`🔍 Scanning: ${folderPath}`);
  let newPhotos = 0;

  function scanDir(dirPath: string) {
    let entries;
    try { entries = readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) scanDir(full);
      else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext) && addPhotoSync(folderId, folderPath, full)) newPhotos++;
      }
    }
  }

  scanDir(folderPath);
  db.prepare('UPDATE folders SET last_scanned_at = unixepoch(\'now\') WHERE id = ?').run(folderId);
  console.log(`✅ Scan done: ${newPhotos} new in ${folderPath}`);
  return { newPhotos };
}

export function startWatching(folderId: string, folderPath: string) {
  stopWatching(folderId);
  const watcher = watch(folderPath, {
    ignored: (p: string) => !IMAGE_EXTENSIONS.has(p.slice(p.lastIndexOf('.')).toLowerCase()),
    ignoreInitial: true,
    depth: 99,
  });
  watcher.on('add', (p: string) => addPhotoSync(folderId, folderPath, p));
  watcher.on('unlink', (p: string) => {
    const name = p.split(/[\/\\]/).pop();
    if (name) getDb().prepare('DELETE FROM photos WHERE folder_path = ? AND name = ?').run(folderPath, name);
  });
  watchers.set(folderId, watcher);
}

export function stopWatching(folderId: string) {
  const w = watchers.get(folderId);
  if (w) { w.close(); watchers.delete(folderId); }
}

export function stopAllWatchers() {
  for (const id of watchers.keys()) stopWatching(id);
  if (periodicInterval) { clearInterval(periodicInterval); periodicInterval = null; }
}

export function startAllWatchers() {
  const folders = getDb().prepare('SELECT * FROM folders').all() as { id: string; path: string }[];
  for (const f of folders) startWatching(f.id, f.path);
}

export function startPeriodicScans() {
  if (periodicInterval) return;
  periodicInterval = setInterval(() => {
    const folders = getDb().prepare('SELECT * FROM folders').all() as { id: string; path: string }[];
    for (const f of folders) scanFolder(f.id, f.path);
  }, SCAN_INTERVAL_MS);
}
