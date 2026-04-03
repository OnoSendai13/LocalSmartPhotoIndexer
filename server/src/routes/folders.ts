import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getDb } from '../db.js';
import { scanFolder } from '../watcher.js';
import { existsSync } from 'fs';

export const foldersRouter = new Hono();

// GET /api/folders
foldersRouter.get('/folders', (c) => {
  const db = getDb();
  const folders = db.prepare('SELECT * FROM folders ORDER BY registered_at DESC').all();
  return c.json(folders);
});

// POST /api/folders — register new folder
foldersRouter.post('/folders', async (c) => {
  const db = getDb();
  const body = await c.req.json();

  if (!body.path) return c.json({ error: 'Folder path is required' }, 400);

  const folderPath = body.path;
  const existing = db.prepare('SELECT * FROM folders WHERE path = ?').get(folderPath) as { id: string; path: string; name: string } | undefined;

  if (existing) {
    if (existsSync(folderPath)) {
      const { newPhotos } = await scanFolder(existing.id, existing.path);
      return c.json({ success: true, id: existing.id, name: existing.name, newPhotos, alreadyRegistered: true });
    }
    return c.json({ success: true, id: existing.id, name: existing.name, alreadyRegistered: true });
  }

  if (!existsSync(folderPath)) return c.json({ error: `Folder not found: ${folderPath}` }, 400);

  const id = randomUUID();
  const name = body.name || folderPath.split(/[/\\]/).pop() || folderPath;

  db.prepare('INSERT INTO folders (id, path, name, registered_at) VALUES (?, ?, ?, unixepoch(\'now\'))').run(id, folderPath, name);

  try {
    const { newPhotos } = await scanFolder(id, folderPath);
    console.log(`📁 Registered: ${name} → ${folderPath} (${newPhotos} photos)`);
    return c.json({ success: true, id, name, newPhotos });
  } catch {
    return c.json({ success: true, id, name, newPhotos: 0 });
  }
});

// POST /api/folders/:id/scan
foldersRouter.post('/folders/:id/scan', async (c) => {
  const db = getDb();
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(c.req.param('id')) as { id: string; path: string; name: string } | undefined;
  if (!folder) return c.json({ error: 'Folder not found' }, 404);

  const { newPhotos } = await scanFolder(folder.id, folder.path);
  return c.json({ success: true, newPhotos });
});

// DELETE /api/folders/:id
foldersRouter.delete('/folders/:id', (c) => {
  getDb().prepare('DELETE FROM folders WHERE id = ?').run(c.req.param('id'));
  return c.json({ success: true });
});
