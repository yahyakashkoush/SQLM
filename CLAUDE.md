# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- `pnpm dev` — Start all services in watch mode (API, web, admin, miniapp)
- `pnpm --filter @sqlm/api dev` — API only (http://localhost:4000)
- `pnpm --filter @sqlm/web dev` — Website only (http://localhost:3000)
- `pnpm --filter @sqlm/admin dev` — Admin dashboard only (http://localhost:3100)
- `pnpm --filter @sqlm/miniapp dev` — Mini App only (http://localhost:3200)
- `docker compose up -d` — Start PostgreSQL, Redis, MinIO (required before any dev)
- `docker compose down` — Stop containers
- `docker compose exec postgres psql -U sqlm -d sqlm` — Connect to Postgres directly
- `redis-cli` — Connect to Redis (from the container: `docker compose exec redis redis-cli`)

### Database

- `pnpm db:generate` — Regenerate Prisma client
- `pnpm db:migrate` — Create a new migration from schema changes
- `pnpm db:migrate:deploy` — Apply pending migrations to dev/prod database
- `pnpm db:seed` — Seed database with test data (owner account + categories + products)
- `pnpm db:studio` — Open Prisma Studio GUI at http://localhost:5555

### Testing & Quality

- `pnpm typecheck` — TypeScript strict mode across all packages (turbo)
- `pnpm lint` — ESLint (turbo, uses TypeScript ESLint rules)
- `pnpm test` — Jest unit tests for all packages
- `pnpm test:e2e` — NestJS e2e tests (API only, 16 suites, ~195 tests, live Postgres/Redis)
  - `pnpm test:e2e -- --testNamePattern="flood"` — Run tests matching "flood"
  - `pnpm test:e2e -- test/orders.e2e-spec.ts` — Run one suite
  - `pnpm test:e2e -- --forceExit` — Kill processes after tests (useful for hanging tests)
- `pnpm format` — Prettier auto-format (ts, tsx, md, json)
- `pnpm build` — Production builds (turbo, all apps)

### Deployment

- `infra/bootstrap.sh` — One-command server setup & update (requires SSH + sudo, runs migrations on boot)
- `git push origin <branch>` — Push; CI runs automatically (GitHub Actions)
  - `ci` job: typecheck + lint + test (all suites green before merge)
  - `images` job: build Docker images (ghcr.io)
  - `deploy` job: SSH and run bootstrap (GitHub runners can't reach EC2, so this fails with continue-on-error; deploy via `bootstrap.sh` on the host instead)

## Architecture Overview

### System shape: One backend, many adapters

```
Telegram Bot ─┐
Mini App ─────┼──▶ Core Backend API (NestJS) ──▶ PostgreSQL
Website ──────┤            │                 └──▶ Redis (cache, locks, idempotency)
Admin ────────┘            └──▶ BullMQ workers ──▶ Telegram API / S3 storage
```

**Key principle**: Business logic lives only in NestJS application services. Telegram handlers, React components, and admin routes are thin adapters — they call services, never access Prisma directly.

### Monorepo layout

```
apps/
  api/       NestJS core: REST API + Telegram webhook + BullMQ workers
  web/       Next.js customer website (marketing/storefront)
  admin/     Next.js admin dashboard (staff-only, RBAC enforced server-side)
  miniapp/   Next.js Telegram Mini App (primary shopping UX)
packages/
  database/  Prisma schema, migrations, generated client, seed
  shared/    Cross-app TypeScript: enums, DTO/zod schemas, permissions
  ui/        Shadcn-style component library (Tailwind CSS)
infra/       docker-compose, Caddy reverse proxy config, Grafana provisioning
docs/        ARCHITECTURE.md, PHASES.md, DEPLOYMENT.md
```

**Package manager**: pnpm workspaces. **Task runner**: Turborepo.

### NestJS module structure (`apps/api/src/modules/`)

Each module is a domain concern with a service, controller(s), DTOs, and optional guards/processors:

| Module | Purpose |
|--------|---------|
| `auth` | JWT tokens for staff, `initData` for Telegram customers |
| `rbac` | Role-based access control, permission guards, decorators |
| `catalog` | Products, categories, dynamic delivery/fulfillment types |
| `inventory` | Stock (quantity) + individual encrypted items, atomic reservation |
| `orders` | Order state machine, cart, explicit transitions, audit trail |
| `payments` | Payment methods, proof upload/review, payment proof processing |
| `delivery` | Auto fulfillment (inventory items) + manual queue (delivery templates) |
| `support` | Tickets/conversations (bidirectional Telegram ⇄ Admin) |
| `telegram` | Bot adapter: webhook controller, grammy handlers, menus, notifications |
| `notifications` | Outbound dispatch (Telegram, future: email) |
| `loyalty` | Member discounts (verified, legacy/old-customer), welcome gift, perks |
| `storage` | S3-compatible (LocalStack in dev, S3/minio in prod) |
| `queue` | BullMQ registration, base processor with retry/backoff/DLQ |
| `redis` | ioredis client, distributed locks, idempotency cache |
| `audit` | Audit log insertion (admin mutations, order events) |
| `health` | Liveness/readiness, Prometheus metrics |

### Core patterns

#### Order state machine (critical invariant)

`OrdersService.transition()` is the **only** code path allowed to write `Order.status`. Transitions are an explicit allow-list in `ORDER_TRANSITIONS` (shared enum); any disallowed transition throws `InvalidOrderTransitionError` (409).

Every transition is wrapped in a Prisma transaction that also inserts an `OrderEvent` row → full audit trail.

States: `CREATED → PENDING_PAYMENT → PAYMENT_SUBMITTED → PAYMENT_REVIEW → PAID → PROCESSING → READY_FOR_DELIVERY → DELIVERED → COMPLETED`, with `CANCELLED`, `REFUNDED`, `DISPUTED` reachable from appropriate states.

#### Inventory atomicity

An item is never delivered twice. The `PAID → PROCESSING` transition only one runner can win (distributed lock). A unique constraint on `Delivery.orderItemId` + a `status: PENDING` guard on the item make the loser of a race a 0-row no-op.

#### Telegram webhook

Webhook endpoint (`POST /telegram/webhook/:secret`):
1. Validate secret + `X-Telegram-Bot-Api-Secret-Token` header
2. Derive idempotency key from `update.update_id`
3. `SET NX` key in Redis (TTL) — duplicate deliveries short-circuit
4. Enqueue raw update to `telegram-updates` BullMQ queue
5. Return `200` immediately

A separate worker consumes `telegram-updates`, replays through grammy `Bot` handlers, which call application services (not Prisma directly).

#### Idempotency

Every webhook requeue is idempotent (Redis NX). API endpoints use headers (`Idempotency-Key` when present) or derive keys from request body.

#### Payment proofs

Manual payment methods require proof upload (image or document). Proofs:
- Store SHA-256 hash (duplicate detection across customers/orders)
- Flagged for risk: same file reused, previous rejections, new account, first order
- Capped at 5 per order (409 `TOO_MANY_PROOFS`)
- Max 10MB per file (413)

#### Flood guard

Bot webhook admits 25 updates/minute per Telegram user; violations trigger a warning and 10-minute mute. Group/channel traffic dropped outright. Fails open on Redis error.

#### Bans

`Customer.status = BANNED` blocks:
- Telegram middleware stops banned senders before any handler
- Mini App refuses BANNED customers at login and every request
- `ban()` also rejects pending proofs, cancels unpaid orders (returns stock), and writes audit log
- Paid orders deliberately left untouched
- Unban restores access

### Authentication & RBAC

**Customers** (mini app, website):
- Telegram `initData` extracted from Mini App web_app_init_data
- JWT issued, validated on every request
- Token refreshed via refresh_token endpoint

**Staff** (admin dashboard):
- Email + password → JWT access + refresh tokens
- Roles (Owner, Admin, PaymentReviewer, SupportAgent, Inventory) → permissions
- Guards on every admin route enforce permissions

## Key Constraints & Gotchas

### Prisma transactions

When calling `prisma.$transaction()`, all queries inside the callback must be Prisma client methods on `prisma` (the callback argument), not the global client. Forgetting this causes silent transaction loss.

```ts
await prisma.$transaction(async (tx) => {
  // ✅ use tx
  await tx.order.update(...);
  // ❌ NOT await prisma.order.update(...);
});
```

### Order transitions are the law

Any code that changes `Order.status` must call `OrdersService.transition()`. Direct `prisma.order.update({ status: ... })` will bypass audit and state validation. Tests assert transition rules; breaking transitions will fail e2e tests.

### Telegram message limit

Messages over 2000 characters are refused by the flood guard. Delivery templates and bot responses must fit.

### E2e tests are live

Tests run against real Postgres + Redis. They're isolated (each suite has fixtures, runs in transaction that rolls back), but suite teardowns can collide if they share resources. Each suite should own its data or use transactions (`prisma.$transaction()`).

### Docker logs are capped

All services have log rotation (`x-logging` in docker-compose.prod.yml: 10MB/file, 3 files max). A runaway logging service won't fill the disk.

### Secrets in environment only

Never commit `.env`. Secrets (JWT keys, crypto keys, bot token, API keys) live only in the server's `.env` or Docker secrets.

### Redis ephemeral

Redis is ephemeral (no persistence). Idempotency caches and rate-limit counters reset on restart. This is intentional for development; in production, use managed Redis with persistence if needed.

## Git Workflow (this session)

- **Branch**: `claude/gifted-pasteur-kpxp3n` (feature branch for Claude Code)
- **PR**: [yahyakashkoush/SQLM#1](https://github.com/yahyakashkoush/SQLM/pull/1) (draft, auto-updated on each push)
- **Commit message footer**:
  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019kEpGVWR8CNP4G5dRe4LbK
  ```
- **After pushing**: CI runs automatically (typecheck, lint, test, build images). Green = ready to merge (or deploy via `infra/bootstrap.sh` on the host).

## Dev Quick Start

```bash
# First time
cp .env.example .env       # fill in secrets
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed               # creates owner account

# Daily dev loop
pnpm dev                   # or watch one service
# make changes...
pnpm typecheck lint test   # or let turbo do it on watch
git add -A && git commit -m "..."
git push origin claude/gifted-pasteur-kpxp3n
```

## References

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — System design, detailed module responsibilities, idempotency strategy, security model
- [`docs/PHASES.md`](./docs/PHASES.md) — Build status, phase-by-phase feature list
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — Production runbook, bootstrap script, DNS/TLS setup
- [`packages/shared/src/permissions`](./packages/shared/src/permissions) — Complete permission list
- [`apps/api/src/modules/orders/order-state-machine.ts`](./apps/api/src/modules/orders/order-state-machine.ts) — Explicit order transitions
- [`infra/bootstrap.sh`](./infra/bootstrap.sh) — Server setup and update script
