# syntax=docker/dockerfile:1
# Multi-stage build for the web app and worker. No secrets are baked into images.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @projectos/web build

FROM base AS web
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 3000
# Applies pending migrations, then serves. Seeding is a separate, explicit step (pnpm db:seed).
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @projectos/web start"]

FROM base AS worker
ENV NODE_ENV=production
COPY --from=deps /app/node_modules /app/node_modules
COPY . .
USER node
CMD ["pnpm", "--filter", "@projectos/worker", "start"]
