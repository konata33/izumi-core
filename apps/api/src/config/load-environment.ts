import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

let workspaceEnvironmentLoaded = false;

/** Load the gitignored workspace .env for local commands run from apps/api. */
export function loadWorkspaceEnvironment(): void {
  if (workspaceEnvironmentLoaded) return;
  workspaceEnvironmentLoaded = true;

  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const environmentFile = path.resolve(currentDirectory, '../../../../.env');
  if (existsSync(environmentFile)) loadEnvFile(environmentFile);
}
