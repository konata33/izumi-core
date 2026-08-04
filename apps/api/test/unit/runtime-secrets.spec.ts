import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveRuntimeSecrets } from '../../src/config/runtime-secrets.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'izumi-runtime-secrets-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('resolveRuntimeSecrets', () => {
  it('generates secure secrets once and reuses them after restart', () => {
    const dataDirectory = temporaryDirectory();
    const first = resolveRuntimeSecrets({ dataDirectory });
    const second = resolveRuntimeSecrets({ dataDirectory });
    const filename = path.join(dataDirectory, 'runtime-secrets.json');

    expect(first).toEqual(second);
    expect(first.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(Buffer.from(first.credentialsEncryptionKey, 'base64')).toHaveLength(32);
    expect(statSync(filename).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual(first);
  });

  it('uses deployment secrets without creating a local file', () => {
    const dataDirectory = temporaryDirectory();
    const credentialsEncryptionKey = Buffer.alloc(32, 4).toString('base64');

    expect(
      resolveRuntimeSecrets({
        dataDirectory,
        jwtSecret: 'deployment-jwt-secret-with-at-least-thirty-two-characters',
        credentialsEncryptionKey,
      }),
    ).toEqual({
      jwtSecret: 'deployment-jwt-secret-with-at-least-thirty-two-characters',
      credentialsEncryptionKey,
    });
    expect(() => statSync(path.join(dataDirectory, 'runtime-secrets.json'))).toThrow();
  });

  it('fails closed instead of replacing a corrupted secrets file', () => {
    const dataDirectory = temporaryDirectory();
    const filename = path.join(dataDirectory, 'runtime-secrets.json');
    writeFileSync(filename, '{"jwtSecret":"broken"}\n', { mode: 0o600 });

    expect(() => resolveRuntimeSecrets({ dataDirectory })).toThrow(
      'contains invalid secrets',
    );
    expect(readFileSync(filename, 'utf8')).toBe('{"jwtSecret":"broken"}\n');
  });
});
