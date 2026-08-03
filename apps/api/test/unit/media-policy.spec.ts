import { describe, expect, it } from 'vitest';

import { validateMediaUpload } from '../../src/media/media-policy.js';
import { sniffMediaType } from '../../src/media/media-signature.js';

const limits = {
  imageMaxBytes: 20 * 1024 * 1024,
  videoMaxBytes: 500 * 1024 * 1024,
};

describe('media upload policy', () => {
  it('rejects SVG and enforces separate image/video size limits', () => {
    expect(() =>
      validateMediaUpload({
        contentType: 'image/svg+xml',
        byteSize: 100,
        ...limits,
      }),
    ).toThrow('Only JPEG');
    expect(() =>
      validateMediaUpload({
        contentType: 'image/png',
        byteSize: limits.imageMaxBytes + 1,
        ...limits,
      }),
    ).toThrow('exceeds');
    expect(
      validateMediaUpload({
        contentType: 'video/mp4; charset=binary',
        byteSize: limits.imageMaxBytes + 1,
        ...limits,
      }),
    ).toMatchObject({ contentType: 'video/mp4', kind: 'video' });
  });

  it.each([
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['image/gif', [...Buffer.from('GIF89a')]],
    ['image/webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]],
    ['image/avif', [0, 0, 0, 0, ...Buffer.from('ftyp'), ...Buffer.from('avif')]],
    ['video/mp4', [0, 0, 0, 0, ...Buffer.from('ftyp'), ...Buffer.from('mp42')]],
    ['video/webm', [0x1a, 0x45, 0xdf, 0xa3]],
  ] as const)('recognizes %s magic bytes', (expected, bytes) => {
    expect(sniffMediaType(Uint8Array.from(bytes))).toBe(expected);
  });

  it('does not trust a filename or declared MIME without matching bytes', () => {
    const disguisedHtml = new TextEncoder().encode('<html>not an image</html>');
    expect(sniffMediaType(disguisedHtml)).toBeUndefined();
  });
});
