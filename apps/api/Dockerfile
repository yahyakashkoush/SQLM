# syntax=docker/dockerfile:1
#
# Serves both the API tier and the worker tier — same image, different
# command (see docker-compose.prod.yml), so the two can never drift apart
# on dependencies or Prisma client version.

FROM node:22-bookworm AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# ---- deps: full install, cached on lockfile changes only ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /repo/ /repo/
COPY . .
RUN pnpm --filter @sqlm/database exec prisma generate \
 && pnpm --filter @sqlm/shared build \
 && pnpm --filter @sqlm/api build \
 # Frontend workspaces are not part of this image.
 && rm -rf apps/web apps/admin apps/miniapp packages/ui .git

# Dev dependencies are deliberately kept: `pnpm --prod` re-links the whole
# store (pnpm's node_modules is a symlink farm, so the tree has to move as
# one piece) and takes the generated Prisma client and the prisma CLI with
# it — and the migrate service in docker-compose.prod.yml runs
# `prisma migrate deploy` from this same image.

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
# Prisma's own probe misidentifies this image's OpenSSL (see the schema's
# binaryTargets comment); point it at the engine that was generated.
ENV PRISMA_QUERY_ENGINE_LIBRARY=/repo/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node
RUN groupadd -r sqlm && useradd -r -m -g sqlm sqlm

COPY --from=build --chown=sqlm:sqlm /repo /repo

USER sqlm
EXPOSE 4000

# Probes the same readiness endpoint the orchestrator uses, so a container
# that can't reach Postgres or Redis is reported unhealthy rather than
# silently accepting traffic it can't serve. Uses node rather than curl:
# the runtime already has it, and it keeps the image one package smaller.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]
