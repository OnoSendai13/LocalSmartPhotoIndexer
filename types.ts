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
  onAddPhotos?: () => void;
  onLinkFolder?: () => void;
  hasUnlinkedPhotos?: boolean; // Photos without previews
  onRetryUncategorized?: () => void;
  uncategorizedCount?: number;
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
  ollamaModel: 'minicpm-v',  // Best model for photo classification (Jan 2025)
};

// ============================================================
// ALLOWED TAGS - Simplified vocabulary for better model accuracy
// Keep it simple - complex lists confuse local models
// ============================================================

export const ALLOWED_TAGS = {
  // People
  people: [
    "Portrait",
    "Group", 
    "Family",
    "Couple",
    "Selfie",
    "People",
  ],
  
  // Animals
  animals: [
    "Dog",
    "Cat", 
    "Bird",
    "Horse",
    "Animal",
  ],
  
  // Scene / Environment
  scene: [
    "Landscape",
    "Cityscape",
    "Beach",
    "Mountain",
    "Forest",
    "Garden",
    "Park",
    "Street",
    "Village",
    "Countryside",
  ],
  
  // Location Type
  location: [
    "Indoor",
    "Outdoor",
    "Home",
    "Restaurant",
    "Museum",
    "Church",
    "Castle",
    "Building",
  ],
  
  // Weather / Time
  weather: [
    "Sunny",
    "Cloudy",
    "Sunset",
    "Sunrise",
    "Night",
    "Rainy",
    "Snowy",
  ],
  
  // Activities
  activities: [
    "Walking",
    "Posing",
    "Eating",
    "Traveling",
    "Sports",
    "Swimming",
    "Hiking",
    "Vacation",
  ],
  
  // Objects
  objects: [
    "Car",
    "Food",
    "Flower",
    "Architecture",
    "Art",
    "Statue",
    "Tree",
    "Water",
  ],
} as const;

// Flatten all allowed tags into a single array for validation
export const ALL_ALLOWED_TAGS: string[] = Object.values(ALLOWED_TAGS).flat();

// Create a Set for fast lookup
export const ALLOWED_TAGS_SET = new Set(ALL_ALLOWED_TAGS);

// Function to validate if a tag is allowed
export const isValidTag = (tag: string): boolean => {
  return ALLOWED_TAGS_SET.has(tag);
};

// Function to find the closest valid tag (for fuzzy matching)
export const findClosestTag = (input: string): string | null => {
  const normalized = input.toLowerCase().trim();
  
  // Direct match (case-insensitive)
  for (const tag of ALL_ALLOWED_TAGS) {
    if (tag.toLowerCase() === normalized) {
      return tag;
    }
  }
  
  // Partial match
  for (const tag of ALL_ALLOWED_TAGS) {
    if (tag.toLowerCase().includes(normalized) || normalized.includes(tag.toLowerCase())) {
      return tag;
    }
  }
  
  return null;
};

// Generate prompt-friendly list of tags by category
export const getTagListForPrompt = (): string => {
  return Object.entries(ALLOWED_TAGS)
    .map(([category, tags]) => `${category}: ${tags.join(', ')}`)
    .join('\n');
};

// ============================================================
// TAG_CATEGORIES - For UI display/suggestions (grouped view)
// ============================================================
export const TAG_CATEGORIES: Record<string, string[]> = {
  "People": ALLOWED_TAGS.people as unknown as string[],
  "Animals": ALLOWED_TAGS.animals as unknown as string[],
  "Scene": ALLOWED_TAGS.scene as unknown as string[],
  "Location": ALLOWED_TAGS.location as unknown as string[],
  "Weather": ALLOWED_TAGS.weather as unknown as string[],
  "Activities": ALLOWED_TAGS.activities as unknown as string[],
  "Objects": ALLOWED_TAGS.objects as unknown as string[],
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
