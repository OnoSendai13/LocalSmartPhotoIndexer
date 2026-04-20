import { Hono } from 'hono';
import { getDb, nukeDb, isNuking, restoreDb, getBackupInfo, backupDb, getDbPath } from '../db.js';
import { writeTagsToFile, readTagsFromFile } from '../exif.js';
import { resetWatchers, startAllWatchers, startPeriodicScans } from '../watcher.js';
import path from 'path';
import { access, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';

export const photosRouter = new Hono();

const PHOTO_COLUMNS = `
  id,
  name,
  path,
  folder_path,
  size,
  last_modified,
  mime_type,
  tags,
  status,
  thumbnail,
  indexed_at,
  error_message,
  created_at,
  updated_at
`;

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toPublicThumbnailUrl(photoId: string, thumbnailPath: string | null): string | undefined {
  if (!thumbnailPath) return undefined;
  return `/api/photos/${encodeURIComponent(photoId)}/thumbnail`;
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
    thumbnail: toPublicThumbnailUrl(row.id, row.thumbnail),
    indexedAt: row.indexed_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

photosRouter.get('/photos', (c) => {
  const db = getDb();
  const status = c.req.query('status');
  const folderPath = c.req.query('folderPath');
  const tag = c.req.query('tag');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  let sql = `SELECT ${PHOTO_COLUMNS} FROM photos WHERE 1=1`;
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

  sql += ' ORDER BY created_at DESC LIMIT @limit OFFSET @offset';
  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(sql).all(params) as PhotoRow[];
  return c.json(rows.map(rowToPhoto));
});

photosRouter.get('/photos/count', (c) => {
  const db = getDb();
  const status = c.req.query('status');
  const folderPath = c.req.query('folderPath');

  let sql = 'SELECT COUNT(*) as cnt FROM photos WHERE 1=1';
  const params: Record<string, unknown> = {};

  if (status) {
    sql += ' AND status = @status';
    params.status = status;
  }
  if (folderPath) {
    sql += ' AND folder_path = @folderPath';
    params.folderPath = folderPath;
  }

  const result = db.prepare(sql).get(params) as { cnt: number };
  return c.json({ total: result.cnt });
});

photosRouter.get('/photos/tags', (c) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT tags FROM photos WHERE status = 'done' AND tags != '[]'")
    .all() as { tags: string }[];

  const tagCounts = new Map<string, number>();
  for (const row of rows) {
    try {
      const tags: string[] = JSON.parse(row.tags);
      for (const tag of tags) {
        if (tag && tag !== 'Uncategorized' && tag !== 'Error-EmptyResponse') {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    } catch {
      // ignore malformed
    }
  }

  const result = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return c.json(result);
});

photosRouter.get('/photos/:id', (c) => {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = @id`)
    .get({ id: c.req.param('id') }) as PhotoRow | undefined;
  if (!row) return c.json({ error: 'Photo not found' }, 404);
  return c.json(rowToPhoto(row));
});

photosRouter.put('/photos/:id', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const db = getDb();
  const body = await c.req.json();
  const id = c.req.param('id');

  const existing = db
    .prepare(`SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = @id`)
    .get({ id }) as PhotoRow | undefined;
  if (!existing) return c.json({ error: 'Photo not found' }, 404);

  const updates: string[] = [];
  const params: Record<string, unknown> = { id };

  if (body.tags !== undefined) {
    updates.push('tags = @tags');
    params.tags = JSON.stringify(body.tags);

    let fullPath = existing.path;
    if (!fullPath || !(await fileExists(fullPath))) {
      fullPath = path.join(existing.folder_path, existing.name);
    }
    if (await fileExists(fullPath)) {
      void writeTagsToFile(fullPath, body.tags);
    }
  }

  if (body.thumbnail !== undefined) {
    updates.push('thumbnail = @thumbnail');
    params.thumbnail = typeof body.thumbnail === 'string' ? body.thumbnail : null;
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

photosRouter.post('/photos', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const db = getDb();
  const body = await c.req.json();
  const photos: Photo[] = Array.isArray(body) ? body : [body];

  const upsert = db.prepare(`
    INSERT INTO photos
      (id, name, path, folder_path, size, last_modified, mime_type, tags, status, thumbnail, indexed_at, error_message, created_at, updated_at)
    VALUES
      (@id, @name, @path, @folderPath, @size, @lastModified, @mimeType, @tags, @status, @thumbnail, @indexedAt, @errorMessage, unixepoch('now'), unixepoch('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      folder_path = excluded.folder_path,
      size = excluded.size,
      last_modified = excluded.last_modified,
      mime_type = excluded.mime_type,
      tags = excluded.tags,
      status = excluded.status,
      thumbnail = COALESCE(excluded.thumbnail, photos.thumbnail),
      indexed_at = excluded.indexed_at,
      error_message = excluded.error_message,
      updated_at = unixepoch('now')
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

  for (const item of photos) {
    if (item.status === 'done' && item.tags && item.tags.length > 0) {
      let filePath = item.path;
      if (!filePath || !(await fileExists(filePath))) {
        filePath = path.join(item.folderPath, item.name);
      }
      if (filePath && (await fileExists(filePath))) {
        void writeTagsToFile(filePath, item.tags);
      }
    }
  }

  return c.json({ success: true, count: photos.length });
});

photosRouter.delete('/photos/:id', (c) => {
  const db = getDb();
  db.prepare('DELETE FROM photos WHERE id = @id').run({ id: c.req.param('id') });
  return c.json({ success: true });
});

photosRouter.post('/photos/queue/reset-processing', (c) => {
  const db = getDb();
  const info = db
    .prepare("UPDATE photos SET status = 'pending', updated_at = unixepoch('now') WHERE status = 'processing'")
    .run() as { changes: number };
  return c.json({ success: true, reset: info.changes });
});

photosRouter.get('/photos/queue/pending', (c) => {
  const db = getDb();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const rows = db
    .prepare(`
      SELECT ${PHOTO_COLUMNS}
      FROM photos
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT @limit
    `)
    .all({ limit }) as PhotoRow[];
  return c.json(rows.map(rowToPhoto));
});

photosRouter.get('/stats', async (c) => {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as count FROM photos').get() as { count: number }).count;
  const indexed = (db.prepare("SELECT COUNT(*) as count FROM photos WHERE status = 'done'").get() as { count: number }).count;
  const pending = (db.prepare("SELECT COUNT(*) as count FROM photos WHERE status = 'pending'").get() as { count: number }).count;
  const errors = (db.prepare("SELECT COUNT(*) as count FROM photos WHERE status = 'error'").get() as { count: number }).count;
  const processing = (db.prepare("SELECT COUNT(*) as count FROM photos WHERE status = 'processing'").get() as { count: number }).count;

  const rows = db.prepare("SELECT tags FROM photos WHERE status = 'done' AND tags != '[]'").all() as { tags: string }[];
  const tagSet = new Set<string>();
  for (const row of rows) {
    try {
      for (const tag of JSON.parse(row.tags) as string[]) tagSet.add(tag);
    } catch {
      // ignore
    }
  }

  const folders = db
    .prepare('SELECT path, name FROM folders ORDER BY registered_at DESC')
    .all() as { path: string; name: string }[];

  let dbFileSize = 0;
  let dbFileExists = false;
  try {
    const info = await stat(getDbPath());
    dbFileSize = info.size;
    dbFileExists = true;
  } catch {
    // ignore
  }

  const avgPhotoSize = total > 0 ? Math.round(dbFileSize / total) : 0;
  const health: 'ok' | 'warning' | 'critical' =
    dbFileSize === 0 ? 'ok' : avgPhotoSize > 100000 ? 'critical' : avgPhotoSize > 50000 ? 'warning' : 'ok';

  return c.json({
    totalPhotos: total,
    indexedPhotos: indexed,
    pendingPhotos: pending,
    errorPhotos: errors,
    processingPhotos: processing,
    uniqueTags: tagSet.size,
    folders,
    db: {
      fileSizeBytes: dbFileSize,
      fileSizeKB: Math.round(dbFileSize / 1024),
      fileSizeMB: (dbFileSize / (1024 * 1024)).toFixed(2),
      avgPhotoSizeBytes: avgPhotoSize,
      exists: dbFileExists,
      health,
    },
  });
});

photosRouter.get('/photos/:id/thumbnail', async (c) => {
  const row = getDb()
    .prepare('SELECT id, thumbnail FROM photos WHERE id = @id')
    .get({ id: c.req.param('id') }) as { id: string; thumbnail: string | null } | undefined;

  if (!row || !row.thumbnail) return c.json({ error: 'Thumbnail not found' }, 404);

  if (!(await fileExists(row.thumbnail))) return c.json({ error: 'Thumbnail file missing' }, 404);

  const buffer = await readFile(row.thumbnail);
  c.header('Content-Type', 'image/jpeg');
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(buffer);
});

photosRouter.get('/photos/:id/preview', async (c) => {
  try {
    const row = getDb()
      .prepare('SELECT id, name, path, folder_path, mime_type, thumbnail FROM photos WHERE id = @id')
      .get({ id: c.req.param('id') }) as
      | { id: string; name: string; path: string; folder_path: string; mime_type: string; thumbnail: string | null }
      | undefined;

    if (!row) return c.json({ error: 'Not found' }, 404);

    let fullPath = row.path;
    if (!fullPath || !(await fileExists(fullPath))) {
      fullPath = path.join(row.folder_path, row.name);
    }

    if (fullPath && (await fileExists(fullPath))) {
      const buffer = await readFile(fullPath);
      c.header('Content-Type', row.mime_type);
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(buffer);
    }

    if (row.thumbnail && (await fileExists(row.thumbnail))) {
      const buf = await readFile(row.thumbnail);
      c.header('Content-Type', 'image/jpeg');
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(buf);
    }

    return c.json({ error: 'File not found and no thumbnail available' }, 404);
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Not found' }, 404);
  }
});

photosRouter.post('/photos/import', async (c) => {
  if (isNuking()) return c.json({ error: 'Operation blocked — database is being cleared' }, 503);

  const db = getDb();
  const body = await c.req.json<{ photos: Photo[]; settings?: Record<string, unknown> }>();
  let photosImported = 0;

  if (body.photos && Array.isArray(body.photos)) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO photos
        (id, name, path, folder_path, size, last_modified, mime_type, tags, status, thumbnail, indexed_at, error_message)
      VALUES (@id, @name, @path, @folderPath, @size, @lastModified, @mimeType, @tags, @status, @thumbnail, @indexedAt, @errorMessage)
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
          thumbnail: item.thumbnail || null,
          indexedAt: item.indexedAt ? Math.floor(item.indexedAt / 1000) : null,
          errorMessage: item.errorMessage || null,
        }) as { changes: number };
        if (result.changes > 0) photosImported++;
      }
    });
    tx(body.photos);
  }

  return c.json({ success: true, photosImported });
});

