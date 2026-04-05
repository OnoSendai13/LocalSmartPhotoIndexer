/**
 * API Service — routes all storage calls to the backend SQLite server.
 * Mirrors the IndexedDB storageService.ts API so App.tsx only needs
 * to change one import line.
 *
 * Vite proxy forwards /api/* → http://localhost:3001
 */

const API_BASE = '/api';

export interface Photo {
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
  createdAt?: number;
  updatedAt?: number;
}

export interface AppSettings {
  id: string;
  ollamaUrl: string;
  ollamaModel: string;
  provider: 'ollama' | 'openrouter' | 'gemini' | 'openai';
  openrouterApiKey?: string;
  openrouterModel?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  geminiModel?: string;
}

// ─── Photos ─────────────────────────────────────────────────────────────────

export async function getAllPhotos(): Promise<Photo[]> {
  const res = await fetch(`${API_BASE}/photos`);
  if (!res.ok) throw new Error(`GET /photos failed: ${res.status}`);
  return res.json();
}

export async function getPhoto(id: string): Promise<Photo | null> {
  const res = await fetch(`${API_BASE}/photos/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /photos/${id} failed: ${res.status}`);
  return res.json();
}

export async function savePhoto(photo: Photo): Promise<void> {
  const res = await fetch(`${API_BASE}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(photo),
  });
  if (!res.ok) throw new Error(`POST /photos failed: ${res.status}`);
}

export async function savePhotos(photos: Photo[]): Promise<void> {
  const res = await fetch(`${API_BASE}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(photos),
  });
  if (!res.ok) throw new Error(`POST /photos (batch) failed: ${res.status}`);
}

export async function deletePhoto(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/photos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`DELETE /photos/${id} failed: ${res.status}`);
}

export async function updatePhotoTags(id: string, tags: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/photos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw new Error(`PUT /photos/${id} (tags) failed: ${res.status}`);
}

export async function updatePhotoStatus(
  id: string,
  status: Photo['status'],
  errorMessage?: string
): Promise<void> {
  const body: Record<string, unknown> = { status };
  if (errorMessage !== undefined) body.errorMessage = errorMessage;
  const res = await fetch(`${API_BASE}/photos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT /photos/${id} (status) failed: ${res.status}`);
}

// ─── EXIF sync ───────────────────────────────────────────────────────────────

export interface ExifSyncResult {
  success: boolean;
  injected: number;   // tags read from file and saved to DB
  written: number;    // DB tags written to file metadata
  skipped: number;
  missing: number;    // files not found on disk
  total: number;
}

/**
 * Sync EXIF metadata between files and the DB.
 * mode='read'  → read file metadata → inject into DB (for untagged photos)
 * mode='write' → push DB tags → write to file metadata (for photos with DB tags but no file metadata)
 * mode='both'  → do both (default)
 */
export async function syncExifTags(
  mode: 'read' | 'write' | 'both' = 'both',
  folderPath?: string,
): Promise<ExifSyncResult> {
  const res = await fetch(`${API_BASE}/photos/sync-exif`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, folderPath }),
  });
  if (!res.ok) throw new Error(`POST /photos/sync-exif failed: ${res.status}`);
  return res.json();
}

/**
 * Force-rewrite EXIF metadata for all photos that have tags in the DB.
 */
export async function rewriteExifTags(folderPath?: string): Promise<{ written: number; missing: number; total: number }> {
  const res = await fetch(`${API_BASE}/photos/rewrite-exif`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath }),
  });
  if (!res.ok) throw new Error(`POST /photos/rewrite-exif failed: ${res.status}`);
  return res.json();
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export interface Stats {
  totalPhotos: number;
  indexedPhotos: number;
  pendingPhotos: number;
  errorPhotos: number;
  uniqueTags: number;
  folders: { path: string; name: string }[];
}

