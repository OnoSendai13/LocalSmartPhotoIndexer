import { Hono } from 'hono';
import { getDb, saveDb, nukeDb, isNuking } from '../db.js';
import { writeTagsToFile } from '../exif.js';
import { resetWatchers } from '../watcher.js';
import path from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';

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
  thumbnail: string | null;
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
  thumbnail?: string;
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
    thumbnail: row.thumbnail ?? undefined,
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
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);
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
  // Accept thumbnail update — only overwrite if a non-empty value is provided
  if (body.thumbnail) {
    updates.push('thumbnail = @thumbnail');
    params.thumbnail = body.thumbnail;
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
// INSERT OR REPLACE handles conflicts on BOTH (id) and (folder_path, name),
// ensuring no duplicate rows regardless of whether the frontend uses DB UUIDs
// or generated IDs (MODE B — path inaccessible).
photosRouter.post('/photos', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);
  const db = getDb();
  const body = await c.req.json();
  const photos: Photo[] = Array.isArray(body) ? body : [body];

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO photos
      (id, name, path, folder_path, size, last_modified, mime_type, tags, status, thumbnail, indexed_at, error_message, created_at, updated_at)
    VALUES
      (@id, @name, @path, @folderPath, @size, @lastModified, @mimeType, @tags, @status,
       COALESCE(@thumbnail, (SELECT thumbnail FROM photos WHERE id=@id)),
       @indexedAt, @errorMessage,
       COALESCE((SELECT created_at FROM photos WHERE id=@id), unixepoch('now')),
       unixepoch('now'))
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
        thumbnail: item.thumbnail || null,
        indexedAt: item.indexedAt ? Math.floor(item.indexedAt / 1000) : null,
        errorMessage: item.errorMessage || null,
      });
    }
  });

  upsertMany(photos);

  // Trigger EXIF write for any photos that are 'done' and have tags
  for (const item of photos) {
    if (item.status === 'done' && item.tags && item.tags.length > 0) {
      let filePath = item.path;
      if (!filePath || !existsSync(filePath)) {
        filePath = path.join(item.folderPath, item.name);
      }
      if (filePath && existsSync(filePath)) {
        const { writeTagsToFile } = await import('../exif.js');
        void writeTagsToFile(filePath, item.tags);
      }
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

    // Try to serve the real file from disk first
    let fullPath = row.path;
    if (!fullPath || !existsSync(fullPath)) {
      fullPath = path.join(row.folder_path, row.name);
    }
    if (fullPath && existsSync(fullPath)) {
      const buffer = readFileSync(fullPath);
      c.header('Content-Type', row.mime_type);
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(buffer);
    }

    // File not on disk (e.g. Windows path, server on different OS) —
    // fall back to the base64 thumbnail stored in the DB.
    if (row.thumbnail) {
      // thumbnail is stored as a data URL: "data:image/jpeg;base64,..."
      const base64 = row.thumbnail.includes(',') ? row.thumbnail.split(',')[1] : row.thumbnail;
      const buf = Buffer.from(base64, 'base64');
      c.header('Content-Type', 'image/jpeg');
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(buf);
    }

    return c.json({ error: 'File not found and no thumbnail available' }, 404);
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Not found' }, 404);
  }
});

// POST /api/photos/import — bulk import from JSON backup
photosRouter.post('/photos/import', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);
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

// DELETE /api/photos/all — wipe everything
photosRouter.delete('/photos/all', async (c) => {
  console.log('[CLEAR] Nuclear clear starting...');

  try { await resetWatchers(); console.log('[CLEAR] Watchers stopped.'); } catch (e) { console.warn('[CLEAR] resetWatchers:', e); }

  // Direct DELETE without transaction wrapper (avoids _inTransaction race)
  const beforeCount = getDb().prepare('SELECT COUNT(*) as cnt FROM photos').get() as { cnt: number };
  console.log(`[CLEAR] Before: ${beforeCount.cnt} photos`);

  getDb().prepare('DELETE FROM photos').run();
  getDb().prepare('DELETE FROM folders').run();

  const afterCount = getDb().prepare('SELECT COUNT(*) as cnt FROM photos').get() as { cnt: number };
  console.log(`[CLEAR] After DELETE: ${afterCount.cnt} photos in memory`);

  saveDb();
  console.log('[CLEAR] saveDb() called');

  // Verify disk
  const { statSync } = await import('fs');
  const { join } = await import('path');
  const dbFile = join(process.cwd(), 'data', 'photo-index.db');
  const diskSize = statSync(dbFile).size;
  console.log(`[CLEAR] Disk file size: ${diskSize} bytes`);

  return c.json({ success: true, message: "V2 - photos cleared", photosBefore: beforeCount.cnt, photosAfter: afterCount.cnt, diskSize });
});

