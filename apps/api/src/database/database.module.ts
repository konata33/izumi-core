import type { OnApplicationShutdown } from '@nestjs/common';
import { Global, Inject, Module } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import * as schema from './schema.js';

export const DATABASE = Symbol('DATABASE');
export const DATABASE_POOL = Symbol('DATABASE_POOL');
export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({
          connectionString: config.databaseUrl,
          max: 10,
        }),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DATABASE, DATABASE_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
