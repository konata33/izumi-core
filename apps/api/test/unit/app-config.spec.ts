import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/app-config.js';

const baseEnvironment = {
  NODE_ENV: 'test',
  PORT: '3100',
  DATABASE_URL: 'postgres://izumi:izumi@127.0.0.1:54329/izumi_core',
  REDIS_URL: 'redis://127.0.0.1:6389',
  JWT_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  JWT_EXPIRES_IN: '2h',
  OWNER_SETUP_TOKEN: 'test-setup-token-with-more-than-thirty-two-characters',
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

  it('loads complete optional media and AI configuration groups', () => {
    const encryptionKey = Buffer.alloc(32, 7).toString('base64');
    const config = loadConfig({
      ...baseEnvironment,
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'izumi-media',
      S3_ACCESS_KEY_ID: 'izumi',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_PUBLIC_BASE_URL: 'https://assets.example.com/',
      S3_FORCE_PATH_STYLE: 'true',
      AI_PROVIDER_TYPE: 'openai-compatible',
      AI_BASE_URL: 'https://api.example.com/v1/',
      AI_MODEL: 'writer',
      AI_API_KEY: 'provider-secret',
      AI_CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
    });

    expect(config.mediaStorage).toMatchObject({
      publicBaseUrl: 'https://assets.example.com',
      forcePathStyle: true,
    });
    expect(config.defaultAiProvider).toMatchObject({
      providerType: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'writer',
    });
    expect(config.aiCredentialsEncryptionKey).toBe(encryptionKey);
  });

  it('rejects partial optional service configuration and invalid encryption keys', () => {
    expect(() =>
      loadConfig({ ...baseEnvironment, S3_ENDPOINT: 'http://127.0.0.1:9000' }),
    ).toThrow('S3 storage');
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        AI_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(12).toString('base64'),
      }),
    ).toThrow('AI_CREDENTIALS_ENCRYPTION_KEY');
  });
});
