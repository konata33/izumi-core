import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export type RuntimeSecrets = Readonly<{
  jwtSecret: string;
  credentialsEncryptionKey: string;
}>;

const runtimeSecretsFilename = 'runtime-secrets.json';

function isEncryptionKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const decoded = Buffer.from(value, 'base64');
  return (
    decoded.byteLength === 32 &&
    decoded.toString('base64').replace(/=+$/u, '') === value.replace(/=+$/u, '')
  );
}

function parseRuntimeSecrets(contents: string, filename: string): RuntimeSecrets {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`Runtime secrets file is not valid JSON: ${filename}`);
  }

  if (typeof value !== 'object' || value === null) {
    throw new Error(`Runtime secrets file has an invalid shape: ${filename}`);
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.jwtSecret !== 'string' ||
    record.jwtSecret.length < 32 ||
    !isEncryptionKey(record.credentialsEncryptionKey)
  ) {
    throw new Error(`Runtime secrets file contains invalid secrets: ${filename}`);
  }

  return {
    jwtSecret: record.jwtSecret,
    credentialsEncryptionKey: record.credentialsEncryptionKey,
  };
}

function readRuntimeSecrets(filename: string): RuntimeSecrets {
  const secrets = parseRuntimeSecrets(readFileSync(filename, 'utf8'), filename);
  chmodSync(filename, 0o600);
  return secrets;
}

function createRuntimeSecrets(filename: string): RuntimeSecrets {
  const secrets: RuntimeSecrets = {
    jwtSecret: randomBytes(48).toString('base64url'),
    credentialsEncryptionKey: randomBytes(32).toString('base64'),
  };

  const temporaryFilename = `${filename}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temporaryFilename, `${JSON.stringify(secrets, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  try {
    linkSync(temporaryFilename, filename);
    return secrets;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      return readRuntimeSecrets(filename);
    }
    throw error;
  } finally {
    unlinkSync(temporaryFilename);
  }
}

export function resolveRuntimeSecrets(input: {
  dataDirectory: string;
  jwtSecret?: string;
  credentialsEncryptionKey?: string;
}): RuntimeSecrets {
  if (input.jwtSecret && input.credentialsEncryptionKey) {
    return {
      jwtSecret: input.jwtSecret,
      credentialsEncryptionKey: input.credentialsEncryptionKey,
    };
  }

  mkdirSync(input.dataDirectory, { recursive: true, mode: 0o700 });
  const filename = path.join(input.dataDirectory, runtimeSecretsFilename);
  const stored = (() => {
    try {
      return readRuntimeSecrets(filename);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return createRuntimeSecrets(filename);
      }
      throw error;
    }
  })();

  return {
    jwtSecret: input.jwtSecret ?? stored.jwtSecret,
    credentialsEncryptionKey:
      input.credentialsEncryptionKey ?? stored.credentialsEncryptionKey,
  };
}
