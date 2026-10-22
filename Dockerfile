# syntax=docker/dockerfile:1
# Phase 8 release images: web (Next.js standalone), worker and migrate (esbuild bundles). No secrets are baked in;
# configuration comes from the environment (Secrets Manager in the Terraform plan). Images run as the non-root `node` user.
# Build:  docker build --target web --build-arg APP_VERSION=0.3.0-rc.1 --build-arg GIT_SHA=$(git rev-parse HEAD) -t projectos-web .
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# Every workspace manifest must be listed here — `pnpm check:dockerfile` (CI) fails if one is missing.
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/compliance/package.json packages/compliance/
COPY packages/core/package.json packages/core/
COPY packages/credentialing/package.json packages/credentialing/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/notifications/package.json packages/notifications/
COPY packages/rcm/package.json packages/rcm/
COPY packages/reports/package.json packages/reports/
COPY packages/scheduling/package.json packages/scheduling/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN NEXT_OUTPUT_STANDALONE=1 pnpm --filter @projectos/web build && node scripts/build/bundle-node.mjs

# ---- runtime images: only build output, no pnpm, no dev dependencies, no source ----
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA} BUILD_TIME=${BUILD_TIME}
WORKDIR /app
# Amazon RDS CA bundle so DB connections can use sslmode=verify-full (see packages/db/src/env.ts). Harmless locally.
ADD --chown=node:node https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem
USER node

FROM runtime AS web
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are NOT run here: they are a separate release step (target `migrate`), run once before rollout.
CMD ["node", "apps/web/server.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /app/dist/worker ./worker
CMD ["node", "--enable-source-maps", "worker/index.mjs"]

FROM runtime AS migrate
COPY --from=build --chown=node:node /app/dist/migrate ./migrate
CMD ["node", "--enable-source-maps", "migrate/index.mjs"]
