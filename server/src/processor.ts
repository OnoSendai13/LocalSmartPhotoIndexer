/**
 * Background photo processing engine.
 *
 * Runs entirely on the backend — independent of browser/frontend.
 * Processes pending photos with AI (Ollama) and saves tags to DB.
 */

import { getDb, saveDb, saveProcessingState, loadProcessingState, ProcessingState } from './db.js';
import { writeTagsToFile } from './exif.js';
import { resizeToThumbnail, isRawFormat, getMimeType } from './image.js';
import { findClosestTag, validateTags } from './tags.js';
import { existsSync, readdirSync } from 'fs';
import path from 'path';

// ─── Configuration ─────────────────────────────────────────────────────────────

const MAX_WORKERS = 4;           // Concurrent AI requests
const THUMBNAIL_MAX_PX = 480;    // Same as frontend for consistency
const JPEG_QUALITY = 0.88;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'minicpm-v';
const OLLAMA_TIMEOUT_MS = 120000; // 2 minute timeout per request
const OLLAMA_MAX_RETRIES = 3;     // Retry on transient failures
const OLLAMA_RETRY_DELAY_MS = 2000; // Wait between retries

function findFileRecursive(dirPath: string, fileName: string, maxDepth = 10): string | null {
  if (maxDepth <= 0) return null;
  let found: string | null = null;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (found) break;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        found = findFileRecursive(full, fileName, maxDepth - 1);
      } else if (entry.isFile() && entry.name === fileName) {
        found = full;
      }
    }
  } catch { /* ignore permission errors */ }
  return found;
}

// ─── State ─────────────────────────────────────────────────────────────────────

let _state: ProcessingState | null = null;
let activeWorkers = 0;
let isRunning = false;
let stopRequested = false;
let autoRestartEnabled = false;
let autoRestartTimeout: ReturnType<typeof setTimeout> | null = null;

/** Check if the processor is currently running (for watcher to skip scans). */
export function isProcessorRunning(): boolean {
  return isRunning;
}

function getState(): ProcessingState {
  if (!_state) {
    _state = { ...loadProcessingState() };
    // If the state was left in 'running' or 'stopping' from a crashed session,
    // reset to idle. The in-memory isRunning flag is always false on startup.
    if (_state.status === 'running' || _state.status === 'stopping') {
      _state.status = 'idle';
      saveProcessingState(_state);
    }
  }
  return _state;
}

function setState(partial: Partial<ProcessingState>): void {
  const current = getState();
  Object.assign(current, partial);
  saveProcessingState(current);
}

// ─── Types ─────────────────────────────────────────────────────────────────────

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

export interface ProcessingStatus {
  status: 'idle' | 'running' | 'stopping';
  done: number;
  total: number;
  percent: number;
  currentPhoto: string;
  startTime: number | null;
}

/**
 * Start or resume photo processing.
 */
export async function startProcessing(): Promise<{ success: true; total: number }> {
  if (isRunning) {
    const s = getState();
    return { success: true, total: s.total };
  }

  console.log('[PROCESSOR] Starting photo processing...');

  // Count pending photos
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
  saveProcessingState(_state);

  console.log(`[PROCESSOR] Processing ${pendingCount} pending photos with ${MAX_WORKERS} workers...`);

  // Spawn workers (fire and forget)
  const workers: Promise<{ errors: number }>[] = [];
  for (let i = 0; i < MAX_WORKERS; i++) {
    workers.push(runWorker());
  }

  // Wait for all workers to complete
  Promise.all(workers).then((results) => {
    isRunning = false;
    setState({ status: 'idle' });
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
    const s = getState();
    console.log(`[PROCESSOR] ✅ All processing complete! Indexed ${s.done - totalErrors} photos, ${totalErrors} errors.`);
    if (autoRestartEnabled) checkAndAutoRestart();
  });

  return { success: true, total: pendingCount };
}

/**
 * Request graceful shutdown of processing.
 */