photosRouter.delete('/photos/all', async (c) => {
  try {
    await resetWatchers();
  } catch (e) {
    console.warn('[CLEAR] resetWatchers error:', e);
  }

  const beforeCount = getDb().prepare('SELECT COUNT(*) as cnt FROM photos').get() as { cnt: number };
  const beforeFolders = getDb().prepare('SELECT COUNT(*) as cnt FROM folders').get() as { cnt: number };

  try {
    await nukeDb();
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }

  return c.json({
    success: true,
    message: 'Database cleared',
    photosCleared: beforeCount.cnt,
    foldersCleared: beforeFolders.cnt,
  });
});

photosRouter.post('/photos/clear-errors', (c) => {
  const db = getDb();
  const errors = db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status = 'error'").get() as { cnt: number };
  const result = db.prepare("DELETE FROM photos WHERE status = 'error'").run() as { changes: number };
  return c.json({ success: true, cleared: result.changes, totalErrors: errors.cnt });
});

photosRouter.post('/photos/reset-all', (c) => {
  const db = getDb();
  const done = db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status = 'done'").get() as { cnt: number };
  const errors = db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status = 'error'").get() as { cnt: number };
  const result = db
    .prepare("UPDATE photos SET status = 'pending', error_message = NULL, updated_at = unixepoch('now') WHERE status IN ('done', 'error')")
    .run() as { changes: number };
  return c.json({ success: true, reset: result.changes, doneCount: done.cnt, errorCount: errors.cnt });
});

