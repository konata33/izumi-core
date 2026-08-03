import path from 'node:path';

import {
  CreateBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApplication } from '../../src/application.js';
import type { AppConfig, MediaStorageConfig } from '../../src/config/app-config.js';
import { runMigrations } from '../../src/database/migrate.js';
import { S3Signer } from '../../src/media/s3-signer.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const accessKeyId = 'izumi-test';
const secretAccessKey = 'izumi-test-secret';
const publicBucket = 'izumi-media-test';
const quarantineBucket = `${publicBucket}-quarantine`;

function uploadForm(
  url: string,
  fields: Record<string, string>,
  content: Uint8Array,
  contentType: string,
): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.set('Content-Type', contentType);
  form.append('file', new Blob([content], { type: contentType }), 'fixture.bin');
  return fetch(url, { method: 'POST', body: form });
}

describe.runIf(integrationEnabled)('media upload quarantine', () => {
  let app: NestFastifyApplication;
  let accessToken: string;
  let database: PostgreSqlContainer;
  let minio: StartedTestContainer;
  let client: S3Client;
  let signer: S3Signer;
  let endpoint: string;

  beforeAll(async () => {
    minio = await new GenericContainer('quay.io/minio/minio:latest')
      .withEnvironment({
        MINIO_ROOT_USER: accessKeyId,
        MINIO_ROOT_PASSWORD: secretAccessKey,
      })
      .withCommand(['server', '/data'])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start();
    database = await new PostgreSqlContainer('postgres:16-alpine').start();
    endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    await Promise.all([
      client.send(new CreateBucketCommand({ Bucket: publicBucket })),
      client.send(new CreateBucketCommand({ Bucket: quarantineBucket })),
    ]);
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: publicBucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${publicBucket}/*`],
            },
          ],
        }),
      }),
    );
    const config: MediaStorageConfig = {
      endpoint,
      region: 'us-east-1',
      bucket: publicBucket,
      accessKeyId,
      secretAccessKey,
      publicBaseUrl: `${endpoint}/${publicBucket}`,
      forcePathStyle: true,
      imageMaxBytes: 1024,
      videoMaxBytes: 2048,
    };
    signer = new S3Signer(config);

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
      ownerSetupToken: 'test-setup-token-with-at-least-thirty-two-characters',
      corsOrigins: [],
      mediaStorage: config,
    };
    app = await createApplication(appConfig);
    await app.init();
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: { 'x-izumi-setup-token': appConfig.ownerSetupToken },
      payload: {
        username: 'konata',
        password: 'correct-horse-battery-staple',
      },
    });
    expect(setup.statusCode).toBe(201);
    accessToken = (setup.json() as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    client?.destroy();
    await Promise.all([minio?.stop(), database?.stop()]);
  });

  it('keeps uploads private until promotion', async () => {
    const key = 'owners/owner-1/private.png';
    const content = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const upload = await signer.presignUpload(key, 'image/png', content.byteLength);

    expect(
      await uploadForm(upload.url, upload.fields, content, 'image/png'),
    ).toMatchObject({ ok: true });
    expect(await fetch(`${endpoint}/${quarantineBucket}/${key}`)).toMatchObject({
      status: 403,
    });
    expect(await fetch(signer.publicUrl(key))).toMatchObject({ status: 404 });

    await Promise.all([
      signer.promote(key, 'image/png', content.byteLength),
      signer.promote(key, 'image/png', content.byteLength),
    ]);

    expect(await fetch(signer.publicUrl(key))).toMatchObject({ status: 200 });
    await signer.discardQuarantine(key);
    await expect(
      client.send(new HeadObjectCommand({ Bucket: quarantineBucket, Key: key })),
    ).rejects.toMatchObject({ name: 'NotFound' });
    await expect(
      signer.promote(key, 'image/png', content.byteLength),
    ).resolves.toBeUndefined();
    expect(await fetch(signer.publicUrl(key))).toMatchObject({ status: 200 });
  });

  it('converges concurrent HTTP finalization after quarantine cleanup', async () => {
    const content = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    const initiated = await app.inject({
      method: 'POST',
      url: '/api/v1/media/uploads',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        originalName: 'concurrent.webm',
        contentType: 'video/webm',
        byteSize: content.byteLength,
      },
    });
    expect(initiated.statusCode).toBe(201);
    const initiation = initiated.json() as {
      data: {
        asset: { id: string; publicUrl: string };
        uploadUrl: string;
        uploadFields: Record<string, string>;
      };
    };
    const { asset, uploadUrl, uploadFields } = initiation.data;
    expect(
      await uploadForm(uploadUrl, uploadFields, content, 'video/webm'),
    ).toMatchObject({ ok: true });
    const key = new URL(asset.publicUrl).pathname.split(`/${publicBucket}/`, 2).at(1)!;
    expect(await fetch(`${endpoint}/${quarantineBucket}/${key}`)).toMatchObject({
      status: 403,
    });

    const nativeFetch = globalThis.fetch;
    let releaseSlowHead = () => undefined;
    const slowHeadReleased = new Promise<void>((resolve) => {
      releaseSlowHead = resolve;
    });
    let markSlowHeadStarted = () => undefined;
    const slowHeadStarted = new Promise<void>((resolve) => {
      markSlowHeadStarted = resolve;
    });
    let headCount = 0;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        if (init?.method === 'HEAD') {
          headCount += 1;
          if (headCount === 1) {
            markSlowHeadStarted();
            await slowHeadReleased;
          }
        }
        return nativeFetch(input, init);
      });
    type FinalizedResponse = {
      data: { id: string; publicUrl: string; status: string };
    };
    let statuses: number[];
    let bodies: FinalizedResponse[];
    try {
      const slowFinalize = app.inject({
        method: 'POST',
        url: `/api/v1/media/${asset.id}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { alt: 'Concurrent media' },
      });
      await slowHeadStarted;
      const fastFinalize = await app.inject({
        method: 'POST',
        url: `/api/v1/media/${asset.id}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { alt: 'Concurrent media' },
      });
      releaseSlowHead();
      const slowResponse = await slowFinalize;
      statuses = [slowResponse.statusCode, fastFinalize.statusCode];
      bodies = [slowResponse.json(), fastFinalize.json()] as FinalizedResponse[];
    } finally {
      releaseSlowHead();
      fetchSpy.mockRestore();
    }

    expect(statuses).toEqual([201, 201]);
    expect(bodies.map(({ data }) => data)).toEqual([
      expect.objectContaining({
        id: asset.id,
        publicUrl: asset.publicUrl,
        status: 'ready',
      }),
      expect.objectContaining({
        id: asset.id,
        publicUrl: asset.publicUrl,
        status: 'ready',
      }),
    ]);
    const pool = new Pool({ connectionString: database.getConnectionUri(), max: 1 });
    try {
      const rows = await pool.query<{
        id: string;
        public_url: string;
        status: string;
      }>('SELECT id, public_url, status FROM media_assets WHERE id = $1', [asset.id]);
      expect(rows.rows).toEqual([
        { id: asset.id, public_url: asset.publicUrl, status: 'ready' },
      ]);
    } finally {
      await pool.end();
    }
    await expect(
      client.send(new HeadObjectCommand({ Bucket: publicBucket, Key: key })),
    ).resolves.toMatchObject({
      ContentLength: content.byteLength,
      ContentType: 'video/webm',
    });
    await expect(
      client.send(new HeadObjectCommand({ Bucket: quarantineBucket, Key: key })),
    ).rejects.toMatchObject({ name: 'NotFound' });
  });

  it('rejects alternate MIME and oversized payloads in the POST policy', async () => {
    const content = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const alternate = await signer.presignUpload(
      'owners/owner-1/alternate.png',
      'image/png',
      content.byteLength,
    );
    const alternateResponse = await uploadForm(
      alternate.url,
      alternate.fields,
      content,
      'text/html',
    );
    expect(alternateResponse.status).toBe(403);

    const oversized = await signer.presignUpload(
      'owners/owner-1/oversized.png',
      'image/png',
      content.byteLength,
    );
    const oversizedResponse = await uploadForm(
      oversized.url,
      oversized.fields,
      new Uint8Array([...content, 0]),
      'image/png',
    );
    expect(oversizedResponse.status).toBe(400);
    expect(await oversizedResponse.text()).toContain('EntityTooLarge');
  });
});