export async function stopProcessing(): Promise<void> {
  if (!isRunning) {
    return;
  }

  console.log('[PROCESSOR] Stopping processing (draining active workers)...');
  disableAutoRestart();
  stopRequested = true;
  setState({ status: 'stopping' });

  // Wait for active workers to finish (max 30s)
  const timeout = setTimeout(() => {
    console.warn('[PROCESSOR] Force stop after 30s timeout');
    isRunning = false;
    setState({ status: 'idle' });
  }, 30000);

  while (activeWorkers > 0 && stopRequested) {
    await new Promise(r => setTimeout(r, 200));
  }

  clearTimeout(timeout);
  isRunning = false;
  setState({ status: 'idle' });
  console.log('[PROCESSOR] Stopped.');
}

/**
 * Get current processing status.
 */
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

/**
 * Backup the database to a .bak file. Called automatically before destructive operations.
 */
export function backupDb(): void {
  const { copyFileSync } = require('fs');
  const { join, dirname } = require('path');
  const { fileURLToPath } = require('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dbPath = join(__dirname, '../data', 'photo-index.db');
  const backupPath = dbPath + '.bak';
  try {
    copyFileSync(dbPath, backupPath);
    console.log(`[BACKUP] Database backed up to ${backupPath}`);
  } catch (err) {
    console.error('[BACKUP] Failed to create backup:', err);
  }
}

/**
 * Reset all 'done' photos back to 'pending' (for re-indexing).
 * IMPORTANT: preserves tags and indexed_at so data is not lost.
 * Creates a backup before running.
 */
export async function resetAllDone(): Promise<{ success: true; reset: number }> {
  // Create a backup first — never run destructive ops without one
  backupDb();

  const db = getDb();
  // Only reset status — keep tags, indexed_at, thumbnails intact
  const result = db.prepare(
    "UPDATE photos SET status = 'pending', error_message = NULL, updated_at = unixepoch('now') WHERE status = 'done'"
  ).run();
  saveDb();
  console.log(`[PROCESSOR] Reset ${result.changes} photos to pending (tags preserved)`);
  return { success: true, reset: result.changes };
}

/**
 * Enable automatic restart of processing if it stops while pending photos remain.
 * Called by the server startup so that indexing resumes automatically after errors.
 */
export function enableAutoRestart(): void {
  autoRestartEnabled = true;
  console.log('[PROCESSOR] Auto-restart enabled — will resume if processing stops with pending photos');
}

/**
 * Disable automatic restart. Called when the user explicitly clicks STOP.
 */
export function disableAutoRestart(): void {
  autoRestartEnabled = false;
  if (autoRestartTimeout) {
    clearTimeout(autoRestartTimeout);
    autoRestartTimeout = null;
  }
  console.log('[PROCESSOR] Auto-restart disabled');
}

/**
 * Check if there are still pending photos and auto-restart processing after a delay.
 * This recovers from unexpected crashes without user intervention.
 */
function checkAndAutoRestart(): void {
  if (stopRequested) return; // User explicitly stopped
  if (!autoRestartEnabled) return;

  try {
    const db = getDb();
    const pending = db.prepare('SELECT COUNT(*) as cnt FROM photos WHERE status = @status').get({ status: 'pending' }) as { cnt: number };

    if (pending.cnt > 0) {
      console.log(`[PROCESSOR] 🔄 ${pending.cnt} pending photos remain — auto-restarting in 1s...`);
      autoRestartTimeout = setTimeout(() => {
        if (autoRestartEnabled && !isRunning) {
          console.log('[PROCESSOR] 🚀 Auto-restarting processing...');
          startProcessing();
        }
      }, 1000);
    } else {
      console.log('[PROCESSOR] ✅ No pending photos — no auto-restart needed');
    }
  } catch (err) {
    console.error('[PROCESSOR] Failed to check for auto-restart:', err);
  }
}

// ─── Internal: Worker Loop ─────────────────────────────────────────────────────

async function runWorker(): Promise<{ errors: number }> {
  let errors = 0;
  while (!stopRequested) {
    const photo = pickNextPhoto();
    if (!photo) {
      break; // No more pending photos
    }

    activeWorkers++;
    try {
      await processPhoto(photo);
    } catch (err) {
      console.error(`[PROCESSOR] Error processing ${photo.name}:`, err);
      markPhotoError(photo.id, err instanceof Error ? err.message : 'Unknown error');
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

  // Mark as processing
  db.prepare(`
    UPDATE photos
    SET status = 'processing', updated_at = unixepoch('now')
    WHERE id = @id
  `).run({ id: row.id });
  saveDb();

  return row;
}

// ─── Internal: Process One Photo ───────────────────────────────────────────────

async function processPhoto(photo: PhotoRow): Promise<void> {
  const s = getState();
  setState({ currentPhoto: photo.name });

  // Skip RAW/unsupported formats
  if (isRawFormat(photo.name)) {
    console.log(`⏭️ Skipping unsupported format: ${photo.name}`);
    markPhotoDone(photo.id, [], null);
    return;
  }

  // Resolve file path
  let fullPath = photo.path;
  if (!fullPath || !existsSync(fullPath)) {
    fullPath = path.win32.join(photo.folder_path, photo.name);
  }
  if (!fullPath || !existsSync(fullPath)) {
    // Try with forward slashes (cross-platform)
    fullPath = photo.folder_path + '/' + photo.name;
  }
  if (!fullPath || !existsSync(fullPath)) {
    // Fallback: recursive search in subdirectories
    console.warn(`[PROCESSOR] Path not found, searching recursively: ${photo.name}`);
    const found = findFileRecursive(photo.folder_path, photo.name);
    if (found) {
      fullPath = found;
      console.log(`[PROCESSOR] ✅ Found via recursive search: ${found}`);
    }
  }

  if (!fullPath || !existsSync(fullPath)) {
    throw new Error(`File not found: ${photo.name} (tried: ${photo.path}, ${path.win32.join(photo.folder_path, photo.name)})`);
  }

  // Generate thumbnail
  const { base64, mimeType } = await resizeToThumbnail(fullPath);
  const thumbnailDataUrl = `data:${mimeType};base64,${base64}`;

  // Call Ollama via the existing analyze endpoint logic
  const tags = await analyzeWithOllama(base64, mimeType);
  console.log(`✅ Tags for ${photo.name}:`, tags);

  // Save to DB
  markPhotoDone(photo.id, tags, thumbnailDataUrl);

  // Update progress
  const st = getState();
  const newDone = st.done + 1;
  const newTotal = st.total;
  if (newDone % 10 === 0 || newDone === newTotal) {
    const pct = newTotal > 0 ? ((newDone / newTotal) * 100).toFixed(1) : '0.0';
    console.log(`📊 Progress: ${newDone}/${newTotal} (${pct}%)`);
  }
  // Update the done counter directly in the state object
  _state!.done = newDone;
  saveProcessingState(_state!);
}

// ─── Internal: Ollama Analysis ────────────────────────────────────────────────

/**
 * Call Ollama with retry logic and timeout.
 * Retries on transient failures (connection refused, timeout, 5xx).
 * Falls back to ['Uncategorized'] after max retries instead of throwing.
 */
async function analyzeWithOllama(base64Data: string, mimeType: string): Promise<string[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= OLLAMA_MAX_RETRIES; attempt++) {
    try {
      const result = await callOllamaOnce(base64Data, mimeType);
      if (attempt > 1) {
        console.log(`[OLLAMA] ✅ Succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[OLLAMA] Attempt ${attempt}/${OLLAMA_MAX_RETRIES} failed: ${lastError.message}`);

      if (attempt < OLLAMA_MAX_RETRIES) {
        const delay = OLLAMA_RETRY_DELAY_MS * attempt; // Exponential backoff
        console.log(`[OLLAMA] Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // All retries exhausted — throw error so photo stays 'pending' for retry
  console.error(`[OLLAMA] All ${OLLAMA_MAX_RETRIES} attempts failed. Last error: ${lastError?.message}`);
  throw lastError ?? new Error('Ollama unavailable');
}

/**
 * Single attempt to call Ollama API with timeout.
 */
async function callOllamaOnce(base64Data: string, mimeType: string): Promise<string[]> {
  const prompt = `Analyze this image and classify it using ONLY tags from this list:
People: Portrait, Group, Family, Couple, Selfie, People
Animals: Dog, Cat, Bird, Horse, Animal, Wildlife, Lion, Elephant, Giraffe, Zebra, Monkey, Fish, Insect
Scene: Landscape, Cityscape, Beach, Mountain, Forest, Garden, Park, Street, Village, Countryside, Desert, Lake, River, Ocean, Savanna, Grassland, Panorama
Location: Indoor, Outdoor, Home, Restaurant, Museum, Church, Castle, Building, Market, Shop, Hotel, Airport, Station, School, Office
Weather: Sunny, Cloudy, Sunset, Sunrise, Night, Rainy, Snowy
Activities: Walking, Posing, Eating, Traveling, Sports, Swimming, Hiking, Vacation, Shopping, Working, Playing, Dancing, Resting, Running, Cycling, Safari, Wedding, Celebration
Objects: Car, Food, Flower, Architecture, Art, Statue, Tree, Water, Boat, Plane, Train, Jewelry, Clothing, Book, Monument
Style: Portrait, Artistic, Panorama, Macro, Black-White, Golden-Hour, Night-Shot

Return a JSON array of 3-8 relevant tags. Example: ["Landscape", "Mountain", "Sunny", "Outdoor"]

Respond with ONLY a JSON array, no other text.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${OLLAMA_URL.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        images: [base64Data],
        format: 'json',
        options: {
          temperature: 0.3,
          top_p: 0.9,
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const responseText = data.response || '';

  // Parse tags from response
  try {
    const parsed = JSON.parse(responseText);
    if (Array.isArray(parsed)) {
      return validateTags(parsed.map(String));
    }
  } catch {
    // Try to extract JSON array from text
    const match = responseText.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return validateTags(parsed.map(String));
        }
      } catch { /* fallthrough */ }
    }
  }

  // Last resort: scan for allowed tags in text
  const rawTags: string[] = [];
  const words = responseText.split(/[\s,]+/);
  for (const word of words) {
    const tag = findClosestTag(word);
    if (tag && !rawTags.includes(tag)) {
      rawTags.push(tag);
    }
  }

  if (rawTags.length > 0) {
    return rawTags.slice(0, 8);
  }

  return ['Uncategorized'];
}

// ─── Internal: DB Updates ──────────────────────────────────────────────────────

function markPhotoDone(photoId: string, tags: string[], thumbnail: string | null): void {
  const db = getDb();
  const tagsJson = JSON.stringify(tags);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE photos
    SET tags = @tags, status = 'done', thumbnail = @thumbnail, indexed_at = @now, updated_at = @now
    WHERE id = @id
  `).run({ tags: tagsJson, thumbnail, now, id: photoId });

  saveDb();

  // Write EXIF tags to file
  const photo = db.prepare('SELECT * FROM photos WHERE id = @id').get({ id: photoId }) as PhotoRow | undefined;
  if (photo && tags.length > 0) {
    let filePath = photo.path;
    if (!existsSync(filePath)) {
      filePath = path.win32.join(photo.folder_path, photo.name);
    }
    if (existsSync(filePath)) {
      writeTagsToFile(filePath, tags).catch(err => {
        console.warn(`[PROCESSOR] Failed to write EXIF for ${photo.name}:`, err);
      });
    }
  }
}

function markPhotoError(photoId: string, errorMessage: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE photos
    SET status = 'error', error_message = @errorMessage, updated_at = unixepoch('now')
    WHERE id = @id
  `).run({ errorMessage, id: photoId });

  // For transient errors (Ollama down), reset to 'pending' so it retries automatically
  if (errorMessage.includes('ollama') || errorMessage.includes('fetch') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('UND_ERR')) {
    db.prepare(`UPDATE photos SET status = 'pending', error_message = NULL WHERE id = @id`).run({ id: photoId });
    console.warn(`[PROCESSOR] Transient error for ${photoId} — reset to pending for retry`);
    return; // Don't increment done
  }

  // Count permanent errors as "processed" to avoid reprocessing
  const s = getState();
  _state!.done = s.done + 1;
  saveDb();
  saveProcessingState(_state!);
}
