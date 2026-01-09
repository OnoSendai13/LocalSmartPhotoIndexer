import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { PhotoGrid } from './components/PhotoGrid';
import { Photo, Category, AIProvider, AppSettings, TAG_CATEGORIES, DEFAULT_SETTINGS } from './types';
import { analyzeImageWithOllama, fileToBase64, checkOllamaConnection, RECOMMENDED_MODELS, getInstalledModels } from './services/ollamaService';
import { analyzeImageWithOpenRouter, checkOpenRouterConnection, OPENROUTER_VISION_MODELS } from './services/openrouterService';
import { analyzeImageWithGemini, checkGeminiConnection, GEMINI_MODELS } from './services/geminiService';
import { 
  savePhoto, 
  getAllPhotos, 
  getSettings, 
  saveSettings, 
  exportData, 
  importData,
  clearAllPhotos,
  StoredPhoto 
} from './services/storageService';

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
  const [installedModels, setInstalledModels] = useState<string[]>([]);

  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const processingQueue = useRef<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  
  // Data management
  const [showDataModal, setShowDataModal] = useState(false);

  // Load settings and photos on mount
  useEffect(() => {
    const loadData = async () => {
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
        
        // Load saved photos from IndexedDB
        const savedPhotos = await getAllPhotos();
        if (savedPhotos.length > 0) {
          // Convert stored photos to app photos (without File objects - they can't be persisted)
          const loadedPhotos: Photo[] = savedPhotos.map(sp => ({
            id: sp.id,
            file: new File([], sp.name), // Placeholder - actual file needs re-import
            previewUrl: '', // Will need to re-import for preview
            name: sp.name,
            path: sp.path,
            folderPath: sp.folderPath,
            tags: sp.tags,
            status: sp.status,
            indexedAt: sp.indexedAt,
          }));
          // Note: We only restore metadata, not the actual images
          // This is shown in the UI as "previously indexed"
        }
      } catch (error) {
        console.error('Failed to load saved data:', error);
      }
    };
    
    loadData();
    checkConnection();
  }, []);

  // Check connection when settings change
  useEffect(() => {
    checkConnection();
  }, [settings.provider, settings.ollamaUrl, settings.openrouterApiKey, settings.geminiApiKey]);

  const checkConnection = async () => {
    try {
      let isConnected = false;
      
      switch (settings.provider) {
        case 'ollama':
          isConnected = await checkOllamaConnection(settings.ollamaUrl);
          if (isConnected) {
            const models = await getInstalledModels(settings.ollamaUrl);
            setInstalledModels(models);
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
      
      setConnectionStatus(isConnected ? 'connected' : 'error');
      return isConnected;
    } catch (error) {
      setConnectionStatus('error');
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
    if (!selectedCategory) return photos;
    return photos.filter(p => p.tags.includes(selectedCategory));
  }, [photos, selectedCategory]);

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

  // Queue Processing Logic
  const processQueue = async () => {
    if (processingQueue.current.length === 0) {
      setIsProcessing(false);
      return;
    }

    const photoId = processingQueue.current.shift();
    if (!photoId) return;

    const photo = photos.find(p => p.id === photoId);
    if (!photo) {
      processQueue(); 
      return;
    }

    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, status: 'processing' } : p));

    try {
      const base64Data = await fileToBase64(photo.file);
      const tags = await analyzeImage(base64Data, photo.file.type);
      
      const updatedPhoto = { 
        ...photo, 
        tags: [...new Set([...photo.tags, ...tags])], // Merge and dedupe tags
        status: 'done' as const,
        indexedAt: Date.now(),
      };
      
      setPhotos(prev => prev.map(p => p.id === photoId ? updatedPhoto : p));
      
      // Save to IndexedDB
      const storedPhoto: StoredPhoto = {
        id: updatedPhoto.id,
        name: updatedPhoto.name,
        path: updatedPhoto.path || '',
        folderPath: updatedPhoto.folderPath || '',
        size: updatedPhoto.file.size,
        lastModified: updatedPhoto.file.lastModified,
        mimeType: updatedPhoto.file.type,
        tags: updatedPhoto.tags,
        status: 'done',
        indexedAt: Date.now(),
      };
      await savePhoto(storedPhoto);
      
    } catch (error) {
      console.error(`Failed to process ${photo.name}`, error);
      setPhotos(prev => prev.map(p => p.id === photoId ? { 
        ...p, 
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      } : p));
    } finally {
      // Process next item
      processQueue(); 
    }
  };

  const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    // Auto-retry connection if it was previously failed
    let currentStatus = connectionStatus;
    if (currentStatus !== 'connected') {
      const isNowConnected = await checkConnection();
      if (!isNowConnected) {
        const providerName = settings.provider === 'ollama' ? 'Ollama' : 
                            settings.provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
        alert(`Connection Failed: Please check your ${providerName} configuration in settings.`);
        setShowSettings(true);
        return;
      }
    }

    // Get folder path from first file
    const firstFile = files[0];
    const folderPath = firstFile.webkitRelativePath?.split('/')[0] || 'Imported';

    const newPhotos: Photo[] = [];
    const newQueueIds: string[] = [];

    Array.from(files).forEach((file: File) => {
      if (!file.type.startsWith('image/')) return;

      const id = Math.random().toString(36).substring(7);
      const previewUrl = URL.createObjectURL(file);
      const relativePath = file.webkitRelativePath || file.name;

      newPhotos.push({
        id,
        file,
        previewUrl,
        name: file.name,
        path: relativePath,
        folderPath: folderPath,
        tags: [],
        status: 'pending'
      });
      newQueueIds.push(id);
    });

    setPhotos(prev => [...prev, ...newPhotos]);
    processingQueue.current.push(...newQueueIds);

    if (!isProcessing) {
      setIsProcessing(true);
      processQueue();
    }
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
    
    // Update in IndexedDB
    const photo = photos.find(p => p.id === photoId);
    if (photo) {
      const storedPhoto: StoredPhoto = {
        id: photo.id,
        name: photo.name,
        path: photo.path || '',
        folderPath: photo.folderPath || '',
        size: photo.file.size,
        lastModified: photo.file.lastModified,
        mimeType: photo.file.type,
        tags: newTags,
        status: photo.status,
        indexedAt: Date.now(),
      };
      await savePhoto(storedPhoto);
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
    if (confirm('Are you sure you want to clear all indexed data? This cannot be undone.')) {
      await clearAllPhotos();
      setPhotos([]);
      alert('All data cleared');
    }
  };

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
      <Sidebar 
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        totalPhotos={photos.length}
        processedCount={processedCount}
        isProcessing={isProcessing}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header */}
        <div className="h-16 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-10">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {selectedCategory ? `${selectedCategory} Gallery` : 'All Photos'}
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
            
            {/* Add Folder Button */}
            <label className="relative inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors shadow-lg shadow-orange-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              <span>Add Folder</span>
              <input 
                type="file" 
                {...({ webkitdirectory: "", directory: "" } as any)}
                multiple 
                className="hidden" 
                onChange={handleFolderSelect} 
              />
            </label>
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
                    {settings.provider === 'gemini' && 'Google Cloud - free tier available'}
                  </p>
                </div>

                {/* Connection Status */}
                {connectionStatus === 'error' && (
                  <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg">
                    <p className="text-xs text-red-200 font-semibold mb-1">Connection Failed</p>
                    {settings.provider === 'ollama' && (
                      <p className="text-[10px] text-red-300">
                        Most likely CORS is blocking the request. Restart Ollama with:
                        <br/>
                        <code className="bg-black/30 px-1 rounded block mt-1 select-all">OLLAMA_ORIGINS="*" ollama serve</code>
                      </p>
                    )}
                    {settings.provider === 'openrouter' && (
                      <p className="text-[10px] text-red-300">Check your API key is valid.</p>
                    )}
                    {settings.provider === 'gemini' && (
                      <p className="text-[10px] text-red-300">Check your API key is valid.</p>
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
                 src={selectedPhoto.previewUrl} 
                 alt={selectedPhoto.name}
                 className="max-w-full max-h-full object-contain"
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
