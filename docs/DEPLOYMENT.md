# Deployment

Production topology, the deploy procedure, and how to get back when a
release goes wrong. Architecture lives in `ARCHITECTURE.md`; build status
in `docs/PHASES.md`.

## Topology

`docker-compose.prod.yml` runs:

| Service | Role |
|---|---|
| `caddy` | TLS termination + reverse proxy, one vhost per app |
| `api` | REST API + Telegram webhook receiver (stateless, scalable) |
| `worker` | BullMQ consumers: delivery, notifications, cleanup (stateless, scalable) |
| `miniapp` / `admin` / `web` | Next.js standalone servers |
| `migrate` | Runs `prisma migrate deploy` once, then exits |
| `postgres` / `redis` | State |

`api` and `worker` run the **same image** with different commands, so the
two tiers can never disagree about dependencies or the Prisma client.

Scale the stateless tiers independently:

```bash
docker compose -f docker-compose.prod.yml up -d --scale api=3 --scale worker=2
```

Caddy load-balances across every container answering to a service name, so
scaling needs no proxy change.

## Configuration

Every secret comes from the environment. `docker-compose.prod.yml` uses
`${VAR:?message}` for anything that must not have a default, so a missing
secret fails the deploy instead of silently starting with a placeholder.
See `.env.example` for the full list.

Two things to know:

- **`PUBLIC_API_URL` is a build argument, not a runtime variable.** Next.js
  inlines `NEXT_PUBLIC_*` at build time, so pointing a frontend at a
  different API needs a rebuild, not a restart.
- **`CORS_ORIGINS` is mandatory in production.** The API refuses to boot
  without it rather than fall back to reflecting any origin, which with
  credentials enabled would let any site drive the API as a logged-in user.

## Deploying

```bash
# 1. Bring up the new release. `migrate` runs first and everything else
#    waits for it to exit successfully, so no container ever serves
#    traffic against an unmigrated schema.
docker compose -f docker-compose.prod.yml up -d --build

# 2. Confirm readiness (checks Postgres and Redis, not just liveness).
curl -fsS https://$API_DOMAIN/api/health/ready

# 3. Confirm the workers are consuming.
curl -fsS -H "Authorization: Bearer $STAFF_TOKEN" https://$API_DOMAIN/api/v1/admin/queues
```

`HEALTHCHECK` in each image probes the same endpoint the orchestrator does,
so `docker compose ps` shows `unhealthy` for a container that is running
but cannot reach its dependencies.

## Rollback

Roll back the **application**, then decide about the schema — in that order.

```bash
# Application: redeploy the previous image tag.
docker compose -f docker-compose.prod.yml up -d --no-deps \
  --scale api=3 api worker
```

Migrations are the asymmetric part. Prisma has no `migrate down`, so:

- **Write migrations to be backward-compatible with the previous release**
  (add columns nullable or with defaults, never rename or drop in the same
  release that stops using them). Then rolling back the app is safe on its
  own and needs no database action — this is the normal path.
- A destructive change must be split across two releases: release N stops
  writing the column, release N+1 drops it. Between them, rollback is free.
- If a migration must genuinely be undone, restore from the pre-deploy
  backup. Take one before every deploy that includes a migration:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backup-$(date +%F-%H%M).sql.gz"
```

In-flight queue jobs survive a rollback — they live in Redis, not in the
container — and delivery is idempotent, so a job that was mid-flight when
the app restarted re-runs without issuing an inventory item twice.

## Telegram webhook

`TELEGRAM_WEBHOOK_URL` must be publicly reachable over HTTPS; the bot
registers it on boot. It points at `/api/v1/telegram/webhook/<secret>`,
where the secret matches `TELEGRAM_WEBHOOK_SECRET` and is verified in
constant time along with Telegram's own `X-Telegram-Bot-Api-Secret-Token`
header.

## What CI verifies

`.github/workflows/ci.yml` runs typecheck, lint, unit tests, and the e2e
suite against live Postgres/Redis/LocalStack service containers, then
builds all four production images and boots the API image against
throwaway Postgres and Redis, failing unless `/api/health/ready` reports
both dependencies up.

CI does **not** deploy. Wiring the deploy step depends on where this runs
(registry credentials, host access) and is deliberately left to whoever
operates it.
