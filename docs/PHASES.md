# Build phases — status log

Each phase ends with a verification gate (typecheck + lint + tests + build,
plus DB validation where applicable) before the next phase starts. This file
is the running record so status isn't re-explained in chat — update it at
the end of every phase instead.

| # | Phase | Status |
|---|---|---|
| 1 | Repository audit + architecture foundation | ✅ done |
| 2 | Database + Prisma + core domain models | pending |
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
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` — Prisma client generated, migration `20260925162306_init_placeholder` applied to live Postgres, seed runs.
- `pnpm typecheck` — 10/10 packages.
- `pnpm lint` — 10/10 packages, 0 errors/warnings.
- `pnpm test` — unit tests pass.
- `pnpm test:e2e` — 4/4 pass against **live** Postgres + Redis (readiness probe asserts both `up`, not mocked).
- `pnpm build` — 7/7 packages (api + web + admin + miniapp + database + shared + ui).

**Known non-blocking item:** `next lint` prints a Next.js 16 deprecation
notice (still functions correctly on Next 15.5); no action needed until the
Next 16 migration.
