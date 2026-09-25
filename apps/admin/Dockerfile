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
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/admin/node_modules ./apps/admin/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /repo/packages/ui/node_modules ./packages/ui/node_modules
COPY . .
RUN pnpm --filter @sqlm/shared build \
 && pnpm --filter @sqlm/ui build \
 && pnpm --filter @sqlm/miniapp build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3100
RUN groupadd -r sqlm && useradd -r -m -g sqlm sqlm

COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /repo/apps/admin/public ./apps/admin/public

USER sqlm
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/admin/server.js"]
