import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type S3StorageConfig = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
}>;

function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function s3PublicUrl(config: S3StorageConfig, objectKey: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/u, '')}/${encodePath(objectKey)}`;
}

function s3Client(config: S3StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function putS3Object(
  config: S3StorageConfig,
  objectKey: string,
  filePath: string,
  contentType: string,
  byteSize: number,
): Promise<void> {
  const client = s3Client(config);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: createReadStream(filePath),
        ContentLength: byteSize,
        ContentType: contentType,
      }),
    );
  } finally {
    client.destroy();
  }
}

export async function deleteS3Object(
  config: S3StorageConfig,
  objectKey: string,
): Promise<void> {
  const client = s3Client(config);
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
  } finally {
    client.destroy();
  }
}

export async function testS3Storage(config: S3StorageConfig): Promise<void> {
  const key = `.izumi-connection-test/${randomUUID()}`;
  const client = s3Client(config);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: '',
        ContentLength: 0,
        ContentType: 'application/octet-stream',
      }),
    );
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } finally {
    client.destroy();
  }
}

export async function putLocalObject(
  localDirectory: string,
  objectKey: string,
  sourcePath: string,
): Promise<string> {
  const destination = path.join(localDirectory, ...objectKey.split('/'));
  const temporaryDestination = `${destination}.tmp-${randomUUID()}`;
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await copyFile(sourcePath, temporaryDestination);
    await rename(temporaryDestination, destination);
    return destination;
  } catch (error) {
    await unlink(temporaryDestination).catch(() => undefined);
    throw error;
  }
}

export async function testLocalStorage(localDirectory: string): Promise<void> {
  const probeDirectory = path.join(localDirectory, '.tmp');
  const probe = path.join(probeDirectory, `connection-${randomUUID()}`);
  await mkdir(probeDirectory, { recursive: true });
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } finally {
    await unlink(probe).catch(() => undefined);
  }
}
