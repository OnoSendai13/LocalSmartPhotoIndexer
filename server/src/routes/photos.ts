import { Hono } from 'hono';
import { getDb } from '../db.js';
import { writeTagsToFile } from '../exif.js';
import path from 'path';
import { existsSync, readFileSync } from 'fs';

export const photosRouter = new Hono();

interface PhotoRow {
  id: string;
  name: string;
  path: string;
  folder_path: string;
  size: number;
  last_modified: number;
  mime_type: string;
  tags: string;
  status: string;
  indexed_at: number | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface Photo {
  id: string;
  name: string;
  path: string;
  folderPath: string;
  size: number;
  lastModified: number;
  mimeType: string;
  tags: string[];
  status: 'pending' | 'processing' | 'done' | 'error';
  indexedAt?: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

function rowToPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    folderPath: row.folder_path,
    size: row.size,
    lastModified: row.last_modified,
    mimeType: row.mime_type,
    tags: JSON.parse(row.tags || '[]'),
    status: row.status as Photo['status'],
    indexedAt: row.indexed_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/photos?status=done&folderPath=...&tag=...
photosRouter.get('/photos', (c) => {
  const db = getDb();
  const status = c.req.query('status');
  const folderPath = c.req.query('folderPath');
  const tag = c.req.query('tag');

  let sql = 'SELECT * FROM photos WHERE 1=1';
  const params: Record<string, unknown> = {};

  if (status) {
    sql += ' AND status = @status';
    params.status = status;
  }
  if (folderPath) {
    sql += ' AND folder_path = @folderPath';
    params.folderPath = folderPath;
  }
  if (tag) {
    sql += ' AND tags LIKE @tag';
    params.tag = `%"${tag}"%`;
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(params) as PhotoRow[];
  return c.json(rows.map(rowToPhoto));
});

// GET /api/photos/:id
photosRouter.get('/photos/:id', (c) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM photos WHERE id = @id').get({ id: c.req.param('id') }) as PhotoRow | undefined;
  if (!row) return c.json({ error: 'Photo not found' }, 404);
  return c.json(rowToPhoto(row));
});

// PUT /api/photos/:id — update tags, status, error_message
photosRouter.put('/photos/:id', async (c) => {
  const db = getDb();
  const body = await c.req.json();
  const id = c.req.param('id');

  const existing = db.prepare('SELECT * FROM photos WHERE id = @id').get({ id }) as PhotoRow | undefined;
  if (!existing) return c.json({ error: 'Photo not found' }, 404);

  const updates: string[] = [];
  const params: Record<string, unknown> = { id };

  if (body.tags !== undefined) {
    updates.push('tags = @tags');
    params.tags = JSON.stringify(body.tags);

    // BUG FIX #3: Use absolute path stored in row.path first; fall back to folder_path + name
    let fullPath = existing.path;
    if (!fullPath || !existsSync(fullPath)) {
      fullPath = path.join(existing.folder_path, existing.name);
    }
    if (existsSync(fullPath)) {
      void writeTagsToFile(fullPath, body.tags);
    } else {
      console.warn(`[EXIF] File not found for EXIF write: ${fullPath}`);
    }
  }
  if (body.status !== undefined) {
    updates.push('status = @status');
    params.status = body.status;
    if (body.status === 'done') {
      updates.push('indexed_at = @indexedAt');
      params.indexedAt = Math.floor(Date.now() / 1000);
    }
  }
  if (body.errorMessage !== undefined) {
    updates.push('error_message = @errorMessage');
    params.errorMessage = body.errorMessage;
  }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  updates.push("updated_at = unixepoch('now')");

  db.prepare(`UPDATE photos SET ${updates.join(', ')} WHERE id = @id`).run(params);

  return c.json({ success: true });
});

// POST /api/photos — upsert photo(s) in batch
// Uses INSERT OR REPLACE so that re-saving a photo (e.g. after AI tagging)
// always updates tags, status, path, etc. — INSERT OR IGNORE silently dropped updates.
photosRouter.post('/photos', async (c) => {
  const db = getDb();
  const body = await c.req.json();
  const photos: Photo[] = Array.isArray(body) ? body : [body];

  const upsert = db.prepare(`
    INSERT INTO photos
      (id, name, path, folder_path, size, last_modified, mime_type, tags, status, indexed_at, error_message, created_at, updated_at)
    VALUES
      (@id, @name, @path, @folderPath, @size, @lastModified, @mimeType, @tags, @status, @indexedAt, @errorMessage, unixepoch('now'), unixepoch('now'))
    ON CONFLICT(id) DO UPDATE SET
      path         = excluded.path,
      folder_path  = excluded.folder_path,
      tags         = excluded.tags,
      status       = excluded.status,
      indexed_at   = excluded.indexed_at,
      error_message= excluded.error_message,
      updated_at   = unixepoch('now')
  `);

  const upsertMany = db.transaction((items: Photo[]) => {
    for (const item of items) {
      upsert.run({
        id: item.id,
        name: item.name,
        path: item.path,
        folderPath: item.folderPath,
        size: item.size,
        lastModified: item.lastModified,
        mimeType: item.mimeType,
        tags: JSON.stringify(item.tags || []),
        status: item.status || 'pending',
        indexedAt: item.indexedAt ? Math.floor(item.indexedAt / 1000) : null,
        errorMessage: item.errorMessage || null,
      });
    }
  });

  upsertMany(photos);

  // Trigger EXIF write for any photos that are 'done' and have tags
  for (const item of photos) {
    if (item.status === 'done' && item.tags && item.tags.length > 0 && item.path) {
      const { writeTagsToFile } = await import('../exif.js');
      void writeTagsToFile(item.path, item.tags);
    }
  }

  return c.json({ success: true, count: photos.length });
});

// DELETE /api/photos/:id
photosRouter.delete('/photos/:id', (c) => {
  const db = getDb();
  db.prepare('DELETE FROM photos WHERE id = @id').run({ id: c.req.param('id') });
  return c.json({ success: true });
});

// POST /api/photos/queue/reset-processing — reset 'processing' -> 'pending' on startup
photosRouter.post('/photos/queue/reset-processing', (c) => {
  const db = getDb();
  const info = db.prepare(
    "UPDATE photos SET status = 'pending', updated_at = unixepoch('now') WHERE status = 'processing'"
  ).run();
  console.log(`[STARTUP] Reset ${info.changes} 'processing' photos back to 'pending'`);
  return c.json({ success: true, reset: info.changes });
});

// GET /api/photos/queue/pending
photosRouter.get('/photos/queue/pending', (c) => {
  const db = getDb();
  const limit = parseInt(c.req.query('limit') || '50');
  const rows = db.prepare(
    "SELECT * FROM photos WHERE status = 'pending' ORDER BY created_at ASC LIMIT @limit"
  ).all({ limit }) as PhotoRow[];
  return c.json(rows.map(rowToPhoto));
});

// GET /api/stats
photosRouter.get('/stats', (c) => {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as count FROM photos').get() as { count: number }).count;
  const indexed = (db.prepare("SELECT COUNT(*) as count FROM photos WHERE status = 'done'").get() as { count: number }).count;
  const pending = (db.prepare("SELECT COUNT(*) as count FROM photos WHERE status = 'pending'").get() as { count: number }).count;
  const errors = (db.prepare("SELECT COUNT(*) as count FROM photos WHERE status = 'error'").get() as { count: number }).count;

  const rows = db.prepare("SELECT tags FROM photos WHERE status = 'done' AND tags != '[]'").all() as { tags: string }[];
  const tagSet = new Set<string>();
  for (const row of rows) {
    try {
      for (const tag of JSON.parse(row.tags) as string[]) tagSet.add(tag);
    } catch { /* skip */ }
  }

  const folders = db.prepare('SELECT DISTINCT folder_path as path, name FROM photos ORDER BY path').all();

  return c.json({
    totalPhotos: total,
    indexedPhotos: indexed,
    pendingPhotos: pending,
    errorPhotos: errors,
    uniqueTags: tagSet.size,
    folders,
  });
});

// GET /api/photos/:id/preview
photosRouter.get('/photos/:id/preview', (c) => {
  try {
    const row = getDb().prepare('SELECT * FROM photos WHERE id = @id').get({ id: c.req.param('id') }) as PhotoRow | undefined;
    if (!row) return c.json({ error: 'Not found' }, 404);

    // row.path is the absolute file path (since watcher fix)
    let fullPath = row.path;
    // Fallback: try folder_path + name if path is just a filename
    if (!fullPath || !existsSync(fullPath)) {
      fullPath = path.join(row.folder_path, row.name);
    }
    if (!fullPath || !existsSync(fullPath)) return c.json({ error: 'File not found' }, 404);

    const buffer = readFileSync(fullPath);
    c.header('Content-Type', row.mime_type);
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(buffer);
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Not found' }, 404);
  }
});

// POST /api/photos/import — bulk import from JSON backup
photosRouter.post('/photos/import', async (c) => {
  const db = getDb();
  const body = await c.req.json<{ photos: Photo[]; settings?: Record<string, unknown> }>();
  let photosImported = 0;

  if (body.photos && Array.isArray(body.photos)) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO photos
        (id, name, path, folder_path, size, last_modified, mime_type, tags, status, indexed_at, error_message)
      VALUES (@id, @name, @path, @folderPath, @size, @lastModified, @mimeType, @tags, @status, @indexedAt, @errorMessage)
    `);
    const tx = db.transaction((items: Photo[]) => {
      for (const item of items) {
        const result = insert.run({
          id: item.id,
          name: item.name,
          path: item.path,
          folderPath: item.folderPath,
          size: item.size,
          lastModified: item.lastModified,
          mimeType: item.mimeType,
          tags: JSON.stringify(item.tags || []),
          status: item.status || 'pending',
          indexedAt: item.indexedAt ? Math.floor(item.indexedAt / 1000) : null,
          errorMessage: item.errorMessage || null,
        });
        if (result.changes > 0) photosImported++;
      }
    });
    tx(body.photos);
  }

  return c.json({ success: true, photosImported });
});

// DELETE /api/photos/all — clear all photos AND folders
photosRouter.delete('/photos/all', (c) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM photos').run();
  db.prepare('DELETE FROM folders').run();
  return c.json({ success: true, deleted: info.changes });
});
