import { ExifTool, WriteTagsRequest } from 'exiftool-vendored';

const exiftool = new ExifTool();

/**
 * Write tags to a photo file's EXIF/XMP metadata.
 * Uses XPKeywords (Windows) and Keywords (standard EXIF).
 */
export async function writeTagsToFile(
  filePath: string,
  tags: string[],
): Promise<void> {
  try {
    const writeRequest: WriteTagsRequest = {
      File: filePath,
      IFD0: {
        XPKeywords: tags.join('; '),
        Keywords: tags,
      },
    };
    await exiftool.writeTags(writeRequest);
    console.log(`Tags written to file: ${filePath} -> [${tags.join(', ')}]`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Failed to write EXIF tags to ${filePath}: ${msg}`);
  }
}

/**
 * Read tags from a photo file's EXIF/XMP metadata.
 * Returns array of tag strings, empty on failure.
 */
export async function readTagsFromFile(
  filePath: string,
): Promise<string[]> {
  try {
    const metadata = await exiftool.read(filePath);
    const rawTags = metadata.Keywords || metadata.XPKeywords;
    if (!rawTags) return [];

    if (typeof rawTags === 'string') {
      return rawTags.split(/[;,\n]/).map(t => t.trim()).filter(Boolean);
    }
    if (Array.isArray(rawTags)) {
      return rawTags.map(String).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

export async function closeExifTool(): Promise<void> {
  await exiftool.end();
}