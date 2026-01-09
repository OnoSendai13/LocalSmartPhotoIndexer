import React from 'react';
import { Photo } from '../types';

interface PhotoGridProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
}

export const PhotoGrid: React.FC<PhotoGridProps> = ({ photos, onPhotoClick }) => {
  if (photos.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500">
        <div className="w-16 h-16 mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
        </div>
        <p className="text-lg font-medium">No photos found</p>
        <p className="text-sm opacity-60">Try selecting a different category or upload more photos.</p>
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto h-full bg-zinc-950">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {photos.map((photo) => (
          <div 
            key={photo.id}
            onClick={() => onPhotoClick(photo)}
            className="group relative aspect-square bg-zinc-900 rounded-xl overflow-hidden cursor-pointer border border-zinc-800 hover:border-indigo-500/50 transition-all shadow-sm hover:shadow-indigo-500/10"
          >
            <img 
              src={photo.previewUrl} 
              alt={photo.name} 
              className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${photo.status === 'processing' ? 'opacity-50 blur-sm' : ''}`}
            />
            
            {/* Processing Overlay */}
            {photo.status === 'processing' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <svg className="animate-spin text-indigo-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              </div>
            )}

            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
              <p className="text-white text-sm font-medium truncate">{photo.name}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {photo.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] bg-white/20 backdrop-blur-md text-white px-1.5 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            
            {/* Status Indicator (top right) */}
            {photo.status === 'done' && (
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50"></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
