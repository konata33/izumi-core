import type { Config } from 'drizzle-kit';

export default {
  schema: './src/database/schema.ts',
  out: './src/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgres://izumi:izumi@127.0.0.1:54329/izumi_core',
  },
} satisfies Config;
