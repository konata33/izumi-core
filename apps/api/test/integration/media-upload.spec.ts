import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CreateBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/application.js';
import type { AppConfig } from '../../src/config/app-config.js';
import { runMigrations } from '../../src/database/migrate.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

function multipartUpload(
  content: Buffer,
  filename: string,
  contentType: string,
  alt?: string,
): { payload: Buffer; contentType: string } {
  const boundary = 'izumi-integration-boundary';
  const parts: Buffer[] = [];
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    content,
    Buffer.from('\r\n'),
  );
  if (alt !== undefined) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\n${alt}\r\n`,
      ),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe.runIf(integrationEnabled)('Core media upload and storage settings', () => {
  let app: NestFastifyApplication;
  let accessToken: string;
  let database: PostgreSqlContainer;
  let localDirectory: string;
  let pool: Pool;
  let s3Container: StartedTestContainer;
  let s3Client: S3Client;
  let s3Endpoint: string;

  beforeAll(async () => {
    [database, s3Container] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new GenericContainer('quay.io/minio/minio:latest')
        .withEnvironment({
          MINIO_ROOT_USER: 'izumi-test',
          MINIO_ROOT_PASSWORD: 'izumi-test-secret',
        })
        .withCommand(['server', '/data'])
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
        .start(),
    ]);
    s3Endpoint = `http://${s3Container.getHost()}:${s3Container.getMappedPort(9000)}`;
    s3Client = new S3Client({
      endpoint: s3Endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'izumi-test',
        secretAccessKey: 'izumi-test-secret',
      },
    });
    await s3Client.send(new CreateBucketCommand({ Bucket: 'izumi-media-test' }));
    localDirectory = await mkdtemp(path.join(os.tmpdir(), 'izumi-media-integration-'));
    await runMigrations({
      databaseUrl: database.getConnectionUri(),
      migrationsFolder: path.resolve(process.cwd(), 'src/database/migrations'),
    });
    const appConfig: AppConfig = {
      nodeEnv: 'test',
      port: 3001,
      adminPort: 5173,
      databaseUrl: database.getConnectionUri(),
      redisUrl: 'redis://127.0.0.1:6389',
      jwtSecret: 'test-only-secret-with-at-least-thirty-two-characters',
      jwtExpiresInSeconds: 3_600,
      corsOrigins: [],
      corePublicUrl: 'https://core.example.test',
      mediaLocalDirectory: localDirectory,
      mediaImageMaxBytes: 1024,
      mediaVideoMaxBytes: 2048,
      credentialsEncryptionKey: Buffer.alloc(32, 8).toString('base64'),
      aiCredentialsEncryptionKey: Buffer.alloc(32, 8).toString('base64'),
    };
    app = await createApplication(appConfig);
    await app.init();
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'konata',
        password: 'correct-horse-battery-staple',
      },
    });
    expect(setup.statusCode).toBe(201);
    accessToken = (setup.json() as { data: { accessToken: string } }).data.accessToken;
    pool = new Pool({ connectionString: database.getConnectionUri(), max: 1 });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    s3Client?.destroy();
    await Promise.all([database?.stop(), s3Container?.stop()]);
    await rm(localDirectory, { recursive: true, force: true });
  });

  it('defaults to local storage and tests the saved local configuration', async () => {
    const settings = await app.inject({
      method: 'GET',
      url: '/api/v1/storage/settings',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      data: {
        mode: 'local',
        localPublicBaseUrl: 'https://core.example.test/uploads',
        secretAccessKeyMasked: null,
      },
    });
    expect(JSON.stringify(settings.json())).not.toContain(localDirectory);

    const test = await app.inject({
      method: 'POST',
      url: '/api/v1/storage/settings/test',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ data: { ok: true, mode: 'local' } });
  });

  it('uploads a validated image as ready and serves it with nosniff', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const multipart = multipartUpload(png, 'pixel.png', 'image/png', 'One pixel');
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/media/uploads',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': multipart.contentType,
      },
      payload: multipart.payload,
    });
    expect(upload.statusCode).toBe(201);
    const asset = (
      upload.json() as {
        data: {
          id: string;
          publicUrl: string;
          status: string;
          alt: string;
          width: number;
          height: number;
        };
      }
    ).data;
    expect(asset).toMatchObject({
      status: 'ready',
      alt: 'One pixel',
      width: 1,
      height: 1,
    });
    expect(asset.publicUrl).toMatch(
      /^https:\/\/core\.example\.test\/uploads\/owners\//u,
    );

    const served = await app.inject({
      method: 'GET',
      url: new URL(asset.publicUrl).pathname,
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.rawPayload).toEqual(png);
    const rows = await pool.query<{ status: string }>(
      'SELECT status FROM media_assets WHERE id = $1',
      [asset.id],
    );
    expect(rows.rows).toEqual([{ status: 'ready' }]);
  });

  it('rejects forged MIME and configured image-size overflow', async () => {
    const forged = multipartUpload(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      'forged.png',
      'image/png',
    );
    const forgedResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/media/uploads',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': forged.contentType,
      },
      payload: forged.payload,
    });
    expect(forgedResponse.statusCode).toBe(415);
    expect(forgedResponse.json()).toMatchObject({
      error: { code: 'MEDIA_SIGNATURE_MISMATCH' },
    });

    const oversized = multipartUpload(
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        Buffer.alloc(1024),
      ]),
      'oversized.png',
      'image/png',
    );
    const oversizedResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/media/uploads',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': oversized.contentType,
      },
      payload: oversized.payload,
    });
    expect(oversizedResponse.statusCode).toBe(413);
    expect(oversizedResponse.json()).toMatchObject({
      error: { code: 'MEDIA_TOO_LARGE' },
    });

    const beyondMultipartLimit = multipartUpload(
      Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2048)]),
      'oversized.webm',
      'video/webm',
    );
    const cappedResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/media/uploads',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': beyondMultipartLimit.contentType,
      },
      payload: beyondMultipartLimit.payload,
    });
    expect(cappedResponse.statusCode).toBe(413);
    expect(cappedResponse.json()).toMatchObject({
      error: { code: 'MEDIA_TOO_LARGE' },
    });
  });

  it('encrypts saved S3 credentials and uploads through the saved connection', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/storage/settings',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        mode: 's3',
        endpoint: s3Endpoint,
        region: 'us-east-1',
        bucket: 'izumi-media-test',
        accessKeyId: 'izumi-test',
        secretAccessKey: 'izumi-test-secret',
        publicBaseUrl: `${s3Endpoint}/izumi-media-test`,
        forcePathStyle: true,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      data: {
        mode: 's3',
        accessKeyId: 'izumi-test',
        secretAccessKeyMasked: expect.stringContaining('cret'),
      },
    });
    expect(JSON.stringify(saved.json())).not.toContain('izumi-test-secret');
    const encrypted = await pool.query<{ encrypted_secret_access_key: string }>(
      'SELECT encrypted_secret_access_key FROM storage_settings LIMIT 1',
    );
    expect(encrypted.rows[0]!.encrypted_secret_access_key).not.toContain(
      'izumi-test-secret',
    );

    const connection = await app.inject({
      method: 'POST',
      url: '/api/v1/storage/settings/test',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(connection.statusCode).toBe(200);
    expect(connection.json()).toMatchObject({ data: { ok: true, mode: 's3' } });

    const video = multipartUpload(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      'clip.webm',
      'video/webm',
    );
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/media/uploads',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': video.contentType,
      },
      payload: video.payload,
    });
    expect(uploaded.statusCode).toBe(201);
    const s3Asset = (uploaded.json() as { data: { publicUrl: string } }).data;
    const objectKey = new URL(s3Asset.publicUrl).pathname.replace(
      '/izumi-media-test/',
      '',
    );
    await expect(
      s3Client.send(
        new HeadObjectCommand({ Bucket: 'izumi-media-test', Key: objectKey }),
      ),
    ).resolves.toMatchObject({
      ContentLength: 4,
      ContentType: 'video/webm',
    });

    const local = await app.inject({
      method: 'PUT',
      url: '/api/v1/storage/settings',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { mode: 'local' },
    });
    expect(local.statusCode).toBe(200);
    expect(local.json()).toMatchObject({
      data: { mode: 'local', secretAccessKeyMasked: expect.any(String) },
    });
  });
});
