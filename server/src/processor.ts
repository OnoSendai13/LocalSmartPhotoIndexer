/**
 * Background photo processing engine.
 */

import { getDb, getThumbnailsDir } from './db.js';
import { resizeToThumbnailBuffer, isRawFormat } from './image.js';
import { access, readdir, writeFile } from 'fs/promises';
import path from 'path';
import { analyzeWithOllama } from './services/ollamaService.js';
import {
  writeTransaction,
  markPhotoErrorWithTransaction,
  replayPendingTransactions,
  getProcessingStateFromDb,
  saveProcessingStateWithTransaction,
  createCheckpointTransaction,
  markPhotoDoneWithTransaction,
} from './transaction-log.js';

const MAX_WORKERS = 1;
const OLLAMA_MAX_RETRIES = 3;
const OLLAMA_RETRY_DELAY_MS = 2000;

let _state: ProcessingState | null = null;
let activeWorkers = 0;
let isRunning = false;
let stopRequested = false;
let autoRestartEnabled = false;
let autoRestartTimeout: ReturnType<typeof setTimeout> | null = null;

export interface ProcessingStatus {
  status: 'idle' | 'running' | 'stopping';
  done: number;
  total: number;
  percent: number;
  currentPhoto: string;
  startTime: number | null;
}

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

export function isProcessorRunning(): boolean {
  return isRunning;
}

export async function startProcessing(): Promise<{ success: true; total: number }> {
  if (isRunning) {
    const s = getState();
    return { success: true, total: s.total };
  }

  console.log('[PROCESSOR] Starting photo processing...');

  const replayed = replayPendingTransactions();
  console.log(`[TRANSACTION] Replayed ${replayed} pending transactions`);

  const db = getDb();
  const result = db
    .prepare('SELECT COUNT(*) as cnt FROM photos WHERE status = @status')
    .get({ status: 'pending' }) as { cnt: number };
  const pendingCount = result.cnt;

  if (pendingCount === 0) {
    console.log('[PROCESSOR] No pending photos to process');
    return { success: true, total: 0 };
  }

  isRunning = true;
  stopRequested = false;
  _state = {
    status: 'running',
    done: 0,
    total: pendingCount,
    currentPhoto: '',
    startTime: Date.now(),
  };
  saveProcessingStateWithTransaction(_state);

  console.log(`[PROCESSOR] Processing ${pendingCount} pending photos with ${MAX_WORKERS} worker(s)...`);

  const workers: Promise<{ errors: number }>[] = [];
  for (let i = 0; i < MAX_WORKERS; i++) {
    workers.push(runWorker());
  }

  void Promise.all(workers)
    .then((results) => {
      isRunning = false;
      const doneState = getState();
      _state = { status: 'idle', done: 0, total: 0, currentPhoto: '', startTime: null };
      saveProcessingStateWithTransaction(_state);
      const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
      console.log(`[PROCESSOR] ✅ Complete. Indexed ${doneState.done - totalErrors} photos, ${totalErrors} errors.`);
      if (autoRestartEnabled) checkAndAutoRestart();
    })
    .catch((err) => {
      console.error('[PROCESSOR] Worker promise chain error:', err);
    });

  return { success: true, total: pendingCount };
}

export async function stopProcessing(): Promise<void> {
  if (!isRunning) return;

  console.log('[PROCESSOR] Stopping processing (draining active workers)...');
  disableAutoRestart();
  stopRequested = true;

  const state = getState();
  _state = {
    status: 'stopping',
    done: state.done,
    total: state.total,
    currentPhoto: '',
    startTime: state.startTime,
  };
  saveProcessingStateWithTransaction(_state);

  const timeoutId = setTimeout(() => {
    console.warn('[PROCESSOR] Force stop after 30s timeout');
    isRunning = false;
  }, 30000);

  while (activeWorkers > 0 && stopRequested) {
    await new Promise((r) => setTimeout(r, 200));
  }

  clearTimeout(timeoutId);
  isRunning = false;
  _state = {
    status: 'idle',
    done: getState().done,
    total: getState().total,
    currentPhoto: '',
    startTime: null,
  };
  saveProcessingStateWithTransaction(_state);
  console.log('[PROCESSOR] Stopped.');
}

export function getProgress(): ProcessingStatus {
  const s = getState();
  const percent = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
  return {
    status: s.status,
    done: s.done,
    total: s.total,
    percent,
    currentPhoto: s.currentPhoto,
    startTime: s.startTime,
  };
}

export function enableAutoRestart(): void {
  autoRestartEnabled = true;
  console.log('[PROCESSOR] Auto-restart enabled');
}

export function disableAutoRestart(): void {
  autoRestartEnabled = false;
  if (autoRestartTimeout) {
    clearTimeout(autoRestartTimeout);
    autoRestartTimeout = null;
  }
}

export async function resetAllDone(): Promise<{ success: true; reset: number }> {
  const db = getDb();
  const result = db
    .prepare("UPDATE photos SET status='pending', error_message = NULL, updated_at = unixepoch('now') WHERE status IN ('done','error')")
    .run() as { changes: number };
  return { success: true, reset: result.changes };
}

async function runWorker(): Promise<{ errors: number }> {
  let errors = 0;
  while (!stopRequested) {
    const photo = pickNextPhoto();
    if (!photo) break;

    activeWorkers++;
    try {
      await processPhoto(photo);
    } catch (err) {
      console.error(`[PROCESSOR] Error processing ${photo.name}:`, err);
      await markPhotoErrorWithTransaction(photo.id, err instanceof Error ? err.message : 'Unknown error');
      errors++;
    } finally {
      activeWorkers--;
    }
  }
  return { errors };
}

