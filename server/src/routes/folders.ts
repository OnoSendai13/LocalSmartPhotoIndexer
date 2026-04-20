import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getDb, isNuking } from '../db.js';
import { scanFolder, stopWatching } from '../watcher.js';
import { access, readdir, lstat } from 'fs/promises';
import path from 'path';
import os from 'os';

export const foldersRouter = new Hono();

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stats = await lstat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

foldersRouter.get('/folders', (c) => {
  const db = getDb();
  const folders = db
    .prepare('SELECT id, path, name, registered_at, last_scanned_at FROM folders ORDER BY registered_at DESC')
    .all();
  return c.json(folders);
});

foldersRouter.get('/folders/probe', async (c) => {
  const inputPath = c.req.query('path') || '';
  const exists = inputPath ? await pathExists(inputPath) : false;

  const parentPath = inputPath ? path.dirname(inputPath) : '';
  let parentEntries: string[] = [];
  try {
    if (parentPath) parentEntries = await readdir(parentPath);
  } catch {
    // ignore
  }

  return c.json({
    inputPath,
    exists,
    platform: process.platform,
    homedir: os.homedir(),
    cwd: process.cwd(),
    parentPath,
    parentEntries,
  });
});

foldersRouter.post('/folders/search', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const body = await c.req.json();
  const folderName = (body.folderName || '').trim();
  if (!folderName) return c.json({ error: 'folderName is required' }, 400);

  const platform = os.platform();
  const homedir = os.homedir();
  const candidates = new Set<string>();

  candidates.add(path.join(homedir, folderName));

  if (platform === 'win32') {
    const dirs = ['Pictures', 'Photos', 'Downloads', 'Desktop', 'Documents', 'OneDrive', 'GoogleDrive'];
    for (const dir of dirs) {
      candidates.add(path.join(homedir, dir, folderName));
      candidates.add(path.join('/mnt', 'c', 'Users', homedir.split(path.sep).pop() || '', dir, folderName));
    }
  } else {
    candidates.add(path.join(homedir, 'Pictures', folderName));
    candidates.add(path.join(homedir, 'Photos', folderName));
    candidates.add(path.join(homedir, 'Images', folderName));
    candidates.add(path.join(homedir, 'Downloads', folderName));
    candidates.add(path.join(homedir, 'Desktop', folderName));

    const winUsername = process.env.WSL_USER ||
      process.env.WINDOWS_USER ||
      (() => {
        const parts = homedir.replace(/\\/g, '/').split('/').filter(Boolean);
        const idx = parts.findIndex(
          (p, i) => p.toLowerCase() === 'mnt' && i + 1 < parts.length && parts[i + 1]?.toLowerCase() === 'c' && parts[i + 2] === 'Users',
        );
        if (idx >= 0) return parts[idx + 3] || '';
        return '';
      })();

    if (winUsername) candidates.add(path.join('/', 'mnt', 'c', 'Users', winUsername, 'Pictures', folderName));
  }

  const validPaths: string[] = [];
  for (const p of candidates) {
    if ((await pathExists(p)) && (await isDirectory(p))) {
      validPaths.push(p);
    }
  }

  return c.json({ folderName, platform, homedir, validPaths });
});

foldersRouter.post('/folders', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const db = getDb();
  const body = await c.req.json();

  if (!body.path) return c.json({ error: 'Folder path is required' }, 400);

  const folderPath = body.path;
  const accessible = await pathExists(folderPath);
  const existing = db
    .prepare('SELECT id, path, name FROM folders WHERE path = @path')
    .get({ path: folderPath }) as { id: string; path: string; name: string } | undefined;

  if (existing) {
    if (accessible) {
      const { newPhotos } = await scanFolder(existing.id, existing.path);
      return c.json({
        success: true,
        id: existing.id,
        name: existing.name,
        newPhotos,
        alreadyRegistered: true,
        pathAccessible: true,
      });
    }
    return c.json({
      success: true,
      id: existing.id,
      name: existing.name,
      newPhotos: 0,
      alreadyRegistered: true,
      pathAccessible: false,
    });
  }

  const id = randomUUID();
  const name = body.name || folderPath.split(/[/\\]/).pop() || folderPath;

  db.prepare("INSERT INTO folders (id, path, name, registered_at) VALUES (@id, @path, @name, unixepoch('now'))").run({
    id,
    path: folderPath,
    name,
  });

  if (!accessible) {
    console.warn(`[FOLDER] Path not accessible on server: ${folderPath} (EXIF write disabled)`);
    return c.json({ success: true, id, name, newPhotos: 0, pathAccessible: false });
  }

  try {
    const { newPhotos } = await scanFolder(id, folderPath);
    return c.json({ success: true, id, name, newPhotos, pathAccessible: true });
  } catch {
    return c.json({ success: true, id, name, newPhotos: 0, pathAccessible: true });
  }
});

foldersRouter.post('/folders/:id/scan', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const db = getDb();
  const folder = db
    .prepare('SELECT id, path, name FROM folders WHERE id = @id')
    .get({ id: c.req.param('id') }) as { id: string; path: string; name: string } | undefined;
  if (!folder) return c.json({ error: 'Folder not found' }, 404);

  const { newPhotos } = await scanFolder(folder.id, folder.path);
  return c.json({ success: true, newPhotos });
});

foldersRouter.delete('/folders/:id', (c) => {
  const id = c.req.param('id');
  const folder = getDb().prepare('SELECT id, path FROM folders WHERE id = @id').get({ id }) as { id: string; path: string } | undefined;
  if (folder) void stopWatching(folder.id);
  getDb().prepare('DELETE FROM folders WHERE id = @id').run({ id });
  return c.json({ success: true });
});
