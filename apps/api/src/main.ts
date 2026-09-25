import 'reflect-metadata';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(compression());

  configureApp(app);

  const corsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  if (corsOrigins.length === 0 && process.env.NODE_ENV === 'production') {
    // `origin: true` reflects whatever Origin the caller sends, which with
    // credentials enabled means any site can drive the API as a logged-in
    // user. Fine for local dev, never in production.
    throw new Error('CORS_ORIGINS must be set explicitly in production');
  }
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  });

  // Bound JSON bodies well under the file-upload path's own 10MB limit;
  // the API takes no large JSON payloads.
  app.use(json({ limit: '256kb' }));
  app.use(urlencoded({ extended: true, limit: '256kb' }));

  app.enableShutdownHooks();

  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 4000;
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