function pickNextPhoto(): PhotoRow | null {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT id, name, path, folder_path, size, last_modified, mime_type, tags, status, thumbnail, indexed_at, error_message, created_at, updated_at
      FROM photos
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .get() as PhotoRow | undefined;

  if (!row) return null;

  writeTransaction({
    type: 'state_update',
    data: { status: 'processing', photoId: row.id },
  });

  db.prepare(`
    UPDATE photos
    SET status = 'processing', updated_at = unixepoch('now')
    WHERE id = @id
  `).run({ id: row.id });

  return row;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePhotoPath(photo: PhotoRow): Promise<string | null> {
  const candidates = [
    photo.path,
    path.win32.join(photo.folder_path, photo.name),
    path.join(photo.folder_path, photo.name),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  const found = await findFileRecursive(photo.folder_path, photo.name);
  return found;
}

async function persistThumbnail(photoId: string, filePath: string): Promise<string> {
  const thumbDir = getThumbnailsDir();
  const targetPath = path.join(thumbDir, `${photoId}.jpg`);
  const { buffer } = await resizeToThumbnailBuffer(filePath);
  await writeFile(targetPath, buffer);
  return targetPath;
}

async function processPhoto(photo: PhotoRow): Promise<void> {
  const photoId = photo.id;

  if (isRawFormat(photo.name)) {
    console.log(`⏭️ Skipping unsupported format: ${photo.name}`);
    markPhotoDoneWithTransaction(photoId, [], photo.thumbnail);
    incrementProgress();
    return;
  }

  try {
    const existingTags = JSON.parse(photo.tags || '[]');
    const validTags = existingTags.filter(
      (t: string) => t && t !== 'Uncategorized' && t !== 'Error-EmptyResponse' && !t.startsWith('Error-'),
    );
    if (validTags.length > 0) {
      console.log(`⏭️ Skipping ${photo.name} — already has valid tags: [${validTags.join(', ')}]`);
      let thumbnailPath = photo.thumbnail || null;
      if (!thumbnailPath) {
        const existingPath = await resolvePhotoPath(photo);
        if (existingPath) {
          thumbnailPath = await persistThumbnail(photoId, existingPath);
        }
      }
      markPhotoDoneWithTransaction(photoId, validTags, thumbnailPath);
      incrementProgress();
      return;
    }
  } catch {
    // ignore parse errors
  }

  const fullPath = await resolvePhotoPath(photo);
  if (!fullPath) {
    throw new Error(`File not found: ${photo.name}`);
  }

  const thumbnailPath = await persistThumbnail(photoId, fullPath);
  const thumbnailBuffer = await resizeToThumbnailBuffer(fullPath);
  const tags = await analyzeWithOllamaRetry(thumbnailBuffer.buffer.toString('base64'), thumbnailBuffer.mimeType);

  markPhotoDoneWithTransaction(photoId, tags, thumbnailPath);
  incrementProgress();
  createCheckpointTransaction('periodic_checkpoint');
}

function incrementProgress(): void {
  const st = getState();
  _state = {
    ...st,
    done: st.done + 1,
  };
  saveProcessingStateWithTransaction(_state);

  if (_state.done % 10 === 0 || _state.done === _state.total) {
    const pct = _state.total > 0 ? ((_state.done / _state.total) * 100).toFixed(1) : '0.0';
    console.log(`📊 Progress: ${_state.done}/${_state.total} (${pct}%)`);
  }
}

async function analyzeWithOllamaRetry(base64Data: string, mimeType: string): Promise<string[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= OLLAMA_MAX_RETRIES; attempt++) {
    try {
      const result = await analyzeWithOllama(base64Data, mimeType);
      if (attempt > 1) {
        console.log(`[OLLAMA] ✅ Succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[OLLAMA] Attempt ${attempt}/${OLLAMA_MAX_RETRIES} failed: ${lastError.message}`);

      if (attempt < OLLAMA_MAX_RETRIES) {
        const delay = OLLAMA_RETRY_DELAY_MS * attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error('Ollama unavailable');
}

async function findFileRecursive(dirPath: string, fileName: string): Promise<string | null> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = await findFileRecursive(path.join(dirPath, entry.name), fileName);
        if (found) return found;
      } else if (entry.name === fileName) {
        return path.join(dirPath, entry.name);
      }
    }
  } catch {
    // ignore permission/path errors
  }
  return null;
}

function getState(): ProcessingState {
  if (!_state) {
    _state = getProcessingStateFromDb() as ProcessingState;
  }
  return _state;
}

interface ProcessingState {
  status: 'idle' | 'running' | 'stopping';
  done: number;
  total: number;
  currentPhoto: string;
  startTime: number | null;
}

function checkAndAutoRestart(): void {
  if (!autoRestartEnabled || isRunning || stopRequested) return;

  const db = getDb();
  const pending = db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE status='pending'").get() as { cnt: number };
  if (pending.cnt === 0) return;

  if (autoRestartTimeout) clearTimeout(autoRestartTimeout);
  autoRestartTimeout = setTimeout(() => {
    if (!isRunning && autoRestartEnabled) {
      void startProcessing().catch((err) => {
        console.error('[PROCESSOR] Auto-restart failed:', err);
      });
    }
  }, 1500);
}

const shutdown = (reason: string) => {
  console.log(`[SHUTDOWN] Reason: ${reason}`);
  void stopProcessing().catch(() => {});
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
