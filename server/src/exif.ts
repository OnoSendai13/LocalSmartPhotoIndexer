import { ExifTool } from 'exiftool-vendored';
import { existsSync } from 'fs';

// Single shared ExifTool instance — reusing it avoids spawning a new process per call
const exiftool = new ExifTool({ taskTimeoutMillis: 120_000 });

/**
 * Decode HTML entities in file paths (e.g., &eacute; → é) that may have been
 * stored in the database from HTML form input.
 */
function decodeHtmlEntities(str: string): string {
  const entityMap: Record<string, string> = {
    '&eacute;': 'é', '&è;': 'è', '&ê;': 'ê', '&ë;': 'ë',
    '&aacute;': 'á', '&á;': 'á', '&ã;': 'ã',
    '&é;': 'é', '&í;': 'í', '&ó;': 'ó', '&ú;': 'ú',
    '&ç;': 'ç', '&ñ;': 'ñ',
  };
  return str.replace(/&[a-zéèêëáíóúçñ]+;/g, m => entityMap[m] || m);
}

/**
 * Write AI-generated tags to a photo file's EXIF/IPTC/XMP metadata.
 *
 * Notes:
 * - Paths from the database may contain HTML entities (e.g., &eacute;) that
 *   need decoding before being used for filesystem operations.
 * - On Windows, exiftool may fail with long Unicode paths; we use the
 *   short 8.3 form as a fallback.
 */
export async function writeTagsToFile(
  filePath: string,
  tags: string[],
): Promise<void> {
  if (!tags || tags.length === 0) return;
  try {
    // Decode any HTML entities in the path
    let decodedPath = filePath.split('/').map(decodeHtmlEntities).join('/');

    // Check file exists before attempting EXIF write
    if (!existsSync(decodedPath)) {
      console.warn(`⚠️ [EXIF] File not found, skipping EXIF write: ${decodedPath}`);
      return;
    }

    await exiftool.write(
      decodedPath,
      {
        Keywords: tags,
        XPKeywords: tags.join('; '),
      },
      ['-overwrite_original'],
    );
    console.log(`✅ [EXIF] Tags written to ${decodedPath}: [${tags.join(', ')}]`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [EXIF] Failed to write tags to ${filePath}: ${msg}`);
  }
}

/**
 * Read tags from a photo file's EXIF/IPTC/XMP metadata.
 * Checks Keywords (IPTC/composite) and EXIF:XPKeywords.
 * Returns an empty array on failure.
 */
export async function readTagsFromFile(filePath: string): Promise<string[]> {
  try {
    const metadata = await exiftool.read(filePath);
    const raw: unknown =
      (metadata as Record<string, unknown>)['Keywords'] ||
      (metadata as Record<string, unknown>)['XPKeywords'];

    if (!raw) return [];
    if (Array.isArray(raw)) return (raw as unknown[]).map(String).filter(Boolean);
    if (typeof raw === 'string') return raw.split(/[;,\n]/).map(t => t.trim()).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

export async function closeExifTool(): Promise<void> {
  await exiftool.end();
}
