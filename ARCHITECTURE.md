# SQLM — Digital Products Telegram Commerce Platform — Architecture

Source of truth for engineering decisions. Update this instead of re-explaining
architecture in chat. See `docs/PHASES.md` for phase-by-phase build status.

## 1. System shape

One backend, many adapters. The Telegram bot, the Mini App, the customer
website, and the Admin Dashboard are all thin clients of the same Core
Backend API. No business logic lives in a Telegram handler, a React
component, or an admin route — it lives in NestJS application services and
is reused by every adapter.

```
Telegram Bot ─┐
Mini App ─────┼──▶ Core Backend API (NestJS) ──▶ PostgreSQL (Prisma)
Website ──────┤            │                 └─▶ Redis (cache, locks, idempotency)
Admin ────────┘            └──▶ BullMQ queues ──▶ Workers ──▶ S3 storage / Telegram API
```

## 2. Monorepo layout

```
apps/
  api/       NestJS core backend: REST API, Telegram webhook adapter,
             BullMQ workers (run as separate processes from the same build).
  web/       Next.js customer marketing/storefront website.
  admin/     Next.js Admin Dashboard (staff-only, RBAC-enforced server-side).
  miniapp/   Next.js Telegram Mini App — the primary shopping experience.
packages/
  database/  Prisma schema, migrations, generated client, seed script.
  shared/    Cross-app TypeScript: enums, DTO/zod schemas, permission list.
infra/       docker-compose, Caddy reverse proxy, Grafana provisioning.
```

Package manager: pnpm workspaces. Task runner: Turborepo. All apps and
packages are TypeScript, compiled with strict mode.

## 3. Why NestJS modules, not microservices

A single deployable Nest application (`apps/api`) hosts every domain module.
Horizontal scaling is achieved by running **multiple stateless instances**
of the same image behind the reverse proxy for the HTTP/webhook role, and
**separate worker processes** (`node dist/worker.js`, scaled independently)
for queue consumers — not by splitting into microservices. This keeps
transactional consistency simple (one Postgres connection pool, one Prisma
schema) while still allowing the API tier and the worker tier to scale
independently, which is what the load profile in the spec actually needs.

## 4. Domain modules (`apps/api/src/modules`)

| Module | Responsibility |
|---|---|
| `prisma` | Prisma client lifecycle, transaction helper |
| `redis` | ioredis client, distributed locks, idempotency cache |
| `queue` | BullMQ queue registration, base processor with retry/backoff/DLQ |
| `config` | Validated env config (zod) |
| `auth` | Staff JWT auth (access+refresh), Telegram `initData` customer auth |
| `rbac` | Roles, permissions, guards, decorators |
| `users` | Customers + Staff accounts |
| `catalog` | Categories, Products (dynamic delivery/fulfillment types) |
| `inventory` | Quantity stock + individual encrypted inventory items, atomic reservation |
| `orders` | Cart→Order, explicit order state machine, order events (audit trail) |
| `payments` | Configurable payment methods, payment proof upload/review |
| `delivery` | Automatic + manual fulfillment workers |
| `support` | Ticket/conversation system (Telegram ⇄ Admin bidirectional) |
| `telegram` | Bot adapter: webhook controller + grammy bot, menus, notifications |
| `notifications` | Outbound notification dispatch (Telegram, future: email) |
| `storage` | S3-compatible object storage client (MinIO in dev) |
| `audit` | Audit log writer used by admin mutations and order transitions |
| `admin` | Dashboard aggregation endpoints |
| `health` | Liveness/readiness + Prometheus metrics |

## 5. Telegram bot = adapter, not business logic

`POST /telegram/webhook/:secret`:
1. Validate the path secret + Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
2. Parse the update, derive an idempotency key from `update.update_id`.
3. `SET NX` the key in Redis (TTL) — duplicate deliveries short-circuit here.
4. Enqueue the raw update onto the `telegram-updates` BullMQ queue.
5. Return `200` immediately (webhook handling must be fast — see §14 of spec).

A separate worker consumes `telegram-updates` and replays each update through
a `grammy` `Bot` instance whose handlers call **application services**
(`OrdersService`, `SupportService`, ...) exactly like the REST controllers
and the Mini App's API calls do. The bot never touches Prisma directly.

## 6. Order state machine

`OrdersService` is the **only** code path allowed to write `Order.status`.
Transitions are declared as an explicit allow-list
(`apps/api/src/modules/orders/order-state-machine.ts`); any other transition
throws. Every accepted transition is wrapped in a Prisma transaction that
also inserts an `OrderEvent` row, so the full lifecycle is auditable.

States: `CREATED → PENDING_PAYMENT → PAYMENT_SUBMITTED → PAYMENT_REVIEW →
PAID → PROCESSING → READY_FOR_DELIVERY → DELIVERED → COMPLETED`, with
`CANCELLED` / `REFUNDED` / `DISPUTED` reachable from the appropriate states.

## 7. Idempotency strategy

| Operation | Mechanism |
|---|---|
| Telegram update delivery | Redis `SET NX EX` on `update_id`, plus a unique DB constraint on `TelegramUpdateLog.updateId` as a second line of defense |
| Checkout / order creation | Client-supplied `idempotencyKey` in the checkout body, enforced by a DB-level unique constraint on `(customerId, idempotencyKey)` — a sequential retry looks it up and replays the same order; a *true concurrent* double-submit races to insert, and the loser catches the constraint violation (Postgres `P2002`) and re-fetches the winner's order instead of erroring |
| Payment proof upload | Unique partial index: one non-terminal `PaymentProof` per order; re-upload replaces the pending row instead of duplicating |
| Inventory reservation | `SELECT ... FOR UPDATE SKIP LOCKED` inside a serializable-enough transaction; reservation count is re-checked against `Product.stock`/available items before commit |
| Admin payment approval | Optimistic status guard (`WHERE status = 'PENDING'`) on the update — a second concurrent approval affects 0 rows and is reported as a conflict, not a double-transition |

## 8. Storage of sensitive inventory data

Individual inventory payloads (account credentials, license keys) are
encrypted at rest with AES-256-GCM (`INVENTORY_ENCRYPTION_KEY`) before being
written to Postgres. Decryption only happens server-side at the moment of
delivery, inside `DeliveryService`, and the decrypted value is sent to the
customer via Telegram and then the in-memory reference is discarded — it is
never returned by any list/browse endpoint.

## 9. Build/verification status

See `docs/PHASES.md`.
