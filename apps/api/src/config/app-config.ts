import { z } from 'zod';

import { loadWorkspaceEnvironment } from './load-environment.js';

loadWorkspaceEnvironment();

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    // Conductor reserves this port and the following nine ports for a workspace.
    // Keep the upper bound low enough for the Admin development server to use +1.
    CONDUCTOR_PORT: z.coerce.number().int().min(1).max(65_525).optional(),
    ADMIN_PORT: z.coerce.number().int().min(1).max(65_535).default(5173),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+[smhd]$/, 'must look like 15m, 12h, or 7d')
      .default('7d'),
    OWNER_SETUP_TOKEN: z.string().min(32),
    CORS_ORIGIN: z.string().optional(),
    ADMIN_STATIC_DIR: z.string().min(1).optional(),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_PUBLIC_BASE_URL: z.url().optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(false),
    MEDIA_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(20 * 1024 * 1024),
    MEDIA_VIDEO_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(500 * 1024 * 1024),
    AI_PROVIDER_TYPE: z.enum(['claude', 'openai-compatible']).optional(),
    AI_BASE_URL: z.url().optional(),
    AI_MODEL: z.string().min(1).optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
  })
  .superRefine((environment, context) => {
    const requireCompleteGroup = (
      fields: Array<keyof typeof environment>,
      groupName: string,
    ) => {
      const configured = fields.filter((field) => environment[field] !== undefined);
      if (configured.length !== 0 && configured.length !== fields.length) {
        context.addIssue({
          code: 'custom',
          message: `${groupName} must be configured as a complete group`,
          path: [configured[0] ?? fields[0]],
        });
      }
    };

    requireCompleteGroup(
      [
        'S3_ENDPOINT',
        'S3_REGION',
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'S3_PUBLIC_BASE_URL',
      ],
      'S3 storage',
    );
    requireCompleteGroup(
      ['AI_PROVIDER_TYPE', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY'],
      'default AI provider',
    );

    if (environment.AI_CREDENTIALS_ENCRYPTION_KEY !== undefined) {
      const encoded = environment.AI_CREDENTIALS_ENCRYPTION_KEY;
      const decoded = Buffer.from(encoded, 'base64');
      if (
        decoded.byteLength !== 32 ||
        decoded.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, '')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'must be a base64-encoded 32-byte key',
          path: ['AI_CREDENTIALS_ENCRYPTION_KEY'],
        });
      }
    }
  });

export type MediaStorageConfig = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
  imageMaxBytes: number;
  videoMaxBytes: number;
}>;

export type AiProviderConfig = Readonly<{
  providerType: 'claude' | 'openai-compatible';
  baseUrl: string;
  model: string;
  apiKey: string;
}>;

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  adminPort: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  ownerSetupToken: string;
  corsOrigins: string[];
  adminStaticDir?: string;
  mediaStorage?: MediaStorageConfig;
  defaultAiProvider?: AiProviderConfig;
  aiCredentialsEncryptionKey?: string;
}>;

export const APP_CONFIG = Symbol('APP_CONFIG');

function durationToSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`Unsupported duration: ${duration}`);

  const value = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3_600 : 86_400;
  return value * multiplier;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);

  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }

  const value = parsed.data;
  const port = value.CONDUCTOR_PORT ?? value.PORT;
  const adminPort =
    value.CONDUCTOR_PORT === undefined ? value.ADMIN_PORT : value.CONDUCTOR_PORT + 1;
  const configuredOrigins =
    value.CORS_ORIGIN?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  return {
    nodeEnv: value.NODE_ENV,
    port,
    adminPort,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    jwtSecret: value.JWT_SECRET,
    jwtExpiresInSeconds: durationToSeconds(value.JWT_EXPIRES_IN),
    ownerSetupToken: value.OWNER_SETUP_TOKEN,
    adminStaticDir: value.ADMIN_STATIC_DIR,
    mediaStorage:
      value.S3_ENDPOINT === undefined
        ? undefined
        : {
            endpoint: value.S3_ENDPOINT,
            region: value.S3_REGION!,
            bucket: value.S3_BUCKET!,
            accessKeyId: value.S3_ACCESS_KEY_ID!,
            secretAccessKey: value.S3_SECRET_ACCESS_KEY!,
            publicBaseUrl: value.S3_PUBLIC_BASE_URL!.replace(/\/+$/u, ''),
            forcePathStyle: value.S3_FORCE_PATH_STYLE,
            imageMaxBytes: value.MEDIA_IMAGE_MAX_BYTES,
            videoMaxBytes: value.MEDIA_VIDEO_MAX_BYTES,
          },
    defaultAiProvider:
      value.AI_PROVIDER_TYPE === undefined
        ? undefined
        : {
            providerType: value.AI_PROVIDER_TYPE,
            baseUrl: value.AI_BASE_URL!.replace(/\/+$/u, ''),
            model: value.AI_MODEL!,
            apiKey: value.AI_API_KEY!,
          },
    aiCredentialsEncryptionKey: value.AI_CREDENTIALS_ENCRYPTION_KEY,
    // The local Admin runs on ADMIN_PORT, or on the next Conductor-reserved
    // port. Keep this convenience limited to development; production allowlists
    // must remain fully explicit.
    corsOrigins:
      value.NODE_ENV === 'development'
        ? [...new Set([...configuredOrigins, `http://localhost:${adminPort}`])]
        : configuredOrigins,
  };
}
