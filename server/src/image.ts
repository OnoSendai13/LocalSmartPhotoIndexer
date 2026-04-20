/**
 * Image processing utilities for photo thumbnails.
 * Uses sharp for fast, efficient resizing.
 */

import sharp from 'sharp';
import { access } from 'fs/promises';

const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.82;

const RAW_EXTENSIONS = new Set([
  '.cr2', '.cr3', '.dng', '.nef', '.nrw', '.arw', '.srf', '.orf',
  '.rw2', '.raf', '.raw', '.rwl', '.pef', '.srw', '.x3f', '.3fr',
  '.iiq', '.erf', '.kdc', '.dcr', '.tif', '.tiff', '.psd', '.psb',
  '.heic', '.heif',
]);

export function isRawFormat(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return RAW_EXTENSIONS.has(ext);
}

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
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface ThumbnailBufferResult {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export async function resizeToThumbnailBuffer(filePath: string): Promise<ThumbnailBufferResult> {
  await access(filePath);

  const metadata = await sharp(filePath).metadata();
  const origWidth = metadata.width || 1;
  const origHeight = metadata.height || 1;

  let newWidth = origWidth;
  let newHeight = origHeight;

  if (origWidth > origHeight) {
    if (origWidth > MAX_DIMENSION) {
      newHeight = Math.round((origHeight * MAX_DIMENSION) / origWidth);
      newWidth = MAX_DIMENSION;
    }
  } else if (origHeight > MAX_DIMENSION) {
    newWidth = Math.round((origWidth * MAX_DIMENSION) / origHeight);
    newHeight = MAX_DIMENSION;
  }

  const buffer = await sharp(filePath)
    .resize(newWidth, newHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: Math.round(JPEG_QUALITY * 100), progressive: true })
    .toBuffer();

  return {
    buffer,
    mimeType: 'image/jpeg',
    width: newWidth,
    height: newHeight,
  };
}

export async function resizeToThumbnail(filePath: string): Promise<ThumbnailResult> {
  const { buffer, mimeType, width, height } = await resizeToThumbnailBuffer(filePath);
  return {
    base64: buffer.toString('base64'),
    mimeType,
    width,
    height,
  };
}
