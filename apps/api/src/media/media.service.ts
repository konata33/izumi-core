import { randomUUID } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { ApiException } from '../common/api-exception.js';
import { decryptSecret, encryptSecret, maskSecret } from '../common/secret-crypto.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import {
  DATABASE,
  type Database,
  type DatabaseTransaction,
} from '../database/database.module.js';
import { posts } from '../database/schema.js';
import { UrlSafetyPolicy } from '../link-cards/url-safety.js';
import { generateImageMetadata } from './image-metadata.js';
import {
  StorageMode,
  type MediaAssetDto,
  type StorageConnectionTestDto,
  type StorageSettingsDto,
  type UpdateStorageSettingsDto,
} from './media.dto.js';
import {
  deleteS3Object,
  putLocalObject,
  putS3Object,
  s3PublicUrl,
  type S3StorageConfig,
  testLocalStorage,
  testS3Storage,
} from './media-storage.js';
import { safeFileExtension, validateMediaUpload } from './media-policy.js';
import type { RichMediaReference } from './media-references.js';
import { mediaAssets, postMediaReferences, storageSettings } from './media.schema.js';
import { sniffMediaType } from './media-signature.js';

type MediaRecord = typeof mediaAssets.$inferSelect;
type StorageSettingsRecord = typeof storageSettings.$inferSelect;

