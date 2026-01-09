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

export const Sidebar: React.FC<SidebarProps> = ({ 
  categories, 
  selectedCategory, 
  onSelectCategory, 
  totalPhotos,
  processedCount,
  isProcessing
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
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        <div className="mb-6">
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

      {isProcessing && (
        <div className="p-4 bg-zinc-900 border-t border-zinc-800">
          <div className="flex items-center justify-between mb-2 text-sm text-indigo-400">
            <div className="flex items-center gap-2">
              <LoaderIcon />
              <span>Indexing...</span>
            </div>
            <span>{percentComplete}%</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-indigo-500 transition-all duration-300 ease-out"
              style={{ width: `${percentComplete}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            Analyzed {processedCount} of {totalPhotos}
          </p>
        </div>
      )}
    </div>
  );
};
