import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({})
export class AuthModule {
  static register(): DynamicModule {
    return {
      global: true,
      module: AuthModule,
      imports: [
        JwtModule.registerAsync({
          global: true,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => ({ secret: config.jwtSecret }),
        }),
      ],
      controllers: [AuthController],
      providers: [AuthService, JwtAuthGuard],
      exports: [AuthService, JwtAuthGuard],
    };
  }
}