photosRouter.post('/photos/reset-errors', (c) => {
  const db = getDb();
  const errors = db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status = 'error'").get() as { cnt: number };
  const result = db
    .prepare("UPDATE photos SET status = 'pending', error_message = NULL, updated_at = unixepoch('now') WHERE status = 'error'")
    .run() as { changes: number };
  return c.json({ success: true, reset: result.changes, errorCount: errors.cnt });
});

photosRouter.post('/photos/sync-exif', async (c) => {
  const db = getDb();

  const body = await c.req
    .json<{ mode?: 'read' | 'write' | 'both'; folderPath?: string }>()
    .catch(() => ({ mode: undefined, folderPath: undefined }));

  const mode = body.mode ?? 'both';
  const folderPath = body.folderPath;

  let sql = `
    SELECT id, name, path, folder_path, tags
    FROM photos
    WHERE path != '' AND path IS NOT NULL
  `;
  const params: Record<string, unknown> = {};
  if (folderPath) {
    sql += ' AND folder_path = @folderPath';
    params.folderPath = folderPath;
  }

  const rows = db.prepare(sql).all(params) as Array<{
    id: string;
    name: string;
    path: string;
    folder_path: string;
    tags: string;
  }>;

  let injected = 0;
  let written = 0;
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
    if (!filePath || !(await fileExists(filePath))) {
      filePath = path.join(row.folder_path, row.name);
    }
    if (!filePath || !(await fileExists(filePath))) {
      missing++;
      continue;
    }

    const dbTags: string[] = JSON.parse(row.tags || '[]');
    const hasDbTags = dbTags.length > 0;

    if ((mode === 'read' || mode === 'both') && !hasDbTags) {
      const fileTags = await readTagsFromFile(filePath);
      if (fileTags.length > 0) {
        updateTags.run({ id: row.id, tags: JSON.stringify(fileTags) });
        injected++;
        continue;
      }
    }

    if ((mode === 'write' || mode === 'both') && hasDbTags) {
      const fileTags = await readTagsFromFile(filePath);
      if (fileTags.length === 0) {
        await writeTagsToFile(filePath, dbTags);
        written++;
      } else {
        skipped++;
      }
    } else if (!hasDbTags) {
      skipped++;
    }
  }

  return c.json({ success: true, injected, written, skipped, missing, total: rows.length });
});

