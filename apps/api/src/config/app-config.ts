import { z } from 'zod';

import { loadWorkspaceEnvironment } from './load-environment.js';

loadWorkspaceEnvironment();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
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
});

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  ownerSetupToken: string;
  corsOrigins: string[];
  adminStaticDir?: string;
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
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    jwtSecret: value.JWT_SECRET,
    jwtExpiresInSeconds: durationToSeconds(value.JWT_EXPIRES_IN),
    ownerSetupToken: value.OWNER_SETUP_TOKEN,
    adminStaticDir: value.ADMIN_STATIC_DIR,
    corsOrigins:
      value.CORS_ORIGIN?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean) ?? [],
  };
}
