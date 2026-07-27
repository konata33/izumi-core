import 'reflect-metadata';

import { createApplication } from './application.js';
import { loadConfig } from './config/app-config.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await createApplication(config);

  await app.listen({ host: '0.0.0.0', port: config.port });
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
