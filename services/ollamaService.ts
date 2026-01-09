
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

export interface OllamaConfig {
  url: string;
  model: string;
}

/**
 * Checks if Ollama is reachable
 */
export const checkOllamaConnection = async (url: string): Promise<boolean> => {
  try {
    // Attempt to fetch tags. This is a lightweight GET request.
    const response = await fetch(`${url.replace(/\/$/, '')}/api/tags`);
    if (!response.ok) {
      console.warn(`Ollama responded but with status: ${response.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Ollama connection failed. Likely causes:\n1. Ollama is not running.\n2. CORS is blocking the request. Run 'OLLAMA_ORIGINS=\"*\" ollama serve'.", e);
    return false;
  }
};

/**
 * Analyzes an image using a local Ollama instance (LLaVA, Qwen-VL, etc.)
 */
export const analyzeImageWithOllama = async (
  base64Data: string, 
  config: OllamaConfig
): Promise<string[]> => {
  const { url, model } = config;
  const endpoint = `${url.replace(/\/$/, '')}/api/generate`;

  // Updated prompt to be more specific about the requested categories
  const prompt = `Analyze this image and provide a JSON array of 5 to 10 single-word keywords.
  
  Focus on these categories:
  1. Main Content (e.g., Nature, Urban, People, Document)
  2. Specific Subject (e.g., Cat, Dog, Car, Flower, Building)
  3. Time of Day/Lighting (e.g., Morning, Night, Sunset, Sunny, Cloudy)
  4. Location (e.g., Indoor, Outdoor, Forest, Street, Beach)
  5. Activity (e.g., Sports, Sleeping, Running, Eating)

  IMPORTANT: Return ONLY the JSON array. Example: ["Nature", "Dog", "Outdoor", "Sunny", "Running"]. Do not add markdown or explanations.`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        images: [base64Data],
        stream: false,
        format: "json" 
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API Error: ${response.statusText}`);
    }

    const data = await response.json();
    let responseText = data.response;

    // Clean up response if the model didn't respect JSON strictly
    responseText = responseText.trim();
    
    // Attempt to extract JSON array if wrapped in markdown
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (jsonMatch) {
      responseText = jsonMatch[0];
    }

    try {
      const tags = JSON.parse(responseText);
      if (Array.isArray(tags)) {
        // Filter out short tags and capitalize
        return tags
          .map((t: any) => String(t).trim())
          .filter((t: string) => t.length > 2)
          .map((t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
      }
    } catch (e) {
      console.warn("Could not parse JSON from Ollama, trying regex", responseText);
      // Fallback: extract words if JSON parsing fails
      const words = responseText.split(/[,\n]/).map((s: string) => s.trim()).filter((s: string) => s.length > 2 && !s.includes('[') && !s.includes(']'));
      return words.slice(0, 10);
    }

    return ["Uncategorized"];

  } catch (error) {
    console.error("Error analyzing image with Ollama:", error);
    return ["Error"];
  }
};