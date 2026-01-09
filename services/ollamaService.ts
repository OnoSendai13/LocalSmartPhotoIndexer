/**
 * Ollama Service for local image analysis using vision models
 * Supports various multimodal models like Qwen3-VL, Qwen2.5-VL, LLaVA, MiniCPM-V, etc.
 */

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

  // Optimized prompt for consistent JSON output
  const prompt = `Analyze this image and provide a JSON array of 5 to 10 single-word keywords.

Focus on these categories:
1. Main Content (e.g., Nature, Urban, People, Document)
2. Specific Subject (e.g., Cat, Dog, Car, Flower, Building)
3. Time of Day/Lighting (e.g., Morning, Night, Sunset, Sunny, Cloudy)
4. Location (e.g., Indoor, Outdoor, Forest, Street, Beach)
5. Activity (e.g., Sports, Sleeping, Running, Eating)

IMPORTANT: Return ONLY the JSON array. Example: ["Nature", "Dog", "Outdoor", "Sunny", "Running"]. Do not add markdown or explanations.`;

  console.log(`🖼️ Analyzing image with model: ${model}`);
  console.log(`📡 Sending to: ${endpoint}`);

  try {
    const requestBody = {
      model: model,
      prompt: prompt,
      images: [base64Data],
      stream: false,
      format: "json",
      options: {
        temperature: 0.3,      // Lower temperature for more consistent output
        num_predict: 500,      // Limit response length
      }
    };
    
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
    let responseText = data.response;

    // Clean up response if the model didn't respect JSON strictly
    responseText = responseText.trim();
    
    // Attempt to extract JSON array if wrapped in markdown or other text
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (jsonMatch) {
      responseText = jsonMatch[0];
    }

    try {
      const tags = JSON.parse(responseText);
      if (Array.isArray(tags)) {
        // Filter out short tags, clean and capitalize
        return tags
          .map((t: any) => String(t).trim())
          .filter((t: string) => t.length > 2 && t.length < 30)
          .map((t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
          .slice(0, 10); // Limit to 10 tags
      }
    } catch (e) {
      console.warn("Could not parse JSON from Ollama, trying regex fallback:", responseText);
      
      // Fallback: extract words if JSON parsing fails
      const words = responseText
        .replace(/[\[\]"']/g, '')
        .split(/[,\n]/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 2 && s.length < 30);
      
      if (words.length > 0) {
        return words
          .map((t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
          .slice(0, 10);
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
