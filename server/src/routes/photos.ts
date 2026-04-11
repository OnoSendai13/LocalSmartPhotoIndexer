import { Hono } from 'hono';
import { getDb, saveDb, nukeDb, isNuking, restoreDb, getBackupInfo } from '../db.js';
import { writeTagsToFile } from '../exif.js';
import { resetWatchers, startAllWatchers, startPeriodicScans } from '../watcher.js';
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

// GET /api/photos?status=done&folderPath=...&tag=...&limit=200&offset=0
photosRouter.get('/photos', (c) => {
  const db = getDb();
  const status = c.req.query('status');
  const folderPath = c.req.query('folderPath');
  const tag = c.req.query('tag');
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 500);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

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

  sql += ' ORDER BY created_at DESC LIMIT @limit OFFSET @offset';
  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(sql).all(params) as PhotoRow[];
  return c.json(rows.map(rowToPhoto));
});

// GET /api/photos/count?status=...&folderPath=... — returns total count for pagination
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

// GET /api/photos/tags — returns all unique tags with counts (for sidebar)
photosRouter.get('/photos/tags', (c) => {
  const db = getDb();
  // Get all tags from done photos
  const rows = db.prepare("SELECT tags FROM photos WHERE status = 'done' AND tags != '[]'").all() as { tags: string }[];
  const tagCounts = new Map<string, number>();
  for (const row of rows) {
    try {
      const tags: string[] = JSON.parse(row.tags);
      for (const tag of tags) {
        if (tag && tag !== 'Uncategorized' && tag !== 'Error-EmptyResponse') {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    } catch { /* skip malformed */ }
  }
  const result = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return c.json(result);
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
    } catch { /* skip */ }
  }

  const folders = db.prepare('SELECT DISTINCT folder_path as path, name FROM photos ORDER BY path').all();

  let dbFileSize = 0;
  let dbFileExists = false;
  try {
    const { statSync, existsSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const dbFile = join(__dirname, '../data', 'photo-index.db');
    dbFileExists = existsSync(dbFile);
    if (dbFileExists) {
      dbFileSize = statSync(dbFile).size;
    }
  } catch { /* ignore */ }

  const avgPhotoSize = total > 0 ? Math.round(dbFileSize / total) : 0;
  const health: 'ok' | 'warning' | 'critical' =
    dbFileSize === 0 ? 'ok' :
    avgPhotoSize > 100000 ? 'critical' :
    avgPhotoSize > 50000 ? 'warning' : 'ok';

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

// DELETE /api/photos/all — wipe everything using nukeDb for reliability
photosRouter.delete('/photos/all', async (c) => {
  console.log('[CLEAR] Nuclear clear starting...');

  try { await resetWatchers(); console.log('[CLEAR] Watchers stopped.'); } catch (e) { console.warn('[CLEAR] resetWatchers:', e); }

  const beforeCount = getDb().prepare('SELECT COUNT(*) as cnt FROM photos').get() as { cnt: number };
  const beforeFolders = getDb().prepare('SELECT COUNT(*) as cnt FROM folders').get() as { cnt: number };

  nukeDb();

  console.log(`[CLEAR] ✅ Cleared ${beforeCount.cnt} photos and ${beforeFolders.cnt} folders`);

  return c.json({
    success: true,
    message: "Database cleared",
    photosCleared: beforeCount.cnt,
    foldersCleared: beforeFolders.cnt,
  });
});

// POST /api/photos/clear-errors — clear only photos with error status
photosRouter.post('/photos/clear-errors', (c) => {
  const db = getDb();
  const errors = db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status = 'error'").get() as { cnt: number };
  const result = db.prepare("DELETE FROM photos WHERE status = 'error'").run();
  saveDb();
  console.log(`[CLEAR] Cleared ${result.changes} error photos`);
  return c.json({ success: true, cleared: result.changes, totalErrors: errors.cnt });
});

// POST /api/photos/reset-all — reset all done/error photos to pending (keeps folders)
photosRouter.post('/photos/reset-all', (c) => {
  const db = getDb();
  const done = db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status = 'done'").get() as { cnt: number };
  const errors = db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status = 'error'").get() as { cnt: number };
  const result = db.prepare("UPDATE photos SET status = 'pending', error_message = NULL, updated_at = unixepoch('now') WHERE status IN ('done', 'error')").run();
  saveDb();
  console.log(`[RESET] Reset ${result.changes} photos to pending (done: ${done.cnt}, errors: ${errors.cnt})`);
  return c.json({ success: true, reset: result.changes, doneCount: done.cnt, errorCount: errors.cnt });
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

// POST /api/photos/analyze — proxy to Ollama (avoids CORS / Docker networking issues)
// Accepts base64 image data and returns AI-generated tags.
// The backend calls Ollama running in Docker and relays the response.
photosRouter.post('/photos/analyze', async (c) => {
  try {
    const body = await c.req.json<{
      base64Data: string;
      mimeType: string;
      ollamaUrl?: string;
      model?: string;
    }>();

    if (!body.base64Data) {
      return c.json({ error: 'base64Data is required' }, 400);
    }

    const ollamaUrl = body.ollamaUrl || 'http://localhost:11434';
    const model = body.model || 'minicpm-v';

    // Simple and direct prompt
    const prompt = `/no_think
What do you see in this image? Answer with a JSON array of tags.

Choose from these categories:
- People: Portrait, Group, Family, Couple, Selfie
- Scene: Landscape, Cityscape, Beach, Mountain, Forest, Garden, Street
- Location: Indoor, Outdoor, Home, Restaurant, Museum, Church
- Weather: Sunny, Cloudy, Sunset, Sunrise, Night
- Activity: Walking, Posing, Eating, Traveling, Sports
- Objects: Car, Food, Flower, Architecture, Art, Statue

Return ONLY a JSON array like: ["Family", "Outdoor", "Sunny", "Garden"]
No explanation, just the JSON array.`;

    const requestBody = {
      model: model,
      prompt: prompt,
      images: [body.base64Data],
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 500,
      }
    };

    if (!model.includes('qwen3-vl')) {
      (requestBody as Record<string, unknown>).format = "json";
    }

    const endpoint = `${ollamaUrl.replace(/\/$/, '')}/api/generate`;
    console.log(`🦙 [Proxy] Calling Ollama at ${endpoint} with model ${model}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [Proxy] Ollama API Error:`, errorText);
      return c.json({ error: `Ollama error: ${response.statusText}`, details: errorText }, response.status as 502);
    }

    const data = await response.json();
    console.log(`📦 [Proxy] Ollama response received`);

    return c.json({
      success: true,
      response: data.response || '',
      thinking: data.thinking || null,
    });
  } catch (error) {
    console.error('❌ [Proxy] Failed to call Ollama:', error);
    return c.json({
      error: 'Failed to connect to Ollama',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 502);
  }
});

// GET /api/ollama/models — proxy to get installed Ollama models
photosRouter.get('/ollama/models', async (c) => {
  try {
    const ollamaUrl = c.req.query('url') || 'http://localhost:11434';
    const endpoint = `${ollamaUrl.replace(/\/$/, '')}/api/tags`;

    const response = await fetch(endpoint);
    if (!response.ok) {
      return c.json({ error: 'Failed to fetch models from Ollama' }, response.status as 502);
    }

    const data = await response.json();
    return c.json({
      success: true,
      models: (data.models || []).map((m: any) => m.name),
    });
  } catch (error) {
    console.error('❌ [Proxy] Failed to fetch Ollama models:', error);
    return c.json({
      error: 'Failed to connect to Ollama',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 502);
  }
});

// POST /api/ollama/health — check if Ollama is reachable via backend
photosRouter.post('/ollama/health', async (c) => {
  try {
    const ollamaUrl = (await c.req.json()).ollamaUrl || 'http://localhost:11434';
    const endpoint = `${ollamaUrl.replace(/\/$/, '')}/api/tags`;

    const response = await fetch(endpoint, { method: 'GET' });
    if (!response.ok) {
      return c.json({ connected: false, error: `HTTP ${response.status}` });
    }

    return c.json({ connected: true });
  } catch (error) {
    return c.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/db/backup — create a manual backup of the current database
photosRouter.post('/db/backup', (c) => {
  try {
    const { copyFileSync, existsSync, statSync } = require('fs');
    const { join, dirname } = require('path');
    const { fileURLToPath } = require('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const dbFile = join(__dirname, '../data', 'photo-index.db');
    const backupFile = dbFile + '.bak';

    if (existsSync(dbFile)) {
      if (existsSync(backupFile)) {
        unlinkSync(backupFile);
      }
      copyFileSync(dbFile, backupFile);
      const stats = statSync(backupFile);
      console.log(`[BACKUP] 💾 Manual backup created: ${backupFile} (${stats.size} bytes)`);
      return c.json({
        success: true,
        message: 'Backup created',
        sizeBytes: stats.size,
        sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
        createdAt: new Date(stats.mtimeMs).toLocaleString(),
      });
    } else {
      return c.json({ success: false, error: 'Database file not found' }, 404);
    }
  } catch (e) {
    console.error('[BACKUP] ❌ Failed:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// GET /api/db/backup-info — get information about the current backup file
photosRouter.get('/db/backup-info', (c) => {
  const info = getBackupInfo();
  return c.json(info);
});

// POST /api/db/restore — restore database from backup
photosRouter.post('/db/restore', async (c) => {
  if (isNuking()) {
    return c.json({ success: false, error: 'Operation blocked — database is being cleared' }, 503);
  }

  console.log('[RESTORE] Starting database restore from backup...');

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
