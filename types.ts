/**
 * Type definitions for Local Smart Photo Indexer
 */

// Provider types for AI analysis
export type AIProvider = 'ollama' | 'openrouter' | 'gemini' | 'openai';

// Photo processing status
export type PhotoStatus = 'pending' | 'processing' | 'done' | 'error';

// Photo object used in the application
export interface Photo {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  path?: string;           // Relative path from imported folder
  folderPath?: string;     // Root folder that was imported
  tags: string[];
  status: PhotoStatus;
  indexedAt?: number;      // Timestamp when tags were generated
  errorMessage?: string;   // Error details if processing failed
}

// Category for sidebar grouping
export interface Category {
  name: string;
  count: number;
}

// View mode for photo display
export type ViewMode = 'grid' | 'detail';

// Sidebar component props
export interface SidebarProps {
  categories: Category[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
  totalPhotos: number;
  processedCount: number;
  isProcessing: boolean;
}

// Photo grid component props
export interface PhotoGridProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
}

// Ollama configuration
export interface OllamaConfig {
  url: string;
  model: string;
}

// OpenRouter configuration
export interface OpenRouterConfig {
  apiKey: string;
  model: string;
}

// Gemini configuration
export interface GeminiConfig {
  apiKey: string;
  model?: string;
}

// OpenAI configuration
export interface OpenAIConfig {
  apiKey: string;
  model?: string;
}

// Unified settings object
export interface AppSettings {
  // Current provider
  provider: AIProvider;
  
  // Ollama settings
  ollamaUrl: string;
  ollamaModel: string;
  
  // OpenRouter settings
  openrouterApiKey?: string;
  openrouterModel?: string;
  
  // Gemini settings
  geminiApiKey?: string;
  geminiModel?: string;
  
  // OpenAI settings
  openaiApiKey?: string;
  openaiModel?: string;
}

// Default settings
export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5vl:7b',
};

// Structured tag categories for suggestions
export const TAG_CATEGORIES: Record<string, string[]> = {
  "Environment": [
    "Nature", "Urban", "Indoor", "Outdoor", "Landscape", 
    "Cityscape", "Sea", "Mountain", "Forest", "Desert", "Garden"
  ],
  "Living": [
    "Person", "Group", "Portrait", "Family", "Friends",
    "Animal", "Cat", "Dog", "Bird", "Wildlife", "Pet"
  ],
  "Time & Light": [
    "Day", "Night", "Sunset", "Sunrise", "Sunny", 
    "Cloudy", "Golden Hour", "Blue Hour", "Foggy", "Rainy"
  ],
  "Activity": [
    "Sports", "Travel", "Work", "Party", "Relaxing", 
    "Driving", "Walking", "Eating", "Cooking", "Reading", "Shopping"
  ],
  "Objects": [
    "Car", "Food", "Technology", "Art", "Document", 
    "Architecture", "Flower", "Book", "Phone", "Computer"
  ],
  "Events": [
    "Wedding", "Birthday", "Holiday", "Concert", "Festival",
    "Graduation", "Vacation", "Meeting", "Celebration"
  ]
};

// Model info for display
export interface ModelInfo {
  id: string;
  name: string;
  vram?: string;
  description?: string;
  recommended?: boolean;
  price?: string;
}

// Stats for dashboard
export interface IndexStats {
  totalPhotos: number;
  indexedPhotos: number;
  pendingPhotos: number;
  errorPhotos: number;
  uniqueTags: number;
  folders: string[];
}

// Export format options
export type ExportFormat = 'json' | 'csv';

// Import result
export interface ImportResult {
  success: boolean;
  photosImported: number;
  errors?: string[];
}
