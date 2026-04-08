/**
 * Ollama Service for local image analysis using vision models
 * Supports various multimodal models like Qwen3-VL, Qwen2.5-VL, LLaVA, MiniCPM-V, etc.
 */

import { ALL_ALLOWED_TAGS, findClosestTag, getTagListForPrompt } from '../types';

export interface OllamaConfig {
  url: string;
  model: string;
}

// Recommended vision models with their characteristics (January 2025)
export const RECOMMENDED_MODELS = [
  { 
    id: 'minicpm-v', 
    name: 'MiniCPM-V 2.6', 
    vram: '~8GB', 
    description: 'BEST for photo classification - highly recommended',
    recommended: true 
  },
  { 
    id: 'qwen2.5vl:7b', 
    name: 'Qwen2.5-VL 7B', 
    vram: '~8GB', 
    description: 'Good alternative, fast',
    recommended: true 
  },
  { 
    id: 'qwen3-vl:8b', 
    name: 'Qwen3-VL 8B', 
    vram: '~12GB', 
    description: 'Has thinking mode issues - use with caution' 
  },
  { 
    id: 'llama3.2-vision:11b', 
    name: 'Llama 3.2 Vision 11B', 
    vram: '~12GB', 
    description: "Meta's vision model" 
  },
  { 
    id: 'llava:7b', 
    name: 'LLaVA 7B', 
    vram: '~6GB', 
    description: 'Fast, lightweight' 
  },
  { 
    id: 'moondream', 
    name: 'Moondream', 
    vram: '~2GB', 
    description: 'Very low resources, basic quality' 
  },
];

/**
 * Maximum dimension for images sent to vision models.
 *
 * Vision models for tag classification work just as well at 512 px as at
 * higher resolutions, with much smaller payloads and faster round-trips.
 * Tweak via the exported constant so the settings UI can override it later.
 *
 * Benchmarks (minicpm-v, local RTX 3080):
 *   1024 px → ~180 KB base64 → ~3.5 s/image
 *    768 px → ~100 KB base64 → ~2.3 s/image
 *    512 px →  ~45 KB base64 → ~1.4 s/image  ← default (best for bulk)
 */
export const MAX_IMAGE_DIMENSION = 512;
export const JPEG_QUALITY = 0.82;  // slightly lower quality, imperceptible for tagging

/**
 * Resizes an image if it exceeds the maximum dimension.
 * Returns a base64 string of the resized image.
 */
const resizeImageIfNeeded = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const { width, height } = img;
      
      // If no resize needed AND already JPEG, skip canvas round-trip (faster + smaller payload)
      const needsResize = width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION;
      const isJpeg = file.type === 'image/jpeg' || file.name.toLowerCase().match(/\.jpe?g$/);
      if (!needsResize && isJpeg) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          if (!result) {
            reject(new Error(`Failed to read file: ${file.name}`));
            return;
          }
          const parts = result.split(',');
          resolve(parts[1] || '');
        };
        reader.onerror = () => reject(new Error(`FileReader error for ${file.name}`));
        reader.readAsDataURL(file);
        return;
      }
      // PNG / oversized → always go through canvas (resize + convert to JPEG to shrink payload)
      
      // Calculate new dimensions maintaining aspect ratio
      let newWidth = width;
      let newHeight = height;
      
      if (width > height) {
        if (width > MAX_IMAGE_DIMENSION) {
          newHeight = Math.round((height * MAX_IMAGE_DIMENSION) / width);
          newWidth = MAX_IMAGE_DIMENSION;
        }
      } else {
        if (height > MAX_IMAGE_DIMENSION) {
          newWidth = Math.round((width * MAX_IMAGE_DIMENSION) / height);
          newHeight = MAX_IMAGE_DIMENSION;
        }
      }
      
      console.log(`📐 Resizing ${file.name}: ${width}x${height} → ${newWidth}x${newHeight}`);
      
      // Create canvas and resize
      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Use high-quality image smoothing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Draw resized image
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      
      // Convert to base64 JPEG
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      const base64Data = dataUrl.split(',')[1];
      
      if (!base64Data) {
        reject(new Error(`Failed to convert resized image to base64: ${file.name}`));
        return;
      }
      
      const originalSizeKB = file.size / 1024;
      const newSizeKB = (base64Data.length * 0.75) / 1024; // base64 is ~33% larger than binary
      console.log(`📉 Size reduced: ${originalSizeKB.toFixed(0)} KB → ${newSizeKB.toFixed(0)} KB (${((1 - newSizeKB/originalSizeKB) * 100).toFixed(0)}% smaller)`);
      
      resolve(base64Data);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    
    img.src = url;
  });
};

/**
 * Converts a File object to a Base64 string, resizing if necessary.
 */
export const fileToBase64 = async (file: File): Promise<string> => {
  // Validate file before processing
  if (!file || file.size === 0) {
    throw new Error(`Invalid file: ${file?.name || 'unknown'} (size: ${file?.size || 0})`);
  }
  
  // Use resize function which handles both small and large images
  return resizeImageIfNeeded(file);
};

