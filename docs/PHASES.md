# Build phases — status log

Each phase ends with a verification gate (typecheck + lint + tests + build,
plus DB validation where applicable) before the next phase starts. This file
is the running record so status isn't re-explained in chat — update it at
the end of every phase instead.

| # | Phase | Status |
|---|---|---|
| 1 | Repository audit + architecture foundation | ✅ done |
| 2 | Database + Prisma + core domain models | ✅ done |
| 3 | Authentication + RBAC | pending |
| 4 | Products + categories + inventory | pending |
| 5 | Orders + checkout + order state machine | pending |
| 6 | Manual payments + payment proofs | pending |
| 7 | Telegram Bot adapter | pending |
| 8 | Telegram Mini App | pending |
| 9 | Automatic/manual fulfillment | pending |
| 10 | Support system | pending |
| 11 | Admin Dashboard | pending |
| 12 | Realtime notifications | pending |
| 13 | Redis + BullMQ + workers | pending |
| 14 | Security hardening | pending |
| 15 | Observability | pending |
| 16 | Load/concurrency testing | pending |
| 17 | Docker + CI/CD + production deployment | pending |

## Phase 1 — Repository audit + architecture foundation ✅

**Scope:** pnpm + Turborepo monorepo; `apps/api` (NestJS) with config
validation, Prisma/Redis wiring, health/readiness/metrics endpoints, global
error filter, structured logging, URI API versioning (`/api/v1/...`) with
version-neutral infra endpoints (`/api/health/*`, `/api/metrics`); `apps/web`,
`apps/admin`, `apps/miniapp` (Next.js 15 App Router + Tailwind) sharing
`packages/ui` (hand-rolled shadcn-style component set) and `packages/shared`
(enums, permissions, zod DTOs); `packages/database` (Prisma, placeholder
schema + first migration applied); dev infra via `docker-compose.yml`
(Postgres 16, Redis 7, S3-compatible storage); root ESLint flat config +
Prettier; GitHub Actions CI skeleton.

**Infra substitution note:** MinIO's official images are no longer pullable
from Docker Hub (repo access denied — MinIO restricted free Docker Hub
distribution in their 2024 AGPL relicensing) and `quay.io/minio` is blocked
by this environment's egress policy. Local dev uses
`localstack/localstack:3.8.1` (pinned — newer LocalStack tags require a paid
auth token even for S3) as the S3-compatible emulator instead; it's exercised
through the same `@aws-sdk/client-s3` code path production will use.
Production must point `S3_ENDPOINT` at a real provider (AWS S3, Cloudflare
R2, Backblaze B2, DigitalOcean Spaces, or a self-hosted MinIO from a registry
you can reach) — never LocalStack. See `docker-compose.yml` for details.

**Verification (all green):**
- `pnpm install` — clean, native build scripts (argon2, Prisma engines, esbuild) approved via `pnpm.onlyBuiltDependencies`.
- `docker compose up -d` — Postgres, Redis, and S3-emulation containers healthy.
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` — Prisma client generated, placeholder migration applied to live Postgres, seed runs. (Superseded in Phase 2 by the real domain schema's `init` migration.)
- `pnpm typecheck` — 10/10 packages.
- `pnpm lint` — 10/10 packages, 0 errors/warnings.
- `pnpm test` — unit tests pass.
- `pnpm test:e2e` — 4/4 pass against **live** Postgres + Redis (readiness probe asserts both `up`, not mocked).
- `pnpm build` — 7/7 packages (api + web + admin + miniapp + database + shared + ui).

**Known non-blocking item:** `next lint` prints a Next.js 16 deprecation
notice (still functions correctly on Next 15.5); no action needed until the
Next 16 migration.

## Phase 2 — Database + Prisma + core domain models ✅

**Scope:** full domain schema in `packages/database/prisma/schema.prisma`
(migration `20260925164308_init`): `Staff`/`StaffRefreshToken` (RBAC role is
a fixed enum — `OWNER`/`ADMIN`/`PAYMENT_REVIEWER`/`SUPPORT_AGENT`/
`DELIVERY_AGENT` — permission derivation stays in
`packages/shared/src/permissions`, not a dynamic DB-backed permission
system, since the spec's roles are a fixed set), `Customer`, `Category`
(self-referencing for subcategories), `Product` (dynamic `deliveryType` /
`fulfillmentType` / `inventoryMode` enums, `metadata` Json escape hatch —
nothing product-specific is hardcoded), `InventoryItem` (encrypted payload,
available count is always `COUNT(status = AVAILABLE)`, never a separate
stored counter that could drift), `Order`/`OrderItem`/`OrderEvent` (product
details snapshotted onto `OrderItem` at purchase time; `OrderEvent` is the
append-only audit trail the state machine writes to in Phase 5),
`PaymentMethod`/`PaymentProof`, `SupportTicket`/`TicketMessage`,
`PlatformSetting` (key/value, admin-editable config), `AuditLog`,
`TelegramUpdateLog` (second line of defense behind the Redis idempotency
check for duplicate Telegram webhook deliveries). Money fields use
`Decimal(12,2)`, not float. `Customer.telegramId` / `TelegramUpdateLog.updateId`
use `BigInt` (Telegram IDs can exceed 32-bit range).

Added `packages/shared/src/crypto/inventory-encryption.ts` — AES-256-GCM
`encryptSecret`/`decryptSecret`, shared between the seed script and the
Phase 4/9 inventory + delivery services so the wire format
(`iv:authTag:data`, all base64) can't drift between writer and reader.

Seed script (`packages/database/prisma/seed.ts`, idempotent — safe to
re-run): one `OWNER` staff account, 3 example payment methods (Bank
Transfer / Vodafone Cash / InstaPay, matching the spec's own examples), 3
platform settings, and an illustrative category + 2 products (one
`AUTOMATIC`/`INDIVIDUAL` with 2 real encrypted inventory items, one
`MANUAL`/`QUANTITY`) — dev fixtures only, freely editable from the future
Admin Dashboard; nothing in application code branches on them.

**Verification (all green):**
- `prisma format` / `prisma validate` — schema valid.
- `prisma migrate reset --force` → `prisma migrate dev --name init` — clean apply to live Postgres.
- `prisma migrate deploy` (the CI/production path, separate from `migrate dev`) — verified against a freshly reset database, 0 pending migrations after apply.
- `pnpm db:seed` run twice — second run is a true no-op (upserts + existence checks), confirmed via row counts (`staff=1, payment_methods=3, platform_settings=3, categories=1, products=2, inventory_items=2`).
- New unit tests for the encryption helper (`packages/shared`, Node's built-in test runner via `tsx --test`): round-trip correctness, random-IV uniqueness per call, wrong-key rejection, tampered-ciphertext (auth tag) rejection, wrong-key-length rejection — 5/5 pass. Manually confirmed the round trip once more with the actual dev `INVENTORY_ENCRYPTION_KEY`.
- `pnpm typecheck` — 10/10. `pnpm lint` — 10/10, 0 warnings. `pnpm test` — all pass (api + shared). `pnpm test:e2e` — 4/4 against live Postgres/Redis. `pnpm build` — 7/7.
