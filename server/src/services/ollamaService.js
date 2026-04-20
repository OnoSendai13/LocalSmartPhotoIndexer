import { findClosestTag, ALL_ALLOWED_TAGS } from '../tags.js';

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'minicpm-v';
const DEFAULT_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

function extractTagsFromText(text) {
  const matches = new Set();

  try {
    const parsed = JSON.parse(text);
    const asArray = Array.isArray(parsed) ? parsed : Object.values(parsed || {}).flat();
    for (const raw of asArray) {
      const tag = findClosestTag(String(raw).trim());
      if (tag) matches.add(tag);
    }
  } catch {
    const jsonArrayMatch = text.match(/\[[\s\S]*?\]/g) || [];
    for (const chunk of jsonArrayMatch) {
      try {
        const arr = JSON.parse(chunk);
        if (!Array.isArray(arr)) continue;
        for (const raw of arr) {
          const tag = findClosestTag(String(raw).trim());
          if (tag) matches.add(tag);
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }

  if (matches.size === 0) {
    for (const allowed of ALL_ALLOWED_TAGS) {
      const regex = new RegExp(`\\b${allowed.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (regex.test(text)) matches.add(allowed);
    }
  }

  return Array.from(matches).slice(0, 8);
}

export async function analyzeWithOllama(base64Data, mimeType = 'image/jpeg') {
  const ollamaUrl = DEFAULT_OLLAMA_URL.replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const prompt = [
    'Analyse cette photo et retourne UNIQUEMENT un tableau JSON de tags.',
    'Exemple: ["Family", "Outdoor", "Sunny", "Garden"]',
    'Pas de phrase, pas de markdown, uniquement le JSON.',
  ].join('\n');

  const payload = {
    model: DEFAULT_OLLAMA_MODEL,
    prompt,
    images: [base64Data],
    stream: false,
    options: {
      temperature: 0.2,
      num_predict: 180,
    },
  };

  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status}: ${details || response.statusText}`);
    }

    const result = await response.json();
    const text = String(result.response || result.thinking || '').trim();
    if (!text) return ['Uncategorized'];

    const tags = extractTagsFromText(text);
    return tags.length > 0 ? tags : ['Uncategorized'];
  } finally {
    clearTimeout(timeoutId);
  }
}
