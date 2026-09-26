import { z } from 'zod';

/**
 * `.env` files commonly leave optional secrets as `KEY=` (empty string, not
 * unset) — treat that the same as "not provided" instead of failing
 * `.min(1)`/`.url()` validation on a value nobody actually filled in.
 */
const optionalString = (schema: z.ZodString = z.string()) =>
  z.preprocess((val) => (val === '' ? undefined : val), schema.optional());

/**
 * Fails fast at boot with a readable error instead of letting a missing
 * secret surface later as a confusing runtime failure (e.g. JWT signing
 * throwing mid-request).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: optionalString(),
  REDIS_URL: optionalString(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  INVENTORY_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be a 32-byte hex string (64 hex chars)'),

  TELEGRAM_BOT_TOKEN: optionalString(z.string().min(1)),
  TELEGRAM_WEBHOOK_SECRET: optionalString(z.string().min(1)),
  TELEGRAM_WEBHOOK_URL: optionalString(z.string().url()),

  S3_ENDPOINT: optionalString(z.string().min(1)),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: optionalString(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: optionalString(z.string().min(1)),
  S3_BUCKET: optionalString(z.string().min(1)),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  S3_PUBLIC_URL: optionalString(),

  SENTRY_DSN: optionalString(),
  LOG_LEVEL: z.string().default('info'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  /** Deliberately much stricter default — brute-force protection on login/Telegram-auth. */
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

  CORS_ORIGINS: optionalString(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return result.data;
}
