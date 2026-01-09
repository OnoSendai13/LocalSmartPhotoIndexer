/**
 * Ollama Service for local image analysis using vision models
 * Supports various multimodal models like Qwen3-VL, Qwen2.5-VL, LLaVA, MiniCPM-V, etc.
 */

import { ALL_ALLOWED_TAGS, findClosestTag, getTagListForPrompt } from '../types';

export interface OllamaConfig {
  url: string;
  model: string;
}

// Recommended vision models with their characteristics
export const RECOMMENDED_MODELS = [
  { 
    id: 'qwen3-vl:8b', 
    name: 'Qwen3-VL 8B', 
    vram: '~12GB', 
    description: 'Latest & best quality, 32 language OCR',
    recommended: true 
  },
  { 
    id: 'qwen3-vl:2b', 
    name: 'Qwen3-VL 2B', 
    vram: '~4GB', 
    description: 'Fast, good for limited hardware' 
  },
  { 
    id: 'qwen2.5vl:7b', 
    name: 'Qwen2.5-VL 7B', 
    vram: '~8GB', 
    description: 'Excellent balance quality/speed',
    recommended: true 
  },
  { 
    id: 'qwen2.5vl:3b', 
    name: 'Qwen2.5-VL 3B', 
    vram: '~4GB', 
    description: 'Faster, decent quality' 
  },
  { 
    id: 'minicpm-v', 
    name: 'MiniCPM-V 2.6', 
    vram: '~8GB', 
    description: 'Excellent for documents & OCR' 
  },
  { 
    id: 'llama3.2-vision:11b', 
    name: 'Llama 3.2 Vision 11B', 
    vram: '~12GB', 
    description: "Meta's vision model" 
  },
  { 
    id: 'llava-llama3', 
    name: 'LLaVA-Llama3', 
    vram: '~8GB', 
    description: 'Good general purpose' 
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
 * Converts a File object to a Base64 string.
 */
export const fileToBase64 = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

  // Get the allowed tags list for the prompt
  const tagList = getTagListForPrompt();
  
  // Strict prompt with closed vocabulary
  // /no_think disables Qwen3's thinking mode which causes empty responses
  const prompt = `/no_think
Analyze this image and classify it using ONLY tags from this predefined list.

ALLOWED TAGS (choose 3-8 that apply):
${tagList}

RULES:
1. ONLY use tags from the list above - no other words allowed
2. Choose 3-8 tags that ACTUALLY appear in the image
3. Return ONLY a JSON array of strings
4. Use exact tag names with correct capitalization (e.g., "Female-Model" not "female model")
5. Do NOT guess or hallucinate - only tag what you clearly see

Example output: ["Portrait", "Female-Model", "Indoor", "Studio", "Fashion"]

Return ONLY the JSON array, nothing else.`;

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
    
    // Attempt to extract JSON array if wrapped in markdown or other text
    const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      responseText = jsonMatch[0];
      console.log(`🔍 Extracted JSON array:`, responseText);
    }

    try {
      const tags = JSON.parse(responseText);
      if (Array.isArray(tags)) {
        // Validate each tag against allowed list
        const validTags: string[] = [];
        for (const tag of tags) {
          const validTag = findClosestTag(String(tag).trim());
          if (validTag && !validTags.includes(validTag)) {
            validTags.push(validTag);
          }
        }
        
        console.log(`✅ Validated tags:`, validTags);
        return validTags.length > 0 ? validTags.slice(0, 8) : ["Uncategorized"];
      }
    } catch (e) {
      console.warn("⚠️ Could not parse JSON from Ollama, trying tag extraction");
      
      // Fallback: scan for allowed tags in the response text
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
        console.log(`✅ Extracted valid tags from response:`, validTags);
        return validTags.slice(0, 8);
      }
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