photosRouter.post('/photos/rewrite-exif', async (c) => {
  const db = getDb();
  const body2 = await c.req.json<{ folderPath?: string }>().catch(() => ({ folderPath: undefined }));
  const folderPath = body2.folderPath;

  let sql = "SELECT id, name, path, folder_path, tags FROM photos WHERE tags != '[]' AND tags IS NOT NULL AND path != ''";
  const params: Record<string, unknown> = {};
  if (folderPath) {
    sql += ' AND folder_path = @folderPath';
    params.folderPath = folderPath;
  }

  const rows = db.prepare(sql).all(params) as Array<{ id: string; name: string; path: string; folder_path: string; tags: string }>;
  let written = 0;
  let missing = 0;

  for (const row of rows) {
    let filePath = row.path;
    if (!filePath || !(await fileExists(filePath))) {
      filePath = path.join(row.folder_path, row.name);
    }
    if (!filePath || !(await fileExists(filePath))) {
      missing++;
      continue;
    }
    const tags: string[] = JSON.parse(row.tags || '[]');
    if (tags.length > 0) {
      await writeTagsToFile(filePath, tags);
      written++;
    }
  }

  return c.json({ success: true, written, missing, total: rows.length });
});

photosRouter.post('/photos/analyze', async (c) => {
  try {
    const body = await c.req.json<{
      base64Data: string;
      mimeType: string;
      ollamaUrl?: string;
      model?: string;
    }>();

    if (!body.base64Data) return c.json({ error: 'base64Data is required' }, 400);

    const ollamaUrl = body.ollamaUrl || 'http://localhost:11434';
    const model = body.model || 'minicpm-v';

    const prompt = `/no_think\nWhat do you see in this image? Return ONLY a JSON array of tags.`;

    const requestBody: Record<string, unknown> = {
      model,
      prompt,
      images: [body.base64Data],
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 500,
      },
    };

    if (!model.includes('qwen3-vl')) {
      requestBody.format = 'json';
    }

    const endpoint = `${ollamaUrl.replace(/\/$/, '')}/api/generate`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: `Ollama error: ${response.statusText}`, details: errorText }, response.status as 502);
    }

    const data = await response.json();
    return c.json({ success: true, response: data.response || '', thinking: data.thinking || null });
  } catch (error) {
    return c.json(
      { error: 'Failed to connect to Ollama', details: error instanceof Error ? error.message : 'Unknown error' },
      502,
    );
  }
});

