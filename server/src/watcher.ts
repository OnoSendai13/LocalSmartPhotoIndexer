import { watch } from 'chokidar';
import { stat, access, readdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getDb, isNuking } from './db.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const SCAN_INTERVAL_MS = 5 * 60 * 1000;

const watchers = new Map<string, ReturnType<typeof watch>>();
let periodicInterval: ReturnType<typeof setInterval> | null = null;

function getMimeType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return map[ext] || 'image/jpeg';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function addPhoto(folderPath: string, fullPath: string): Promise<boolean> {
  if (isNuking()) return false;

  try {
    const db = getDb();
    const name = fullPath.split(/[/\\]/).pop() || fullPath;

    const existing = db
      .prepare('SELECT id FROM photos WHERE folder_path = @fp AND name = @n')
      .get({ fp: folderPath, n: name });
    if (existing) return false;

    const stats = await stat(fullPath).catch(() => null);
    if (!stats) return false;

    db.prepare(`
      INSERT INTO photos (id, name, path, folder_path, size, last_modified, mime_type, tags, status)
      VALUES (@id, @n, @rp, @fp, @sz, @lm, @mt, '[]', 'pending')
    `).run({
      id: randomUUID(),
      n: name,
      rp: fullPath,
      fp: folderPath,
      sz: stats.size,
      lm: Math.floor(stats.mtimeMs),
      mt: getMimeType(name),
    });

    return true;
  } catch (err) {
    console.error(`[WATCHER] Failed to add photo ${fullPath}:`, err);
    return false;
  }
}

export async function scanFolder(folderId: string, folderPath: string): Promise<{ newPhotos: number }> {
  if (isNuking()) return { newPhotos: 0 };

  const { isProcessorRunning } = await import('./processor.js');
  if (isProcessorRunning()) return { newPhotos: 0 };

  let db;
  try {
    db = getDb();
  } catch {
    return { newPhotos: 0 };
  }

  if (!(await fileExists(folderPath))) return { newPhotos: 0 };

  console.log(`🔍 Scanning: ${folderPath}`);
  let newPhotos = 0;

  const scanDir = async (dirPath: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await scanDir(full);
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext) && (await addPhoto(folderPath, full))) newPhotos++;
      }
    }
  };

  try {
    await scanDir(folderPath);
    db.prepare("UPDATE folders SET last_scanned_at = unixepoch('now') WHERE id = @id").run({ id: folderId });
  } catch (err) {
    console.error(`[WATCHER] Error during scan of ${folderPath}:`, err);
  }

  console.log(`✅ Scan done: ${newPhotos} new in ${folderPath}`);
  return { newPhotos };
}

export function startWatching(folderId: string, folderPath: string) {
  void stopWatching(folderId);

  const watcher = watch(folderPath, {
    ignored: (p: string) => !IMAGE_EXTENSIONS.has(p.slice(p.lastIndexOf('.')).toLowerCase()),
    ignoreInitial: true,
    depth: 99,
  });

  watcher.on('add', (p: string) => {
    void addPhoto(folderPath, p);
  });

  watcher.on('unlink', (p: string) => {
    if (isNuking()) return;
    try {
      const name = p.split(/[\/\\]/).pop();
      if (name) getDb().prepare('DELETE FROM photos WHERE folder_path = @fp AND name = @n').run({ fp: folderPath, n: name });
    } catch (err) {
      console.error(`[WATCHER] Failed to remove photo ${p}:`, err);
    }
  });

  watchers.set(folderId, watcher);
}

export async function stopWatching(folderId: string) {
  const w = watchers.get(folderId);
  if (w) {
    await w.close();
    watchers.delete(folderId);
  }
}

export async function stopAllWatchers() {
  const promises: Promise<void>[] = [];
  for (const id of watchers.keys()) {
    promises.push(stopWatching(id));
  }
  await Promise.all(promises);
  if (periodicInterval) {
    clearInterval(periodicInterval);
    periodicInterval = null;
  }
}

export async function resetWatchers() {
  await stopAllWatchers();
  watchers.clear();
}

export function startAllWatchers() {
  const folders = getDb().prepare('SELECT id, path FROM folders').all() as { id: string; path: string }[];
  for (const f of folders) startWatching(f.id, f.path);
}

export function startPeriodicScans() {
  if (periodicInterval) return;

  const runScans = async () => {
    try {
      const folders = getDb().prepare('SELECT id, path FROM folders').all() as { id: string; path: string }[];
      for (const f of folders) {
        await scanFolder(f.id, f.path).catch((err) => {
          console.error(`[WATCHER] Periodic scan error for folder "${f.path}":`, err);
        });
      }
    } catch (err) {
      console.error('[WATCHER] Failed to fetch folders for periodic scan:', err);
    }
  };

  periodicInterval = setInterval(() => {
    void runScans();
  }, SCAN_INTERVAL_MS);
}
