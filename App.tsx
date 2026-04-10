import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { PhotoGrid } from './components/PhotoGrid';
import { FolderPathModal } from './components/FolderPathModal';
import { Photo, Category, AIProvider, AppSettings, TAG_CATEGORIES, DEFAULT_SETTINGS } from './types';
import { analyzeImageWithOllama, fileToBase64, checkOllamaConnection, RECOMMENDED_MODELS, getInstalledModels } from './services/ollamaService';
import { analyzeImageWithOpenRouter, checkOpenRouterConnection, OPENROUTER_VISION_MODELS } from './services/openrouterService';
import { analyzeImageWithGemini, checkGeminiConnection, GEMINI_MODELS } from './services/geminiService';

const API_BASE = '/api';

import {
  savePhoto,
  savePhotos,
  getAllPhotos,
  getPhotosPage,
  getSettings,
  saveSettings,
  exportData,
  importData,
  clearAllPhotos,
  getFolders,
  addFolder,
  probeFolder,
  updatePhotoStatus,
  updatePhotoTags as apiUpdatePhotoTags,
  resetProcessingPhotos,
  getSystemInfo,
  syncExifTags,
  rewriteExifTags,
  SystemInfo,
  Photo as StoredPhoto,
  startProcessing,
  stopProcessing,
  getProcessingStatus,
  ProcessingStatus,
} from './services/apiService';
import {
  isFileSystemAccessSupported,
  tryRestoreDirectoryAccess,
  requestDirectoryPermission,
  selectAndSaveDirectory,
  getFileFromDirectory,
  getAllFilesFromDirectory,
  clearDirectoryHandle,
} from './services/fileSystemService';

// Add webkitdirectory to InputHTMLAttributes for TypeScript
declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

