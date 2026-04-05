import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getDb } from '../db.js';
import { scanFolder } from '../watcher.js';
import { existsSync, readdirSync } from 'fs';
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
  const exists = inputPath ? existsSync(inputPath) : false;

  // Try to list parent directory so the user knows what names are available
  let parentEntries: string[] = [];
  let parentPath = '';
  if (inputPath) {
    parentPath = path.dirname(inputPath);
    try {
      parentEntries = readdirSync(parentPath);
    } catch {
      parentEntries = [];
    }
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

// POST /api/folders — register new folder
// If the path doesn't exist on the server filesystem the folder is still registered
// (pathAccessible=false) so the frontend can still use the browser File API for LLM
// processing. EXIF writing will be skipped for inaccessible files.
foldersRouter.post('/folders', async (c) => {
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
  const db = getDb();
  const folder = db.prepare('SELECT * FROM folders WHERE id = @id').get({ id: c.req.param('id') }) as { id: string; path: string; name: string } | undefined;
  if (!folder) return c.json({ error: 'Folder not found' }, 404);

  const { newPhotos } = await scanFolder(folder.id, folder.path);
  return c.json({ success: true, newPhotos });
});

// DELETE /api/folders/:id
foldersRouter.delete('/folders/:id', (c) => {
  getDb().prepare('DELETE FROM folders WHERE id = @id').run({ id: c.req.param('id') });
  return c.json({ success: true });
});
