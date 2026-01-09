/**
 * OpenRouter API Service for cloud-based image analysis
 * Provides access to multiple vision models via a unified API
 * https://openrouter.ai/
 */

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
}

// Popular vision models available on OpenRouter
export const OPENROUTER_VISION_MODELS = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', price: '$$' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku (Fast)', price: '$' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', price: '$$$' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', price: '$' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', price: '$$' },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5 (Fast)', price: '$' },
  { id: 'qwen/qwen-2-vl-72b-instruct', name: 'Qwen2-VL 72B', price: '$$' },
  { id: 'meta-llama/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', price: '$$' },
];

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Check if the OpenRouter API key is valid
 */
export const checkOpenRouterConnection = async (apiKey: string): Promise<boolean> => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    return response.ok;
  } catch (e) {
    console.error('OpenRouter connection check failed:', e);
    return false;
  }
};

/**
 * Get list of available vision models from OpenRouter
 */
export const getAvailableModels = async (apiKey: string): Promise<string[]> => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }
    
    const data = await response.json();
    // Filter to only vision-capable models
    return data.data
      .filter((m: any) => m.id && (
        m.id.includes('vision') || 
        m.id.includes('gpt-4o') ||
        m.id.includes('claude-3') ||
        m.id.includes('gemini') ||
        m.id.includes('qwen') && m.id.includes('vl')
      ))
      .map((m: any) => m.id);
  } catch (e) {
    console.error('Failed to get OpenRouter models:', e);
    return OPENROUTER_VISION_MODELS.map(m => m.id);
  }
};

/**
 * Analyzes an image using OpenRouter API
 */
export const analyzeImageWithOpenRouter = async (
  base64Data: string,
  mimeType: string,
  config: OpenRouterConfig
): Promise<string[]> => {
  const { apiKey, model } = config;

  const prompt = `Analyze this image and provide a JSON array of 5 to 10 single-word keywords.

Focus on these categories:
1. Main Content (e.g., Nature, Urban, People, Document)
2. Specific Subject (e.g., Cat, Dog, Car, Flower, Building)
3. Time of Day/Lighting (e.g., Morning, Night, Sunset, Sunny, Cloudy)
4. Location (e.g., Indoor, Outdoor, Forest, Street, Beach)
5. Activity (e.g., Sports, Sleeping, Running, Eating)

IMPORTANT: Return ONLY the JSON array. Example: ["Nature", "Dog", "Outdoor", "Sunny", "Running"]. Do not add markdown or explanations.`;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Local Smart Photo Indexer',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`,
                },
              },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `OpenRouter API Error: ${response.statusText}`);
    }

    const data = await response.json();
    let responseText = data.choices?.[0]?.message?.content || '';

    // Clean up response
    responseText = responseText.trim();
    
    // Attempt to extract JSON array if wrapped in markdown
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (jsonMatch) {
      responseText = jsonMatch[0];
    }

    try {
      const tags = JSON.parse(responseText);
      if (Array.isArray(tags)) {
        return tags
          .map((t: any) => String(t).trim())
          .filter((t: string) => t.length > 2)
          .map((t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
      }
    } catch (e) {
      console.warn('Could not parse JSON from OpenRouter, trying fallback:', responseText);
      // Fallback: extract words
      const words = responseText
        .split(/[,\n]/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 2 && !s.includes('[') && !s.includes(']'));
      return words.slice(0, 10);
    }

    return ['Uncategorized'];
  } catch (error) {
    console.error('Error analyzing image with OpenRouter:', error);
    throw error;
  }
};