const App: React.FC = () => {
  // Application State
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  
  // Settings State
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
  const [connectionError, setConnectionError] = useState<string>('');
  const [installedModels, setInstalledModels] = useState<string[]>([]);

  // Scanning state (folder import progress)
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, currentFile: '' });

  const pendingCount = photos.filter(p => p.status === 'pending').length;

  // Backend processing status (polling)
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [tagInput, setTagInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Loading state for long operations
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  
  // Data management
  const [showDataModal, setShowDataModal] = useState(false);
  
  // Link folder input ref
  const linkFolderInputRef = useRef<HTMLInputElement>(null);
  
  // File System Access API state
  const [fsaSupported] = useState(() => isFileSystemAccessSupported());
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderStatus, setFolderStatus] = useState<'none' | 'needs_permission' | 'connected'>('none');
  const [connectedFolderName, setConnectedFolderName] = useState<string | null>(null);

  // Multiple folders support
  const [folders, setFolders] = useState<{ id: string; name: string; path: string }[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // System info (platform, homedir) — loaded once on mount
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({ platform: 'linux', homedir: '/home/user', sep: '/' });

  // Folder path modal state
  const [folderPathModalState, setFolderPathModalState] = useState<{
    open: boolean;
    folderName: string;
    pendingFiles: FileList | null;
  }>({ open: false, folderName: '', pendingFiles: null });

  // Refresh folders from backend
  const refreshFolders = useCallback(async () => {
    try {
      const f = await getFolders();
      setFolders(f.map(fi => ({ id: fi.id, name: fi.name, path: fi.path })));
    } catch { /* ignore */ }
  }, []);

  // Load settings and photos on mount
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setLoadingMessage('Loading saved photos...');
      
      try {
        // Load settings
        const savedSettings = await getSettings();
        if (savedSettings) {
          setSettings({
            provider: savedSettings.provider || 'ollama',
            ollamaUrl: savedSettings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl,
            ollamaModel: savedSettings.ollamaModel || DEFAULT_SETTINGS.ollamaModel,
            openrouterApiKey: savedSettings.openrouterApiKey,
            openrouterModel: savedSettings.openrouterModel,
            geminiApiKey: savedSettings.geminiApiKey,
            geminiModel: savedSettings.geminiModel,
          });
        }

        // Reset any photos stuck in 'processing' on startup (crash recovery)
        const resetCount = await resetProcessingPhotos();
        if (resetCount > 0) {
          console.log(`🔄 Reset ${resetCount} interrupted photos back to 'pending'`);
        }

        // Load system info for path suggestions in the folder modal
        const sysInfo = await getSystemInfo();
        setSystemInfo(sysInfo);
        console.log(`🖥️ System: ${sysInfo.platform}, homedir: ${sysInfo.homedir}`);

        // Load registered folders
        await refreshFolders();

        // ─── Load photos from backend DB ──────────────────────────────────────
        // Only load first 100 to avoid freezing the browser with 10k+ photos.
        // The backend still indexes ALL photos; frontend just shows a sample.
        const savedPhotos = await getAllPhotos();
        const displayLimit = 100;
        const totalCount = savedPhotos.length;

        if (totalCount > 0) {
          const samplePhotos = savedPhotos.slice(0, displayLimit);
          console.log(`📚 Loaded ${totalCount} photos from DB (showing first ${samplePhotos.length})`);

          const loadedPhotos: Photo[] = samplePhotos.map(sp => {
            const thumb = sp.thumbnail || '';
            return {
              id: sp.id,
              file: new File([], sp.name),
              previewUrl: thumb,
              name: sp.name,
              path: sp.path,
              folderPath: sp.folderPath,
              absoluteFolderPath: sp.folderPath,
              tags: sp.tags,
              thumbnail: thumb,
              status: sp.status,
              indexedAt: sp.indexedAt,
            };
          });

          setPhotos(loadedPhotos);
        }
        
        // Try to restore File System Access (Chrome/Edge only)
        if (fsaSupported) {
          console.log('🔗 Checking for saved folder access...');
          const { handle, needsPermission, folderName } = await tryRestoreDirectoryAccess();
          
          if (handle) {
            setConnectedFolderName(folderName);
            setDirectoryHandle(handle);
            
            if (needsPermission) {
              console.log(`📁 Folder "${folderName}" found, needs permission - click "Grant Access" to link files`);
              setFolderStatus('needs_permission');
            } else {
              console.log(`✅ Folder "${folderName}" connected! Files will be linked on-demand.`);
              setFolderStatus('connected');
              // Don't auto-scan the whole folder - it's too slow for 10k+ files
              // Files will be linked when needed (rescan, preview, etc.)
            }
          } else {
            // File System Access API n'a pas de handle persisté, mais le folder peut être
            // connecté côté backend via SQLite. On verra dans rafraîchFolders().
            console.log('📂 Pas d\'accès File System API persisté (le folder backend peut être connecté)');
          }
        } else {
          console.log('⚠️ File System Access API not supported (use Chrome/Edge)');
        }
      } catch (error) {
        console.error('Failed to load saved data:', error);
      } finally {
        setIsLoading(false);
        setLoadingMessage('');
      }
    };
    
    loadData();
    checkConnection();
  }, []);

  // ── Backend processing handlers ────────────────────────────────────────────
  const handleStartProcessing = useCallback(async () => {
    try {
      await startProcessing();
      console.log('▶️ Backend processing started');
    } catch (err) {
      console.error('Failed to start backend processing:', err);
    }
  }, []);

  const handleStopProcessing = useCallback(async () => {
    try {
      await stopProcessing();
      console.log('⏹ Backend processing stopped');
    } catch (err) {
      console.error('Failed to stop backend processing:', err);
    }
  }, []);

  // Check connection when settings change
  useEffect(() => {
    checkConnection();
  }, [settings.provider, settings.ollamaUrl, settings.openrouterApiKey, settings.geminiApiKey]);

  // Auto-retry connection every 30s if in error state and there are pending photos
  useEffect(() => {
    if (connectionStatus !== 'error') return;

    console.log('⏱️ Setting up connection retry every 30s...');
    const interval = setInterval(async () => {
      console.log('🔄 Auto-retrying connection...');
      const ok = await checkConnection();
      if (ok) {
        console.log('✅ Connection restored!');
        clearInterval(interval);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [connectionStatus]);

  // ── Poll backend processing status every 2s ────────────────────────────────
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const status = await getProcessingStatus();
        setProcessingStatus(status);

        // Refresh photos list when backend finishes processing
        if (status.status === 'idle' && status.done > 0 && photos.some(p => p.status === 'pending')) {
          console.log('🔄 Backend finished — refreshing photos list...');
          const savedPhotos = await getAllPhotos();
          const loadedPhotos = savedPhotos.map(sp => ({
            id: sp.id,
            file: new File([], sp.name),
            previewUrl: sp.thumbnail || '',
            name: sp.name,
            path: sp.path,
            folderPath: sp.folderPath,
            absoluteFolderPath: sp.folderPath,
            tags: sp.tags,
            thumbnail: sp.thumbnail,
            status: sp.status,
            indexedAt: sp.indexedAt,
          }));
          setPhotos(loadedPhotos);
          refreshFolders();
        }
      } catch (err) {
        // If the endpoint doesn't exist yet or server isn't ready, set a default idle state
        if (!processingStatus) {
          setProcessingStatus({
            status: 'idle',
            done: 0,
            total: 0,
            percent: 0,
            currentPhoto: '',
            startTime: null,
          });
        }
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const checkConnection = async () => {
    console.log(`🔄 Checking connection for provider: ${settings.provider}`);
    console.log(`📍 Ollama URL: ${settings.ollamaUrl}`);
    
    try {
      let isConnected = false;
      
      switch (settings.provider) {
        case 'ollama':
          console.log('🦙 Testing Ollama connection...');
          isConnected = await checkOllamaConnection(settings.ollamaUrl);
          console.log(`🦙 Ollama connection result: ${isConnected}`);
          if (isConnected) {
            const models = await getInstalledModels(settings.ollamaUrl);
            setInstalledModels(models);
            console.log(`🦙 Installed models:`, models);

            // Verify the selected model is actually installed
            const modelBase = settings.ollamaModel.split(':')[0];
            const isInstalled = models.some(m => m.startsWith(modelBase));
            if (!isInstalled) {
              console.warn(`🦙 Model "${settings.ollamaModel}" is NOT installed. Installed models:`, models);
              isConnected = false;
              setConnectionError(`Model "${settings.ollamaModel}" is not installed.`);
            } else {
              console.log(`🦙 Model "${settings.ollamaModel}" is installed.`);
            }
          }
          break;
        case 'openrouter':
          if (settings.openrouterApiKey) {
            isConnected = await checkOpenRouterConnection(settings.openrouterApiKey);
          }
          break;
        case 'gemini':
          if (settings.geminiApiKey) {
            isConnected = await checkGeminiConnection(settings.geminiApiKey);
          }
          break;
      }
      
      console.log(`✅ Final connection status: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
      setConnectionStatus(isConnected ? 'connected' : 'error');
      return isConnected;
    } catch (error) {
      console.error('❌ Connection check failed with exception:', error);
      setConnectionStatus('error');
      setConnectionError(error instanceof Error ? error.message : 'Connection failed');
      return false;
    }
  };

  // Save settings when they change
  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    await saveSettings(updated);
  };

  // Derived state: Unique categories
  const categories: Category[] = useMemo(() => {
    const catMap = new Map<string, number>();
    photos.forEach(p => {
      p.tags.forEach(tag => {
        catMap.set(tag, (catMap.get(tag) || 0) + 1);
      });
    });
    return Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    let result = photos;
    if (selectedFolder) {
      // BUG FIX #2: Filter by absoluteFolderPath OR folderPath (handle both old and new records)
      result = result.filter(p => 
        p.absoluteFolderPath === selectedFolder || 
        p.folderPath === selectedFolder
      );
    }
    if (selectedCategory) {
      result = result.filter(p => p.tags.includes(selectedCategory));
    }
    return result;
  }, [photos, selectedFolder, selectedCategory]);

  const processedCount = photos.filter(p => p.status === 'done' || p.status === 'error').length;

  // Analyze image based on current provider
  const analyzeImage = async (base64Data: string, mimeType: string): Promise<string[]> => {
    switch (settings.provider) {
      case 'ollama':
        return analyzeImageWithOllama(base64Data, {
          url: settings.ollamaUrl,
          model: settings.ollamaModel,
        });
      case 'openrouter':
        if (!settings.openrouterApiKey || !settings.openrouterModel) {
          throw new Error('OpenRouter API key and model required');
        }
        return analyzeImageWithOpenRouter(base64Data, mimeType, {
          apiKey: settings.openrouterApiKey,
          model: settings.openrouterModel,
        });
      case 'gemini':
        if (!settings.geminiApiKey) {
          throw new Error('Gemini API key required');
        }
        return analyzeImageWithGemini(base64Data, mimeType, {
          apiKey: settings.geminiApiKey,
          model: settings.geminiModel,
        });
      default:
        throw new Error(`Unknown provider: ${settings.provider}`);
    }
  };

  // ─── Photo ref (for latest state access) ───────────────────────────────────
  const photosRef = useRef<Photo[]>([]);
  useEffect(() => { photosRef.current = photos; }, [photos]);

  /**
   * Step 1 — called when the user picks a folder via the native file picker.
   * Validates the selection, checks the AI connection, then opens FolderPathModal
   * to ask for the absolute server-side path before proceeding.
   */
  const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    console.log('📁 Folder selected, files:', files?.length);
    
    if (!files || files.length === 0) {
      console.log('❌ No files found');
      return;
    }

    // Auto-retry connection if it was previously failed
    if (connectionStatus !== 'connected') {
      const isNowConnected = await checkConnection();
      if (!isNowConnected) {
        const providerName = settings.provider === 'ollama' ? 'Ollama' : 
                            settings.provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
        alert(`Connection Failed: Please check your ${providerName} configuration in settings.`);
        setShowSettings(true);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    // Determine folder name from the first file's relative path
    const firstFile = files[0];
    const relativeFolderName = firstFile.webkitRelativePath?.split('/')[0] || 'Imported';

    // Open the modal — the modal queries the backend for real paths
    setFolderPathModalState({
      open: true,
      folderName: relativeFolderName,
      pendingFiles: files,
    });
  };

  /**
   * Step 2 — called when the user confirms (or cancels) the path modal.
   *
   * TWO-MODE FLOW depending on whether the backend can access the folder:
   *
   * MODE A — pathAccessible=true (normal case):
   *   1. POST /folders → backend scans + creates UUID photo rows
   *   2. GET /photos   → frontend loads DB records (stable UUIDs)
   *   3. Photo[] built from DB; real File attached if name matches
   *   4. Done photos shown immediately; backend handles AI processing
   *
   * MODE B — pathAccessible=false (backend on different OS/drive, e.g. Node on
   *           Windows but path is already in DB from a previous session, or path
   *           is temporarily unavailable):
   *   - Folder is still registered in DB (id obtained)
   *   - Frontend builds Photo[] directly from browser File picker
   *   - Real File blobs are attached → LLM processing works fully
   *   - EXIF write will be skipped (server can't reach files), user is warned
   *   - A small "path debug" report is shown so the user can fix the path
   */
  const handleFolderPathConfirm = async (absoluteFolderPath: string | null) => {
    const { pendingFiles } = folderPathModalState;
    setFolderPathModalState(s => ({ ...s, open: false }));

    if (!absoluteFolderPath || !pendingFiles) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const cleanAbsolutePath = absoluteFolderPath.trim().replace(/[/\\]+$/, '');

    setIsScanning(true);
    setScanProgress({ current: 0, total: 0, currentFile: 'Enregistrement du dossier…' });

    // ── Step 1: register folder with backend (tolerant — never throws 400) ────
    let folderId: string | null = null;
    let pathAccessible = false;
    try {
      const folderResult = await addFolder(cleanAbsolutePath);
      folderId = folderResult.id;
      pathAccessible = folderResult.pathAccessible;
      console.log(`✅ Folder registered: ${cleanAbsolutePath} (id: ${folderId}, accessible: ${pathAccessible}, newPhotos: ${folderResult.newPhotos})`);
      await refreshFolders();
    } catch (err) {
      // Network error or unexpected server crash — abort
      console.error(`❌ addFolder failed: ${err}`);
      setIsScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      alert(`Erreur réseau lors de l'enregistrement du dossier :\n${err}`);
      return;
    }

    // ── Step 2: load DB photos for this folder ────────────────────────────────
    setScanProgress({ current: 0, total: 0, currentFile: 'Chargement depuis la base de données…' });
    let allDbPhotos: StoredPhoto[] = [];
    try {
      allDbPhotos = await getAllPhotos();
    } catch (e) {
      console.warn('Could not load photos from DB:', e);
    }

    const folderDbPhotos = allDbPhotos.filter(p => p.folderPath === cleanAbsolutePath);
    console.log(`📚 DB has ${folderDbPhotos.length} photos for this folder`);

    // ── Step 3: build Photo[] ─────────────────────────────────────────────────
    // Map browser File objects by filename for quick lookup
    const filesByName = new Map<string, File>();
    Array.from(pendingFiles).forEach(f => filesByName.set(f.name, f));

    const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
    const RAW_EXTS = new Set(['.cr2','.cr3','.nef','.nrw','.arw','.srf','.orf','.rw2',
      '.raf','.dng','.raw','.rwl','.pef','.srw','.x3f','.3fr','.iiq','.erf','.kdc',
      '.dcr','.tif','.tiff','.psd','.psb']);

    let photosToProcess: Photo[] = [];

    if (pathAccessible && folderDbPhotos.length > 0) {
      // MODE A: backend scanned successfully → use DB UUIDs
      photosToProcess = folderDbPhotos.map(sp => {
        const realFile = filesByName.get(sp.name);
        return {
          id: sp.id,
          file: realFile ?? new File([], sp.name), // size=0 → /preview fallback
          previewUrl: '',
          name: sp.name,
          path: sp.path,
          folderPath: sp.folderPath,
          absoluteFolderPath: sp.folderPath,
          tags: sp.tags,
          status: sp.status,
          indexedAt: sp.indexedAt,
        };
      });
    } else {
      // MODE B: backend can't read the folder OR scanFolder returned 0 photos
      // (e.g. different OS/drive). Build Photo[] from browser File picker.
      // Use DB records for already-done photos; create new entries for new ones.
      if (!pathAccessible) {
        console.warn(`⚠️ Backend cannot access path, using browser File API (EXIF write disabled)`);
      }

      // Probe to help user debug path issues
      try {
        const probe = await probeFolder(cleanAbsolutePath);
        console.log('🔍 Path probe:', probe);
        if (!probe.exists && probe.parentEntries.length > 0) {
          const similar = probe.parentEntries
            .filter(e => e.toLowerCase().includes(cleanAbsolutePath.split(/[/\\]/).pop()?.toLowerCase() || ''))
            .slice(0, 5);
          if (similar.length > 0) {
            console.log(`💡 Similar folder names in parent: ${similar.join(', ')}`);
          }
        }
      } catch { /* probe is best-effort */ }

      // Build set of already-done paths from DB
      const donePathsInDb = new Set(folderDbPhotos.filter(p => p.status === 'done').map(p => p.path));

      const filesArray = Array.from(pendingFiles);
      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        setScanProgress({ current: i + 1, total: filesArray.length, currentFile: file.name });

        const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        if (RAW_EXTS.has(ext)) continue;
        if (!IMAGE_EXTS.has(ext) && !file.type.startsWith('image/')) continue;

        const relPath = file.webkitRelativePath
          ? file.webkitRelativePath.split('/').slice(1).join('/')
          : file.name;
        const absoluteFilePath = `${cleanAbsolutePath}/${relPath}`;

        // Check if already done in DB
        const dbEntry = folderDbPhotos.find(p => p.path === absoluteFilePath || p.name === file.name);
        if (dbEntry && dbEntry.status === 'done') {
          photosToProcess.push({
            id: dbEntry.id,
            file,
            previewUrl: '',
            name: dbEntry.name,
            path: dbEntry.path,
            folderPath: cleanAbsolutePath,
            absoluteFolderPath: cleanAbsolutePath,
            tags: dbEntry.tags,
            status: 'done',
            indexedAt: dbEntry.indexedAt,
          });
          continue;
        }

        // New photo or pending — use existing DB id if available, else generate one
        const existingId = dbEntry?.id ?? Math.random().toString(36).substring(2, 9);
        photosToProcess.push({
          id: existingId,
          file,
          previewUrl: '',
          name: file.name,
          path: absoluteFilePath,
          folderPath: cleanAbsolutePath,
          absoluteFolderPath: cleanAbsolutePath,
          tags: dbEntry?.tags ?? [],
          status: dbEntry?.status === 'done' ? 'done' : 'pending',
          indexedAt: dbEntry?.indexedAt,
        });

        if (i % 50 === 0) await new Promise(r => setTimeout(r, 10));
      }

      if (!pathAccessible) {
        // Probe for actionable hint
        try {
          const probe = await probeFolder(cleanAbsolutePath);
          const parentInfo = probe.parentEntries.length > 0
            ? `\n\nDossiers disponibles dans "${probe.parentPath}" :\n${probe.parentEntries.slice(0, 10).join('\n')}`
            : '';
          console.warn(
            `[PATH PROBE] platform=${probe.platform} homedir=${probe.homedir}\n` +
            `inputPath="${probe.inputPath}" exists=${probe.exists}${parentInfo}`
          );
        } catch { /* ignore */ }
      }
    }

    setIsScanning(false);

    if (photosToProcess.length === 0) {
      alert('Aucune image trouvée. Vérifiez le chemin et les extensions supportées (.jpg, .jpeg, .png, .gif, .webp, .bmp).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // ── Step 4: merge into state and queue pending IDs ────────────────────────
    const pendingIds = photosToProcess.filter(p => p.status === 'pending').map(p => p.id);
    const doneCount = photosToProcess.filter(p => p.status === 'done').length;

    console.log(`▶️ ${pendingIds.length} à traiter, ${doneCount} déjà indexées`);

    if (!pathAccessible && pendingIds.length > 0) {
      console.info('ℹ️ Traitement via File API navigateur — les métadonnées EXIF ne seront pas écrites (chemin inaccessible côté serveur).');
    }

    setPhotos(prev => {
      const others = prev.filter(p => p.folderPath !== cleanAbsolutePath);
      const merged = [...others, ...photosToProcess];
      return merged;
    });

    if (doneCount > 0 && pendingIds.length === 0) {
      alert(`Toutes les ${doneCount} photos de ce dossier sont déjà indexées !`);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Tag Management
  const addTag = (tag: string) => {
    if (!selectedPhoto) return;
    const formattedTag = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
    
    if (selectedPhoto.tags.includes(formattedTag)) return;
    
    const newTags = [...selectedPhoto.tags, formattedTag];
    updatePhotoTags(selectedPhoto.id, newTags);
  };

  const removeTag = (tagToRemove: string) => {
    if (!selectedPhoto) return;
    const newTags = selectedPhoto.tags.filter(t => t !== tagToRemove);
    updatePhotoTags(selectedPhoto.id, newTags);
  };

  const updatePhotoTags = async (photoId: string, newTags: string[]) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, tags: newTags } : p));
    setSelectedPhoto(prev => prev ? { ...prev, tags: newTags } : null);
    
    // Update in backend DB - use apiUpdatePhotoTags which triggers EXIF write server-side
    try {
      await apiUpdatePhotoTags(photoId, newTags);
    } catch (err) {
      console.warn('Failed to update photo tags in backend:', err);
      // Fallback: use full savePhoto — include thumbnail so it is not lost
      const photo = photos.find(p => p.id === photoId);
      if (photo) {
        const absoluteFolderPath = photo.absoluteFolderPath || photo.folderPath || '';
        const absoluteFilePath = photo.path && photo.path.startsWith('/')
          ? photo.path
          : absoluteFolderPath ? `${absoluteFolderPath}/${photo.name}` : (photo.path || '');
        const storedPhoto: StoredPhoto = {
          id: photo.id,
          name: photo.name,
          path: absoluteFilePath,
          folderPath: absoluteFolderPath,
          size: photo.file.size,
          lastModified: photo.file.lastModified,
          mimeType: photo.file.type,
          tags: newTags,
          thumbnail: photo.thumbnail,   // ← preserve thumbnail
          status: photo.status,
          indexedAt: photo.indexedAt,
        };
        await savePhoto(storedPhoto);
      }
    }
  };

  const handleTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tagInput.trim()) {
      addTag(tagInput.trim());
      setTagInput('');
    }
  };

  // Data export/import handlers
  const handleExportData = async () => {
    try {
      const data = await exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photo-index-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export data');
    }
  };

  const handleImportData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = await importData(text);
      alert(`Successfully imported ${result.photosImported} photos`);
      window.location.reload(); // Reload to reflect imported data
    } catch (error) {
      console.error('Import failed:', error);
      alert('Failed to import data. Please check the file format.');
    }
  };

  const handleClearData = async () => {
    if (confirm('Supprimer toutes les données indexées ? Cette action est irréversible.')) {
      try {
        setIsLoading(true);
        setLoadingMessage('Suppression en cours…');
        await clearAllPhotos();
        // Also clear the frontend File System Access handle so stale access
        // doesn't trigger auto-rescan of the same folder after reload
        await clearDirectoryHandle();
        // Server stays alive — nukeDb() wiped the DB in-place, no restart needed.
        window.location.reload();
      } catch (err) {
        setIsLoading(false);
        console.error('Clear failed:', err);
        alert(`Erreur lors de la suppression : ${err}`);
      }
    }
  };

  // ─── EXIF Sync handlers ───────────────────────────────────────────────────
  const handleSyncExif = async () => {
    setShowDataModal(false);
    setIsLoading(true);
    setLoadingMessage('Synchronisation EXIF en cours...');
    try {
      const result = await syncExifTags('both', selectedFolder || undefined);
      const msg = [
        `✅ Synchronisation EXIF terminée`,
        ``,
        `📥 Tags lus depuis les fichiers et injectés en DB : ${result.injected}`,
        `📤 Tags DB écrits dans les métadonnées des fichiers : ${result.written}`,
        `⏭️  Photos déjà synchronisées (ignorées) : ${result.skipped}`,
        result.missing > 0 ? `⚠️  Fichiers introuvables sur le disque : ${result.missing}` : '',
        ``,
        `Total analysé : ${result.total}`,
      ].filter(Boolean).join('\n');
      alert(msg);
      // Reload photos to reflect injected tags
      const savedPhotos = await getAllPhotos();
      if (savedPhotos.length > 0) {
        setPhotos(prev => prev.map(p => {
          const updated = savedPhotos.find(s => s.id === p.id);
          return updated ? { ...p, tags: updated.tags, status: updated.status as Photo['status'] } : p;
        }));
      }
    } catch (err) {
      alert(`Erreur sync EXIF : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handleRewriteExif = async () => {
    const doneWithTags = photos.filter(p => p.status === 'done' && p.tags.length > 0).length;
    if (!confirm(`Réécrire les métadonnées EXIF pour ${doneWithTags} photos indexées ?\n\nCela écrase les métadonnées existantes avec les tags de la base de données.`)) return;
    setShowDataModal(false);
    setIsLoading(true);
    setLoadingMessage('Réécriture EXIF en cours...');
    try {
      const result = await rewriteExifTags(selectedFolder || undefined);
      alert(`✅ EXIF réécrits\n\n📤 Fichiers mis à jour : ${result.written}\n⚠️  Fichiers manquants : ${result.missing}\nTotal : ${result.total}`);
    } catch (err) {
      alert(`Erreur réécriture EXIF : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // Export CSV for Excel analysis
  const handleExportCSV = () => {
    try {
      // CSV header
      const headers = ['Filename', 'Folder', 'Tags', 'Tag Count', 'Status', 'Indexed At'];
      
      // Build rows
      const rows = photos.map(photo => {
        const tags = photo.tags.join('; '); // Use semicolon to avoid CSV comma issues
        const tagCount = photo.tags.filter(t => t !== 'Uncategorized' && t !== 'Error-EmptyResponse').length;
        const indexedAt = photo.indexedAt ? new Date(photo.indexedAt).toLocaleString() : '';
        
        return [
          photo.name,
          photo.folderPath || '',
          tags,
          tagCount.toString(),
          photo.status,
          indexedAt
        ].map(field => {
          // Escape fields with quotes or commas
          if (field.includes(',') || field.includes('"') || field.includes('\n')) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        }).join(',');
      });

      // Combine header and rows
      const csvContent = [headers.join(','), ...rows].join('\n');
      
      // Add BOM for Excel UTF-8 compatibility
      const bom = '\uFEFF';
      const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photo-tags-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      console.log(`📊 Exported ${photos.length} photos to CSV`);
    } catch (error) {
      console.error('CSV export failed:', error);
      alert('Failed to export CSV');
    }
  };

  // Retry photos that ended up as "Uncategorized"
  const handleRetryUncategorized = async () => {
    const uncategorizedPhotos = photos.filter(p => 
      p.tags.length === 1 && p.tags[0] === 'Uncategorized'
    );
    
    if (uncategorizedPhotos.length === 0) {
      alert('No uncategorized photos to retry!');
      return;
    }
    
    // Check if we have a connected folder handle
    if (!directoryHandle) {
      alert(
        `⚠️ No folder connected!\n\n` +
        `To retry uncategorized photos, you need to connect the original folder:\n\n` +
        `1. Click "Change folder..." in the sidebar\n` +
        `2. Select your Photos folder\n` +
        `3. Then come back here to retry`
      );
      return;
    }
    
    // Confirm before proceeding
    const confirmRetry = confirm(
      `Found ${uncategorizedPhotos.length} uncategorized photos.\n\n` +
      `The app will link the files from "${connectedFolderName}" and re-analyze them.\n\n` +
      `This may take a moment. Continue?`
    );
    
    if (!confirmRetry) return;
    
    console.log(`🔄 Linking and retrying ${uncategorizedPhotos.length} uncategorized photos...`);
    
    // Show loading indicator
    setIsLoading(true);
    setLoadingMessage(`Linking ${uncategorizedPhotos.length} photos...`);
    
    try {
      // Link files on-demand for just the uncategorized photos
      let linkedCount = 0;
      const photosToRetry: string[] = [];
      const updatedPhotos: Photo[] = [];
      
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        
        // Only process uncategorized photos
        if (!(photo.tags.length === 1 && photo.tags[0] === 'Uncategorized')) {
          updatedPhotos.push(photo);
          continue;
        }
        
        // Update loading message periodically
        if (linkedCount % 10 === 0) {
          setLoadingMessage(`Linking files... ${linkedCount}/${uncategorizedPhotos.length}`);
        }
        
        // Already has a valid file?
        if (photo.file && photo.file.size > 0) {
          linkedCount++;
          photosToRetry.push(photo.id);
          updatedPhotos.push({ ...photo, tags: [], status: 'pending' as const });
          continue;
        }
        
        // Try to get the file from the directory handle
        const file = await getFileFromDirectory(directoryHandle, photo.path || '');
        if (file) {
          linkedCount++;
          photosToRetry.push(photo.id);
          updatedPhotos.push({ ...photo, file, previewUrl: '', tags: [], status: 'pending' as const });
          continue;
        }
        
        // Try by filename only
        const fileByName = await getFileFromDirectory(directoryHandle, photo.name);
        if (fileByName) {
          linkedCount++;
          photosToRetry.push(photo.id);
          updatedPhotos.push({ ...photo, file: fileByName, previewUrl: '', tags: [], status: 'pending' as const });
          continue;
        }
        
        console.log(`⚠️ Could not find file for: ${photo.name}`);
        updatedPhotos.push(photo);
      }
      
      if (linkedCount === 0) {
        setIsLoading(false);
        setLoadingMessage('');
        alert(
          `⚠️ Could not find any matching files!\n\n` +
          `Make sure you selected the correct folder containing your photos.`
        );
        return;
      }
    
      setPhotos(updatedPhotos);

      console.log(`✅ Linked ${linkedCount}/${uncategorizedPhotos.length} photos`);
    } catch (error) {
      console.error('Error during retry:', error);
      alert('An error occurred while linking files. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // Link files from a FileSystemDirectoryHandle (File System Access API)
  const linkFilesFromHandle = async (
    handle: FileSystemDirectoryHandle,
    photosToLink: Photo[] = photos
  ) => {
    console.log(`🔗 Linking files from directory handle: ${handle.name}`);
    
    // Get all files from the directory
    const allFiles = await getAllFilesFromDirectory(handle, handle.name);
    console.log(`📂 Found ${allFiles.size} image files in directory`);
    
    // Show sample paths
    const samplePaths = Array.from(allFiles.keys()).slice(0, 5);
    console.log('📂 Sample file paths:', samplePaths);
    
    // Show sample from DB
    const samplePhotos = photosToLink.slice(0, 3);
    console.log('📷 Sample photos from DB:');
    samplePhotos.forEach(p => {
      console.log(`   name: "${p.name}", path: "${p.path}"`);
    });
    
    let linkedCount = 0;
    let matchedByPath = 0;
    let matchedByRelative = 0;
    let matchedByName = 0;
    
    const updatedPhotos = photosToLink.map(photo => {
      // Already has a valid file? Count it
      if (photo.file && photo.file.size > 0) {
        linkedCount++;
        return photo;
      }
      
      let matchedFile: File | undefined;
      
      // Try 1: Full path match (e.g., "Photos/subdir/IMG_001.jpg")
      if (photo.path) {
        matchedFile = allFiles.get(photo.path);
        if (matchedFile) {
          matchedByPath++;
        }
      }
      
      // Try 2: Path without root folder
      if (!matchedFile && photo.path) {
        const pathParts = photo.path.split('/');
        if (pathParts.length > 1) {
          const relativePath = pathParts.slice(1).join('/');
          // Try with directory name prefix
          matchedFile = allFiles.get(`${handle.name}/${relativePath}`);
          if (matchedFile) {
            matchedByRelative++;
          }
        }
      }
      
      // Try 3: Just filename
      if (!matchedFile) {
        matchedFile = allFiles.get(photo.name);
        if (matchedFile) {
          matchedByName++;
        }
      }
      
      if (matchedFile && matchedFile.size > 0) {
        linkedCount++;
        return {
          ...photo,
          file: matchedFile,
          previewUrl: '', // Will be lazy-loaded
        };
      }
      
      return photo;
    });
    
    setPhotos(updatedPhotos);
    
    console.log(`✅ Linked ${linkedCount} photos:`);
    console.log(`   By full path: ${matchedByPath}`);
    console.log(`   By relative path: ${matchedByRelative}`);
    console.log(`   By filename: ${matchedByName}`);
    
    return { linkedCount, matchedByPath, matchedByRelative, matchedByName };
  };

  // Request permission for stored folder (called when user clicks "Grant Access")
  const handleRequestFolderPermission = async () => {
    if (!directoryHandle) return;
    
    const granted = await requestDirectoryPermission(directoryHandle);
    if (granted) {
      setFolderStatus('connected');
      console.log('✅ Permission granted, linking files...');
      
      // Link files to photos
      const result = await linkFilesFromHandle(directoryHandle);
      
      alert(
        `✅ Folder "${connectedFolderName}" connected!\n\n` +
        `Linked ${result.linkedCount} photos.\n` +
        `Previews will load as you scroll.`
      );
    } else {
      alert('Permission denied. Please try again or select a new folder.');
    }
  };

  // Select a new folder using File System Access API
  const handleSelectFolderFSA = async () => {
    const handle = await selectAndSaveDirectory();
    if (handle) {
      setDirectoryHandle(handle);
      setConnectedFolderName(handle.name);
      setFolderStatus('connected');
      
      console.log(`✅ New folder selected: ${handle.name}`);
      
      // Link files to photos
      const result = await linkFilesFromHandle(handle);
      
      alert(
        `✅ Folder "${handle.name}" connected and saved!\n\n` +
        `Linked ${result.linkedCount} photos.\n` +
        `This folder will be remembered for future sessions.`
      );
    }
  };

  // Link an existing folder to show previews for indexed photos (legacy fallback)
  const handleLinkFolder = () => {
    // If File System Access API is supported, use it instead
    if (fsaSupported) {
      handleSelectFolderFSA();
      return;
    }
    // Fallback to old method
    linkFolderInputRef.current?.click();
  };

  const handleLinkFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      console.log('❌ No files selected');
      return;
    }

    console.log(`🔗 Linking folder with ${files.length} files...`);
    
    // Show loading indicator
    setIsLoading(true);
    setLoadingMessage(`Linking ${files.length} files to ${photos.length} photos...`);
    
    // Build multiple maps for flexible matching
    const fileByFullPath = new Map<string, File>();      // "Photos/subdir/IMG_001.jpg"
    const fileByRelativePath = new Map<string, File>();  // "subdir/IMG_001.jpg" (without root folder)
    const fileByName = new Map<string, File>();          // "IMG_001.jpg"
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fullPath = file.webkitRelativePath || file.name;
      
      // Full path: "Photos/subdir/IMG_001.jpg"
      fileByFullPath.set(fullPath, file);
      
      // Relative path without root folder: "subdir/IMG_001.jpg"
      const pathParts = fullPath.split('/');
      if (pathParts.length > 1) {
        const relativePath = pathParts.slice(1).join('/');
        fileByRelativePath.set(relativePath, file);
      }
      
      // Just filename: "IMG_001.jpg"
      fileByName.set(file.name, file);
    }
    
    // Debug: show first few entries from each map
    console.log('📂 File maps built:');
    console.log(`   Full paths: ${fileByFullPath.size} entries`);
    console.log(`   Relative paths: ${fileByRelativePath.size} entries`);
    console.log(`   By name: ${fileByName.size} entries`);
    
    // Show sample from DB
    const samplePhotos = photos.slice(0, 3);
    console.log('📷 Sample photos from DB:');
    samplePhotos.forEach(p => {
      console.log(`   name: "${p.name}", path: "${p.path}", folderPath: "${p.folderPath}"`);
    });

    // Match files with existing photos
    let linkedCount = 0;
    let matchedByPath = 0;
    let matchedByRelative = 0;
    let matchedByName = 0;
    
    const updatedPhotos = photos.map(photo => {
      // Already has a valid file? Skip
      if (photo.file && photo.file.size > 0) {
        linkedCount++;
        return photo;
      }
      
      let matchedFile: File | undefined;
      
      // Try 1: Full path match (e.g., "Photos/IMG_001.jpg")
      if (photo.path) {
        matchedFile = fileByFullPath.get(photo.path);
        if (matchedFile) matchedByPath++;
      }
      
      // Try 2: Path without root folder (e.g., stored as "Photos/sub/IMG.jpg", file is "NewFolder/sub/IMG.jpg")
      if (!matchedFile && photo.path) {
        const pathParts = photo.path.split('/');
        if (pathParts.length > 1) {
          const relativePath = pathParts.slice(1).join('/');
          matchedFile = fileByRelativePath.get(relativePath);
          if (matchedFile) matchedByRelative++;
        }
      }
      
      // Try 3: Just by filename
      if (!matchedFile) {
        matchedFile = fileByName.get(photo.name);
        if (matchedFile) matchedByName++;
      }
      
      if (matchedFile && matchedFile.size > 0) {
        linkedCount++;
        return {
          ...photo,
          file: matchedFile,
          previewUrl: '' // Will be lazy-loaded when visible
        };
      }
      return photo;
    });

    setPhotos(updatedPhotos);
    
    console.log(`✅ Linked ${linkedCount} photos:`);
    console.log(`   By full path: ${matchedByPath}`);
    console.log(`   By relative path: ${matchedByRelative}`);
    console.log(`   By filename: ${matchedByName}`);
    
    if (linkedCount > 0) {
      alert(
        `Successfully linked ${linkedCount} photos!\n\n` +
        `• By path: ${matchedByPath}\n` +
        `• By relative path: ${matchedByRelative}\n` +
        `• By filename: ${matchedByName}\n\n` +
        `Previews will load as you scroll.`
      );
    } else {
      // Show debug info
      const sampleFile = files[0];
      const samplePhoto = photos[0];
      alert(
        `No matching files found.\n\n` +
        `Debug info:\n` +
        `• Selected folder has ${files.length} files\n` +
        `• DB has ${photos.length} photos\n` +
        `• Sample file path: "${sampleFile?.webkitRelativePath}"\n` +
        `• Sample DB path: "${samplePhoto?.path}"\n\n` +
        `Make sure you're selecting the same folder structure.`
      );
    }

    // Hide loading indicator
    setIsLoading(false);
    setLoadingMessage('');
    
    // Reset the input
    if (linkFolderInputRef.current) {
      linkFolderInputRef.current.value = '';
    }
  };

  // Check if there are photos without previews (unlinked)
  const hasUnlinkedPhotos = useMemo(() => {
    return photos.some(p => !p.previewUrl && (!p.file || p.file.size === 0));
  }, [photos]);

  // Count uncategorized photos
  const uncategorizedCount = useMemo(() => {
    return photos.filter(p => p.tags.length === 1 && p.tags[0] === 'Uncategorized').length;
  }, [photos]);

  // Provider display info
  const getProviderInfo = () => {
    switch (settings.provider) {
      case 'ollama':
        return { name: 'Ollama', model: settings.ollamaModel, icon: '🦙' };
      case 'openrouter':
        return { name: 'OpenRouter', model: settings.openrouterModel || 'Not set', icon: '🌐' };
      case 'gemini':
        return { name: 'Gemini', model: settings.geminiModel || 'gemini-1.5-flash', icon: '✨' };
      default:
        return { name: 'Unknown', model: '', icon: '❓' };
    }
  };

  const providerInfo = getProviderInfo();

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Folder Path Modal — shown when user picks a folder to get the absolute server path */}
      {folderPathModalState.open && (
        <FolderPathModal
          folderName={folderPathModalState.folderName}
          onConfirm={handleFolderPathConfirm}
        />
      )}

      {/* Loading Overlay for long operations */}
      {isLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-xl border border-zinc-700 p-8 shadow-2xl max-w-md w-full mx-4">
            <div className="flex flex-col items-center gap-4">
              {/* Spinner */}
              <div className="w-12 h-12 border-4 border-zinc-700 border-t-orange-500 rounded-full animate-spin"></div>
              {/* Message */}
              <div className="text-center">
                <p className="text-lg font-medium text-white">{loadingMessage || 'Processing...'}</p>
                <p className="text-sm text-zinc-400 mt-1">Please wait, this may take a moment</p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <Sidebar
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        totalPhotos={photos.length}
        processedCount={processedCount}
        isProcessing={isScanning || (processingStatus?.status === 'running')}
        onAddPhotos={() => fileInputRef.current?.click()}
        onLinkFolder={handleLinkFolder}
        hasUnlinkedPhotos={hasUnlinkedPhotos}
        onRetryUncategorized={handleRetryUncategorized}
        uncategorizedCount={uncategorizedCount}
        folderStatus={folderStatus}
        connectedFolderName={connectedFolderName}
        onRequestPermission={handleRequestFolderPermission}
        folders={folders}
        selectedFolder={selectedFolder}
        onSelectFolder={(path) => {
          setSelectedFolder(path);
        }}
        onAddFolder={handleLinkFolder}
        processingStatus={processingStatus}
        onStartProcessing={handleStartProcessing}
        onStopProcessing={handleStopProcessing}
        connectionStatus={connectionStatus}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header */}
        <div className="h-16 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-10">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {selectedFolder ? `${folders.find(f => f.path === selectedFolder)?.name || 'Folder'}` : selectedCategory ? `${selectedCategory} Gallery` : 'All Photos'}
            </h2>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <p className="text-xs text-zinc-400">
                {connectionStatus === 'connected' 
                  ? `${providerInfo.icon} ${providerInfo.name} (${providerInfo.model})` 
                  : `${providerInfo.icon} ${providerInfo.name} Disconnected`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Data Management Button */}
            <button 
              onClick={() => setShowDataModal(true)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              title="Data Management"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
            </button>
            
            {/* Settings Button */}
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              title="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            
            {/* Add Folder Button - using label for native file picker behavior */}
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors shadow-lg shadow-orange-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              <span>Add Folder</span>
              <input 
                ref={fileInputRef}
                type="file" 
                webkitdirectory=""
                directory=""
                multiple 
                style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
                onChange={(e) => {
                  console.log('📂 Input onChange triggered!');
                  handleFolderSelect(e);
                }} 
              />
            </label>
            
            {/* Hidden input for linking folder */}
            <input 
              ref={linkFolderInputRef}
              type="file" 
              webkitdirectory=""
              directory=""
              multiple 
              style={{ display: 'none' }}
              onChange={handleLinkFolderSelect} 
            />
          </div>
        </div>

        {/* Settings Modal */}
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-lg overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-800/50 sticky top-0">
                <h3 className="font-semibold text-white">Settings</h3>
                <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                {/* Provider Selection */}
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">AI Provider</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['ollama', 'openrouter', 'gemini'] as AIProvider[]).map(provider => (
                      <button
                        key={provider}
                        onClick={() => updateSettings({ provider })}
                        className={`p-3 rounded-lg border text-sm font-medium transition-all ${
                          settings.provider === provider
                            ? 'bg-orange-600/20 border-orange-500 text-orange-300'
                            : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        {provider === 'ollama' && '🦙 Ollama'}
                        {provider === 'openrouter' && '🌐 OpenRouter'}
                        {provider === 'gemini' && '✨ Gemini'}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-2">
                    {settings.provider === 'ollama' && 'Local processing - your data stays on your machine'}
                    {settings.provider === 'openrouter' && 'Cloud API - access to GPT-4V, Claude, etc.'}
                    {settings.provider === 'gemini' && 'Google Cloud API - Gemini Flash/Pro'}
                  </p>
                </div>

                {/* Connection Status */}
                {connectionStatus === 'error' && (
                  <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg">
                    <p className="text-xs text-red-200 font-semibold mb-1">Connection Failed</p>
                    <p className="text-[10px] text-red-300">{connectionError}</p>
                    {settings.provider === 'ollama' && connectionError.includes('not installed') && (
                      <p className="text-[10px] text-yellow-300 mt-1">
                        Pull the model with:<br/>
                        <code className="bg-black/30 px-1 rounded block mt-1">docker exec ollama ollama pull {settings.ollamaModel}</code>
                      </p>
                    )}
                    {settings.provider === 'ollama' && !connectionError.includes('not installed') && (
                      <p className="text-[10px] text-red-300 mt-1">
                        Check CORS settings or that Ollama is running.
                      </p>
                    )}
                  </div>
                )}

                {/* Ollama Settings */}
                {settings.provider === 'ollama' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Server URL</label>
                      <input 
                        type="text" 
                        value={settings.ollamaUrl}
                        onChange={(e) => updateSettings({ ollamaUrl: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                        placeholder="http://localhost:11434"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Vision Model</label>
                      <select
                        value={settings.ollamaModel}
                        onChange={(e) => updateSettings({ ollamaModel: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                      >
                        {RECOMMENDED_MODELS.map(model => (
                          <option key={model.id} value={model.id}>
                            {model.name} ({model.vram}) {model.recommended ? '⭐' : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-zinc-500 mt-1">
                        {RECOMMENDED_MODELS.find(m => m.id === settings.ollamaModel)?.description}
                      </p>
                      {installedModels.length > 0 && (
                        <div className="mt-2 text-[10px] text-zinc-500">
                          <span className="text-zinc-400">Installed:</span> {installedModels.slice(0, 5).join(', ')}
                          {installedModels.length > 5 && ` +${installedModels.length - 5} more`}
                        </div>
                      )}
                      {!installedModels.some(m => m.startsWith(settings.ollamaModel.split(':')[0])) && installedModels.length > 0 && (
                        <div className="mt-2 text-[10px] text-yellow-400">
                          Warning: "{settings.ollamaModel}" is not installed. Pull it with:<br/>
                          <code className="bg-black/30 px-1 rounded mt-1 block">docker exec ollama ollama pull {settings.ollamaModel}</code>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* OpenRouter Settings */}
                {settings.provider === 'openrouter' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">API Key</label>
                      <input 
                        type="password" 
                        value={settings.openrouterApiKey || ''}
                        onChange={(e) => updateSettings({ openrouterApiKey: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                        placeholder="sk-or-..."
                      />
                      <p className="text-[10px] text-zinc-500 mt-1">
                        Get your key at <a href="https://openrouter.ai/keys" target="_blank" className="text-orange-400 hover:underline">openrouter.ai/keys</a>
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Model</label>
                      <select
                        value={settings.openrouterModel || ''}
                        onChange={(e) => updateSettings({ openrouterModel: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                      >
                        <option value="">Select a model</option>
                        {OPENROUTER_VISION_MODELS.map(model => (
                          <option key={model.id} value={model.id}>
                            {model.name} ({model.price})
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {/* Gemini Settings */}
                {settings.provider === 'gemini' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">API Key</label>
                      <input 
                        type="password" 
                        value={settings.geminiApiKey || ''}
                        onChange={(e) => updateSettings({ geminiApiKey: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                        placeholder="AIza..."
                      />
                      <p className="text-[10px] text-zinc-500 mt-1">
                        Get your key at <a href="https://aistudio.google.com/apikey" target="_blank" className="text-orange-400 hover:underline">aistudio.google.com</a>
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Model</label>
                      <select
                        value={settings.geminiModel || 'gemini-1.5-flash'}
                        onChange={(e) => updateSettings({ geminiModel: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                      >
                        {GEMINI_MODELS.map(model => (
                          <option key={model.id} value={model.id}>
                            {model.name} ({model.price})
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {/* Test Connection Button */}
                <div className="pt-2 flex justify-between items-center">
                  <span className={`text-xs ${connectionStatus === 'connected' ? 'text-green-500' : 'text-red-500'}`}>
                    {connectionStatus === 'connected' ? '✓ Connected' : '✗ Disconnected'}
                  </span>
                  <button 
                    onClick={checkConnection}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs rounded text-white transition-colors border border-zinc-700"
                  >
                    Test Connection
                  </button>
                </div>
              </div>
              
              <div className="p-4 bg-zinc-800/50 flex justify-end sticky bottom-0">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-white text-black text-sm font-medium rounded hover:bg-gray-200"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Data Management Modal */}
        {showDataModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-md overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-800/50">
                <h3 className="font-semibold text-white">Data Management</h3>
                <button onClick={() => setShowDataModal(false)} className="text-zinc-400 hover:text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <p className="text-sm text-zinc-400">
                  Your photo index data is stored locally in your browser. Use these options to backup or manage your data.
                </p>
                
                <div className="space-y-3">
                  {/* Retry Uncategorized Button */}
                  {photos.filter(p => p.tags.length === 1 && p.tags[0] === 'Uncategorized').length > 0 && (
                    <button
                      onClick={() => { setShowDataModal(false); handleRetryUncategorized(); }}
                      disabled={isScanning || (processingStatus?.status === 'running')}
                      className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-3"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                      Retry Uncategorized ({photos.filter(p => p.tags.length === 1 && p.tags[0] === 'Uncategorized').length})
                    </button>
                  )}

                  {/* ── EXIF Sync section ──────────────────────────────── */}
                  <div className="border border-zinc-700 rounded-lg overflow-hidden">
                    <div className="bg-zinc-800/60 px-4 py-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
                      Métadonnées EXIF / XMP
                    </div>
                    <div className="p-3 space-y-2">
                      <button
                        onClick={handleSyncExif}
                        disabled={photos.length === 0}
                        className="w-full px-4 py-2.5 bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-3"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                        <span>
                          Synchroniser les tags EXIF
                          {selectedFolder && <span className="ml-1 opacity-70 text-xs">(dossier sélectionné)</span>}
                        </span>
                      </button>
                      <p className="text-[10px] text-zinc-500 px-1">
                        Lit les tags depuis les fichiers → injecte en DB ; et écrit les tags DB → fichiers manquants.
                      </p>
                      <button
                        onClick={handleRewriteExif}
                        disabled={photos.filter(p => p.status === 'done' && p.tags.length > 0).length === 0}
                        className="w-full px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-3"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        Réécrire tous les tags EXIF ({photos.filter(p => p.status === 'done' && p.tags.length > 0).length} photos)
                      </button>
                      <p className="text-[10px] text-zinc-500 px-1">
                        Force la réécriture des métadonnées EXIF/IPTC/XMP pour toutes les photos indexées.
                      </p>
                    </div>
                  </div>
                  
                  <button
                    onClick={handleExportCSV}
                    className="w-full px-4 py-3 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-3"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>
                    Export for Excel (CSV)
                  </button>
                  
                  <button
                    onClick={handleExportData}
                    className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-3"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                    Export Backup (JSON)
                  </button>
                  
                  <label className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-3 cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                    Import Backup
                    <input 
                      type="file" 
                      accept=".json"
                      className="hidden" 
                      onChange={handleImportData} 
                    />
                  </label>
                  
                  <button
                    onClick={handleClearData}
                    className="w-full px-4 py-3 bg-red-900/30 hover:bg-red-900/50 text-red-300 text-sm font-medium rounded-lg transition-colors flex items-center gap-3 border border-red-800/50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    Clear All Data
                  </button>
                </div>
                
                <div className="pt-4 border-t border-zinc-800">
                  <p className="text-xs text-zinc-500">
                    Photos: {photos.length} • Indexed: {processedCount} • Tags: {categories.length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}


        {/* Content */}
        {photos.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center mb-6 border border-zinc-800 animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Local Photo Indexer</h2>
            <p className="text-zinc-400 max-w-md mb-8">
              Index your photos using AI vision models. 
              {settings.provider === 'ollama' 
                ? ' All processing happens locally - your data never leaves your computer.'
                : ` Using ${providerInfo.name} for cloud processing.`}
            </p>
            <div className="flex gap-2 text-xs text-zinc-600 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800">
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                {providerInfo.icon} {providerInfo.name}: {connectionStatus === 'connected' ? 'Ready' : 'Not Connected'}
              </span>
            </div>
          </div>
        ) : (
          <PhotoGrid photos={filteredPhotos} onPhotoClick={setSelectedPhoto} />
        )}
      </div>

      {/* Detail Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/95 backdrop-blur-sm p-4">
          <button 
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors z-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>

          <div className="flex flex-col lg:flex-row max-w-7xl w-full max-h-[90vh] bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl">
            {/* Image Section */}
            <div className="flex-1 bg-black flex items-center justify-center relative min-h-[300px] lg:min-h-[600px] p-4">
               <img
                 src={
                   // BUG FIX #1: Use blob URL if available, otherwise use backend preview endpoint
                   (selectedPhoto.previewUrl && selectedPhoto.previewUrl !== '')
                     ? selectedPhoto.previewUrl
                     : (selectedPhoto.file && selectedPhoto.file.size > 0)
                       ? URL.createObjectURL(selectedPhoto.file)
                       : `${API_BASE}/photos/${encodeURIComponent(selectedPhoto.id)}/preview`
                 }
                 alt={selectedPhoto.name}
                 className="max-w-full max-h-full object-contain"
                 onError={(e) => {
                   const target = e.target as HTMLImageElement;
                   target.style.opacity = '0.3';
                 }}
               />
            </div>
            
            {/* Sidebar Section */}
            <div className="w-full lg:w-96 p-6 flex flex-col border-l border-zinc-800 bg-zinc-900 overflow-y-auto">
              <h3 className="text-xl font-semibold text-white mb-1 truncate" title={selectedPhoto.name}>
                {selectedPhoto.name}
              </h3>
              <p className="text-sm text-zinc-500 mb-1 font-mono">
                {(selectedPhoto.file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              {selectedPhoto.path && (
                <p className="text-xs text-zinc-600 mb-6 truncate" title={selectedPhoto.path}>
                  📁 {selectedPhoto.path}
                </p>
              )}

              {/* Tag Management Section */}
              <div className="mb-6 flex-1">
                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Active Tags</h4>
                
                {/* Active Tags */}
                <div className="flex flex-wrap gap-2 mb-6 min-h-[40px]">
                  {selectedPhoto.tags.length > 0 ? (
                    selectedPhoto.tags.map(tag => (
                      <div key={tag} className="flex items-center gap-1 pl-3 pr-1 py-1 bg-orange-500/10 text-orange-300 border border-orange-500/20 rounded-full text-sm group animate-in fade-in zoom-in duration-200">
                        <span>{tag}</span>
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                          className="p-0.5 hover:bg-orange-500/20 rounded-full text-orange-400 hover:text-orange-200 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="w-full p-3 border border-dashed border-zinc-800 rounded text-center">
                      <span className="text-zinc-500 text-sm italic">
                        {selectedPhoto.status === 'processing' ? 'AI is analyzing this photo...' : 'No tags yet'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Add Tag Input */}
                <form onSubmit={handleTagSubmit} className="relative mb-8">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="Type a custom tag..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 placeholder:text-zinc-600 transition-colors"
                  />
                  <button 
                    type="submit"
                    disabled={!tagInput.trim()}
                    className="absolute right-1.5 top-1.5 p-1 bg-zinc-800 text-zinc-400 hover:text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                  </button>
                </form>

                {/* Quick Add Suggestions (Categorized) */}
                <div className="space-y-5">
                   {Object.entries(TAG_CATEGORIES).map(([category, tags]) => (
                     <div key={category}>
                       <h5 className="text-[10px] text-zinc-500 font-bold mb-2 uppercase tracking-wider flex items-center gap-2">
                         {category}
                       </h5>
                       <div className="flex flex-wrap gap-2">
                         {tags.map(tag => {
                           const isSelected = selectedPhoto.tags.includes(tag);
                           if (isSelected) return null;
                           return (
                             <button
                              key={tag}
                              onClick={() => addTag(tag)}
                              className="px-2.5 py-1 text-xs text-zinc-400 bg-zinc-800/40 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 rounded-md transition-all hover:text-zinc-200"
                             >
                               + {tag}
                             </button>
                           );
                         })}
                       </div>
                     </div>
                   ))}
                </div>
              </div>
              
              <div className="mt-6 pt-4 border-t border-zinc-800">
                 <div className="flex items-center justify-between text-[10px] text-zinc-500">
                    <span>{providerInfo.icon} {providerInfo.model}</span>
                    <span>Status: {selectedPhoto.status}</span>
                 </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
