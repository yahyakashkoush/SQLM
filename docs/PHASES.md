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
| 5 | Orders + checkout + order state machine | ✅ done |
| 6 | Manual payments + payment proofs | ✅ done |
| 7 | Telegram Bot adapter | ✅ done |
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

**CI infrastructure notes (found by watching the PR's checks, not by local testing):** every push through Phase 4 was actually red in CI despite all-green local verification — two separate bugs local runs couldn't surface. (1) `pnpm/action-setup@v4` now errors on redundant explicit `version` input alongside `package.json`'s `packageManager` field. (2) Turborepo 2.x defaults to strict env mode: `turbo.json` only allowlisted `NODE_ENV`, so every var CI's workflow set (`DATABASE_URL`, `JWT_ACCESS_SECRET`, ...) was stripped before reaching `test:e2e`'s child process — masked locally because `@nestjs/config` reads the physical `.env` file directly, bypassing whatever turbo does or doesn't pass through. Fixed both (`globalPassThroughEnv` now lists every runtime var) and verified the second fix the only way that actually proves it: removed `.env` locally, exported CI's exact variables into the shell, reran `test:e2e` — 34/34 still pass. Lesson for the rest of this build: a fully-green local run does not mean CI is green — check the PR's actual CI status after every push, not just local output.

## Phase 5 — Orders + checkout + order state machine ✅

**Scope:** `modules/orders/order-state-machine.ts` is the single source of
truth for legal transitions (`ORDER_TRANSITIONS` table); `OrdersService.transition()`
is the *only* code path allowed to write `Order.status` — it validates the
transition, updates the row, and writes an `OrderEvent` together, always,
plus side effects that can never be forgotten because they live in the same
place: releasing reserved inventory (both `InventoryItem`→`AVAILABLE` and
`Product.stock` increment) on any transition into `CANCELLED`, and marking
individual items `SOLD` on transition into `PAID`. `CANCELLED` is reachable
only from pre-payment-approval states in the transition table, which is what
lets the release logic run unconditionally on cancellation with no separate
"was this already sold" check — the state machine already guarantees it.

`OrdersService.checkout()` is the full orchestration: idempotency check
(`(customerId, idempotencyKey)` lookup) → payment method validation →
product purchasability + same-currency validation → server-computed
totals (client-sent prices are never trusted) → one Prisma transaction that
creates the `Order`, snapshots `OrderItem`s (name/price/delivery type at
time of purchase, so later product edits can't retroactively change a past
order), reserves inventory via Phase 4's primitives (mode-appropriate:
`reserveIndividualItems` or `reserveQuantity`), and transitions
`CREATED → PENDING_PAYMENT` — all atomic, so a failed reservation rolls
back everything, including the `Order` row itself. **True concurrent
double-submits** (not just sequential retries) are handled by catching the
`(customerId, idempotencyKey)` unique constraint violation (Postgres error
`P2002`) when two requests race past the initial idempotency check
simultaneously: the loser re-fetches and returns the winner's order instead
of erroring.

Introduced `DomainError` (`common/errors/domain.error.ts`): a base class for
service-layer errors that cross a transaction boundary with no HTTP context
of their own (`InsufficientInventoryError`, `ProductNotPurchasableError`,
`PaymentMethodUnavailableError`, `InvalidOrderTransitionError`).
`AllExceptionsFilter` now recognizes it and maps to the error's own declared
status instead of logging it as an unexpected 500 — one central place
instead of try/catch boilerplate in every controller.

No persisted `Cart` entity: the Mini App (Phase 8) owns cart state
client-side and submits the full item list at checkout, matching how
`checkoutRequestSchema` was already shaped back in Phase 1.

