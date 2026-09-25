# Build phases — status log

Each phase ends with a verification gate (typecheck + lint + tests + build,
plus DB validation where applicable) before the next phase starts. This file
is the running record so status isn't re-explained in chat — update it at
the end of every phase instead.

| # | Phase | Status |
|---|---|---|
| 1 | Repository audit + architecture foundation | ✅ done |
| 2 | Database + Prisma + core domain models | ✅ done |
| 3 | Authentication + RBAC | ✅ done |
| 4 | Products + categories + inventory | ✅ done |
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

## Phase 3 — Authentication + RBAC ✅

**Scope:** two independent JWT auth flows on one `JWT_ACCESS_SECRET`,
distinguished by a `type: 'staff' | 'customer'` claim each Passport
strategy checks (a staff token can never authenticate as a customer or
vice versa):

- **Staff** (`modules/auth/staff-auth.{service,controller}.ts`):
  email+password login (argon2), short-lived access token +
  long-lived opaque refresh token. Refresh tokens are never JWTs — random
  48-byte values, stored only as a SHA-256 hash in `StaffRefreshToken`, so
  they can be revoked server-side (JWTs can't be). Refresh **rotates**: every
  `/auth/staff/refresh` call revokes the token it was given and issues a new
  pair, so a stolen-and-reused refresh token is detectable. Login compares
  against a dummy argon2 hash when the email doesn't exist, so response
  timing doesn't leak which emails are registered.
- **Customer** (`modules/auth/customer-auth.{service,controller}.ts`):
  Telegram Mini App `initData` → `packages/shared/src/crypto/telegram-init-data.ts`
  (HMAC-SHA256 per Telegram's documented algorithm, `timingSafeEqual`
  comparison, rejects payloads older than 24h) → upserts `Customer` →
  24h access token. No customer refresh token: the Mini App re-sends fresh
  `initData` every time it's opened, which is Telegram's own intended
  re-auth mechanism.

**RBAC** (`modules/rbac/`): `PermissionsGuard` checks a route's
`@Permissions(...)` metadata against `packages/shared`'s static
`ROLE_PERMISSIONS[staff.role]` — authorization logic lives in exactly one
place, never re-implemented per route. `GET /rbac/roles` (permission
`roles.read`) exposes the full role→permission matrix for the future
Admin Dashboard `/admin/roles` page. `JwtStaffAuthGuard`/
`JwtCustomerAuthGuard` attach the authenticated principal to
`request.staff` / `request.customer` (never the shared `request.user`)
so the two principal types can't be confused if a route is reachable by
mistake from both guard types.

Guards are applied per-route via `@UseGuards(...)`, not globally — this API
mixes public storefront reads, customer-authenticated, and staff-authenticated
routes on the same server, so a blanket global guard would need constant
`@Public()` exceptions.

**Security hardening landed alongside auth** (found while wiring the
global `ThrottlerGuard`, which Phase 1 had imported but never actually
registered — rate limiting wasn't being enforced at all until now):
named Throttler profiles (`default` 120/min, stricter `auth` 5/min by
default) so login and Telegram-auth — the platform's brute-force targets —
get independently tunable limits via `AUTH_RATE_LIMIT_MAX` /
`AUTH_RATE_LIMIT_WINDOW_MS`, without loosening the global API limit. CI
and local dev set `AUTH_RATE_LIMIT_MAX` high so the e2e suite's repeated
login calls don't rate-limit each other; production keeps the strict
default.

**Verification (all green):**
- New `apps/api/test/auth.e2e-spec.ts` (11 tests) against live Postgres/Redis: unknown-email and wrong-password rejection, successful login response shape, `/me` unauthenticated (401) vs authenticated, refresh-token rotation (old token rejected after rotation), logout revocation, RBAC allow (OWNER → `roles.read`) and deny (SUPPORT_AGENT → 403), Telegram auth rejection on bad signature and full authenticate→`/me` round trip on a validly-signed payload.
- `packages/shared` gained 5 more unit tests for `verifyTelegramInitData` (valid signature, wrong bot token, tampered field, stale `auth_date`, missing hash) — 15/15 total in that package now.
- `pnpm typecheck` — 10/10. `pnpm lint` — 10/10. `pnpm test` — all pass. `pnpm test:e2e` — 15/15. `pnpm build` — 7/7. CI workflow updated to actually run `test:e2e` (it previously only ran unit tests).

## Phase 4 — Products + categories + inventory ✅

**Scope:** `modules/catalog/` (categories + products, split into public and
`admin/`-prefixed controllers so guard application is class-level, not
scattered per-method): public browsing only ever returns
`status=ACTIVE, visibility=VISIBLE` (a `DRAFT` product 404s on the public
endpoint even by direct slug lookup — verified by e2e, not just assumed);
admin endpoints are fully paginated/searchable/filterable and gated by
`products.read`/`products.write`/`categories.read`/`categories.write`.
Product listings compute `availableStock` per item — `product.stock`
directly for `QUANTITY` mode, a single batched `groupBy` count of
`AVAILABLE` inventory items for `INDIVIDUAL` mode (one query for the whole
page, not one per product).

`modules/inventory/` — the concurrency-critical module:
- `bulkImport` encrypts each secret (Phase 2's `encryptSecret`) before
  storage; list views select every `InventoryItem` column **except**
  `encryptedPayload` at the query level, so the secret physically never
  leaves the database in a listing response, not just "isn't shown by the
  client."
- `revealSecret` decrypts one item and writes an `AuditLog` row
  (new `modules/audit/`, a global module — nearly every staff mutation
  needs it) tagging the requesting staff id. Gated by a **separate**
  `inventory.reveal_secret` permission, not bundled into `inventory.read`.
- `reserveIndividualItems`: `SELECT ... FOR UPDATE SKIP LOCKED` inside the
  caller's transaction, so concurrent reservations for the same product
  never block each other on rows another transaction is already claiming.
- `reserveQuantity`: atomic `UPDATE product SET stock = stock - qty WHERE
  stock >= qty` — safe under concurrency without explicit locking, because
  Postgres re-evaluates the `WHERE` clause against the just-committed row
  when a blocked `UPDATE` unblocks (`result.count === 0` on the loser,
  every time, never a stale read).
- Both reservation primitives take a `Prisma.TransactionClient`, not a
  bare `PrismaService` — they're building blocks Phase 5's checkout
  transaction composes, not standalone endpoints.

**RBAC fix found by testing, not by inspection:** the Phase 3 permission
matrix gave `ADMIN` `inventory.write` but not `inventory.reveal_secret`,
which doesn't match the spec's description of `ADMIN` having full
inventory scope (only `DELIVERY_AGENT` had it). Writing the e2e test for
"admin reveals a secret" caught this immediately (403 where the test
expected 201) — fixed by granting `ADMIN` `inventory.reveal_secret` too,
rather than by weakening the test.

**Verification (all green):**
- New `apps/api/test/catalog-inventory.e2e-spec.ts` (12 tests) against live Postgres/Redis, including the two that matter most for a commerce platform: **N concurrent reservation attempts against 3 available individual inventory items** (8 attempts → exactly 3 succeed, 5 throw `InsufficientInventoryError`, 0 left `AVAILABLE`, exactly 3 `RESERVED`) and the same shape for **QUANTITY-mode stock** (8 concurrent decrement attempts against `stock=3` → exactly 3 succeed, final `stock === 0`, never negative). Also: draft-product 404 on public routes then visible after publish, duplicate category slug rejection, permission denial for a role without `products.write`, bulk import + list-never-exposes-secret + reveal-is-audited.
- `pnpm typecheck` — 10/10. `pnpm lint` — 10/10. `pnpm test` — all pass. `pnpm test:e2e` — 23/23. `pnpm build` — 7/7.
