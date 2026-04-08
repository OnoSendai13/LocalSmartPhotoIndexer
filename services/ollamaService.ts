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
 * Checks if Ollama is reachable via the backend proxy.
 * This avoids CORS issues when Ollama runs in Docker.
 */
export const checkOllamaConnection = async (url: string): Promise<boolean> => {
  console.log(`🔗 Checking Ollama connection via backend proxy (url: ${url})`);

  try {
    const response = await fetch('/api/ollama/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ollamaUrl: url }),
    });

    const data = await response.json();
    if (data.connected) {
      console.log(`✅ Ollama connected via proxy!`);
      return true;
    } else {
      console.warn(`❌ Ollama not reachable: ${data.error}`);
      return false;
    }
  } catch (e: any) {
    console.error('❌ Ollama connection check failed:', e);
    return false;
  }
};

/**
 * Get list of installed models from Ollama via backend proxy
 */
export const getInstalledModels = async (url: string): Promise<string[]> => {
  try {
    const response = await fetch(`/api/ollama/models?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    const modelNames = data.models || [];
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
 * Analyzes an image using a local Ollama instance via the Node.js backend proxy.
 * This avoids CORS and Docker networking issues by routing requests through
 * the backend server (which can reach Ollama running in Docker).
 */
export const analyzeImageWithOllama = async (
  base64Data: string,
  config: OllamaConfig
): Promise<string[]> => {
  const { url, model } = config;

  console.log(`🖼️ Analyzing image with model: ${model} (via backend proxy)`);
  console.log(`📏 Base64 image size: ${(base64Data.length / 1024).toFixed(1)} KB`);

  try {
    // Call our backend proxy which forwards to Ollama
    const response = await fetch('/api/photos/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64Data,
        mimeType: 'image/jpeg',
        ollamaUrl: url,
        model,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`❌ Proxy analyze error:`, errorData);
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log(`📦 Proxy response received`);

    const responseText = data.response || data.thinking || '';
    if (!responseText || responseText.trim() === '') {
      console.error('❌ Ollama returned empty response via proxy!');
      return ["Error-EmptyResponse"];
    }

    console.log(`📝 Response text:`, JSON.stringify(responseText));

    // Parse response — same logic as before
    try {
      const parsed = JSON.parse(responseText);
      const validTags: string[] = [];

      if (Array.isArray(parsed)) {
        for (const tag of parsed) {
          const validTag = findClosestTag(String(tag).trim());
          if (validTag && !validTags.includes(validTag)) validTags.push(validTag);
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        for (const [, tags] of Object.entries(parsed)) {
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              const validTag = findClosestTag(String(tag).trim());
              if (validTag && !validTags.includes(validTag)) validTags.push(validTag);
            }
          } else if (typeof tags === 'string') {
            const validTag = findClosestTag(tags.trim());
            if (validTag && !validTags.includes(validTag)) validTags.push(validTag);
          }
        }
      }

      if (validTags.length > 0) {
        console.log(`✅ Validated tags:`, validTags);
        return validTags.slice(0, 8);
      }
    } catch {
      // Try JSON array extraction from text
      const jsonArrayMatch = responseText.match(/\[[\s\S]*?\]/g);
      if (jsonArrayMatch) {
        const validTags: string[] = [];
        for (const arrayStr of jsonArrayMatch) {
          try {
            const tags = JSON.parse(arrayStr);
            if (Array.isArray(tags)) {
              for (const tag of tags) {
                const validTag = findClosestTag(String(tag).trim());
                if (validTag && !validTags.includes(validTag)) validTags.push(validTag);
              }
            }
          } catch { /* skip */ }
        }
        if (validTags.length > 0) {
          console.log(`✅ Extracted tags from JSON arrays:`, validTags);
          return validTags.slice(0, 8);
        }
      }
    }

    // Last resort: scan for allowed tags in response text
    const validTags: string[] = [];
    for (const allowedTag of ALL_ALLOWED_TAGS) {
      const variants = [allowedTag, allowedTag.replace(/-/g, ' '), allowedTag.replace(/-/g, '')];
      for (const variant of variants) {
        const regex = new RegExp(`\\b${variant}\\b`, 'gi');
        if (regex.test(responseText) && !validTags.includes(allowedTag)) {
          validTags.push(allowedTag);
          break;
        }
      }
    }

    if (validTags.length > 0) {
      console.log(`✅ Extracted valid tags from text:`, validTags);
      return validTags.slice(0, 8);
    }

    return ["Uncategorized"];

  } catch (error) {
    console.error("Error analyzing image with Ollama via proxy:", error);
    throw error;
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
