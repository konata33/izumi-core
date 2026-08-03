import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../src/config/app-config.js';
import { MediaService } from '../../src/media/media.service.js';
import { S3Signer } from '../../src/media/s3-signer.js';

const now = new Date('2026-07-30T00:00:00.000Z');
const asset = {
  id: 'asset-1',
  ownerId: 'owner-1',
  objectKey: 'owners/owner-1/asset-1.png',
  originalName: 'article.png',
  contentType: 'image/png',
  kind: 'image',
  byteSize: 28,
  status: 'initiated',
  publicUrl: 'https://assets.example.test/owners/owner-1/asset-1.png',
  width: null,
  height: null,
  thumbhash: null,
  alt: null,
  finalizedAt: null,
  createdAt: now,
};

const config = {
  mediaStorage: {
    endpoint: 'https://s3.example.test',
    region: 'auto',
    bucket: 'izumi',
    accessKeyId: 'test',
    secretAccessKey: 'test-secret',
    publicBaseUrl: 'https://assets.example.test',
    forcePathStyle: true,
    imageMaxBytes: 20 * 1024 * 1024,
    videoMaxBytes: 500 * 1024 * 1024,
  },
} as AppConfig;

function selection(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MediaService verification and cleanup', () => {
  it('rejects a forged MIME when object magic bytes do not match', async () => {
    const update = vi.fn();
    const database = {
      select: () => selection([asset]),
      update,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            'Content-Length': String(asset.byteSize),
            'Content-Type': asset.contentType,
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<html>forged image payload</html>', { status: 206 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const promote = vi.spyOn(S3Signer.prototype, 'promote');

    const service = new MediaService(database as never, config);
    await expect(service.finalize('owner-1', asset.id, {})).rejects.toMatchObject({
      code: 'MEDIA_SIGNATURE_MISMATCH',
    });
    expect(update).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });

  it('keeps a validated upload retryable when public promotion fails', async () => {
    const videoAsset = {
      ...asset,
      objectKey: 'owners/owner-1/asset-1.webm',
      contentType: 'video/webm',
      kind: 'video',
      byteSize: 4,
    };
    const update = vi.fn();
    const database = {
      select: () => selection([videoAsset]),
      update,
    };
    vi.spyOn(S3Signer.prototype, 'presign').mockResolvedValue('https://signed.test');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_url, init) =>
        init?.method === 'HEAD'
          ? new Response(null, {
              headers: {
                'Content-Length': String(videoAsset.byteSize),
                'Content-Type': videoAsset.contentType,
              },
            })
          : new Response(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), {
              status: 206,
            }),
      ),
    );
    vi.spyOn(S3Signer.prototype, 'promote').mockRejectedValue(
      new Error('temporary S3 outage'),
    );
    const discard = vi.spyOn(S3Signer.prototype, 'discard');

    const service = new MediaService(database as never, config);
    await expect(service.finalize('owner-1', asset.id, {})).rejects.toMatchObject({
      code: 'MEDIA_PROMOTION_FAILED',
    });
    expect(update).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it('returns the canonical ready asset when a concurrent finalize removes quarantine', async () => {
    const current: Record<string, unknown> = {
      ...asset,
      objectKey: 'owners/owner-1/asset-1.webm',
      contentType: 'video/webm',
      kind: 'video',
      byteSize: 4,
    };
    const database = {
      select: () => selection([current]),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (current.status !== 'initiated') return [];
              Object.assign(current, values);
              return [{ ...current }];
            },
          }),
        }),
      })),
    };
    vi.spyOn(S3Signer.prototype, 'presign').mockResolvedValue('https://signed.test');
    let releaseSlowHead = () => undefined;
    const slowHeadReleased = new Promise<void>((resolve) => {
      releaseSlowHead = resolve;
    });
    let markSlowHeadStarted = () => undefined;
    const slowHeadStarted = new Promise<void>((resolve) => {
      markSlowHeadStarted = resolve;
    });
    let headCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.method === 'HEAD') {
          headCount += 1;
          if (headCount === 1) {
            markSlowHeadStarted();
            await slowHeadReleased;
            return new Response(null, { status: 404 });
          }
          return new Response(null, {
            headers: {
              'Content-Length': '4',
              'Content-Type': 'video/webm',
            },
          });
        }
        return new Response(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), {
          status: 206,
        });
      }),
    );
    const promote = vi.spyOn(S3Signer.prototype, 'promote').mockResolvedValue();
    const discardQuarantine = vi
      .spyOn(S3Signer.prototype, 'discardQuarantine')
      .mockResolvedValue();
    const discard = vi.spyOn(S3Signer.prototype, 'discard');

    const service = new MediaService(database as never, config);
    const slowFinalize = service.finalize('owner-1', asset.id, {});
    await slowHeadStarted;
    const fastFinalize = await service.finalize('owner-1', asset.id, {});
    releaseSlowHead();
    const finalized = [await slowFinalize, fastFinalize];

    expect(finalized.map(({ status }) => status)).toEqual(['ready', 'ready']);
    expect(finalized[0]).toEqual(finalized[1]);
    expect(promote).toHaveBeenCalledTimes(1);
    expect(discardQuarantine).toHaveBeenCalledTimes(2);
    expect(discard).not.toHaveBeenCalled();
  });

  it('deletes only stale initiated objects after S3 deletion succeeds', async () => {
    const stale = {
      ...asset,
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
    };
    const returning = vi.fn(async () => [{ id: stale.id }]);
    const deleteWhere = vi.fn(() => ({ returning }));
    const database = {
      select: () => selection([stale]),
      delete: vi.fn(() => ({ where: deleteWhere })),
    };
    const discard = vi.spyOn(S3Signer.prototype, 'discard').mockResolvedValue();

    const service = new MediaService(database as never, config);
    await expect(service.cleanupOrphans(now)).resolves.toBe(1);
    expect(discard).toHaveBeenCalledWith(stale.objectKey);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('leaves failed orphan deletions retryable and continues the cleanup batch', async () => {
    const candidates = [
      { ...asset, id: 'failed', objectKey: 'owners/owner-1/failed.png' },
      { ...asset, id: 'removed', objectKey: 'owners/owner-1/removed.png' },
    ];
    const returning = vi.fn(async () => [{ id: 'removed' }]);
    const database = {
      select: () => selection(candidates),
      delete: vi.fn(() => ({
        where: () => ({ returning }),
      })),
    };
    vi.spyOn(S3Signer.prototype, 'discard')
      .mockRejectedValueOnce(new Error('temporary S3 outage'))
      .mockResolvedValueOnce();

    const service = new MediaService(database as never, config);
    await expect(service.cleanupOrphans(now)).resolves.toBe(1);
    expect(database.delete).toHaveBeenCalledTimes(1);
  });
});