export type SavedMediaUpload = Readonly<{
  filePath: string;
  fieldName: string;
  originalName: string;
  contentType: string;
  alt?: string;
}>;

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

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(UrlSafetyPolicy) private readonly urlSafety: UrlSafetyPolicy,
  ) {}

  async upload(ownerId: string, input: SavedMediaUpload): Promise<MediaAssetDto> {
    if (input.fieldName !== 'file') {
      throw new ApiException(
        'MEDIA_FILE_FIELD_INVALID',
        'The multipart file field must be named "file"',
        HttpStatus.BAD_REQUEST,
      );
    }
    const originalName = input.originalName.trim();
    if (!originalName || originalName.length > 255) {
      throw new ApiException(
        'MEDIA_NAME_INVALID',
        'The original filename must contain 1 to 255 characters',
        HttpStatus.BAD_REQUEST,
      );
    }
    const alt = input.alt?.trim() || null;
    if (alt && alt.length > 1_000) {
      throw new ApiException(
        'MEDIA_ALT_INVALID',
        'Media alternative text must not exceed 1000 characters',
        HttpStatus.BAD_REQUEST,
      );
    }

    const file = await stat(input.filePath);
    const policy = validateMediaUpload({
      contentType: input.contentType,
      byteSize: file.size,
      imageMaxBytes: this.config.mediaImageMaxBytes,
      videoMaxBytes: this.config.mediaVideoMaxBytes,
    });
    const handle = await open(input.filePath, 'r');
    const signature = Buffer.alloc(Math.min(64, file.size));
    try {
      await handle.read(signature, 0, signature.length, 0);
    } finally {
      await handle.close();
    }
    if (sniffMediaType(signature) !== policy.contentType) {
      throw new ApiException(
        'MEDIA_SIGNATURE_MISMATCH',
        'The uploaded bytes do not match the declared media type',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    let imageMetadata: { width: number; height: number; thumbhash: string } | undefined;
    if (policy.kind === 'image') {
      try {
        imageMetadata = await generateImageMetadata(await readFile(input.filePath));
      } catch {
        throw new ApiException(
          'MEDIA_IMAGE_INVALID',
          'The uploaded image could not be decoded safely',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
    }

    const id = randomUUID();
    const extension = safeFileExtension(originalName, policy.contentType);
    const objectKey = `owners/${ownerId}/${id}.${extension}`;
    const storage = await this.resolveStorage(ownerId);
    const publicUrl =
      storage.mode === StorageMode.S3
        ? s3PublicUrl(storage.config, objectKey)
        : `${this.config.corePublicUrl}/uploads/${objectKey}`;
    let localDestination: string | undefined;
    let s3Attempted = false;
    try {
      if (storage.mode === StorageMode.S3) {
        s3Attempted = true;
        await putS3Object(
          storage.config,
          objectKey,
          input.filePath,
          policy.contentType,
          file.size,
        );
      } else {
        localDestination = await putLocalObject(
          this.config.mediaLocalDirectory,
          objectKey,
          input.filePath,
        );
      }
      const now = new Date();
      const [asset] = await this.database
        .insert(mediaAssets)
        .values({
          id,
          ownerId,
          objectKey,
          originalName,
          contentType: policy.contentType,
          kind: policy.kind,
          byteSize: file.size,
          status: 'ready',
          publicUrl,
          width: imageMetadata?.width ?? null,
          height: imageMetadata?.height ?? null,
          thumbhash: imageMetadata?.thumbhash ?? null,
          alt,
          finalizedAt: now,
          createdAt: now,
        })
        .returning();
      if (!asset) throw new Error('Media upload returned no row');
      return toDto(asset);
    } catch (error) {
      if (localDestination) await unlink(localDestination).catch(() => undefined);
      if (s3Attempted && storage.mode === StorageMode.S3) {
        await deleteS3Object(storage.config, objectKey).catch(() => undefined);
      }
      if (error instanceof ApiException) throw error;
      throw new ApiException(
        'MEDIA_STORAGE_FAILED',
        'The validated media file could not be stored',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getStorageSettings(ownerId: string): Promise<StorageSettingsDto> {
    const settings = await this.findStorageSettings(ownerId);
    let secretAccessKeyMasked: string | null = null;
    if (settings?.encryptedSecretAccessKey) {
      const encryptionKey = this.config.credentialsEncryptionKey;
      secretAccessKeyMasked = encryptionKey
        ? maskSecret(this.decryptStorageSecret(settings.encryptedSecretAccessKey))
        : '••••';
    }
    return {
      mode: (settings?.mode as StorageMode | undefined) ?? StorageMode.Local,
      localPublicBaseUrl: `${this.config.corePublicUrl}/uploads`,
      endpoint: settings?.endpoint ?? null,
      region: settings?.region ?? null,
      bucket: settings?.bucket ?? null,
      accessKeyId: settings?.accessKeyId ?? null,
      secretAccessKeyMasked,
      publicBaseUrl: settings?.publicBaseUrl ?? null,
      forcePathStyle: settings?.forcePathStyle ?? false,
      updatedAt: settings?.updatedAt.toISOString() ?? null,
    };
  }

  async updateStorageSettings(
    ownerId: string,
    input: UpdateStorageSettingsDto,
  ): Promise<StorageSettingsDto> {
    const existing = await this.findStorageSettings(ownerId);
    const now = new Date();
    if (input.mode === StorageMode.Local) {
      await this.database
        .insert(storageSettings)
        .values({
          ownerId,
          mode: StorageMode.Local,
          endpoint: existing?.endpoint,
          region: existing?.region,
          bucket: existing?.bucket,
          accessKeyId: existing?.accessKeyId,
          encryptedSecretAccessKey: existing?.encryptedSecretAccessKey,
          publicBaseUrl: existing?.publicBaseUrl,
          forcePathStyle: existing?.forcePathStyle ?? false,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: storageSettings.ownerId,
          set: { mode: StorageMode.Local, updatedAt: now },
        });
      return this.getStorageSettings(ownerId);
    }

    const endpoint = present(input.endpoint ?? existing?.endpoint);
    const region = present(input.region ?? existing?.region);
    const bucket = present(input.bucket ?? existing?.bucket);
    const accessKeyId = present(input.accessKeyId ?? existing?.accessKeyId);
    const publicBaseUrl = present(input.publicBaseUrl ?? existing?.publicBaseUrl);
    const encryptedSecretAccessKey = input.secretAccessKey
      ? this.encryptStorageSecret(input.secretAccessKey)
      : existing?.encryptedSecretAccessKey;
    if (!input.secretAccessKey && encryptedSecretAccessKey) {
      this.decryptStorageSecret(encryptedSecretAccessKey);
    }
    if (
      !endpoint ||
      !region ||
      !bucket ||
      !accessKeyId ||
      !publicBaseUrl ||
      !encryptedSecretAccessKey
    ) {
      throw new ApiException(
        'STORAGE_SETTINGS_INCOMPLETE',
        'S3 endpoint, region, bucket, access key, secret key, and public URL are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.assertStorageUrl(endpoint, 'endpoint', true);
    await this.assertStorageUrl(publicBaseUrl, 'public URL', false);
    const forcePathStyle = input.forcePathStyle ?? existing?.forcePathStyle ?? false;
    await this.database
      .insert(storageSettings)
      .values({
        ownerId,
        mode: StorageMode.S3,
        endpoint: endpoint.replace(/\/+$/u, ''),
        region,
        bucket,
        accessKeyId,
        encryptedSecretAccessKey,
        publicBaseUrl: publicBaseUrl.replace(/\/+$/u, ''),
        forcePathStyle,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: storageSettings.ownerId,
        set: {
          mode: StorageMode.S3,
          endpoint: endpoint.replace(/\/+$/u, ''),
          region,
          bucket,
          accessKeyId,
          encryptedSecretAccessKey,
          publicBaseUrl: publicBaseUrl.replace(/\/+$/u, ''),
          forcePathStyle,
          updatedAt: now,
        },
      });
    return this.getStorageSettings(ownerId);
  }

  async testSavedStorage(ownerId: string): Promise<StorageConnectionTestDto> {
    const started = performance.now();
    const storage = await this.resolveStorage(ownerId);
    try {
      if (storage.mode === StorageMode.S3) await testS3Storage(storage.config);
      else await testLocalStorage(this.config.mediaLocalDirectory);
    } catch {
      throw new ApiException(
        'STORAGE_CONNECTION_FAILED',
        'The saved storage configuration could not write and delete a probe object',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return {
      ok: true,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      mode: storage.mode,
    };
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
          'Every referenced media asset must be ready and belong to the owner',
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
        'Every embedded media asset must be ready and use its canonical public URL',
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

  private async resolveStorage(
    ownerId: string,
  ): Promise<
    { mode: StorageMode.Local } | { mode: StorageMode.S3; config: S3StorageConfig }
  > {
    const settings = await this.findStorageSettings(ownerId);
    if (!settings || settings.mode === StorageMode.Local) {
      return { mode: StorageMode.Local };
    }
    const encryptionKey = this.config.credentialsEncryptionKey;
    if (!encryptionKey) {
      throw new ApiException(
        'STORAGE_CREDENTIALS_DISABLED',
        'S3 storage cannot be used without CREDENTIALS_ENCRYPTION_KEY',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      !settings.endpoint ||
      !settings.region ||
      !settings.bucket ||
      !settings.accessKeyId ||
      !settings.encryptedSecretAccessKey ||
      !settings.publicBaseUrl
    ) {
      throw new ApiException(
        'STORAGE_SETTINGS_INCOMPLETE',
        'The saved S3 storage configuration is incomplete',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.assertStorageUrl(settings.endpoint, 'endpoint', true);
    await this.assertStorageUrl(settings.publicBaseUrl, 'public URL', false);
    return {
      mode: StorageMode.S3,
      config: {
        endpoint: settings.endpoint,
        region: settings.region,
        bucket: settings.bucket,
        accessKeyId: settings.accessKeyId,
        secretAccessKey: this.decryptStorageSecret(settings.encryptedSecretAccessKey),
        publicBaseUrl: settings.publicBaseUrl,
        forcePathStyle: settings.forcePathStyle,
      },
    };
  }

  private async findStorageSettings(
    ownerId: string,
  ): Promise<StorageSettingsRecord | undefined> {
    const [settings] = await this.database
      .select()
      .from(storageSettings)
      .where(eq(storageSettings.ownerId, ownerId))
      .orderBy(asc(storageSettings.ownerId))
      .limit(1);
    return settings;
  }

  private encryptStorageSecret(value: string): string {
    if (!value.trim()) {
      throw new ApiException(
        'STORAGE_SECRET_INVALID',
        'The S3 secret access key must contain non-whitespace text',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.config.credentialsEncryptionKey) {
      throw new ApiException(
        'STORAGE_CREDENTIALS_DISABLED',
        'S3 settings are disabled until CREDENTIALS_ENCRYPTION_KEY is configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return encryptSecret(value, this.config.credentialsEncryptionKey);
  }

  private decryptStorageSecret(value: string): string {
    if (!this.config.credentialsEncryptionKey) {
      throw new ApiException(
        'STORAGE_CREDENTIALS_DISABLED',
        'S3 credentials cannot be read without CREDENTIALS_ENCRYPTION_KEY',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      return decryptSecret(value, this.config.credentialsEncryptionKey);
    } catch {
      throw new ApiException(
        'STORAGE_CREDENTIALS_INVALID',
        'The saved S3 secret cannot be decrypted with CREDENTIALS_ENCRYPTION_KEY',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async assertStorageUrl(
    value: string,
    label: string,
    resolvesNetwork: boolean,
  ): Promise<void> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ApiException(
        'STORAGE_URL_INVALID',
        `The S3 ${label} is not a valid URL`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ApiException(
        'STORAGE_URL_INVALID',
        `The S3 ${label} must use HTTP(S)`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (url.username || url.password) {
      throw new ApiException(
        'STORAGE_URL_INVALID',
        `The S3 ${label} must not contain credentials`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (this.config.nodeEnv === 'production' && url.protocol !== 'https:') {
      throw new ApiException(
        'STORAGE_URL_INSECURE',
        `The production S3 ${label} must use HTTPS`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (resolvesNetwork && this.config.nodeEnv === 'production') {
      try {
        await this.urlSafety.assertSafe(value);
      } catch {
        throw new ApiException(
          'STORAGE_URL_UNSAFE',
          'The production S3 endpoint must resolve to a public network address',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
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
}