photosRouter.get('/ollama/models', async (c) => {
  try {
    const ollamaUrl = c.req.query('url') || 'http://localhost:11434';
    const endpoint = `${ollamaUrl.replace(/\/$/, '')}/api/tags`;

    const response = await fetch(endpoint);
    if (!response.ok) return c.json({ error: 'Failed to fetch models from Ollama' }, response.status as 502);

    const data = await response.json();
    return c.json({ success: true, models: (data.models || []).map((m: { name: string }) => m.name) });
  } catch (error) {
    return c.json(
      { error: 'Failed to connect to Ollama', details: error instanceof Error ? error.message : 'Unknown error' },
      502,
    );
  }
});

photosRouter.post('/ollama/health', async (c) => {
  try {
    const ollamaUrl = (await c.req.json()).ollamaUrl || 'http://localhost:11434';
    const endpoint = `${ollamaUrl.replace(/\/$/, '')}/api/tags`;

    const response = await fetch(endpoint, { method: 'GET' });
    if (!response.ok) return c.json({ connected: false, error: `HTTP ${response.status}` });

    return c.json({ connected: true });
  } catch (error) {
    return c.json({ connected: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

photosRouter.post('/db/backup', async (c) => {
  try {
    const dbFile = getDbPath();
    const backupFile = `${dbFile}.bak`;

    if (!existsSync(dbFile)) return c.json({ success: false, error: 'Database file not found' }, 404);

    backupDb();
    const stats = await stat(backupFile);

    return c.json({
      success: true,
      message: 'Backup created',
      sizeBytes: stats.size,
      sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
      createdAt: new Date(stats.mtimeMs).toLocaleString(),
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

photosRouter.get('/db/backup-info', (c) => {
  const info = getBackupInfo();
  return c.json(info);
});

photosRouter.post('/db/restore', async (c) => {
  if (isNuking()) {
    return c.json({ success: false, error: 'Operation blocked — database is being cleared' }, 503);
  }

  try {
    await resetWatchers();
  } catch (e) {
    console.warn('[RESTORE] resetWatchers:', e);
  }

  const result = restoreDb();

  if (result.success) {
    try {
      startAllWatchers();
      startPeriodicScans();
    } catch (e) {
      console.warn('[RESTORE] Failed to restart watchers:', e);
    }
  }

  return c.json(result);
});
