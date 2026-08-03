import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, maskSecret } from '../../src/ai/ai.crypto.js';

describe('AI credential encryption', () => {
  it('round-trips with AES-256-GCM and uses a fresh nonce', () => {
    const key = randomBytes(32).toString('base64');
    const first = encryptSecret('sk-sensitive-value', key);
    const second = encryptSecret('sk-sensitive-value', key);

    expect(first).not.toBe(second);
    expect(first).not.toContain('sk-sensitive-value');
    expect(decryptSecret(first, key)).toBe('sk-sensitive-value');
    expect(decryptSecret(second, key)).toBe('sk-sensitive-value');
  });

  it('rejects tampered ciphertext and the wrong encryption key', () => {
    const key = randomBytes(32).toString('base64');
    const envelope = encryptSecret('secret', key);
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith('A') ? 'B' : 'A'}`;

    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(envelope, randomBytes(32).toString('base64'))).toThrow();
  });

  it('returns only a short suffix when masking credentials', () => {
    expect(maskSecret('sk-ant-long-secret-123456')).toBe('••••••••3456');
    expect(maskSecret('tiny')).toBe('••••');
  });
});
