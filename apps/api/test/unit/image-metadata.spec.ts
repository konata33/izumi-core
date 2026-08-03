import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  generateImageMetadata,
  readObjectLimited,
} from '../../src/media/image-metadata.js';

describe('server-side image metadata', () => {
  it('decodes dimensions and generates a thumbhash from trusted pixels', async () => {
    const image = await sharp({
      create: {
        width: 24,
        height: 12,
        channels: 4,
        background: { r: 151, g: 119, b: 82, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    await expect(generateImageMetadata(image)).resolves.toMatchObject({
      width: 24,
      height: 12,
      thumbhash: expect.any(String),
    });
  });

  it('rejects a file with plausible signature bytes but invalid image data', async () => {
    const invalidPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    await expect(generateImageMetadata(invalidPng)).rejects.toBeDefined();
  });

  it('stops reading when a remote object exceeds its processing limit', async () => {
    await expect(
      readObjectLimited(
        new Response(new Uint8Array(64), {
          headers: { 'Content-Length': '64' },
        }),
        32,
      ),
    ).rejects.toThrow('processing limit');
  });
});
