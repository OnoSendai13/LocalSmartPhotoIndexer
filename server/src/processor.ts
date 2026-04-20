/**
 * Fixed background photo processing engine with transaction-based state management.
 */

import { getDb, saveDb } from './db.js';
import { writeTagsToFile, closeExifTool } from './exif-fixed.js';
import { resizeToThumbnail, isRawFormat, getMimeType } from './image.js';
import { findClosestTag, validateTags } from './tags.js';
import { existsSync, readdirSync } from 'fs';
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


// ─── Configuration ─────────────────────────────────────────────────────────────

const MAX_WORKERS = 1;
const THUMBNAIL_MAX_PX = 224;
const JPEG_QUALITY = 0.7;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'minicpm-v';
const OLLAMA_TIMEOUT_MS = 300000;
const OLLAMA_MAX_RETRIES = 3;
const OLLAMA_RETRY_DELAY_MS = 2000;

// ─── State ─────────────────────────────────────────────────────────────────────

let _state: ProcessingState | null = null;
let activeWorkers = 0;
let isRunning = false;
let stopRequested = false;
let autoRestartEnabled = false;
let autoRestartTimeout: ReturnType<typeof setTimeout> | null = null;

// ─── Types ─────────────────────────────────────────────────────────────────────

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

// ─── Public API ────────────────────────────────────────────────────────────────

export function isProcessorRunning(): boolean {
  return isRunning;
}

export async function startProcessing(): Promise<{ success: true; total: number }> {
  if (isRunning) {
    const s = getState();
    return { success: true, total: s.total };
  }

  console.log('[PROCESSOR] Starting photo processing...');

  // Replay any pending transactions from previous crash
  const replayed = replayPendingTransactions();
  console.log(`[TRANSACTION] Replayed ${replayed} pending transactions`);

  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as cnt FROM photos WHERE status = @status').get({ status: 'pending' }) as { cnt: number };
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

  console.log(`[PROCESSOR] Processing ${pendingCount} pending photos with ${MAX_WORKERS} workers...`);

  const workers: Promise<{ errors: number }>[] = [];
  for (let i = 0; i < MAX_WORKERS; i++) {
    workers.push(runWorker());
  }

  Promise.all(workers).then((results) => {
    isRunning = false;
    _state = { status: 'idle', done: 0, total: 0, currentPhoto: '', startTime: null };
    saveProcessingStateWithTransaction(_state);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
    const s = getState();
    console.log(`[PROCESSOR] ✅ All processing complete! Indexed ${s.done - totalErrors} photos, ${totalErrors} errors.`);
    if (autoRestartEnabled) checkAndAutoRestart();
  }).catch((err) => {
    console.error('[PROCESSOR] Worker promise chain error:', err);
  });

  return { success: true, total: pendingCount };
}

export async function stopProcessing(): Promise<void> {
  if (!isRunning) {
    return;
  }

  console.log('[PROCESSOR] Stopping processing (draining active workers)...');
  disableAutoRestart();
  stopRequested = true;
  _state = { status: 'stopping', done: getState().done, total: getState().total, currentPhoto: '', startTime: getState().startTime };
  saveProcessingStateWithTransaction(_state);

  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.warn('[PROCESSOR] Force stop after 30s timeout');
      isRunning = false;
      resolve();
    }, 30000);
  });

  while (activeWorkers > 0 && stopRequested) {
    await new Promise(r => setTimeout(r, 200));
  }

  clearTimeout(timeout as any);
  isRunning = false;
  _state = { status: 'idle', done: getState().done, total: getState().total, currentPhoto: '', startTime: null };
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
  console.log('[PROCESSOR] Auto-restart enabled — will resume if processing stops with pending photos');
}

export function disableAutoRestart(): void {
  autoRestartEnabled = false;
  if (autoRestartTimeout) {
    clearTimeout(autoRestartTimeout);
    autoRestartTimeout = null;
  }
  console.log('[PROCESSOR] Auto-restart disabled');
}

