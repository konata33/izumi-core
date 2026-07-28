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

  it('uses PORT even when a platform port is present', () => {
    expect(loadConfig({ ...baseEnvironment, CONDUCTOR_PORT: '4100' }).port).toBe(3100);
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
});
