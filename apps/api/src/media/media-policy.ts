import { HttpStatus } from '@nestjs/common';

import { ApiException } from '../common/api-exception.js';

export const imageMediaTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
] as const;
export const videoMediaTypes = ['video/mp4', 'video/webm'] as const;
export const allowedMediaTypes = [...imageMediaTypes, ...videoMediaTypes] as const;

export type AllowedMediaType = (typeof allowedMediaTypes)[number];
export type MediaKind = 'image' | 'video';

const allowedSet = new Set<string>(allowedMediaTypes);
const imageSet = new Set<string>(imageMediaTypes);

export function normalizeMediaType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function validateMediaUpload(input: {
  contentType: string;
  byteSize: number;
  imageMaxBytes: number;
  videoMaxBytes: number;
}): { contentType: AllowedMediaType; kind: MediaKind } {
  const contentType = normalizeMediaType(input.contentType);
  if (contentType === 'image/svg+xml' || !allowedSet.has(contentType)) {
    throw new ApiException(
      'MEDIA_TYPE_UNSUPPORTED',
      'Only JPEG, PNG, WebP, GIF, AVIF, MP4, and WebM uploads are allowed',
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      { contentType },
    );
  }

  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    throw new ApiException(
      'MEDIA_SIZE_INVALID',
      'Upload size must be a positive integer',
      HttpStatus.BAD_REQUEST,
    );
  }

  const kind: MediaKind = imageSet.has(contentType) ? 'image' : 'video';
  const limit = kind === 'image' ? input.imageMaxBytes : input.videoMaxBytes;
  if (input.byteSize > limit) {
    throw new ApiException(
      'MEDIA_TOO_LARGE',
      `The ${kind} exceeds the configured upload limit`,
      HttpStatus.PAYLOAD_TOO_LARGE,
      { byteSize: input.byteSize, maxBytes: limit },
    );
  }

  return { contentType: contentType as AllowedMediaType, kind };
}

export function safeFileExtension(
  originalName: string,
  contentType: AllowedMediaType,
): string {
  const extensions: Record<AllowedMediaType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  const supplied = originalName.split('.').pop()?.toLowerCase();
  const canonical = extensions[contentType];
  if (supplied === 'jpeg' && contentType === 'image/jpeg') return 'jpg';
  return supplied === canonical ? supplied : canonical;
}
