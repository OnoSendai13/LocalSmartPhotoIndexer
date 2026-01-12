/**
 * IndexedDB Storage Service for persisting photo index data
 * Stores photo metadata, tags, and processing state locally in the browser
 */

const DB_NAME = 'LocalPhotoIndexer';
const DB_VERSION = 2;  // Updated to match fileSystemService.ts
const STORE_NAME = 'photos';
const SETTINGS_STORE = 'settings';
const HANDLE_STORE = 'directoryHandles';  // For File System Access API

export interface StoredPhoto {
  id: string;
  name: string;
  path: string;           // Relative path from imported folder
  folderPath: string;     // Root folder path
  size: number;
  lastModified: number;
  mimeType: string;
  tags: string[];
  status: 'pending' | 'processing' | 'done' | 'error';
  indexedAt?: number;     // Timestamp when indexed
  errorMessage?: string;  // Error details if status is 'error'
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
}

const DEFAULT_SETTINGS: AppSettings = {
  id: 'default',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'minicpm-v',  // Best model for photo classification (Jan 2025)
  provider: 'ollama',
};

/**
 * Opens the IndexedDB database, creating stores if needed
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create photos store with indexes
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const photoStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        photoStore.createIndex('name', 'name', { unique: false });
        photoStore.createIndex('folderPath', 'folderPath', { unique: false });
        photoStore.createIndex('status', 'status', { unique: false });
        photoStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      }

      // Create settings store
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
      }
      
      // Create directoryHandles store for File System Access API (added in v2)
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: 'id' });
        console.log('📁 Created directoryHandles store for persistent folder access');
      }
    };
  });
};

/**
 * Save a single photo to IndexedDB
 */
export const savePhoto = async (photo: StoredPhoto): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(photo);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Save multiple photos to IndexedDB (batch operation)
 */
export const savePhotos = async (photos: StoredPhoto[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    photos.forEach(photo => {
      store.put(photo);
    });

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
};

/**
 * Get a single photo by ID
 */
export const getPhoto = async (id: string): Promise<StoredPhoto | undefined> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Get all photos from IndexedDB
 */
export const getAllPhotos = async (): Promise<StoredPhoto[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Get photos by folder path
 */
export const getPhotosByFolder = async (folderPath: string): Promise<StoredPhoto[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('folderPath');
    const request = index.getAll(folderPath);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Get photos by tag
 */
export const getPhotosByTag = async (tag: string): Promise<StoredPhoto[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('tags');
    const request = index.getAll(tag);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Update photo tags
 */
export const updatePhotoTags = async (id: string, tags: string[]): Promise<void> => {
  const photo = await getPhoto(id);
  if (photo) {
    photo.tags = tags;
    photo.indexedAt = Date.now();
    await savePhoto(photo);
  }
};

/**
 * Update photo status
 */
export const updatePhotoStatus = async (
  id: string, 
  status: StoredPhoto['status'],
  errorMessage?: string
): Promise<void> => {
  const photo = await getPhoto(id);
  if (photo) {
    photo.status = status;
    if (errorMessage) {
      photo.errorMessage = errorMessage;
    }
    if (status === 'done') {
      photo.indexedAt = Date.now();
    }
    await savePhoto(photo);
  }
};

/**
 * Delete a photo from IndexedDB
 */
export const deletePhoto = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Delete all photos from a specific folder
 */
export const deletePhotosByFolder = async (folderPath: string): Promise<void> => {
  const photos = await getPhotosByFolder(folderPath);
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    photos.forEach(photo => {
      store.delete(photo.id);
    });

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
};

/**
 * Clear all photos from IndexedDB
 */
export const clearAllPhotos = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Get app settings
 */
export const getSettings = async (): Promise<AppSettings> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SETTINGS_STORE], 'readonly');
    const store = transaction.objectStore(SETTINGS_STORE);
    const request = store.get('default');

    request.onsuccess = () => {
      resolve(request.result || DEFAULT_SETTINGS);
    };
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Save app settings
 */
export const saveSettings = async (settings: Partial<AppSettings>): Promise<void> => {
  const currentSettings = await getSettings();
  const newSettings = { ...currentSettings, ...settings, id: 'default' };
  
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SETTINGS_STORE], 'readwrite');
    const store = transaction.objectStore(SETTINGS_STORE);
    const request = store.put(newSettings);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
};

/**
 * Export all data as JSON (for backup)
 */
export const exportData = async (): Promise<string> => {
  const photos = await getAllPhotos();
  const settings = await getSettings();
  
  const exportObj = {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    photos,
    settings,
  };
  
  return JSON.stringify(exportObj, null, 2);
};

/**
 * Import data from JSON backup
 */
export const importData = async (jsonData: string): Promise<{ photosImported: number }> => {
  const data = JSON.parse(jsonData);
  
  if (data.photos && Array.isArray(data.photos)) {
    await savePhotos(data.photos);
  }
  
  if (data.settings) {
    await saveSettings(data.settings);
  }
  
  return { photosImported: data.photos?.length || 0 };
};

/**
 * Check if a photo with same name and folder already exists
 */
export const photoExists = async (name: string, folderPath: string): Promise<StoredPhoto | null> => {
  const photos = await getPhotosByFolder(folderPath);
  return photos.find(p => p.name === name) || null;
};

/**
 * Get statistics about indexed photos
 */
export const getStats = async (): Promise<{
  totalPhotos: number;
  indexedPhotos: number;
  pendingPhotos: number;
  errorPhotos: number;
  uniqueTags: number;
  folders: string[];
}> => {
  const photos = await getAllPhotos();
  const tagSet = new Set<string>();
  const folderSet = new Set<string>();
  
  photos.forEach(p => {
    p.tags.forEach(t => tagSet.add(t));
    folderSet.add(p.folderPath);
  });
  
  return {
    totalPhotos: photos.length,
    indexedPhotos: photos.filter(p => p.status === 'done').length,
    pendingPhotos: photos.filter(p => p.status === 'pending').length,
    errorPhotos: photos.filter(p => p.status === 'error').length,
    uniqueTags: tagSet.size,
    folders: Array.from(folderSet),
  };
};
