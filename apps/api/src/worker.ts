import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * Separate entrypoint for the BullMQ worker tier (`pnpm --filter @sqlm/api worker`).
 * Runs the same Nest application context — same services, same Prisma
 * connection pool — but without the HTTP server, so it can be scaled
 * independently from the API tier. Queue processors register themselves
 * from their owning modules (see modules/queue); this file just boots the
 * process and keeps it alive.
 */
async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  // eslint-disable-next-line no-console
  console.log('[worker] SQLM worker process started');
}

bootstrapWorker().catch((err) => {
  console.error('Fatal worker bootstrap error', err);
  process.exit(1);
});
