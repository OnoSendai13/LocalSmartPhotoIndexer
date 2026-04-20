import { randomUUID } from 'crypto';
import { getDb } from './db.js';

const DEFAULT_STATE = {
  status: 'idle',
  done: 0,
  total: 0,
  currentPhoto: '',
  startTime: null,
};

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function serializeData(data) {
  return JSON.stringify(data ?? {});
}

export function initTransactionLog() {
  const db = getDb();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS processing_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      done INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      current_photo TEXT NOT NULL DEFAULT '',
      start_time INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS transaction_log (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_transaction_log_status ON transaction_log(status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_transaction_log_timestamp ON transaction_log(timestamp)').run();
}

export function writeTransaction({ type, data }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO transaction_log (id, type, data, timestamp, status)
    VALUES (@id, @type, @data, @timestamp, 'applied')
  `).run({
    id: randomUUID(),
    type,
    data: serializeData(data),
    timestamp: nowEpoch(),
  });
}

export function saveProcessingStateWithTransaction(state) {
  const db = getDb();
  const payload = {
    ...DEFAULT_STATE,
    ...(state || {}),
  };

  db.prepare(`
    INSERT INTO processing_state (id, status, done, total, current_photo, start_time, updated_at)
    VALUES (1, @status, @done, @total, @currentPhoto, @startTime, unixepoch('now'))
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      done = excluded.done,
      total = excluded.total,
      current_photo = excluded.current_photo,
      start_time = excluded.start_time,
      updated_at = unixepoch('now')
  `).run(payload);

  writeTransaction({ type: 'processing_state', data: payload });
}

export function getProcessingStateFromDb() {
  const db = getDb();
  const row = db.prepare(`
    SELECT status, done, total, current_photo as currentPhoto, start_time as startTime
    FROM processing_state WHERE id = 1
  `).get();
  return row || { ...DEFAULT_STATE };
}

export function markPhotoDoneWithTransaction(photoId, tags, thumbnailPath) {
  const db = getDb();
  const safeTags = Array.isArray(tags) ? tags : [];

  db.prepare(`
    UPDATE photos
    SET
      tags = @tags,
      status = 'done',
      thumbnail = @thumbnail,
      indexed_at = unixepoch('now'),
      error_message = NULL,
      updated_at = unixepoch('now')
    WHERE id = @photoId
  `).run({
    photoId,
    tags: JSON.stringify(safeTags),
    thumbnail: thumbnailPath || null,
  });

  writeTransaction({
    type: 'photo_done',
    data: { photoId, tags: safeTags, thumbnail: thumbnailPath || null },
  });
}

export async function markPhotoErrorWithTransaction(photoId, errorMessage) {
  const db = getDb();
  db.prepare(`
    UPDATE photos
    SET
      status = 'error',
      error_message = @errorMessage,
      updated_at = unixepoch('now')
    WHERE id = @photoId
  `).run({ photoId, errorMessage });

  writeTransaction({
    type: 'photo_error',
    data: { photoId, errorMessage },
  });
}

export function createCheckpointTransaction(reason = 'checkpoint') {
  writeTransaction({
    type: 'checkpoint',
    data: { reason, timestamp: nowEpoch() },
  });
}

function applyPendingTransaction(txRow) {
  const db = getDb();
  let data = {};
  try {
    data = JSON.parse(txRow.data || '{}');
  } catch {
    data = {};
  }

  if (txRow.type === 'photo_done') {
    db.prepare(`
      UPDATE photos
      SET tags = @tags, status = 'done', thumbnail = @thumbnail, indexed_at = unixepoch('now'), error_message = NULL, updated_at = unixepoch('now')
      WHERE id = @photoId
    `).run({
      photoId: data.photoId,
      tags: JSON.stringify(data.tags || []),
      thumbnail: data.thumbnail || null,
    });
  } else if (txRow.type === 'photo_error') {
    db.prepare(`
      UPDATE photos
      SET status = 'error', error_message = @errorMessage, updated_at = unixepoch('now')
      WHERE id = @photoId
    `).run({
      photoId: data.photoId,
      errorMessage: data.errorMessage || 'Unknown error',
    });
  } else if (txRow.type === 'processing_state') {
    saveProcessingStateWithTransaction(data);
  }

  db.prepare("UPDATE transaction_log SET status = 'applied' WHERE id = @id").run({ id: txRow.id });
}

export function replayPendingTransactions() {
  const db = getDb();
  const pending = db.prepare(`
    SELECT id, type, data FROM transaction_log
    WHERE status = 'pending'
    ORDER BY timestamp ASC
    LIMIT 2000
  `).all();

  for (const row of pending) {
    applyPendingTransaction(row);
  }

  return pending.length;
}
