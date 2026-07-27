import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/app-config.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { PostsModule } from './posts/posts.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule,
        AuthModule.register(),
        HealthModule,
        PostsModule,
        ProfilesModule,
      ],
    };
  }
}