export async function getStats(): Promise<Stats> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`GET /stats failed: ${res.status}`);
  return res.json();
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error(`GET /settings failed: ${res.status}`);
  const data = await res.json();
  // Backend stores as {key, value} rows — flatten to object
  if (Array.isArray(data)) {
    const settings: Record<string, string> = {};
    for (const row of data) settings[row.key] = row.value;
    return {
      id: 'default',
      ollamaUrl: settings.ollamaUrl || 'http://localhost:11434',
      ollamaModel: settings.ollamaModel || 'minicpm-v',
      provider: (settings.provider as AppSettings['provider']) || 'ollama',
      openrouterApiKey: settings.openrouterApiKey,
      openrouterModel: settings.openrouterModel,
      geminiApiKey: settings.geminiApiKey,
      openaiApiKey: settings.openaiApiKey,
      openaiModel: settings.openaiModel,
      geminiModel: settings.geminiModel,
    };
  }
  return data as AppSettings;
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`PUT /settings failed: ${res.status}`);
}

// ─── System Info ─────────────────────────────────────────────────────────────

export interface SystemInfo {
  platform: 'win32' | 'linux' | 'darwin' | string;
  homedir: string;
  sep: string;
}

export async function getSystemInfo(): Promise<SystemInfo> {
  try {
    const res = await fetch(`${API_BASE}/system/info`);
    if (!res.ok) return { platform: 'linux', homedir: '/home/user', sep: '/' };
    return res.json();
  } catch {
    return { platform: 'linux', homedir: '/home/user', sep: '/' };
  }
}

// ─── Health ─────────────────────────────────────────────────────────────────

export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface FolderInfo {
  id: string;
  name: string;
  path: string;
  registered_at: number;
  last_scanned_at?: number;
}

export async function getFolders(): Promise<FolderInfo[]> {
  const res = await fetch(`${API_BASE}/folders`);
  if (!res.ok) throw new Error(`GET /folders failed: ${res.status}`);
  return res.json();
}

export interface FolderAddResult {
  id: string;
  name: string;
  newPhotos: number;
  /** true = backend can read the path and scanned it; false = path not accessible (EXIF disabled) */
  pathAccessible: boolean;
  alreadyRegistered?: boolean;
}

export async function addFolder(path: string, name?: string): Promise<FolderAddResult> {
  const res = await fetch(`${API_BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`POST /folders failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

export interface FolderProbeResult {
  inputPath: string;
  exists: boolean;
  platform: string;
  homedir: string;
  cwd: string;
  parentPath: string;
  parentEntries: string[];
}

export async function probeFolder(path: string): Promise<FolderProbeResult> {
  const res = await fetch(`${API_BASE}/folders/probe?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`GET /folders/probe failed: ${res.status}`);
  return res.json();
}

// ─── Backup / Restore ─────────────────────────────────────────────────────────

export async function exportData(): Promise<string> {
  const [photos, settings] = await Promise.all([getAllPhotos(), getSettings()]);
  const exportObj = {
    version: 2,
    exportedAt: new Date().toISOString(),
    photos,
    settings,
  };
  return JSON.stringify(exportObj, null, 2);
}

export async function importData(jsonData: string): Promise<{ photosImported: number }> {
  const data = JSON.parse(jsonData);
  let photosImported = 0;

  if (data.photos && Array.isArray(data.photos)) {
    const res = await fetch(`${API_BASE}/photos/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos: data.photos }),
    });
    if (!res.ok) throw new Error(`Import failed: ${res.status}`);
    const result = await res.json();
    photosImported = result.photosImported || 0;
  }

  if (data.settings) {
    await saveSettings(data.settings);
  }

  return { photosImported };
}

export async function clearAllPhotos(): Promise<void> {
  const res = await fetch(`${API_BASE}/photos/all`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /photos/all failed: ${res.status}`);
}

// BUG FIX #4: Reset photos stuck in 'processing' state (called on app startup)
export async function resetProcessingPhotos(): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/photos/queue/reset-processing`, { method: 'POST' });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.reset || 0;
  } catch {
    return 0;
  }
}
