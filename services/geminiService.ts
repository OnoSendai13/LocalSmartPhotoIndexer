import { GoogleGenAI, Type } from "@google/genai";

// We use the environment variable for the API Key.
const apiKey = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey });

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
 * Analyzes an image using Gemini to generate categorization tags.
 */
export const analyzeImage = async (base64Data: string, mimeType: string): Promise<string[]> => {
  if (!apiKey) {
    console.error("API Key is missing.");
    return ["Uncategorized"];
  }

  try {
    const model = 'gemini-3-flash-preview'; 
    
    // We use a schema to ensure we get a clean array of strings back.
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          {
            text: "Analyze this image and provide 5 to 8 relevant single-word semantic categories or tags to organize this photo (e.g., 'Nature', 'Urban', 'People', 'Food', 'Documents', 'Animals', 'Screenshot', 'Night', 'Travel'). Return ONLY the list of tags."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) return ["Uncategorized"];

    const tags = JSON.parse(jsonText);
    
    // Fallback if the model returns something unexpected (though schema usually prevents this)
    if (Array.isArray(tags)) {
      return tags.map((t: string) => t.charAt(0).toUpperCase() + t.slice(1)); // Capitalize
    }
    
    return ["Uncategorized"];

  } catch (error) {
    console.error("Error analyzing image:", error);
    return ["Error"];
  }
};