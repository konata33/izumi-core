import { randomUUID } from 'node:crypto';

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lt } from 'drizzle-orm';

import { ApiException } from '../common/api-exception.js';
import { APP_CONFIG } from '../config/app-config.js';
import {
  DATABASE,
  type Database,
  type DatabaseTransaction,
} from '../database/database.module.js';
import { posts } from '../database/schema.js';
import { generateImageMetadata, readObjectLimited } from './image-metadata.js';
import type { FinalizeMediaUploadDto, MediaAssetDto } from './media.dto.js';
import type { MediaAwareAppConfig } from './media.config.js';
import { safeFileExtension, validateMediaUpload } from './media-policy.js';
import type { RichMediaReference } from './media-references.js';
import { mediaAssets, postMediaReferences } from './media.schema.js';
import { readSignature, sniffMediaType } from './media-signature.js';
import { S3Signer } from './s3-signer.js';

type MediaRecord = typeof mediaAssets.$inferSelect;

function toDto(asset: MediaRecord): MediaAssetDto {
  return {
    id: asset.id,
    originalName: asset.originalName,
    contentType: asset.contentType,
    kind: asset.kind as 'image' | 'video',
    byteSize: asset.byteSize,
    publicUrl: asset.publicUrl,
    status: asset.status as 'initiated' | 'ready',
    width: asset.width,
    height: asset.height,
    thumbhash: asset.thumbhash,
    alt: asset.alt,
    createdAt: asset.createdAt.toISOString(),
    finalizedAt: asset.finalizedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private readonly storage;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) config: MediaAwareAppConfig,
  ) {
    this.storage = config.mediaStorage;
  }

  onModuleInit(): void {
    if (!this.storage) return;
    void this.cleanupOrphans().catch(() => undefined);
    this.cleanupTimer = setInterval(
      () => {
        void this.cleanupOrphans().catch(() => undefined);
      },
      60 * 60 * 1_000,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async initiate(
    ownerId: string,
    input: { originalName: string; contentType: string; byteSize: number },
  ): Promise<{
    asset: MediaAssetDto;
    uploadUrl: string;
    uploadFields: Record<string, string>;
    expiresInSeconds: number;
  }> {
    const { storage, signer } = this.requireStorage();
    const originalName = input.originalName.trim();
    if (!originalName) {
      throw new ApiException(
        'MEDIA_NAME_INVALID',
        'The original filename must contain non-whitespace text',
        HttpStatus.BAD_REQUEST,
      );
    }
    const policy = validateMediaUpload({
      ...input,
      imageMaxBytes: storage.imageMaxBytes,
      videoMaxBytes: storage.videoMaxBytes,
    });
    const id = randomUUID();
    const extension = safeFileExtension(originalName, policy.contentType);
    const objectKey = `owners/${ownerId}/${id}.${extension}`;
    const [asset] = await this.database
      .insert(mediaAssets)
      .values({
        id,
        ownerId,
        objectKey,
        originalName,
        contentType: policy.contentType,
        kind: policy.kind,
        byteSize: input.byteSize,
        publicUrl: signer.publicUrl(objectKey),
      })
      .returning();

    if (!asset) throw new Error('Media initiation returned no row');
    const upload = await signer.presignUpload(
      objectKey,
      policy.contentType,
      input.byteSize,
    );
    return {
      asset: toDto(asset),
      uploadUrl: upload.url,
      uploadFields: upload.fields,
      expiresInSeconds: 900,
    };
  }

  async finalize(
    ownerId: string,
    id: string,
    input: FinalizeMediaUploadDto,
  ): Promise<MediaAssetDto> {
    const { storage, signer } = this.requireStorage();
    const asset = await this.findRecord(ownerId, id);
    if (asset.status === 'ready') {
      await signer.discardQuarantine(asset.objectKey).catch(() => undefined);
      return toDto(asset);
    }

    const response = await fetch(
      await signer.presign('HEAD', asset.objectKey, {
        expiresSeconds: 60,
        quarantine: true,
      }),
      { method: 'HEAD', signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) {
      const finalized = await this.findConcurrentFinalization(ownerId, id, signer);
      if (finalized) return finalized;
      throw new ApiException(
        'MEDIA_UPLOAD_MISSING',
        'The uploaded object could not be verified',
        HttpStatus.CONFLICT,
      );
    }

    const byteSize = Number(response.headers.get('content-length'));
    const contentType = response.headers.get('content-type') ?? '';
    const verified = validateMediaUpload({
      contentType,
      byteSize,
      imageMaxBytes: storage.imageMaxBytes,
      videoMaxBytes: storage.videoMaxBytes,
    });
    if (
      byteSize !== asset.byteSize ||
      verified.contentType !== asset.contentType ||
      verified.kind !== asset.kind
    ) {
      throw new ApiException(
        'MEDIA_UPLOAD_MISMATCH',
        'The uploaded object does not match the initiated upload',
        HttpStatus.CONFLICT,
      );
    }

    const signatureResponse = await fetch(
      await signer.presign('GET', asset.objectKey, {
        expiresSeconds: 60,
        quarantine: true,
        range: 'bytes=0-63',
      }),
      {
        method: 'GET',
        headers: { Range: 'bytes=0-63' },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!signatureResponse.ok) {
      const finalized = await this.findConcurrentFinalization(ownerId, id, signer);
      if (finalized) return finalized;
      throw new ApiException(
        'MEDIA_UPLOAD_UNREADABLE',
        'The uploaded object signature could not be verified',
        HttpStatus.CONFLICT,
      );
    }
    const detectedType = sniffMediaType(await readSignature(signatureResponse));
    if (detectedType !== asset.contentType) {
      throw new ApiException(
        'MEDIA_SIGNATURE_MISMATCH',
        'The uploaded bytes do not match the declared media type',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    let imageMetadata: { width: number; height: number; thumbhash: string } | undefined;
    if (asset.kind === 'image') {
      const imageResponse = await fetch(
        await signer.presign('GET', asset.objectKey, {
          expiresSeconds: 60,
          quarantine: true,
        }),
        { method: 'GET', signal: AbortSignal.timeout(15_000) },
      );
      if (!imageResponse.ok) {
        const finalized = await this.findConcurrentFinalization(ownerId, id, signer);
        if (finalized) return finalized;
        throw new ApiException(
          'MEDIA_IMAGE_UNREADABLE',
          'The uploaded image could not be processed',
          HttpStatus.CONFLICT,
        );
      }
      try {
        const image = await readObjectLimited(
          imageResponse,
          Math.min(asset.byteSize, storage.imageMaxBytes),
        );
        if (image.byteLength !== asset.byteSize) {
          throw new Error('Downloaded image size does not match the upload');
        }
        imageMetadata = await generateImageMetadata(image);
      } catch {
        throw new ApiException(
          'MEDIA_IMAGE_INVALID',
          'The uploaded image could not be decoded safely',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
    }

    try {
      await signer.promote(asset.objectKey, asset.contentType, asset.byteSize);
    } catch {
      throw new ApiException(
        'MEDIA_PROMOTION_FAILED',
        'The validated object could not be moved into public storage',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const [updated] = await this.database
      .update(mediaAssets)
      .set({
        status: 'ready',
        width: imageMetadata?.width ?? null,
        height: imageMetadata?.height ?? null,
        thumbhash: imageMetadata?.thumbhash ?? null,
        alt: input.alt?.trim() || null,
        finalizedAt: new Date(),
      })
      .where(
        and(
          eq(mediaAssets.id, id),
          eq(mediaAssets.ownerId, ownerId),
          eq(mediaAssets.status, 'initiated'),
        ),
      )
      .returning();
    const finalized = updated ?? (await this.findRecord(ownerId, id));
    await signer.discardQuarantine(asset.objectKey).catch(() => undefined);
    return toDto(finalized);
  }

  async find(ownerId: string, id: string): Promise<MediaAssetDto> {
    return toDto(await this.findRecord(ownerId, id));
  }

  async replacePostReferences(
    ownerId: string,
    postId: string,
    assetIds: string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(assetIds)];
    const [post] = await this.database
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.ownerId, ownerId)))
      .limit(1);
    if (!post) {
      throw new ApiException('POST_NOT_FOUND', 'Post not found', HttpStatus.NOT_FOUND);
    }
    if (uniqueIds.length > 0) {
      const assets = await this.database
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.ownerId, ownerId),
            eq(mediaAssets.status, 'ready'),
            inArray(mediaAssets.id, uniqueIds),
          ),
        );
      if (assets.length !== uniqueIds.length) {
        throw new ApiException(
          'MEDIA_REFERENCE_INVALID',
          'Every referenced media asset must exist, be finalized, and belong to the owner',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    await this.database.transaction(async (transaction) => {
      await transaction
        .delete(postMediaReferences)
        .where(eq(postMediaReferences.postId, postId));
      if (uniqueIds.length > 0) {
        await transaction
          .insert(postMediaReferences)
          .values(uniqueIds.map((assetId) => ({ postId, assetId })));
      }
    });
  }

  async assertPublishableReferences(
    ownerId: string,
    references: readonly RichMediaReference[],
    executor: Database | DatabaseTransaction = this.database,
  ): Promise<string[]> {
    const publicUrls = [...new Set(references.map(({ publicUrl }) => publicUrl))];
    if (publicUrls.length === 0) return [];
    const assets = await executor
      .select({
        id: mediaAssets.id,
        status: mediaAssets.status,
        publicUrl: mediaAssets.publicUrl,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.ownerId, ownerId),
          inArray(mediaAssets.publicUrl, publicUrls),
        ),
      );
    const byUrl = new Map(assets.map((asset) => [asset.publicUrl, asset]));
    const invalid = references
      .filter((reference) => {
        const asset = byUrl.get(reference.publicUrl);
        return !asset || asset.status !== 'ready';
      })
      .map(({ publicUrl }) => publicUrl);
    if (invalid.length > 0) {
      throw new ApiException(
        'MEDIA_NOT_PUBLISHABLE',
        'Every embedded media asset must be finalized and use its canonical public URL',
        HttpStatus.BAD_REQUEST,
        { publicUrls: [...new Set(invalid)] },
      );
    }
    return publicUrls.map((publicUrl) => byUrl.get(publicUrl)!.id);
  }

  async replacePostReferencesInTransaction(
    transaction: DatabaseTransaction,
    postId: string,
    assetIds: readonly string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(assetIds)];
    await transaction
      .delete(postMediaReferences)
      .where(eq(postMediaReferences.postId, postId));
    if (uniqueIds.length > 0) {
      await transaction
        .insert(postMediaReferences)
        .values(uniqueIds.map((assetId) => ({ postId, assetId })));
    }
  }

  async cleanupOrphans(
    before = new Date(Date.now() - 24 * 60 * 60 * 1_000),
  ): Promise<number> {
    const { signer } = this.requireStorage();
    const candidates = await this.database
      .select()
      .from(mediaAssets)
      .where(
        and(eq(mediaAssets.status, 'initiated'), lt(mediaAssets.createdAt, before)),
      )
      .limit(100);
    let removed = 0;
    for (const asset of candidates) {
      try {
        await signer.discard(asset.objectKey);
        const [deleted] = await this.database
          .delete(mediaAssets)
          .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.status, 'initiated')))
          .returning({ id: mediaAssets.id });
        if (deleted) removed += 1;
      } catch {
        // Leave the record in `initiated` so a later scheduled pass can retry it.
      }
    }
    return removed;
  }

  private requireStorage(): {
    storage: NonNullable<MediaAwareAppConfig['mediaStorage']>;
    signer: S3Signer;
  } {
    if (!this.storage) {
      throw new ApiException(
        'MEDIA_STORAGE_UNAVAILABLE',
        'Media storage is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { storage: this.storage, signer: new S3Signer(this.storage) };
  }

  private async findRecord(ownerId: string, id: string): Promise<MediaRecord> {
    const [asset] = await this.database
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.ownerId, ownerId)))
      .limit(1);
    if (!asset) {
      throw new ApiException(
        'MEDIA_NOT_FOUND',
        'Media asset not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return asset;
  }

  private async findConcurrentFinalization(
    ownerId: string,
    id: string,
    signer: S3Signer,
  ): Promise<MediaAssetDto | undefined> {
    const asset = await this.findRecord(ownerId, id);
    if (asset.status !== 'ready') return undefined;
    await signer.discardQuarantine(asset.objectKey).catch(() => undefined);
    return toDto(asset);
  }
}
