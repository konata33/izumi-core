import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ENVELOPE_VERSION = 'v1';

export function decodeEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.byteLength !== 32) {
    throw new Error('Credentials encryption key must decode to exactly 32 bytes');
  }
  const normalizedInput = encoded.replace(/=+$/u, '');
  const normalizedKey = key.toString('base64').replace(/=+$/u, '');
  const inputBuffer = Buffer.from(normalizedInput);
  const keyBuffer = Buffer.from(normalizedKey);
  if (
    inputBuffer.byteLength !== keyBuffer.byteLength ||
    !timingSafeEqual(inputBuffer, keyBuffer)
  ) {
    throw new Error('Credentials encryption key is not canonical base64');
  }
  return key;
}

export function encryptSecret(secret: string, encodedKey: string): string {
  const key = decodeEncryptionKey(encodedKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    nonce.toString('base64url'),
    authenticationTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(envelope: string, encodedKey: string): string {
  const [version, nonceValue, tagValue, ciphertextValue, extra] = envelope.split('.');
  if (
    version !== ENVELOPE_VERSION ||
    !nonceValue ||
    !tagValue ||
    ciphertextValue === undefined ||
    extra !== undefined
  ) {
    throw new Error('Encrypted credential has an unsupported envelope');
  }
  const key = decodeEncryptionKey(encodedKey);
  const nonce = Buffer.from(nonceValue, 'base64url');
  const authenticationTag = Buffer.from(tagValue, 'base64url');
  if (nonce.byteLength !== 12 || authenticationTag.byteLength !== 16) {
    throw new Error('Encrypted credential envelope is malformed');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return '••••';
  const visible = Math.min(4, Math.max(2, Math.floor(trimmed.length / 4)));
  return `••••••••${trimmed.slice(-visible)}`;
}
