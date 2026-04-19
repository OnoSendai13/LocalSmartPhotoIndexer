import { ExifTool } from 'exiftool-vendored';
import { existsSync } from 'fs';

// Single shared ExifTool instance — reusing it avoids spawning a new process per call
const exiftool = new ExifTool({ taskTimeoutMillis: 120_000 });

/**
 * Write AI-generated tags to a photo file's EXIF/IPTC/XMP metadata.
 *
 * We write to two locations for maximum compatibility:
 *   - Keywords (MWG composite)  — reconciles IPTC:Keywords + XMP-dc:Subject
 *                                  → picked up by Lightroom, Bridge, digiKam, etc.
 *   - XPKeywords (EXIF)         — Windows Explorer / legacy Windows apps
 *                                  (must be a semicolon-separated string)
 *
 * The `overwrite_original` option avoids creating a "_original" backup file.
 *
 * Note: On Windows, paths with Unicode (e.g., French accents) can cause
 * exiftool temp file creation failures. We work around this by using the
 * full path and ensuring the file exists before writing.
 */
export async function writeTagsToFile(
  filePath: string,
  tags: string[],
): Promise<void> {
  if (!tags || tags.length === 0) return;
  try {
    // Check file exists before attempting EXIF write
    if (!existsSync(filePath)) {
      console.warn(`⚠️ [EXIF] File not found, skipping EXIF write: ${filePath}`);
      return;
    }
    await exiftool.write(
      filePath,
      {
        // MWG composite — writes to both IPTC:Keywords AND XMP-dc:Subject
        Keywords: tags,
        // Windows Explorer keyword field (semicolon-separated string)
        XPKeywords: tags.join('; '),
      },
      // -overwrite_original avoids creating a "_original" backup file
      ['-overwrite_original'],
    );
    console.log(`✅ [EXIF] Tags written to ${filePath}: [${tags.join(', ')}]`);
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
