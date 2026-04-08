import React, { useState, useEffect, useRef } from 'react';
import { Photo } from '../types';

interface PhotoGridProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
}

const API_BASE = '/api';

// BUG FIX #1: Lazy loading image component
// Falls back to backend /api/photos/:id/preview when no file blob is available
// This allows photos to display correctly after page refresh without re-selecting the folder
const Placeholder: React.FC<{ name: string }> = ({ name }) => (
  <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-900 flex flex-col items-center justify-center p-3 text-center">
    <svg className="w-10 h-10 text-zinc-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
    <p className="text-[10px] text-zinc-500 truncate w-full">{name}</p>
  </div>
);

const LazyImage: React.FC<{ photo: Photo; className?: string }> = ({ photo, className }) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [usedBlobUrl, setUsedBlobUrl] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const imgRef = useRef<HTMLDivElement>(null);
  const maxRetries = 5;
  const retryDelays = [500, 1000, 2000, 4000, 8000]; // exponential backoff

  useEffect(() => {
    setIsLoaded(false);
    setFailed(false);
    setRetryCount(0);

    // Priority 1: real File blob (live session — full original resolution)
    if (photo.file && photo.file.size > 0) {
      const url = URL.createObjectURL(photo.file);
      setImageUrl(url);
      setUsedBlobUrl(true);
      return;
    }

    // Priority 2: base64 thumbnail stored in DB (works after reload, even on Windows)
    if (photo.previewUrl) {
      setImageUrl(photo.previewUrl);
      return;
    }

    // Priority 3: backend /preview (only works if server can reach the file)
    setImageUrl(`${API_BASE}/photos/${encodeURIComponent(photo.id)}/preview`);
  }, [photo.file, photo.previewUrl, photo.id]);

  // Retry failed backend preview requests with exponential backoff
  useEffect(() => {
    if (!failed || retryCount >= maxRetries) return;
    if (!imageUrl.includes(`/photos/${photo.id}/preview`)) return;

    const delay = retryDelays[Math.min(retryCount, retryDelays.length - 1)];
    const timer = setTimeout(() => {
      console.log(`🔄 Retry ${retryCount + 1}/${maxRetries} for preview: ${photo.name}`);
      setRetryCount(c => c + 1);
      setFailed(false);
      // Force re-fetch by appending a cache-busting query param
      const baseUrl = `${API_BASE}/photos/${encodeURIComponent(photo.id)}/preview`;
      setImageUrl(`${baseUrl}?retry=${Date.now()}`);
    }, delay);

    return () => clearTimeout(timer);
  }, [failed, retryCount, photo.id, photo.name, imageUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (usedBlobUrl && imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [imageUrl, usedBlobUrl]);

  return (
    <div ref={imgRef} className="w-full h-full">
      {/* Show placeholder if no URL yet or if load failed (after all retries) */}
      {(!imageUrl || (failed && retryCount >= maxRetries)) ? (
        <Placeholder name={photo.name} />
      ) : (
        <img
          src={imageUrl}
          alt={photo.name}
          className={`${className} ${!isLoaded ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
          onLoad={() => setIsLoaded(true)}
          onError={() => setFailed(true)}
          loading="lazy"
        />
      )}
    </div>
  );
};

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
            <LazyImage 
              photo={photo}
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
            {photo.status === 'error' && (
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 shadow-lg shadow-red-500/50"></div>
            )}
            {photo.status === 'pending' && (
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-zinc-500"></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