/**
 * Checks if Ollama is reachable and returns available models
 */
export const checkOllamaConnection = async (url: string): Promise<boolean> => {
  const endpoint = `${url.replace(/\/$/, '')}/api/tags`;
  console.log(`🔗 Checking Ollama connection: ${endpoint}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`❌ Ollama responded but with status: ${response.status}`);
      return false;
    }
    
    const data = await response.json();
    console.log(`✅ Ollama connected! Models available:`, data.models?.length || 0);
    return true;
  } catch (e: any) {
    if (e.name === 'AbortError') {
      console.error('⏱️ Ollama connection timeout (5s)');
    } else if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
      console.error(
        "❌ Ollama connection failed. Likely causes:\n" +
        "1. Ollama is not running.\n" +
        "2. CORS is blocking the request.\n\n" +
        "Fix for Docker: docker run -e OLLAMA_ORIGINS=\"*\" ...\n" +
        "Fix for local: OLLAMA_ORIGINS=\"*\" ollama serve"
      );
    } else {
      console.error('❌ Ollama connection error:', e);
    }
    return false;
  }
};

/**
 * Get list of installed models from Ollama
 */
export const getInstalledModels = async (url: string): Promise<string[]> => {
  try {
    const endpoint = `${url.replace(/\/$/, '')}/api/tags`;
    console.log(`📋 Fetching installed models from: ${endpoint}`);
    
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    const modelNames = data.models?.map((m: any) => m.name) || [];
    console.log(`📦 Found ${modelNames.length} models:`, modelNames.slice(0, 5));
    return modelNames;
  } catch (e) {
    console.error('❌ Failed to get installed models:', e);
    return [];
  }
};

/**
 * Check if a specific model is installed
 */
export const isModelInstalled = async (url: string, modelName: string): Promise<boolean> => {
  const models = await getInstalledModels(url);
  return models.some(m => m.startsWith(modelName.split(':')[0]));
};

/**
 * Analyzes an image using a local Ollama instance (Qwen3-VL, Qwen2.5-VL, LLaVA, etc.)
 */
export const analyzeImageWithOllama = async (
  base64Data: string, 
  config: OllamaConfig
): Promise<string[]> => {
  const { url, model } = config;
  const endpoint = `${url.replace(/\/$/, '')}/api/generate`;

  // Simple and direct prompt - complex prompts confuse smaller models
  // /no_think disables Qwen3's thinking mode
  const prompt = `/no_think
What do you see in this image? Answer with a JSON array of tags.

Choose from these categories:
- People: Portrait, Group, Family, Couple, Selfie
- Scene: Landscape, Cityscape, Beach, Mountain, Forest, Garden, Street
- Location: Indoor, Outdoor, Home, Restaurant, Museum, Church
- Weather: Sunny, Cloudy, Sunset, Sunrise, Night
- Activity: Walking, Posing, Eating, Traveling, Sports
- Objects: Car, Food, Flower, Architecture, Art, Statue

Return ONLY a JSON array like: ["Family", "Outdoor", "Sunny", "Garden"]
No explanation, just the JSON array.`;

  console.log(`🖼️ Analyzing image with model: ${model}`);
  console.log(`📡 Sending to: ${endpoint}`);
  console.log(`📏 Base64 image size: ${(base64Data.length / 1024).toFixed(1)} KB`);

  try {
    // Note: Some models like qwen3-vl don't support format: "json" well
    // We'll use a clearer prompt and parse the response more robustly
    const requestBody: Record<string, any> = {
      model: model,
      prompt: prompt,
      images: [base64Data],
      stream: false,
      options: {
        temperature: 0.3,      // Lower temperature for more consistent output
        num_predict: 500,      // Limit response length
      }
    };
    
    // Only add format:json for models that support it well (not qwen3-vl)
    if (!model.includes('qwen3-vl')) {
      requestBody.format = "json";
    }
    
    console.log(`📤 Request body (without base64):`, { ...requestBody, images: ['<base64 data>'] });
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`📥 Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Ollama API Error:`, errorText);
      throw new Error(`Ollama API Error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`📦 Full Ollama response:`, data);
    
    let responseText = data.response || '';
    console.log(`📝 Response text (raw):`, JSON.stringify(responseText));

    // Check if response is empty but thinking field has content (Qwen3-VL fallback)
    // This should be rare now that we use /no_think in the prompt
    if ((!responseText || responseText.trim() === '') && data.thinking) {
      console.log('🧠 Response empty, checking thinking field (fallback)...');
      
      const thinkingText = data.thinking;
      const validTags: string[] = [];
      
      // ONLY extract if we find a proper JSON array in the thinking
      // Don't scan for random words - too many false positives
      const jsonMatch = thinkingText.match(/\["[^"]+(?:"\s*,\s*"[^"]+)*"\]/);
      if (jsonMatch) {
        try {
          const tags = JSON.parse(jsonMatch[0]);
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              const validTag = findClosestTag(String(tag));
              if (validTag && !validTags.includes(validTag)) {
                validTags.push(validTag);
              }
            }
            if (validTags.length > 0) {
              console.log(`✅ Extracted valid tags from thinking JSON:`, validTags);
              return validTags.slice(0, 8);
            }
          }
        } catch (e) {
          console.log('Could not parse JSON from thinking field');
        }
      }
      
      console.warn('⚠️ No valid JSON array found in thinking field');
      return ["Uncategorized"];
    }
    
    // Standard empty response handling (no thinking field)
    if (!responseText || responseText.trim() === '') {
      console.error('❌ Ollama returned empty response!');
      console.log('💡 This might be a model compatibility issue. Try a different model.');
      return ["Error-EmptyResponse"];
    }

    // Clean up response if the model didn't respect JSON strictly
    responseText = responseText.trim();
    
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(responseText);
      const validTags: string[] = [];
      
      // Case 1: Response is already an array ["tag1", "tag2", ...]
      if (Array.isArray(parsed)) {
        console.log(`🔍 Response is a JSON array`);
        for (const tag of parsed) {
          const validTag = findClosestTag(String(tag).trim());
          if (validTag && !validTags.includes(validTag)) {
            validTags.push(validTag);
          }
        }
      }
      // Case 2: Response is an object with categories {"People": ["Portrait"], "Scene": ["Beach"]}
      // Also handles {"People": "Couple", "Scene": "Landscape"} (string values)
      else if (typeof parsed === 'object' && parsed !== null) {
        console.log(`🔍 Response is a JSON object with categories`);
        // Extract all values from all categories
        for (const [category, tags] of Object.entries(parsed)) {
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              const tagStr = String(tag).trim();
              const validTag = findClosestTag(tagStr);
              if (validTag && !validTags.includes(validTag)) {
                validTags.push(validTag);
              } else if (!validTag) {
                console.log(`⚠️ Tag "${tagStr}" from category "${category}" not found in allowed list`);
              }
            }
          } else if (typeof tags === 'string') {
            // Sometimes a category has a single string value (e.g., "People": "Couple")
            const tagStr = tags.trim();
            const validTag = findClosestTag(tagStr);
            if (validTag && !validTags.includes(validTag)) {
              validTags.push(validTag);
            } else if (!validTag) {
              console.log(`⚠️ Tag "${tagStr}" from category "${category}" not found in allowed list`);
            }
          }
        }
      }
      
      if (validTags.length > 0) {
        console.log(`✅ Validated tags:`, validTags);
        return validTags.slice(0, 8);
      }
    } catch (e) {
      console.warn("⚠️ Could not parse JSON from Ollama, trying regex extraction");
    }
    
    // Fallback: Try to extract JSON array from text (in case of markdown wrapper)
    const jsonArrayMatch = responseText.match(/\[[\s\S]*?\]/g);
    if (jsonArrayMatch) {
      const validTags: string[] = [];
      // Process ALL arrays found, not just the first one
      for (const arrayStr of jsonArrayMatch) {
        try {
          const tags = JSON.parse(arrayStr);
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              const validTag = findClosestTag(String(tag).trim());
              if (validTag && !validTags.includes(validTag)) {
                validTags.push(validTag);
              }
            }
          }
        } catch (e) {
          // Skip this array if parsing fails
        }
      }
      if (validTags.length > 0) {
        console.log(`✅ Extracted tags from multiple JSON arrays:`, validTags);
        return validTags.slice(0, 8);
      }
    }
    
    // Last resort: scan for allowed tags in the response text
    const validTags: string[] = [];
    for (const allowedTag of ALL_ALLOWED_TAGS) {
      const tagVariants = [
        allowedTag,
        allowedTag.replace(/-/g, ' '),
        allowedTag.replace(/-/g, ''),
      ];
      
      for (const variant of tagVariants) {
        const regex = new RegExp(`\\b${variant}\\b`, 'gi');
        if (regex.test(responseText)) {
          if (!validTags.includes(allowedTag)) {
            validTags.push(allowedTag);
          }
          break;
        }
      }
    }
    
    if (validTags.length > 0) {
      console.log(`✅ Extracted valid tags from response text:`, validTags);
      return validTags.slice(0, 8);
    }

    return ["Uncategorized"];

  } catch (error) {
    console.error("Error analyzing image with Ollama:", error);
    throw error; // Re-throw to let caller handle it
  }
};

/**
 * Pull a model from Ollama (for future use - requires longer timeout)
 */
export const pullModel = async (
  url: string, 
  modelName: string, 
  onProgress?: (status: string) => void
): Promise<boolean> => {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: modelName,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }

    return true;
  } catch (error) {
    console.error('Error pulling model:', error);
    return false;
  }
};