// POST /api/photos/sync-exif
// Reads EXIF/IPTC/XMP tags from each photo file and:
//   1. Injects them into the DB for photos that have no tags yet (status='done' or status='pending' with no tags)
//   2. Re-writes the EXIF metadata for photos that have DB tags but no file metadata
// Returns per-photo results so the frontend can show a summary.
photosRouter.post('/photos/sync-exif', async (c) => {
  const db = getDb();
  const { readTagsFromFile, writeTagsToFile } = await import('../exif.js');
  const { existsSync } = await import('fs');

  const body = await c.req.json<{ mode?: 'read' | 'write' | 'both'; folderPath?: string }>().catch(() => ({ mode: undefined, folderPath: undefined }));
  const mode = (body as { mode?: string }).mode ?? 'both';
  const folderPath = (body as { folderPath?: string }).folderPath;

  // Fetch all photos that have a real absolute path
  let sql = "SELECT * FROM photos WHERE path != '' AND path IS NOT NULL";
  const params: Record<string, unknown> = {};
  if (folderPath) {
    sql += ' AND folder_path = @folderPath';
    params.folderPath = folderPath;
  }
  const rows = db.prepare(sql).all(params) as PhotoRow[];

  let injected = 0;   // tags read from file → saved to DB
  let written = 0;    // tags from DB → written to file
  let skipped = 0;
  let missing = 0;

  const updateTags = db.prepare(`
    UPDATE photos SET
      tags = @tags,
      status = 'done',
      indexed_at = unixepoch('now'),
      updated_at = unixepoch('now')
    WHERE id = @id
  `);

  for (const row of rows) {
    let filePath = row.path;
    if (!filePath || !existsSync(filePath)) {
      filePath = path.join(row.folder_path, row.name);
    }
    if (!filePath || !existsSync(filePath)) { missing++; continue; }

    const dbTags: string[] = JSON.parse(row.tags || '[]');
    const hasDbTags = dbTags.length > 0;

    // READ mode: inject file metadata tags into DB when DB has no tags
    if ((mode === 'read' || mode === 'both') && !hasDbTags) {
      const fileTags = await readTagsFromFile(filePath);
      if (fileTags.length > 0) {
        updateTags.run({ id: row.id, tags: JSON.stringify(fileTags) });
        injected++;
        console.log(`📥 [sync-exif] Injected from file: ${row.name} → [${fileTags.join(', ')}]`);
        continue; // no need to also write back
      }
    }

    // WRITE mode: push DB tags to file when file has no metadata tags
    if ((mode === 'write' || mode === 'both') && hasDbTags) {
      const fileTags = await readTagsFromFile(filePath);
      if (fileTags.length === 0) {
        await writeTagsToFile(filePath, dbTags);
        written++;
        console.log(`📤 [sync-exif] Written to file: ${row.name} → [${dbTags.join(', ')}]`);
      } else {
        skipped++;
      }
    } else if (!hasDbTags) {
      skipped++;
    }
  }

  console.log(`[sync-exif] Done: ${injected} injected, ${written} written, ${skipped} skipped, ${missing} missing`);
  return c.json({ success: true, injected, written, skipped, missing, total: rows.length });
});

// POST /api/photos/rewrite-exif
// Force-rewrites EXIF tags for ALL photos that have tags in DB, regardless of what's on disk.
// Useful after a path migration or first-time setup where files had no metadata.
photosRouter.post('/photos/rewrite-exif', async (c) => {
  const db = getDb();
  const { writeTagsToFile } = await import('../exif.js');
  const { existsSync } = await import('fs');

  const body2 = await c.req.json<{ folderPath?: string }>().catch(() => ({ folderPath: undefined }));
  const folderPath = (body2 as { folderPath?: string }).folderPath;

  let sql = "SELECT * FROM photos WHERE tags != '[]' AND tags IS NOT NULL AND path != ''";
  const params: Record<string, unknown> = {};
  if (folderPath) { sql += ' AND folder_path = @folderPath'; params.folderPath = folderPath; }

  const rows = db.prepare(sql).all(params) as PhotoRow[];
  let written = 0; let missing = 0;

  for (const row of rows) {
    let filePath = row.path;
    if (!filePath || !existsSync(filePath)) {
      filePath = path.join(row.folder_path, row.name);
    }
    if (!filePath || !existsSync(filePath)) { missing++; continue; }
    const tags: string[] = JSON.parse(row.tags || '[]');
    if (tags.length > 0) {
      await writeTagsToFile(filePath, tags);
      written++;
    }
  }

  console.log(`[rewrite-exif] ${written} files updated, ${missing} missing`);
  return c.json({ success: true, written, missing, total: rows.length });
});
