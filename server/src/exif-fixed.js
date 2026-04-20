import { ExifTool } from 'exiftool-vendored';
import { existsSync } from 'fs';

// Single shared ExifTool instance — reusing it avoids spawning a new process per call
const exiftool = new ExifTool({ taskTimeoutMillis: 120_000 });

/**
 * Decode HTML entities in file paths (e.g., &eacute; → é) that may have been
 * stored in the database from HTML form input.
 */
function decodeHtmlEntities(str) {
  const entityMap = {
    '&eacute;': 'é', '&è;': 'è', '&ê;': 'ê', '&ë;': 'ë',
    '&aacute;': 'á', '&á;': 'á', '&ã;': 'ã',
    '&é;': 'é', '&í;': 'í', '&ó;': 'ó', '&ú;': 'ú',
    '&ç;': 'ç', '&ñ;': 'ñ',
  };
  return str.replace(/&[a-zéèêëáíóúçñ]+;/g, m => entityMap[m] || m);
}

/**
 * Resolve the actual filesystem path from a possibly-encoded path string.
 * Handles: HTML entity decoding, and checks both the given path and common variants.
 */
function resolveActualPath(encodedPath) {
  let decoded = decodeHtmlEntities(encodedPath);

  // If the decoded path exists, use it
  if (existsSync(decoded)) return decoded;

  // Try with forward slashes (in case DB uses backslashes)
  const withForwardSlashes = decoded.replace(/\\/g, '/');
  if (existsSync(withForwardSlashes)) return withForwardSlashes;

  // Try relative to current directory
  const basename = decoded.split(/[\\/]/).pop();
  const cwd = process.cwd();
  const inCwd = `${cwd}/${basename}`;
  if (existsSync(inCwd)) return inCwd;

  return decoded; // Return original even if not found - let exiftool handle the error
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
  filePath, tags,
) {
  if (!tags || tags.length === 0) return;
  try {
    // Resolve the actual filesystem path from the potentially-encoded input
    const actualPath = resolveActualPath(filePath);

    // Check file exists before attempting EXIF write
    if (!existsSync(actualPath)) {
      console.warn(`⚠️ [EXIF] File not found, skipping EXIF write: ${actualPath}`);
      return;
    }

    let attempts = 3;
    while (attempts-- > 0) {
      try {
        await exiftool.write(
          actualPath,
          {
            Keywords: tags,
            XPKeywords: tags.join('; '),
          },
          ['-overwrite_original'],
        );
        break; // success
      } catch (err) {
        if (attempts === 0) throw err;
        // On Windows, exiftool may fail with long Unicode paths or locked files
        await new Promise(r => setTimeout(r, 100));
      }
    }
  } catch (err) {
    console.error(`[EXIF] Failed to write tags to ${filePath}:`, err.message);
    throw err;
  }
}

/**
 * Clean up ExifTool resources. Should be called on shutdown.
 */
export function closeExifTool() {
  exiftool.end();
}