import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/app-config.js';

const baseEnvironment = {
  NODE_ENV: 'test',
  PORT: '3100',
  DATABASE_URL: 'postgres://izumi:izumi@127.0.0.1:54329/izumi_core',
  REDIS_URL: 'redis://127.0.0.1:6389',
  JWT_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  JWT_EXPIRES_IN: '2h',
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadConfig', () => {
  it('normalizes explicit environment values', () => {
    expect(loadConfig(baseEnvironment)).toMatchObject({
      nodeEnv: 'test',
      port: 3100,
      jwtExpiresInSeconds: 7200,
    });
  });

  it('uses the Conductor-assigned API port when it is present', () => {
    expect(loadConfig({ ...baseEnvironment, CONDUCTOR_PORT: '4100' }).port).toBe(4100);
  });

  it('pairs the Admin with the next Conductor port and permits it in development', () => {
    const config = loadConfig({
      ...baseEnvironment,
      NODE_ENV: 'development',
      CONDUCTOR_PORT: '4100',
      CORS_ORIGIN: 'http://localhost:5173',
    });

    expect(config.adminPort).toBe(4101);
    expect(config.corsOrigins).toEqual([
      'http://localhost:5173',
      'http://localhost:4101',
    ]);
  });

  it('splits and trims the explicit browser-origin allowlist', () => {
    expect(
      loadConfig({
        ...baseEnvironment,
        CORS_ORIGIN: ' https://izumi.example.com, https://admin.example.com ',
      }).corsOrigins,
    ).toEqual(['https://izumi.example.com', 'https://admin.example.com']);
  });

  it('rejects production configuration without a strong JWT secret', () => {
    expect(() => loadConfig({ ...baseEnvironment, JWT_SECRET: 'too-short' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('loads media infrastructure, AI defaults, and the shared encryption key', () => {
    const encryptionKey = Buffer.alloc(32, 7).toString('base64');
    const config = loadConfig({
      ...baseEnvironment,
      CORE_PUBLIC_URL: 'https://core.example.com/',
      MEDIA_LOCAL_DIR: './var/media',
      AI_PROVIDER_TYPE: 'openai-compatible',
      AI_BASE_URL: 'https://api.example.com/v1/',
      AI_MODEL: 'writer',
      AI_API_KEY: 'provider-secret',
      CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
    });

    expect(config.corePublicUrl).toBe('https://core.example.com');
    expect(config.mediaLocalDirectory).toBe(`${process.cwd()}/var/media`);
    expect(config.defaultAiProvider).toMatchObject({
      providerType: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'writer',
    });
    expect(config.aiCredentialsEncryptionKey).toBe(encryptionKey);
    expect(config.credentialsEncryptionKey).toBe(encryptionKey);
  });

  it('rejects invalid encryption keys and production without a public Core URL', () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(12).toString('base64'),
      }),
    ).toThrow('CREDENTIALS_ENCRYPTION_KEY');
    expect(() => loadConfig({ ...baseEnvironment, NODE_ENV: 'production' })).toThrow(
      'CORE_PUBLIC_URL',
    );
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        NODE_ENV: 'production',
        CORE_PUBLIC_URL: 'http://core.example.com',
      }),
    ).toThrow('HTTPS');
  });
});
