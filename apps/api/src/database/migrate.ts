import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { loadWorkspaceEnvironment } from '../config/load-environment.js';

function defaultMigrationsFolder(): string {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const compiledMigrations = path.join(currentDirectory, 'migrations');
  if (existsSync(compiledMigrations)) return compiledMigrations;

  return path.resolve(process.cwd(), 'src/database/migrations');
}

export async function runMigrations(options: {
  databaseUrl: string;
  migrationsFolder?: string;
}): Promise<void> {
  const pool = new Pool({ connectionString: options.databaseUrl, max: 1 });

  try {
    await migrate(drizzle(pool), {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder(),
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  loadWorkspaceEnvironment();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  await runMigrations({ databaseUrl });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
