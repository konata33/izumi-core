import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { type AppConfig, loadConfig } from './config/app-config.js';

export function createOpenApiDocument(app: NestFastifyApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Izumi Core API')
      .setDescription('Versioned API for the Izumi content platform')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build(),
  );
}

export async function createApplication(
  config: AppConfig = loadConfig(),
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter({ logger: false, requestIdHeader: 'x-request-id' }),
  );

  const corsOrigin =
    config.corsOrigins.length === 0
      ? config.nodeEnv === 'production'
        ? false
        : true
      : config.corsOrigins;

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  const document = createOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });

  return app;
}