// ─── Internal: Worker Loop ─────────────────────────────────────────────────────

async function runWorker(): Promise<{ errors: number }> {
  let errors = 0;
  while (!stopRequested) {
    const photo = pickNextPhoto();
    if (!photo) {
      break;
    }

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
  const row = db.prepare(`
    SELECT * FROM photos
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
  `).get() as PhotoRow | undefined;

  if (!row) return null;

  writeTransaction({
    type: 'state_update',
    data: { status: 'processing' },
  });

  db.prepare(`
    UPDATE photos
    SET status = 'processing', updated_at = unixepoch('now')
    WHERE id = @id
  `).run({ id: row.id });
  saveDb();

  return row;
}

// ─── Internal: Process One Photo ──────────────────────────────────────────────

async function processPhoto(photo: PhotoRow): Promise<void> {
  const db = getDb();
  const photoId = photo.id;

  if (isRawFormat(photo.name)) {
    console.log(`⏭️ Skipping unsupported format: ${photo.name}`);
    markPhotoDoneWithTransaction(photoId, [], null);
    return;
  }

  // Try to load existing tags from DB first (skip reprocessing if valid)
  try {
    const existingTags = JSON.parse(photo.tags || '[]');
    const validTags = existingTags.filter((t: string) =>
      t && t !== 'Uncategorized' && t !== 'Error-EmptyResponse' && !t.startsWith('Error-')
    );
    if (validTags.length > 0) {
      console.log(`⏭️ Skipping ${photo.name} — already has valid tags: [${validTags.join(', ')}]`);
      markPhotoDoneWithTransaction(photoId, validTags, photo.thumbnail);
      return;
    }
  } catch { /* ignore parse errors */ }

  let fullPath = photo.path;
  if (!existsSync(fullPath)) {
    fullPath = path.win32.join(photo.folder_path, photo.name);
  }
  if (!existsSync(fullPath)) {
    fullPath = photo.folder_path + '/' + photo.name;
  }
  if (!existsSync(fullPath)) {
    console.warn(`[PROCESSOR] Path not found, searching recursively: ${photo.name}`);
    const found = findFileRecursive(photo.folder_path, photo.name);
    if (found) {
      fullPath = found;
      console.log(`[PROCESSOR] ✅ Found via recursive search: ${found}`);
    }
  }

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${photo.name}`);
  }

  const { base64, mimeType } = await resizeToThumbnail(fullPath);
  const thumbnailDataUrl = `data:${mimeType};base64,${base64}`;

  const tags = await analyzeWithOllamaRetry(base64, mimeType);
  console.log(`✅ Tags for ${photo.name}:`, tags);

  markPhotoDoneWithTransaction(photoId, tags, thumbnailDataUrl);

  const st = getState();
  _state!.done = st.done + 1;
  saveProcessingStateWithTransaction(_state!);

  if (_state!.done % 10 === 0 || _state!.done === _state!.total) {
    const pct = _state!.total > 0 ? ((_state!.done / _state!.total) * 100).toFixed(1) : '0.0';
    console.log(`📊 Progress: ${_state!.done}/${_state!.total} (${pct}%)`);
  }

  createCheckpointTransaction('periodic_checkpoint');
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
        console.log(`[OLLAMA] Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error('Ollama unavailable');
}

// ─── Internal: File Search ────────────────────────────────────────────────────

function findFileRecursive(dirPath: string, fileName: string): string | null {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = findFileRecursive(path.join(dirPath, entry.name), fileName);
        if (found) return found;
      } else if (entry.name === fileName) {
        return path.join(dirPath, entry.name);
      }
    }
  } catch { /* ignore permission errors */ }
  return null;
}

// ─── Internal: State Management ──────────────────────────────────────────────

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

// ─── Cleanup ───────────────────────────────────────────────────────────────────

const shutdown = (reason: string) => {
  console.log(`[SHUTDOWN] Reason: ${reason}`);
  stopProcessing().catch(() => {});
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  shutdown('unhandledRejection');
});
