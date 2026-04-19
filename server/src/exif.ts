import { ExifTool } from 'exiftool-vendored';
import { realpathSync } from 'fs';

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
 * Note: On Windows, paths with Unicode (e.g., French accents) are resolved
 * through realpathSync to avoid exiftool path encoding issues.
 */
export async function writeTagsToFile(
  filePath: string,
  tags: string[],
): Promise<void> {
  if (!tags || tags.length === 0) return;
  try {
    // Resolve path through filesystem to handle Windows Unicode encoding
    const resolvedPath = realpathSync(filePath);
    await exiftool.write(
      resolvedPath,
      {
        // MWG composite — writes to both IPTC:Keywords AND XMP-dc:Subject
        Keywords: tags,
        // Windows Explorer keyword field (semicolon-separated string)
        XPKeywords: tags.join('; '),
      },
      // -overwrite_original avoids creating a "_original" backup file
      ['-overwrite_original'],
    );
    console.log(`✅ [EXIF] Tags written to ${resolvedPath}: [${tags.join(', ')}]`);
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
