import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/application.js';
import type { AppConfig } from '../../src/config/app-config.js';
import {
  MAX_REQUEST_ENVELOPE_BYTES,
  MAX_RICH_DOCUMENT_BYTES,
} from '../../src/posts/rich-content.js';

describe('HTTP request envelope limit', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const config: AppConfig = {
      nodeEnv: 'test',
      port: 3001,
      adminPort: 5173,
      databaseUrl: 'postgres://izumi:izumi@127.0.0.1:1/unused',
      redisUrl: 'redis://127.0.0.1:1',
      jwtSecret: 'test-only-secret-with-at-least-thirty-two-characters',
      jwtExpiresInSeconds: 3600,
      corsOrigins: [],
      corePublicUrl: 'http://localhost:3001',
      mediaLocalDirectory: '/tmp/izumi-body-limit-media',
      mediaImageMaxBytes: 1024,
      mediaVideoMaxBytes: 2048,
    };
    app = await createApplication(config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('parses a two-document AI envelope before application validation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'owner',
        password: 'valid-password',
        padding: 'x'.repeat(MAX_RICH_DOCUMENT_BYTES * 2),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('rejects JSON above the exported envelope at the HTTP boundary', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'owner',
        password: 'valid-password',
        padding: 'x'.repeat(MAX_REQUEST_ENVELOPE_BYTES),
      },
    });

    expect(response.statusCode).toBe(413);
  });
});
