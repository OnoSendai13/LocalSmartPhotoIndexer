import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { PhotoGrid } from './components/PhotoGrid';
import { Photo, Category } from './types';
import { analyzeImageWithOllama, fileToBase64, checkOllamaConnection, OllamaConfig } from './services/ollamaService';

// Add webkitdirectory to InputHTMLAttributes for TypeScript
declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

// Structured categories for user assistance
const TAG_CATEGORIES: Record<string, string[]> = {
  "Environment": ["Nature", "Urban", "Indoor", "Outdoor", "Landscape", "Cityscape", "Sea", "Mountain", "Forest"],
  "Living": ["Person", "Group", "Portrait", "Animal", "Cat", "Dog", "Bird", "Wildlife", "Pet"],
  "Time & Light": ["Day", "Night", "Sunset", "Sunrise", "Sunny", "Cloudy", "Golden Hour", "Blue Hour"],
  "Activity": ["Sports", "Travel", "Work", "Party", "Relaxing", "Driving", "Walking", "Eating"],
  "Objects": ["Car", "Food", "Technology", "Art", "Document", "Architecture", "Flower"]
};

const DEFAULT_CONFIG: OllamaConfig = {
  url: 'http://localhost:11434',
  model: 'llava' 
};

const App: React.FC = () => {
  // Application State
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  
  // Ollama Configuration State
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');

  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const processingQueue = useRef<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Initial connection check
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    const isConnected = await checkOllamaConnection(ollamaConfig.url);
    setConnectionStatus(isConnected ? 'connected' : 'error');
    return isConnected;
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
      const tags = await analyzeImageWithOllama(base64Data, ollamaConfig);
      
      setPhotos(prev => prev.map(p => 
        p.id === photoId 
          ? { ...p, tags: [...p.tags, ...tags], status: 'done' } 
          : p
      ));
    } catch (error) {
      console.error(`Failed to process ${photo.name}`, error);
      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, status: 'error' } : p));
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
             alert("Connection Failed: Ensure Ollama is running and OLLAMA_ORIGINS=\"*\" is set.");
             setShowSettings(true);
             return;
        }
    }

    const newPhotos: Photo[] = [];
    const newQueueIds: string[] = [];

    Array.from(files).forEach((file: File) => {
      if (!file.type.startsWith('image/')) return;

      const id = Math.random().toString(36).substring(7);
      const previewUrl = URL.createObjectURL(file);

      newPhotos.push({
        id,
        file,
        previewUrl,
        name: file.name,
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
    // Format tag to Title Case
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

  const updatePhotoTags = (photoId: string, newTags: string[]) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, tags: newTags } : p));
    setSelectedPhoto(prev => prev ? { ...prev, tags: newTags } : null);
  };

  const handleTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tagInput.trim()) {
      addTag(tagInput.trim());
      setTagInput('');
    }
  };

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
                {connectionStatus === 'connected' ? `Ollama Connected (${ollamaConfig.model})` : 'Ollama Disconnected (CORS?)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              title="Ollama Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
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
            <div className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-md overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-800/50">
                <h3 className="font-semibold text-white">Ollama Configuration</h3>
                <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <div className="p-6 space-y-4">
                {connectionStatus === 'error' && (
                  <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg">
                    <p className="text-xs text-red-200 font-semibold mb-1">Connection Failed</p>
                    <p className="text-[10px] text-red-300">
                      Most likely CORS is blocking the request. Restart Ollama with:
                      <br/>
                      <code className="bg-black/30 px-1 rounded block mt-1 select-all">OLLAMA_ORIGINS="*" ollama serve</code>
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Server URL</label>
                  <input 
                    type="text" 
                    value={ollamaConfig.url}
                    onChange={(e) => setOllamaConfig({...ollamaConfig, url: e.target.value})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                    placeholder="http://localhost:11434"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Make sure OLLAMA_ORIGINS="*" is set on your server.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Model Name</label>
                  <input 
                    type="text" 
                    value={ollamaConfig.model}
                    onChange={(e) => setOllamaConfig({...ollamaConfig, model: e.target.value})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                    placeholder="llava, qwen-vl, moondream"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Must be a multimodal model (Vision supported).</p>
                </div>
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
              <div className="p-4 bg-zinc-800/50 flex justify-end">
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

        {/* Content */}
        {photos.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center mb-6 border border-zinc-800 animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Local Photo Indexer</h2>
            <p className="text-zinc-400 max-w-md mb-8">
              Index your photos using your local Ollama instance (LLaVA, Qwen-VL). 
              No data leaves your computer.
            </p>
            <div className="flex gap-2 text-xs text-zinc-600 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800">
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                Status: {connectionStatus === 'connected' ? 'Ready' : 'Not Connected'}
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
              <p className="text-sm text-zinc-500 mb-6 font-mono">
                {(selectedPhoto.file.size / 1024 / 1024).toFixed(2)} MB
              </p>

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
                           if (isSelected) return null; // Don't show already selected tags in suggestions
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
                    <span>Model: {ollamaConfig.model}</span>
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