/**
 * Background photo processing engine.
 *
 * Runs entirely on the backend — independent of browser/frontend.
 * Processes pending photos with AI (Ollama) and saves tags to DB.
 */

import { getDb, saveDb, saveProcessingState, loadProcessingState, resetProcessingState, ProcessingState } from './db.js';
import { writeTagsToFile } from './exif.js';
import { resizeToThumbnail, isRawFormat, getMimeType } from './image.js';
import { findClosestTag, validateTags } from './tags.js';
import { existsSync } from 'fs';
import path from 'path';

// ─── Configuration ─────────────────────────────────────────────────────────────

const MAX_WORKERS = 4;           // Concurrent AI requests
const THUMBNAIL_MAX_PX = 480;    // Same as frontend for consistency
const JPEG_QUALITY = 0.88;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'minicpm-v';

// ─── State ─────────────────────────────────────────────────────────────────────

let state: ProcessingState = { ...loadProcessingState() };
let activeWorkers = 0;
let isRunning = false;
let stopRequested = false;

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
    return { success: true, total: state.total };
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
  state = {
    status: 'running',
    done: 0,
    total: pendingCount,
    currentPhoto: '',
    startTime: Date.now(),
  };
  saveProcessingState(state);

  console.log(`[PROCESSOR] Processing ${pendingCount} pending photos with ${MAX_WORKERS} workers...`);

  // Spawn workers (fire and forget)
  const workers: Promise<void>[] = [];
  for (let i = 0; i < MAX_WORKERS; i++) {
    workers.push(runWorker());
  }

  // Wait for all workers to complete
  Promise.all(workers).then(() => {
    isRunning = false;
    state.status = 'idle';
    saveProcessingState(state);
    console.log(`[PROCESSOR] ✅ All processing complete! Indexed ${state.done} photos.`);
  }).catch(err => {
    console.error('[PROCESSOR] Worker error:', err);
    isRunning = false;
    state.status = 'idle';
    saveProcessingState(state);
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
  stopRequested = true;
  state.status = 'stopping';
  saveProcessingState(state);

  // Wait for active workers to finish (max 30s)
  const timeout = setTimeout(() => {
    console.warn('[PROCESSOR] Force stop after 30s timeout');
    isRunning = false;
    state.status = 'idle';
    saveProcessingState(state);
  }, 30000);

  while (activeWorkers > 0 && !stopRequested) {
    await new Promise(r => setTimeout(r, 200));
  }

  clearTimeout(timeout);
  isRunning = false;
  state.status = 'idle';
  saveProcessingState(state);
  console.log('[PROCESSOR] Stopped.');
}

/**
 * Get current processing status.
 */
export function getProgress(): ProcessingStatus {
  const percent = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
  return {
    status: state.status,
    done: state.done,
    total: state.total,
    percent,
    currentPhoto: state.currentPhoto,
    startTime: state.startTime,
  };
}

/**
 * Reset all 'done' photos back to 'pending' (for re-indexing).
 */
export async function resetAllDone(): Promise<{ success: true; reset: number }> {
  const db = getDb();
  const result = db.prepare("UPDATE photos SET status = 'pending', tags = '[]', error_message = NULL, indexed_at = NULL, updated_at = unixepoch('now') WHERE status = 'done'").run();
  saveDb();
  console.log(`[PROCESSOR] Reset ${result.changes} photos to pending`);
  return { success: true, reset: result.changes };
}

// ─── Internal: Worker Loop ─────────────────────────────────────────────────────

async function runWorker(): Promise<void> {
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
    } finally {
      activeWorkers--;
    }
  }
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
  state.currentPhoto = photo.name;

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
  state.done++;
  if (state.done % 10 === 0 || state.done === state.total) {
    const pct = state.total > 0 ? ((state.done / state.total) * 100).toFixed(1) : '0.0';
    console.log(`📊 Progress: ${state.done}/${state.total} (${pct}%)`);
    saveProcessingState(state);
  }
}

// ─── Internal: Ollama Analysis ────────────────────────────────────────────────

async function analyzeWithOllama(base64Data: string, mimeType: string): Promise<string[]> {
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

  const response = await fetch(`${OLLAMA_URL.replace(/\/$/, '')}/api/generate`, {
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
  });

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

  saveDb();
}

function markPhotoError(photoId: string, errorMessage: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE photos
    SET status = 'error', error_message = @errorMessage, updated_at = unixepoch('now')
    WHERE id = @id
  `).run({ errorMessage, id: photoId });
  state.done++; // Count errors as "processed" to avoid reprocessing
  saveDb();
  saveProcessingState(state);
}
