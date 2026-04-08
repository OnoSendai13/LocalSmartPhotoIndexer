import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getDb, isNuking } from '../db.js';
import { scanFolder, stopWatching } from '../watcher.js';
import { existsSync, readdirSync, lstatSync } from 'fs';
import path from 'path';
import os from 'os';

export const foldersRouter = new Hono();

// GET /api/folders
foldersRouter.get('/folders', (c) => {
  const db = getDb();
  const folders = db.prepare('SELECT * FROM folders ORDER BY registered_at DESC').all();
  return c.json(folders);
});

// GET /api/folders/probe?path=... — debug helper: check if a path exists on the server
// Returns what the server can see: exists, platform, cwd, homedir, and nearby entries
foldersRouter.get('/folders/probe', (c) => {
  const inputPath = c.req.query('path') || '';
  const pathExists = inputPath ? existsSync(inputPath) : false;

  const parentPath = inputPath ? path.dirname(inputPath) : '';
  let parentEntries: string[] = [];
  try {
    if (parentPath) parentEntries = readdirSync(parentPath);
  } catch { /* ignore */ }

  return c.json({
    inputPath,
    exists: pathExists,
    platform: process.platform,
    homedir: os.homedir(),
    cwd: process.cwd(),
    parentPath,
    parentEntries,
  });
});

// POST /api/folders/search — find real paths for a folder name on the server
// Searches common photo directories on Windows/Linux/macOS and returns paths that
// actually exist. The frontend uses this to populate an accurate path selector.
foldersRouter.post('/folders/search', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const body = await c.req.json();
  const folderName = (body.folderName || '').trim();
  if (!folderName) return c.json({ error: 'folderName is required' }, 400);

  const platform = os.platform();
  const homedir = os.homedir();
  const candidates = new Set<string>();

  // Always check the exact basename the user provided
  candidates.add(path.join(homedir, folderName));

  if (platform === 'win32') {
    // Windows native: Pictures, Photos, Downloads, Desktop, Documents
    const dirs = ['Pictures', 'Photos', 'Downloads', 'Desktop', 'Documents', 'OneDrive', 'GoogleDrive'];
    for (const dir of dirs) {
      candidates.add(path.join(homedir, dir, folderName));
      // Also WSL mounts
      candidates.add(path.join('/mnt', 'c', 'Users', homedir.split(path.sep).pop() || '', dir, folderName));
    }
  } else {
    // Linux / WSL / macOS
    candidates.add(path.join(homedir, 'Pictures', folderName));
    candidates.add(path.join(homedir, 'Photos', folderName));
    candidates.add(path.join(homedir, 'Images', folderName));
    candidates.add(path.join(homedir, 'Downloads', folderName));
    candidates.add(path.join(homedir, 'Desktop', folderName));
    // WSL: /mnt/c/Users/.../Pictures/folderName — try auto-detect Windows username
    const winUsername = process.env.WSL_USER || process.env.WINDOWS_USER ||
      (() => {
        // Try to parse from home path like /mnt/c/Users/Alice
        const parts = homedir.replace(/\\/g, '/').split('/').filter(Boolean);
        const idx = parts.findIndex((p, i) =>
          p.toLowerCase() === 'mnt' && i + 1 < parts.length && parts[i + 1]?.toLowerCase() === 'c' && parts[i + 2] === 'Users'
        );
        if (idx >= 0) return parts[idx + 3] || '';
        return '';
      })();
    if (winUsername) candidates.add(path.join('/', 'mnt', 'c', 'Users', winUsername, 'Pictures', folderName));
  }

  const validPaths: string[] = [];
  for (const p of candidates) {
    try {
      if (existsSync(p) && lstatSync(p).isDirectory()) {
        validPaths.push(p);
      }
    } catch { /* ignore */ }
  }

  return c.json({
    folderName,
    platform,
    homedir,
    validPaths,
  });
});

// POST /api/folders — register new folder
// If the path doesn't exist on the server filesystem the folder is still registered
// (pathAccessible=false) so the frontend can still use the browser File API for LLM
// processing. EXIF writing will be skipped for inaccessible files.
foldersRouter.post('/folders', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const db = getDb();
  const body = await c.req.json();

  if (!body.path) return c.json({ error: 'Folder path is required' }, 400);

  const folderPath = body.path;
  const pathAccessible = existsSync(folderPath);
  const existing = db.prepare('SELECT * FROM folders WHERE path = @path').get({ path: folderPath }) as { id: string; path: string; name: string } | undefined;

  if (existing) {
    if (pathAccessible) {
      const { newPhotos } = await scanFolder(existing.id, existing.path);
      return c.json({ success: true, id: existing.id, name: existing.name, newPhotos, alreadyRegistered: true, pathAccessible: true });
    }
    // Path not accessible but folder already registered — return without scanning
    return c.json({ success: true, id: existing.id, name: existing.name, newPhotos: 0, alreadyRegistered: true, pathAccessible: false });
  }

  const id = randomUUID();
  const name = body.name || folderPath.split(/[/\\]/).pop() || folderPath;

  db.prepare("INSERT INTO folders (id, path, name, registered_at) VALUES (@id, @path, @name, unixepoch('now'))").run({ id, path: folderPath, name });

  if (!pathAccessible) {
    // Folder registered but backend cannot read it — frontend will use browser File API
    console.warn(`[FOLDER] Path not accessible on server: ${folderPath} (EXIF write disabled)`);
    return c.json({ success: true, id, name, newPhotos: 0, pathAccessible: false });
  }

  try {
    const { newPhotos } = await scanFolder(id, folderPath);
    console.log(`Registered: ${name} -> ${folderPath} (${newPhotos} photos)`);
    return c.json({ success: true, id, name, newPhotos, pathAccessible: true });
  } catch {
    return c.json({ success: true, id, name, newPhotos: 0, pathAccessible: true });
  }
});

// POST /api/folders/:id/scan
foldersRouter.post('/folders/:id/scan', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const db = getDb();
  const folder = db.prepare('SELECT * FROM folders WHERE id = @id').get({ id: c.req.param('id') }) as { id: string; path: string; name: string } | undefined;
  if (!folder) return c.json({ error: 'Folder not found' }, 404);

  const { newPhotos } = await scanFolder(folder.id, folder.path);
  return c.json({ success: true, newPhotos });
});

// DELETE /api/folders/:id
foldersRouter.delete('/folders/:id', (c) => {
  const id = c.req.param('id');
  const folder = getDb().prepare('SELECT * FROM folders WHERE id = @id').get({ id }) as { id: string; path: string } | undefined;
  if (folder) stopWatching(folder.id);
  getDb().prepare('DELETE FROM folders WHERE id = @id').run({ id });
  return c.json({ success: true });
});
