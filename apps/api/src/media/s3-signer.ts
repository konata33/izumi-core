import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { MediaStorageConfig } from '../config/app-config.js';

function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export class S3Signer {
  private readonly client: S3Client;
  private readonly quarantineBucket: string;

  constructor(private readonly config: MediaStorageConfig) {
    this.quarantineBucket = `${config.bucket}-quarantine`;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  publicUrl(objectKey: string): string {
    return `${this.config.publicBaseUrl.replace(/\/+$/, '')}/${encodePath(objectKey)}`;
  }

  async presignUpload(
    objectKey: string,
    contentType: string,
    byteSize: number,
    expiresSeconds = 900,
  ): Promise<{ url: string; fields: Record<string, string> }> {
    return createPresignedPost(this.client, {
      Bucket: this.quarantineBucket,
      Key: objectKey,
      Conditions: [
        ['eq', '$Content-Type', contentType],
        ['content-length-range', byteSize, byteSize],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: expiresSeconds,
    });
  }

  async presign(
    method: 'GET' | 'HEAD' | 'DELETE',
    objectKey: string,
    options: {
      range?: string;
      expiresSeconds?: number;
      quarantine?: boolean;
    } = {},
  ): Promise<string> {
    const base = {
      Bucket: options.quarantine ? this.quarantineBucket : this.config.bucket,
      Key: objectKey,
    };
    const command =
      method === 'GET'
        ? new GetObjectCommand({ ...base, Range: options.range })
        : method === 'HEAD'
          ? new HeadObjectCommand(base)
          : new DeleteObjectCommand(base);
    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresSeconds ?? 900,
    });
  }

  async promote(
    objectKey: string,
    contentType: string,
    byteSize: number,
  ): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
          CopySource: `${this.quarantineBucket}/${encodePath(objectKey)}`,
          ContentType: contentType,
          MetadataDirective: 'REPLACE',
        }),
      );
    } catch (error) {
      const existing = await this.client
        .send(
          new HeadObjectCommand({
            Bucket: this.config.bucket,
            Key: objectKey,
          }),
        )
        .catch(() => undefined);
      if (
        existing?.ContentLength === byteSize &&
        existing.ContentType?.split(';', 1)[0]?.trim().toLowerCase() === contentType
      ) {
        return;
      }
      throw error;
    }
  }

  async discardQuarantine(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.quarantineBucket,
        Key: objectKey,
      }),
    );
  }

  async discard(objectKey: string): Promise<void> {
    await Promise.all([
      this.client.send(
        new DeleteObjectCommand({
          Bucket: this.quarantineBucket,
          Key: objectKey,
        }),
      ),
      this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
        }),
      ),
    ]);
  }
}
