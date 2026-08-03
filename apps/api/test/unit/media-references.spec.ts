import { describe, expect, it } from 'vitest';

import { extractMediaReferences } from '../../src/media/media-references.js';

describe('rich-document media references', () => {
  it('extracts canonical src values from Haklex image, gallery, and video nodes', () => {
    expect(
      extractMediaReferences({
        root: {
          children: [
            {
              type: 'image',
              src: 'https://assets.example.test/image.webp',
              altText: 'Editorial image',
            },
            {
              type: 'gallery',
              images: [
                {
                  src: 'https://assets.example.test/image.webp',
                  alt: 'Same image',
                },
                {
                  src: 'https://assets.example.test/gallery.webp',
                  alt: 'Gallery image',
                },
              ],
            },
            {
              type: 'video',
              src: 'https://assets.example.test/clip.mp4',
              poster: 'https://assets.example.test/poster.webp',
            },
          ],
        },
      }),
    ).toEqual([
      {
        publicUrl: 'https://assets.example.test/image.webp',
        nodeType: 'image',
        alt: 'Editorial image',
      },
      {
        publicUrl: 'https://assets.example.test/image.webp',
        nodeType: 'gallery',
        alt: 'Same image',
      },
      {
        publicUrl: 'https://assets.example.test/gallery.webp',
        nodeType: 'gallery',
        alt: 'Gallery image',
      },
      {
        publicUrl: 'https://assets.example.test/clip.mp4',
        nodeType: 'video',
      },
      {
        publicUrl: 'https://assets.example.test/poster.webp',
        nodeType: 'video-poster',
      },
    ]);
  });

  it('ignores unrelated src fields on non-media nodes', () => {
    expect(
      extractMediaReferences({
        type: 'link',
        src: 'https://external.example.test',
        children: [],
      }),
    ).toEqual([]);
  });
});
