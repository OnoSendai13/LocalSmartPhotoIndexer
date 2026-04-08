import React from 'react';
import { SidebarProps } from '../types';

// Icons
const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
);

const AllPhotosIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
);

const TagIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
);

const LoaderIcon = () => (
  <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
);

// Plus icon for add button
const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
);

// Link icon for folder linking
const LinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
);

// Refresh icon for retry
const RefreshIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
);

// Check icon for connected status
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
);

// Play icon for starting indexing
const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7z"/></svg>
);

// Pause icon for pausing indexing
const PauseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
);

// Key icon for permission needed
const KeyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>
);

export const Sidebar: React.FC<SidebarProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
  totalPhotos,
  processedCount,
  isProcessing,
  onAddPhotos,
  onLinkFolder,
  hasUnlinkedPhotos,
  onRetryUncategorized,
  uncategorizedCount,
  folderStatus,
  connectedFolderName,
  onRequestPermission,
  folders = [],
  selectedFolder,
  onSelectFolder,
  onAddFolder,
  processingStatus,
  onStartProcessing,
  onStopProcessing,
  connectionStatus = 'unknown',
}) => {
  const percentComplete = totalPhotos > 0 ? Math.round((processedCount / totalPhotos) * 100) : 0;

  return (
    <div className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full shrink-0">
      <div className="p-6 border-b border-zinc-800">
        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400 flex items-center gap-2">
          <FolderIcon />
          SmartOrganizer
        </h1>
        <p className="text-xs text-zinc-500 mt-1">Local AI Indexing</p>
        
        {/* Folder Connection Status */}
        {folderStatus === 'connected' && connectedFolderName && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckIcon />
            <span className="truncate" title={connectedFolderName}>📁 {connectedFolderName}</span>
          </div>
        )}
        {folderStatus === 'needs_permission' && connectedFolderName && (
          <button
            onClick={onRequestPermission}
            className="mt-2 w-full flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 bg-amber-900/20 rounded px-2 py-1 border border-amber-800/30"
          >
            <KeyIcon />
            <span className="truncate">Grant access to {connectedFolderName}</span>
          </button>
        )}
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        {/* All Photos Button */}
        <div className="mb-4">
          <button
            onClick={() => onSelectCategory(null)}
            className={`w-full text-left px-3 py-2 rounded-md flex items-center justify-between transition-colors ${
              selectedCategory === null 
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' 
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <AllPhotosIcon />
              <span className="font-medium">All Photos</span>
            </div>
            <span className="text-xs font-mono opacity-60">{totalPhotos}</span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="mb-6 space-y-2">
          {onAddPhotos && (
            <button
              onClick={onAddPhotos}
              disabled={isProcessing}
              className="w-full text-left px-3 py-2 rounded-md flex items-center gap-3 text-emerald-400 hover:bg-emerald-900/20 hover:text-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-800/30"
            >
              <PlusIcon />
              <span className="font-medium text-sm">Add New Photos</span>
            </button>
          )}
          
          {onLinkFolder && hasUnlinkedPhotos && folderStatus !== 'connected' && (
            <button
              onClick={onLinkFolder}
              className="w-full text-left px-3 py-2 rounded-md flex items-center gap-3 text-amber-400 hover:bg-amber-900/20 hover:text-amber-300 transition-colors border border-amber-800/30"
            >
              <LinkIcon />
              <span className="font-medium text-sm">
                {folderStatus === 'none' ? 'Select Folder' : 'Link Folder'}
              </span>
            </button>
          )}
          
          {/* Change folder button when already connected */}
          {onLinkFolder && folderStatus === 'connected' && (
            <button
              onClick={onLinkFolder}
              className="w-full text-left px-3 py-2 rounded-md flex items-center gap-3 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors text-xs"
            >
              <LinkIcon />
              <span>Change folder...</span>
            </button>
          )}
          
          {onRetryUncategorized && uncategorizedCount && uncategorizedCount > 0 && (
            <button
              onClick={onRetryUncategorized}
              disabled={isProcessing}
              className="w-full text-left px-3 py-2 rounded-md flex items-center justify-between text-orange-400 hover:bg-orange-900/20 hover:text-orange-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-orange-800/30"
            >
              <div className="flex items-center gap-3">
                <RefreshIcon />
                <span className="font-medium text-sm">Rescan Failed</span>
              </div>
              <span className="text-xs bg-orange-900/50 px-1.5 py-0.5 rounded-full">{uncategorizedCount}</span>
            </button>
          )}
        </div>

        {/* Folders list */}
        {folders.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-3">
              Folders
            </h3>
            <div className="space-y-1">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => onSelectFolder?.(selectedFolder === folder.path ? null : folder.path)}
                  className={`w-full text-left px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all ${
                    selectedFolder === folder.path
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                  title={folder.path}
                >
                  <FolderIcon />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{folder.name}</div>
                    <div className="truncate text-[10px] opacity-50 font-mono">{folder.path}</div>
                  </div>
                </button>
              ))}
            </div>
            {onAddFolder && (
              <button
                onClick={onAddFolder}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs text-zinc-600 hover:text-zinc-400 mt-1"
              >
                <PlusIcon />
                <span>Add folder...</span>
              </button>
            )}
          </div>
        )}

        {categories.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 px-3">
              Smart Categories
            </h3>
            <div className="space-y-1">
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => onSelectCategory(cat.name)}
                  className={`w-full text-left px-3 py-1.5 rounded-md flex items-center justify-between text-sm transition-all ${
                    selectedCategory === cat.name 
                      ? 'bg-zinc-800 text-white' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <TagIcon />
                    <span className="truncate max-w-[120px]">{cat.name}</span>
                  </div>
                  <span className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded-full text-zinc-500 border border-zinc-700">
                    {cat.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Backend processing controls */}
      {processingStatus && processingStatus.status !== 'idle' && (
        <div className="p-4 bg-zinc-900 border-t border-zinc-800">
          <div className="flex items-center justify-between mb-2 text-sm text-indigo-400">
            <div className="flex items-center gap-2">
              <LoaderIcon />
              <span>
                {processingStatus.status === 'stopping' ? 'Stopping...' : 'Indexing...'}
              </span>
            </div>
            <span>{processingStatus.percent}%</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300 ease-out"
              style={{ width: `${processingStatus.percent}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            {processingStatus.done} / {processingStatus.total} photos
          </p>
          {processingStatus.currentPhoto && (
            <p className="text-[10px] text-zinc-600 mt-1 truncate" title={processingStatus.currentPhoto}>
              → {processingStatus.currentPhoto}
            </p>
          )}
          {processingStatus.status === 'running' && onStopProcessing && (
            <button
              onClick={onStopProcessing}
              className="w-full mt-3 px-3 py-1.5 rounded text-xs bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 transition-colors flex items-center justify-center gap-1"
            >
              <PauseIcon />
              Stop
            </button>
          )}
        </div>
      )}

      {/* Start button when idle and there are pending photos */}
      {processingStatus && processingStatus.status === 'idle' && processingStatus.total > 0 && (
        <div className="p-3 bg-zinc-900 border-t border-zinc-800">
          <button
            onClick={onStartProcessing}
            disabled={connectionStatus !== 'connected'}
            title={connectionStatus !== 'connected' ? 'AI provider not connected' : ''}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              connectionStatus === 'connected'
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <PlayIcon />
            Start Indexing ({processingStatus.total} pending)
          </button>
          {connectionStatus !== 'connected' && (
            <p className="text-[10px] text-amber-500 mt-1 text-center">
              ⚠️ AI provider not connected
            </p>
          )}
        </div>
      )}

      {/* Idle state with no pending photos */}
      {processingStatus && processingStatus.status === 'idle' && processingStatus.total === 0 && (
        <div className="p-3 bg-zinc-900 border-t border-zinc-800 text-center">
          {processingStatus.done > 0 ? (
            <p className="text-xs text-emerald-400">
              ✅ All {processingStatus.done} photos indexed
            </p>
          ) : (
            <p className="text-xs text-zinc-500">
              No photos to index
            </p>
          )}
        </div>
      )}
    </div>
  );
};
