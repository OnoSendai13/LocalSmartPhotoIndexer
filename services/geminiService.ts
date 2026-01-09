/**
 * Google Gemini API Service for cloud-based image analysis
 * https://ai.google.dev/
 */

export interface GeminiConfig {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = 'gemini-1.5-flash';

// Available Gemini vision models
export const GEMINI_MODELS = [
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Fast)', price: 'Free tier' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Better)', price: 'Paid' },
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Latest)', price: 'Free tier' },
];

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Check if the Gemini API key is valid
 */
export const checkGeminiConnection = async (apiKey: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `${GEMINI_API_URL}?key=${apiKey}`
    );
    return response.ok;
  } catch (e) {
    console.error('Gemini connection check failed:', e);
    return false;
  }
};

/**
 * Converts a File object to a Base64 string.
 */
export const fileToGenerativePart = async (file: File): Promise<string> => {
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
 * Analyzes an image using Gemini API to generate categorization tags.
 */
export const analyzeImageWithGemini = async (
  base64Data: string, 
  mimeType: string,
  config: GeminiConfig
): Promise<string[]> => {
  const { apiKey, model = DEFAULT_MODEL } = config;

  if (!apiKey) {
    console.error("Gemini API Key is missing.");
    throw new Error("Gemini API Key is required");
  }

  const prompt = `Analyze this image and provide a JSON array of 5 to 10 single-word keywords.

Focus on these categories:
1. Main Content (e.g., Nature, Urban, People, Document)
2. Specific Subject (e.g., Cat, Dog, Car, Flower, Building)
3. Time of Day/Lighting (e.g., Morning, Night, Sunset, Sunny, Cloudy)
4. Location (e.g., Indoor, Outdoor, Forest, Street, Beach)
5. Activity (e.g., Sports, Sleeping, Running, Eating)

IMPORTANT: Return ONLY the JSON array. Example: ["Nature", "Dog", "Outdoor", "Sunny", "Running"]. Do not add markdown or explanations.`;

  try {
    const response = await fetch(
      `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data
                }
              },
              {
                text: prompt
              }
            ]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500,
            responseMimeType: "application/json",
          }
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `Gemini API Error: ${response.statusText}`);
    }

    const data = await response.json();
    let responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

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
      console.warn("Could not parse JSON from Gemini:", responseText);
      // Fallback: extract words
      const words = responseText
        .split(/[,\n]/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 2 && !s.includes('[') && !s.includes(']'));
      return words.slice(0, 10);
    }
    
    return ["Uncategorized"];

  } catch (error) {
    console.error("Error analyzing image with Gemini:", error);
    throw error;
  }
};
