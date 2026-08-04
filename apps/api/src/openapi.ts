import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApplication, createOpenApiDocument } from './application.js';

async function generate(): Promise<void> {
  const app = await createApplication({
    nodeEnv: 'test',
    port: 0,
    adminPort: 0,
    databaseUrl: 'postgres://izumi:izumi@127.0.0.1:54329/izumi_core',
    redisUrl: 'redis://127.0.0.1:6389',
    jwtSecret: 'openapi-generation-secret-that-is-not-used-at-runtime',
    jwtExpiresInSeconds: 604_800,
    corsOrigins: [],
    corePublicUrl: 'http://localhost:3001',
    mediaLocalDirectory: '/tmp/izumi-openapi-media',
    mediaImageMaxBytes: 20 * 1024 * 1024,
    mediaVideoMaxBytes: 500 * 1024 * 1024,
  });
  const document = createOpenApiDocument(app);
  const output = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'openapi.json',
  );

  try {
    await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

generate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
