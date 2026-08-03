import type { AllowedMediaType } from './media-policy.js';

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function sniffMediaType(bytes: Uint8Array): AllowedMediaType | undefined {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 6 &&
    (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 4, 4) === 'ftyp' &&
    ['avif', 'avis'].includes(ascii(bytes, 8, 4))
  ) {
    return 'image/avif';
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 4, 4) === 'ftyp' &&
    [
      'avc1',
      'dash',
      'iso2',
      'iso3',
      'iso4',
      'iso5',
      'iso6',
      'isom',
      'mmp4',
      'mp41',
      'mp42',
    ].includes(ascii(bytes, 8, 4))
  ) {
    return 'video/mp4';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'video/webm';
  }
  return undefined;
}

export async function readSignature(
  response: Response,
  maxBytes = 64,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const result = new Uint8Array(maxBytes);
  let offset = 0;
  try {
    while (offset < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - offset;
      const chunk = value.subarray(0, remaining);
      result.set(chunk, offset);
      offset += chunk.length;
      if (chunk.length < value.length) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return result.subarray(0, offset);
}
