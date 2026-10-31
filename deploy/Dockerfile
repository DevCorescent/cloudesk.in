# Cloudesk app image. One image runs every role:
#   web     — `npm start` with APP_ROLE=web (no worker, no schedulers); scale horizontally behind a load balancer
#   worker  — `npm start` with APP_ROLE unset: exactly ONE replica (several schedulers are not claim-safe)
#   migrate — `node scripts/migrate.mjs`, run once per release before new web tasks take traffic
# Build from the repository root:  docker build -f deploy/Dockerfile -t cloudesk .
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# A failed build must fail the image. The prune keeps only production dependencies
# (the migrate script is plain JS, so it needs nothing from devDependencies);
# the build cache is not shipped.
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts && rm -rf .next/cache

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Amazon RDS certificate bundle, so DATABASE_SSL_CA=/app/certs/rds-global-bundle.pem verifies the database's certificate.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && mkdir -p /app/certs \
  && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds-global-bundle.pem \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3000
# Liveness only (the process answers). Readiness, which also checks the database, is GET /api/v1/health — use that for the load balancer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `next start` handles SIGTERM; src/instrumentation.ts stops the schedulers and the job worker on it.
STOPSIGNAL SIGTERM
CMD ["npm", "start"]
