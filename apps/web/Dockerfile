# syntax=docker/dockerfile:1
#
# Next.js standalone output: the runtime stage carries only the traced
# server bundle plus static assets, not the full node_modules tree.
#
# NEXT_PUBLIC_* values are inlined at build time, so the API URL is a build
# arg — a deployment pointing at a different API needs a rebuild, not just
# a restart.

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/ /repo/
COPY . .
RUN pnpm --filter @sqlm/shared build \
 && pnpm --filter @sqlm/ui build \
 && pnpm --filter @sqlm/web build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
RUN groupadd -r sqlm && useradd -r -m -g sqlm sqlm

COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

USER sqlm
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/web/server.js"]
