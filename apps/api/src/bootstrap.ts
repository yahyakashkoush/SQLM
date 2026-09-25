import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Shared between `main.ts` (real boot) and e2e tests, so the two can never
 * drift apart on prefixing/pipes/filters the way hand-duplicated setup would.
 *
 * Health and metrics live under the same `/api` prefix as everything else
 * (`/api/health/*`, `/api/metrics`) rather than being excluded from it —
 * NestJS's prefix `exclude` needs a path-to-regexp wildcard to cover
 * `health/*` sub-routes, and that syntax isn't stable across the
 * path-to-regexp majors Express 4 vs 5 ship. Keeping everything under one
 * prefix sidesteps that entirely; point liveness/readiness probes and the
 * Prometheus scrape config at the `/api/...` paths.
 */
export function configureApp(app: INestApplication): void {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
