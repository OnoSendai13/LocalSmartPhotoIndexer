/**
 * Image processing utilities for photo thumbnails.
 * Uses sharp for fast, efficient resizing.
 */

import sharp from 'sharp';
import { existsSync } from 'fs';

// Same parameters as the frontend for consistency
const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.88;

// RAW and unsupported formats that cannot be decoded for thumbnails
const RAW_EXTENSIONS = new Set([
  '.cr2', '.cr3', '.dng', '.nef', '.nrw', '.arw', '.srf', '.orf',
  '.rw2', '.raf', '.raw', '.rwl', '.pef', '.srw', '.x3f', '.3fr',
  '.iiq', '.erf', '.kdc', '.dcr', '.tif', '.tiff', '.psd', '.psb',
  '.heic', '.heif',  // HEIC support is unstable on Windows in sharp
]);

/**
 * Check if a file is a RAW or unsupported format.
 */
export function isRawFormat(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return RAW_EXTENSIONS.has(ext);
}

/**
 * Get MIME type from filename extension.
 */
export function getMimeType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.heic': 'image/heif',
    '.heif': 'image/heif',
  };
  return mimeMap[ext] || 'image/jpeg';
}

export interface ThumbnailResult {
  base64: string;      // Raw base64 data (no data URL prefix)
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Resize an image file to a thumbnail (max 480px) and return as base64 JPEG.
 */
export async function resizeToThumbnail(filePath: string): Promise<ThumbnailResult> {
  if (!existsSync(filePath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }

  // Get image dimensions first
  const metadata = await sharp(filePath).metadata();
  const origWidth = metadata.width || 1;
  const origHeight = metadata.height || 1;

  // Calculate new dimensions maintaining aspect ratio
  let newWidth = origWidth;
  let newHeight = origHeight;

  if (origWidth > origHeight) {
    if (origWidth > MAX_DIMENSION) {
      newHeight = Math.round((origHeight * MAX_DIMENSION) / origWidth);
      newWidth = MAX_DIMENSION;
    }
  } else {
    if (origHeight > MAX_DIMENSION) {
      newWidth = Math.round((origWidth * MAX_DIMENSION) / origHeight);
      newHeight = MAX_DIMENSION;
    }
  }

  // Resize and convert to JPEG
  const jpegBuffer = await sharp(filePath)
    .resize(newWidth, newHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: Math.round(JPEG_QUALITY * 100), progressive: true })
    .toBuffer();

  const base64 = jpegBuffer.toString('base64');

  return {
    base64,
    mimeType: 'image/jpeg',
    width: newWidth,
    height: newHeight,
  };
}
