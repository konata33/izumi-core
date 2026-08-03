import type { AppConfig, MediaStorageConfig } from '../config/app-config.js';

export type MediaAwareAppConfig = AppConfig;

export function requireMediaStorageConfig(
  config: MediaAwareAppConfig,
): MediaStorageConfig {
  if (!config.mediaStorage) {
    throw new Error('Media storage is not configured');
  }
  return config.mediaStorage;
}
