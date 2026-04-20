import { ExifTool } from 'exiftool-vendored';
import { existsSync } from 'fs';

const exiftool = new ExifTool({ taskTimeoutMillis: 120_000 });

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

export async function writeTagsToFile(filePath, tags) {
  if (!Array.isArray(tags) || tags.length === 0) return;
  const resolved = normalizePath(filePath);
  if (!existsSync(resolved)) {
    console.warn(`[EXIF] File not found, skip write: ${resolved}`);
    return;
  }

  await exiftool.write(
    resolved,
    {
      Keywords: tags,
      XPKeywords: tags.join('; '),
      Subject: tags,
    },
    ['-overwrite_original'],
  );
}

export async function readTagsFromFile(filePath) {
  const resolved = normalizePath(filePath);
  if (!existsSync(resolved)) return [];

  try {
    const metadata = await exiftool.read(resolved);
    const candidates = [metadata.Keywords, metadata.Subject, metadata.XPKeywords]
      .flat()
      .filter(Boolean)
      .flatMap((value) => {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') return value.split(/[;,]/g);
        return [];
      })
      .map((tag) => String(tag).trim())
      .filter(Boolean);

    return Array.from(new Set(candidates));
  } catch (error) {
    console.warn(`[EXIF] Read failed for ${resolved}:`, error instanceof Error ? error.message : error);
    return [];
  }
}

export function closeExifTool() {
  exiftool.end();
}
