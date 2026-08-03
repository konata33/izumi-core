import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

const MAX_DECODED_PIXELS = 40_000_000;
const THUMBHASH_EDGE = 100;

export type ImageMetadata = Readonly<{
  width: number;
  height: number;
  thumbhash: string;
}>;

export async function readObjectLimited(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Media object exceeds the configured processing limit');
  }
  if (!response.body) throw new Error('Media object has no response body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        throw new Error('Media object exceeds the configured processing limit');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, byteLength);
}

export async function generateImageMetadata(image: Buffer): Promise<ImageMetadata> {
  const metadata = await sharp(image, {
    failOn: 'warning',
    limitInputPixels: MAX_DECODED_PIXELS,
    pages: 1,
  }).metadata();
  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('Image has invalid dimensions');
  }

  const { data, info } = await sharp(image, {
    failOn: 'warning',
    limitInputPixels: MAX_DECODED_PIXELS,
    pages: 1,
  })
    .autoOrient()
    .resize({
      width: THUMBHASH_EDGE,
      height: THUMBHASH_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = rgbaToThumbHash(info.width, info.height, data);
  return { width, height, thumbhash: Buffer.from(hash).toString('base64url') };
}
