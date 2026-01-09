export interface Photo {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  tags: string[];
  status: 'pending' | 'processing' | 'done' | 'error';
}

export interface Category {
  name: string;
  count: number;
}

export type ViewMode = 'grid' | 'detail';

export interface SidebarProps {
  categories: Category[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
  totalPhotos: number;
  processedCount: number;
  isProcessing: boolean;
}

export interface PhotoGridProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
}