**Verification (all green) — `apps/api/test/orders.e2e-spec.ts`, 13 new tests against live Postgres/Redis:**
- Checkout creates `PENDING_PAYMENT` order with server-computed totals and real inventory reservation.
- Idempotent replay (same key, sequential) returns the identical order — confirmed via DB row count, not just the HTTP response.
- **True concurrent double-tap** (`Promise.all`, same idempotency key) still produces exactly one order and exactly one reservation — this is the `P2002`-catch path, and it's exercised for real, not just unit-reasoned about.
- Insufficient inventory → 409, and — critically — the transaction rollback is verified to leave *zero* partial reservations behind, not just reject the request.
- Disabled payment method → 400; DRAFT (non-purchasable) product → 409.
- Order ownership isolation: a customer gets 404 (not 403 — existence isn't leaked) on another customer's order.
- Full happy-path walk (`PENDING_PAYMENT → ... → COMPLETED`, 7 staff-driven transitions) with an audit trail assertion on the resulting `OrderEvent` rows.
- Invalid transition (state-skipping) → 409.
- Cancellation releases reservations correctly for **both** inventory modes, independently verified (individual items back to `AVAILABLE` with `orderId` cleared; `QUANTITY` stock incremented back).
- `pnpm typecheck` — 10/10. `pnpm lint` — 10/10. `pnpm test` — all pass. `pnpm test:e2e` — 34/34. `pnpm build` — 7/7.

**CI status:** as of this phase's push (commit `15585ce`), the PR's actual CI run is green for the first time (`conclusion: success`) — confirmed via the GitHub API, not assumed. Both CI-only bugs above are fully resolved.

## Phase 6 — Manual payments + payment proofs ✅

**Scope:** `modules/storage/` — a thin `StorageService` over `@aws-sdk/client-s3`, used for every upload from here on. Fixed a latent security issue while building this: the Phase 1 LocalStack init script made the whole dev bucket public-read, which would have been the wrong default the moment payment-proof screenshots (transaction details, partial account numbers) landed in it. The bucket is now private; all access is a time-limited presigned URL (`getPresignedUrl`, 15 minutes for admin proof review) generated on demand for an already-authorized request — verified by actually deleting the stale public bucket policy and confirming `NoSuchBucketPolicy` before writing any proof-handling code.

`modules/payments/`:
- **Payment methods**: admin CRUD (`payments.methods.write`) matching the spec's own fields (name, description, account number, instructions, QR code, currency, enabled, display order); public endpoint returns only `enabled` ones. Never hard-deleted — orders reference them historically — "delete" disables instead.
- **Payment proofs**: `uploadProof` is gated entirely by order state — only a `PENDING_PAYMENT` order accepts a proof. Since a successful upload immediately moves the order to `PAYMENT_SUBMITTED → PAYMENT_REVIEW` (two chained `OrdersService.transition()` calls in one DB transaction, both from Phase 5's state machine — no new transition-writing code needed here), a second upload attempt lands on "order not awaiting payment" instead of creating a duplicate `PaymentProof` row. This is the spec's "customer uploads the same screenshot twice" requirement, satisfied by composing Phase 5's state machine rather than adding separate dedup bookkeeping.
- `approve`/`reject` each run as a single transaction: an optimistic `updateMany({ where: { id, status: 'PENDING' } })` guard plus the order transition, together. Two admins racing to approve/reject the *same* proof — the spec's explicit "duplicate admin payment approval" scenario — means one `updateMany` affects 1 row and proceeds to `PAID`; Postgres re-evaluates the second (blocked) transaction's `WHERE` clause against the just-committed row when it unblocks, sees `status != 'PENDING'` already, affects 0 rows, and the loser gets `ProofAlreadyReviewedError` (409) — the same "atomic guarded UPDATE" pattern Phase 4 used for inventory, applied here to payment review.
- Reject takes a `cancelOrder` flag: `false` returns the order to `PENDING_PAYMENT` so the customer can resubmit (still gated the same way); `true` cancels outright, which — because `OrdersService.transition()` already releases inventory unconditionally on any `CANCELLED` transition (Phase 5) — automatically returns reserved stock with no payments-specific release code.
- Never auto-approves on upload, per the spec: `PaymentProof.status` starts and stays `PENDING` until a staff member with `payments.proofs.review` acts on it.

**Verification (all green) — `apps/api/test/payments.e2e-spec.ts`, 12 new tests against live Postgres/Redis (42/42 total in the suite now):**
- Public payment-method listing excludes disabled methods.
- Upload → order reaches `PAYMENT_REVIEW`; a second upload on the same order → 409, and the `PaymentProof` row count is asserted to stay at 1 (not just the HTTP response).
- Unsupported file type (an `.exe`) → 400.
- Approve → order `PAID` with `paidAt` set.
- **Two admins racing to approve the same proof** (`Promise.all`, distinct staff accounts and tokens): exactly one `201`, one `409`; order ends up `PAID` exactly once; exactly one `PAYMENT_APPROVED` `OrderEvent` — not the request outcome alone, the actual downstream state.
- Reject-and-resubmit: order returns to `PENDING_PAYMENT`, and a follow-up upload is accepted.
- Reject-and-cancel: order `CANCELLED`, `QUANTITY` stock verifiably restored to its pre-checkout value.
- Presigned view URL is generated and well-formed.
- `pnpm typecheck` — 10/10. `pnpm lint` — 10/10. `pnpm test` — all pass. `pnpm test:e2e` — 42/42. `pnpm build` — 7/7.

## Phase 7 — Telegram Bot adapter ✅

**Scope:** `modules/queue/` — the first real BullMQ wiring: a global module owning the shared Redis connection (`maxRetriesPerRequest: null`, mandatory for BullMQ's blocking commands) and `defaultJobOptions` (5 attempts, exponential backoff, bounded retention) every queue inherits. `QUEUE_NAMES` registers all ten names from spec §15 up front; only `telegram-updates` has an actual processor this phase — the rest get theirs as their owning modules gain background processing (Phase 9 delivery, Phase 12 notifications, the remainder in Phase 13).

`modules/telegram/` implements the exact webhook→queue→worker shape ARCHITECTURE.md §5 committed to:
- `TelegramWebhookController`: validates the path secret *and* the `X-Telegram-Bot-Api-Secret-Token` header, claims the update via Redis `SETNX` (`RedisService.claimOnce`, built in Phase 1) so a duplicate delivery never reaches the queue, then enqueues with `jobId: telegram-update-${update_id}` (a second, BullMQ-level idempotency layer) and returns immediately — no Prisma, no Telegram API calls, nothing slow in the request path.
- `TelegramUpdateProcessor`: the worker. A unique constraint on `TelegramUpdateLog.updateId` is the third line of defense (catches the case where a job was somehow enqueued twice despite the Redis claim — e.g. Redis was briefly down). Logs `PROCESSING`→`COMPLETED`/`FAILED`, and a failure re-throws so BullMQ retries per the queue's backoff policy.
- `TelegramBotService`: wraps a `grammy` `Bot`. Every handler either replies with a short text summary built from `OrdersService`/`CustomersService`, or hands off to the Mini App via a `web_app` inline button — spec §5's full menu (🏠🛍️🔥🔎📦💳🎫👤), none of it touching Prisma directly. Self-registers the webhook URL with Telegram on boot (`setWebhook`) when configured.
- New `modules/customers/`: extracted `upsertFromTelegram` out of Phase 3's `CustomerAuthService` so the Mini App's HMAC-verified `initData` flow and the bot's webhook-secret-verified flow (which needs no HMAC check of its own — the webhook secret already authenticates it) share one upsert implementation instead of two that could drift.

**Real bug caught by testing, not by review:** `TelegramBotService.onModuleInit()` calling `bot.init()` (a real `getMe` call to `api.telegram.org`) has no bounded timeout in grammy, and this sandbox has no route to Telegram's API (confirmed directly: a plain `curl` to `api.telegram.org` hangs/resets through the egress proxy). Since `onModuleInit` gates Nest's bootstrap, this hung *the entire application* — including the plain REST API, which has nothing to do with the bot — every time a `TELEGRAM_BOT_TOKEN` was configured. First surfaced as all-suites-timeout when the e2e run first included `TelegramModule`. Fixed with a small `withTimeout()` utility (`common/utils/with-timeout.ts`, 8s bound, reusable for the next external HTTP client that doesn't apply its own timeout) plus an explicit skip under `NODE_ENV=test` so the test suite doesn't pay that bound five times over. Verified by actually building and running `dist/worker.js` standalone (not just the test suite): every module initializes, `bot.init()` times out at 8000ms exactly, the failure is logged as a caught error rather than an unhandled rejection, and the process stays alive afterward — the degraded-mode contract holds for real, not just in a test double.

**Honest testing limitation:** actual Telegram message delivery (does `ctx.reply()` really reach a chat) is not verifiable in this environment — no network path to `api.telegram.org` exists here, confirmed directly rather than assumed. What *is* verified end-to-end: webhook validation, all three idempotency layers, queue enqueueing, and (via a dedicated unit test) the keyboard-building logic every handler uses. Production message delivery depends on grammy's own correctness plus real network access, neither of which this sandbox can exercise.

**Verification (all green):**
- New `apps/api/test/telegram-webhook.e2e-spec.ts` (7 tests) against live Postgres/Redis: wrong path secret / missing header secret / mismatched header secret → 403; missing `update_id` → 400; a valid update enqueues exactly one job (inspected via `queue.getJob`, not just the HTTP response); three identical webhook deliveries for the same `update_id` still enqueue exactly one job (`queue.getJobCounts()` summed); the Redis claim primitive directly (`claimOnce` true then false); the DB-level ledger directly (a duplicate `TelegramUpdateLog.updateId` insert rejects, row count stays 1).
- New `main-menu.keyboard.spec.ts` (3 unit tests): every menu label present exactly once, 2-column layout, the `web_app` inline button carries the exact URL passed in.
- `pnpm typecheck` — 10/10. `pnpm lint` — 10/10. `pnpm test` — all pass (4). `pnpm test:e2e` — 50/50. `pnpm build` — 7/7. Also manually ran the built worker process standalone to confirm the timeout fix under real (non-test) conditions.
