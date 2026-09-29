# SQLM — Digital Products Telegram Commerce Platform

Production-grade digital commerce backend with a Telegram Bot, Telegram Mini
App, customer website, and Admin Dashboard as thin adapters over one core
API. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the system design and
[`docs/PHASES.md`](./docs/PHASES.md) for build status.

## Stack

Next.js · TypeScript · Tailwind CSS · NestJS · PostgreSQL/Prisma · Redis/BullMQ · Telegram Bot API & Mini Apps · S3-compatible storage · Docker.

## Monorepo layout

```
apps/api       NestJS core backend (REST API + Telegram webhook adapter + workers)
apps/web       Customer website (Next.js)
apps/admin     Admin Dashboard (Next.js)
apps/miniapp   Telegram Mini App (Next.js)
packages/database  Prisma schema, migrations, seed
packages/shared     Cross-app enums, permissions, zod DTOs
packages/ui         Shared shadcn-style component library
infra/               Caddy, Grafana provisioning
```

## Getting started

```bash
cp .env.example .env        # fill in real secrets before running anything but local dev
pnpm install
docker compose up -d        # postgres, redis, minio
pnpm db:migrate
pnpm db:seed
pnpm dev                    # runs every app + api in watch mode via turbo
```

Individual services:

```bash
pnpm --filter @sqlm/api dev        # http://localhost:4000
pnpm --filter @sqlm/web dev        # http://localhost:3000
pnpm --filter @sqlm/admin dev      # http://localhost:3100
pnpm --filter @sqlm/miniapp dev    # http://localhost:3200
```

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
