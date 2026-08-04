import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '../../src/common/secret-crypto.js';
import type { AppConfig } from '../../src/config/app-config.js';
import { UrlSafetyPolicy } from '../../src/link-cards/url-safety.js';
import { StorageMode } from '../../src/media/media.dto.js';
import { MediaService } from '../../src/media/media.service.js';

const createdDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'izumi-media-unit-'));
  createdDirectories.push(directory);
  return directory;
}

function config(localDirectory: string): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3001,
    adminPort: 5173,
    databaseUrl: 'postgres://unused',
    redisUrl: 'redis://unused',
    jwtSecret: 'test-secret-with-more-than-thirty-two-characters',
    jwtExpiresInSeconds: 3600,
    corsOrigins: [],
    corePublicUrl: 'https://core.example.test',
    mediaLocalDirectory: localDirectory,
    mediaImageMaxBytes: 1024,
    mediaVideoMaxBytes: 2048,
  };
}

function localDatabase(inserted?: (values: Record<string, unknown>) => void) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          inserted?.(values);
          const now = values.createdAt as Date;
          return [{ ...values, createdAt: now, finalizedAt: now }];
        },
      }),
    }),
  };
}

afterEach(async () => {
  await Promise.all(
    createdDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe('MediaService Core upload', () => {
  it('stores a valid video locally and returns a ready canonical asset', async () => {
    const directory = await temporaryDirectory();
    const source = path.join(directory, 'request-upload');
    const content = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    await writeFile(source, content);
    let inserted: Record<string, unknown> | undefined;
    const service = new MediaService(
      localDatabase((values) => {
        inserted = values;
      }) as never,
      config(path.join(directory, 'stored')),
      new UrlSafetyPolicy(),
    );

    const asset = await service.upload('owner-1', {
      filePath: source,
      fieldName: 'file',
      originalName: 'clip.webm',
      contentType: 'video/webm',
      alt: 'A short clip',
    });

    expect(asset).toMatchObject({
      status: 'ready',
      publicUrl: expect.stringMatching(
        /^https:\/\/core\.example\.test\/uploads\/owners\/owner-1\/.+\.webm$/u,
      ),
      byteSize: content.byteLength,
      alt: 'A short clip',
    });
    expect(inserted).toMatchObject({ status: 'ready', kind: 'video' });
    const storedPath = path.join(
      directory,
      'stored',
      ...(inserted!.objectKey as string).split('/'),
    );
    await expect(readFile(storedPath)).resolves.toEqual(content);
  });

  it('rejects forged MIME before creating a database row or stored object', async () => {
    const directory = await temporaryDirectory();
    const source = path.join(directory, 'forged');
    await writeFile(source, '<html>not a video</html>');
    const database = localDatabase();
    const service = new MediaService(
      database as never,
      config(path.join(directory, 'stored')),
      new UrlSafetyPolicy(),
    );

    await expect(
      service.upload('owner-1', {
        filePath: source,
        fieldName: 'file',
        originalName: 'forged.webm',
        contentType: 'video/webm',
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_SIGNATURE_MISMATCH' });
  });

  it('removes the local object when the media row cannot be committed', async () => {
    const directory = await temporaryDirectory();
    const storageDirectory = path.join(directory, 'stored');
    const source = path.join(directory, 'request-upload');
    await writeFile(source, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const database = localDatabase(() => {
      throw new Error('database unavailable');
    });
    const service = new MediaService(
      database as never,
      config(storageDirectory),
      new UrlSafetyPolicy(),
    );

    await expect(
      service.upload('owner-1', {
        filePath: source,
        fieldName: 'file',
        originalName: 'clip.webm',
        contentType: 'video/webm',
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_STORAGE_FAILED' });
    await expect(
      readdir(path.join(storageDirectory, 'owners/owner-1')),
    ).resolves.toEqual([]);
  });

  it('does not update S3 fields when the saved secret cannot be decrypted', async () => {
    const directory = await temporaryDirectory();
    const rightKey = Buffer.alloc(32, 3).toString('base64');
    const wrongKey = Buffer.alloc(32, 4).toString('base64');
    const settings = {
      ownerId: 'owner-1',
      mode: 's3',
      endpoint: 'https://s3.example.test',
      region: 'auto',
      bucket: 'izumi',
      accessKeyId: 'access',
      encryptedSecretAccessKey: encryptSecret('saved-secret', rightKey),
      publicBaseUrl: 'https://assets.example.test',
      forcePathStyle: false,
      updatedAt: new Date(),
    };
    const insert = vi.fn();
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => [settings] }),
          }),
        }),
      }),
      insert,
    };
    const appConfig = {
      ...config(path.join(directory, 'stored')),
      credentialsEncryptionKey: wrongKey,
    };
    const service = new MediaService(
      database as never,
      appConfig,
      new UrlSafetyPolicy(),
    );

    await expect(
      service.updateStorageSettings('owner-1', {
        mode: StorageMode.S3,
        bucket: 'new-bucket',
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_CREDENTIALS_INVALID' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects private S3 endpoints in production before saving settings', async () => {
    const directory = await temporaryDirectory();
    const insert = vi.fn();
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => [] }),
          }),
        }),
      }),
      insert,
    };
    const appConfig: AppConfig = {
      ...config(path.join(directory, 'stored')),
      nodeEnv: 'production',
      credentialsEncryptionKey: Buffer.alloc(32, 5).toString('base64'),
    };
    const urlSafety = {
      assertSafe: vi.fn().mockRejectedValue(new Error('private target')),
    };
    const service = new MediaService(database as never, appConfig, urlSafety as never);

    await expect(
      service.updateStorageSettings('owner-1', {
        mode: StorageMode.S3,
        endpoint: 'https://127.0.0.1',
        region: 'auto',
        bucket: 'izumi',
        accessKeyId: 'access',
        secretAccessKey: 'secret',
        publicBaseUrl: 'https://assets.example.test',
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_URL_UNSAFE' });
    expect(urlSafety.assertSafe).toHaveBeenCalledWith('https://127.0.0.1');
    expect(insert).not.toHaveBeenCalled();
  });
});
