/**
 * File System Access API Service
 * Provides persistent access to folders across browser sessions (Chrome/Edge only)
 * 
 * How it works:
 * 1. User selects a folder once using showDirectoryPicker()
 * 2. We store the DirectoryHandle in IndexedDB
 * 3. On next load, we retrieve the handle and request permission
 * 4. If granted, we have direct access to all files without re-selecting
 */

const DB_NAME = 'LocalPhotoIndexer';
const HANDLE_STORE = 'directoryHandles';

// Check if File System Access API is supported
export const isFileSystemAccessSupported = (): boolean => {
  return 'showDirectoryPicker' in window;
};

/**
 * Open the database and ensure the directoryHandles store exists
 */
const openHandleDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // Bump version to add new store

    request.onerror = () => reject(request.error);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create photos store if it doesn't exist
      if (!db.objectStoreNames.contains('photos')) {
        const photosStore = db.createObjectStore('photos', { keyPath: 'id' });
        photosStore.createIndex('name', 'name', { unique: false });
        photosStore.createIndex('folderPath', 'folderPath', { unique: false });
        photosStore.createIndex('status', 'status', { unique: false });
        photosStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      }
      
      // Create settings store if it doesn't exist
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      
      // Create directoryHandles store for File System Access API
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: 'id' });
        console.log('📁 Created directoryHandles store for persistent folder access');
      }
    };

    request.onsuccess = () => resolve(request.result);
  });
};

/**
 * Store a directory handle in IndexedDB
 */
export const saveDirectoryHandle = async (
  handle: FileSystemDirectoryHandle,
  id: string = 'primary'
): Promise<void> => {
  const db = await openHandleDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([HANDLE_STORE], 'readwrite');
    const store = transaction.objectStore(HANDLE_STORE);
    
    const data = {
      id,
      handle,
      name: handle.name,
      savedAt: Date.now(),
    };
    
    const request = store.put(data);
    
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    
    request.onsuccess = () => {
      db.close();
      console.log(`💾 Saved directory handle: ${handle.name}`);
      resolve();
    };
  });
};

/**
 * Retrieve a stored directory handle from IndexedDB
 */
export const getDirectoryHandle = async (
  id: string = 'primary'
): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const db = await openHandleDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([HANDLE_STORE], 'readonly');
      const store = transaction.objectStore(HANDLE_STORE);
      const request = store.get(id);
      
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      
      request.onsuccess = () => {
        db.close();
        const result = request.result;
        if (result && result.handle) {
          console.log(`📂 Retrieved directory handle: ${result.name}`);
          resolve(result.handle);
        } else {
          resolve(null);
        }
      };
    });
  } catch (error) {
    console.error('Failed to get directory handle:', error);
    return null;
  }
};

/**
 * Request permission for a stored directory handle
 * Returns true if permission granted, false otherwise
 */
export const requestDirectoryPermission = async (
  handle: FileSystemDirectoryHandle
): Promise<boolean> => {
  try {
    // Check current permission status
    const options = { mode: 'read' as const };
    
    // @ts-ignore - queryPermission exists but TypeScript doesn't know about it
    let permission = await handle.queryPermission(options);
    
    if (permission === 'granted') {
      console.log('✅ Directory permission already granted');
      return true;
    }
    
    // Request permission if not granted
    // @ts-ignore - requestPermission exists but TypeScript doesn't know about it
    permission = await handle.requestPermission(options);
    
    if (permission === 'granted') {
      console.log('✅ Directory permission granted by user');
      return true;
    }
    
    console.log('❌ Directory permission denied');
    return false;
  } catch (error) {
    console.error('Failed to request directory permission:', error);
    return false;
  }
};

/**
 * Get a file from the directory by its relative path
 */
