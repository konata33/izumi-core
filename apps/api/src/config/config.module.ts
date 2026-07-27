import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from './app-config.js';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig) {
    return {
      global: true,
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
