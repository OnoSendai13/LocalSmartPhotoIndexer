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
  path?: string;                 // Relative path from imported folder (webkitRelativePath)
  folderPath?: string;           // Display folder name (root folder that was imported)
  absoluteFolderPath?: string;   // Absolute server-side folder path (registered in backend)
  tags: string[];
  status: PhotoStatus;
  /** Small base64 JPEG thumbnail (~96px) stored in DB for offline/cross-host preview */
  thumbnail?: string;
  indexedAt?: number;            // Timestamp when tags were generated
  errorMessage?: string;         // Error details if processing failed
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
  // File System Access API
  folderStatus?: 'none' | 'needs_permission' | 'connected';
  connectedFolderName?: string | null;
  onRequestPermission?: () => void;
  // Multiple folders support
  folders?: { id: string; name: string; path: string }[];
  selectedFolder?: string | null;
  onSelectFolder?: (folderPath: string | null) => void;
  onAddFolder?: () => void;
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
  
  // Animals & Wildlife
  animals: [
    "Dog",
    "Cat", 
    "Bird",
    "Horse",
    "Animal",
    "Wildlife",
    "Lion",
    "Elephant",
    "Giraffe",
    "Zebra",
    "Monkey",
    "Fish",
    "Insect",
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
    "Desert",
    "Lake",
    "River",
    "Ocean",
    "Savanna",
    "Grassland",
    "Panorama",
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
    "Market",
    "Shop",
    "Hotel",
    "Airport",
    "Station",
    "School",
    "Office",
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
    "Shopping",
    "Working",
    "Playing",
    "Dancing",
    "Resting",
    "Running",
    "Cycling",
    "Safari",
    "Wedding",
    "Celebration",
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
    "Boat",
    "Plane",
    "Train",
    "Jewelry",
    "Clothing",
    "Book",
    "Monument",
  ],
  
  // Photo Style
  style: [
    "Portrait",
    "Artistic",
    "Panorama",
    "Macro",
    "Black-White",
    "Golden-Hour",
    "Night-Shot",
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

// Words to exclude (LLM reasoning residuals, common words that aren't tags)
const EXCLUDED_WORDS = new Set([
  // Reasoning words
  "could", "seems", "here", "there", "this", "that", "the", "and", "with",
  "appears", "looks", "like", "maybe", "probably", "possibly", "might",
  "showing", "shows", "contains", "has", "have", "featuring", "features",
  "image", "photo", "picture", "scene", "visible", "seen", "can", "see",
  // Common non-descriptive words
  "very", "quite", "really", "just", "also", "some", "many", "few",
  "good", "nice", "beautiful", "amazing", "great", "wonderful",
  "male", "female", "model", "person", "thing", "object", "place",
  // Time words that aren't weather
  "daytime", "daylight", "today", "now", "then",
  // Partial/incomplete
  "sunbathing", "condition", "tattoo",
]);

// Synonym mapping to allowed tags
const TAG_SYNONYMS: Record<string, string> = {
  // Wildlife synonyms
  "lioness": "Lion",
  "lions": "Lion",
  "elephants": "Elephant",
  "giraffes": "Giraffe",
  "zebras": "Zebra",
  "monkeys": "Monkey",
  "ape": "Monkey",
  "apes": "Monkey",
  "birds": "Bird",
  "dogs": "Dog",
  "cats": "Cat",
  "horses": "Horse",
  "fishes": "Fish",
  "insects": "Insect",
  "bug": "Insect",
  "bugs": "Insect",
  "butterfly": "Insect",
  
  // Scene synonyms
  "mountains": "Mountain",
  "forests": "Forest",
  "beaches": "Beach",
  "lakes": "Lake",
  "rivers": "River",
  "sea": "Ocean",
  "seas": "Ocean",
  "desert": "Desert",
  "deserts": "Desert",
  "plains": "Savanna",
  "prairie": "Grassland",
  "meadow": "Grassland",
  
  // Location synonyms
  "markets": "Market",
  "store": "Shop",
  "stores": "Shop",
  "shops": "Shop",
  "mall": "Shop",
  "cathedral": "Church",
  "temple": "Church",
  "mosque": "Church",
  "palace": "Castle",
  "chateau": "Castle",
  "fortress": "Castle",
  
  // Activity synonyms
  "walk": "Walking",
  "hike": "Hiking",
  "swim": "Swimming",
  "run": "Running",
  "cycle": "Cycling",
  "bike": "Cycling",
  "biking": "Cycling",
  "dance": "Dancing",
  "rest": "Resting",
  "sleep": "Resting",
  "relax": "Resting",
  "relaxing": "Resting",
  "shop": "Shopping",
  "buy": "Shopping",
  "buying": "Shopping",
  "purchasing": "Shopping",
  "selling": "Shopping",
  "work": "Working",
  "play": "Playing",
  "game": "Playing",
  "celebrate": "Celebration",
  "celebrating": "Celebration",
  "party": "Celebration",
  "birthday": "Celebration",
  "christmas": "Celebration",
  "holiday": "Vacation",
  "holidays": "Vacation",
  "trip": "Traveling",
  "journey": "Traveling",
  "tour": "Traveling",
  "travel": "Traveling",
  
  // People synonyms
  "child": "Family",
  "children": "Family",
  "kids": "Family",
  "kid": "Family",
  "baby": "Family",
  "babies": "Family",
  "man": "People",
  "men": "People",
  "woman": "People",
  "women": "People",
  "crowd": "Group",
  "team": "Group",
  "friends": "Group",
  
  // Weather synonyms
  "sun": "Sunny",
  "sunshine": "Sunny",
  "cloud": "Cloudy",
  "clouds": "Cloudy",
  "overcast": "Cloudy",
  "rain": "Rainy",
  "raining": "Rainy",
  "storm": "Rainy",
  "snow": "Snowy",
  "snowing": "Snowy",
  "winter": "Snowy",
  "dawn": "Sunrise",
  "dusk": "Sunset",
  "evening": "Sunset",
  "golden-hour": "Golden-Hour",
  "goldenhour": "Golden-Hour",
  "golden hour": "Golden-Hour",
  
  // Style synonyms
  "artistic": "Artistic",
  "art": "Art",
  "bw": "Black-White",
  "blackwhite": "Black-White",
  "monochrome": "Black-White",
  
  // Object synonyms
  "vehicle": "Car",
  "automobile": "Car",
  "ship": "Boat",
  "yacht": "Boat",
  "aircraft": "Plane",
  "airplane": "Plane",
  "railway": "Train",
  "locomotive": "Train",
  "flowers": "Flower",
  "plant": "Flower",
  "plants": "Flower",
  "trees": "Tree",
  "building": "Architecture",
  "buildings": "Architecture",
  "house": "Architecture",
  "houses": "Architecture",
  "sculpture": "Statue",
  "sculptures": "Statue",
  "statues": "Statue",
  "ring": "Jewelry",
  "necklace": "Jewelry",
  "bracelet": "Jewelry",
  "clothes": "Clothing",
  "dress": "Clothing",
  "suit": "Clothing",
  "basket": "Objects",
  "baskets": "Objects",
  "container": "Objects",
};

// Function to find the closest valid tag (for fuzzy matching)
export const findClosestTag = (input: string): string | null => {
  const normalized = input.toLowerCase().trim();
  
  // Check if it's an excluded word
  if (EXCLUDED_WORDS.has(normalized)) {
    return null;
  }
  
  // Check synonyms first
  if (TAG_SYNONYMS[normalized]) {
    return TAG_SYNONYMS[normalized];
  }
  
  // Direct match (case-insensitive)
  for (const tag of ALL_ALLOWED_TAGS) {
    if (tag.toLowerCase() === normalized) {
      return tag;
    }
  }
  
  // Check if normalized matches with hyphen removed
  const withoutHyphen = normalized.replace(/-/g, '');
  for (const tag of ALL_ALLOWED_TAGS) {
    if (tag.toLowerCase().replace(/-/g, '') === withoutHyphen) {
      return tag;
    }
  }
  
  // Partial match (tag contains input or input contains tag)
  for (const tag of ALL_ALLOWED_TAGS) {
    const tagLower = tag.toLowerCase();
    if (tagLower.includes(normalized) || normalized.includes(tagLower)) {
      // Make sure it's not a very short match that could be misleading
      if (normalized.length >= 3 && tagLower.length >= 3) {
        return tag;
      }
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
