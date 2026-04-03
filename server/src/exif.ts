/**
 * EXIF tag writing — stubbed out since exiftool-vendored requires native compilation.
 * The database is the source of truth for tags; writing to files is optional.
 */

export async function writeTagsToFile(
  _filePath: string,
  tags: string[],
): Promise<void> {
  // EXIF writing requires exiftool-vendored (native module, needs C++ toolchain).
  // Tags are stored in SQLite — this is non-critical.
  console.log(`[EXIF stub] Would write tags to file: [${tags.join(', ')}]`);
}

export async function readTagsFromFile(_filePath: string): Promise<string[]> {
  return [];
}

export async function closeExifTool(): Promise<void> {
  // no-op
}
