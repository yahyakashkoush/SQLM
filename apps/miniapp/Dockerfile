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
COPY apps/miniapp/package.json apps/miniapp/
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
 && pnpm --filter @sqlm/miniapp build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3200
RUN groupadd -r sqlm && useradd -r -m -g sqlm sqlm

COPY --from=build /repo/apps/miniapp/.next/standalone ./
COPY --from=build /repo/apps/miniapp/.next/static ./apps/miniapp/.next/static
COPY --from=build /repo/apps/miniapp/public ./apps/miniapp/public

USER sqlm
EXPOSE 3200
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3200/shop').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/miniapp/server.js"]