export const getFileFromDirectory = async (
  dirHandle: FileSystemDirectoryHandle,
  relativePath: string
): Promise<File | null> => {
  try {
    // Split the path into parts
    const pathParts = relativePath.split('/').filter(p => p.length > 0);
    
    if (pathParts.length === 0) {
      return null;
    }
    
    // Navigate to the file
    let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = dirHandle;
    
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isLastPart = i === pathParts.length - 1;
      
      if (isLastPart) {
        // Last part is the file
        try {
          const fileHandle = await (currentHandle as FileSystemDirectoryHandle).getFileHandle(part);
          return await fileHandle.getFile();
        } catch {
          return null;
        }
      } else {
        // Navigate into subdirectory
        try {
          currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(part);
        } catch {
          return null;
        }
      }
    }
    
    return null;
  } catch (error) {
    // File not found or access error - this is normal for missing files
    return null;
  }
};

/**
 * Get all image files from a directory recursively
 */
export const getAllFilesFromDirectory = async (
  dirHandle: FileSystemDirectoryHandle,
  basePath: string = ''
): Promise<Map<string, File>> => {
  const files = new Map<string, File>();
  
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const excludedExtensions = ['.cr2', '.cr3', '.nef', '.arw', '.orf', '.rw2', '.raf', '.dng', '.raw', '.tif', '.tiff', '.psd', '.psb'];
  
  async function* getFilesRecursively(
    dirHandle: FileSystemDirectoryHandle,
    path: string
  ): AsyncGenerator<{ path: string; file: File }> {
    // @ts-ignore - entries() exists on FileSystemDirectoryHandle
    for await (const [name, handle] of dirHandle.entries()) {
      const fullPath = path ? `${path}/${name}` : name;
      
      if (handle.kind === 'file') {
        const ext = name.toLowerCase().substring(name.lastIndexOf('.'));
        
        // Skip excluded extensions
        if (excludedExtensions.includes(ext)) {
          continue;
        }
        
        // Only include image files
        if (imageExtensions.includes(ext)) {
          try {
            const file = await handle.getFile();
            yield { path: fullPath, file };
          } catch {
            // Skip files we can't read
          }
        }
      } else if (handle.kind === 'directory') {
        yield* getFilesRecursively(handle, fullPath);
      }
    }
  }
  
  try {
    for await (const { path, file } of getFilesRecursively(dirHandle, basePath)) {
      files.set(path, file);
      // Also map by filename only for fallback matching
      files.set(file.name, file);
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }
  
  return files;
};

/**
 * Show directory picker and save the handle
 */
export const selectAndSaveDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    // @ts-ignore - showDirectoryPicker exists in Chrome
    const handle = await window.showDirectoryPicker({
      mode: 'read',
    });
    
    // Save the handle for future sessions
    await saveDirectoryHandle(handle);
    
    return handle;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // User cancelled - this is normal
      console.log('📂 Directory selection cancelled');
    } else {
      console.error('Failed to select directory:', error);
    }
    return null;
  }
};

/**
 * Try to restore access to a previously selected directory
 * Returns the handle if successful, null if user needs to re-select
 */
export const tryRestoreDirectoryAccess = async (): Promise<{
  handle: FileSystemDirectoryHandle | null;
  needsPermission: boolean;
  folderName: string | null;
}> => {
  const handle = await getDirectoryHandle();
  
  if (!handle) {
    return { handle: null, needsPermission: false, folderName: null };
  }
  
  // Check if we still have permission
  try {
    // @ts-ignore
    const permission = await handle.queryPermission({ mode: 'read' });
    
    if (permission === 'granted') {
      return { handle, needsPermission: false, folderName: handle.name };
    }
    
    // We have a stored handle but need to request permission
    return { handle, needsPermission: true, folderName: handle.name };
  } catch (error) {
    console.error('Error checking permission:', error);
    return { handle: null, needsPermission: false, folderName: null };
  }
};

/**
 * Delete stored directory handle
 */
export const clearDirectoryHandle = async (id: string = 'primary'): Promise<void> => {
  try {
    const db = await openHandleDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([HANDLE_STORE], 'readwrite');
      const store = transaction.objectStore(HANDLE_STORE);
      const request = store.delete(id);
      
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      
      request.onsuccess = () => {
        db.close();
        console.log('🗑️ Cleared directory handle');
        resolve();
      };
    });
  } catch (error) {
    console.error('Failed to clear directory handle:', error);
  }
};
