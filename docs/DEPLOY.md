# Deploying Cloudesk

One container image runs every role. Postgres holds all state (sessions, uploads, settings, jobs), so web servers are stateless and scale horizontally.

## 1. Environment

Store these in your platform's secret manager — never in the repository.

| Variable | Needed | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres 15+ (managed, with point-in-time recovery). Don't put a transaction-mode pooler (PgBouncer, RDS Proxy) in front: chat and documents use LISTEN/NOTIFY, which needs real sessions. Size `DB_POOL_MAX` × servers (+2 LISTEN clients each) under the database's `max_connections` instead. |
| `DATABASE_SSL_CA` | on AWS/any managed DB | Path to the database's CA bundle; the image ships Amazon's at `/app/certs/rds-global-bundle.pem`. (`DATABASE_SSL=no-verify` encrypts without verifying — last resort.) |
| `DB_POOL_MAX` | no | Connections per server (default 10). |
| `TRUST_PROXY` | behind a load balancer | `xff-last` behind AWS ALB (it appends to `X-Forwarded-For`); the default `xff-first` is only right when the proxy overwrites the header (`deploy/Caddyfile` does). |
| `APP_URL` | yes | `https://app.yourdomain.com` |
| `APP_ENCRYPTION_KEY` | yes | `openssl rand -base64 32`. Never change it once data exists. |
| `NODE_ENV` | yes | `production` |
| `MAIL_FROM` + one of `RESEND_API_KEY`, `POSTMARK_SERVER_TOKEN`, `SENDGRID_API_KEY`, `SMTP_*` | yes | Email delivery (verification, resets, notifications). |
| `STRIPE_*` or `RAZORPAY_*` | to charge | Billing; limits apply only once it's configured. Webhooks: `/api/v1/billing/webhooks/stripe` or `/razorpay`. |
| `CUSTOM_DOMAIN_CNAME` / `CUSTOM_DOMAIN_IPV4` | for customer domains | The DNS target customers use. |
| `APP_ROLE` | on web-only nodes | `web` turns off the job worker and every scheduler on that node. |
| `RATE_LIMIT_STORE` | no | Production counts rate limits in Postgres (shared by all servers). `memory` makes them per server. |
| `GITHUB_CLIENT_ID/SECRET`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `EXEC_DOCKER` | optional | GitHub sign-in, AI, semantic search, code containers. |

Admin → Integrations shows which are set (never their values), has a step-by-step guide for each, and can test them live. Email, billing (Stripe/Razorpay), GitHub sign-in, AI and Voyage keys can also be **saved from the console** instead of the environment: they're encrypted with `APP_ENCRYPTION_KEY`, never shown again, reach every server within 30 seconds, and an environment variable of the same name always wins.

**The proxy must overwrite `X-Forwarded-For`** with the real client address (not append to it). Rate limits and the admin IP allowlist read the first address in that header; `deploy/Caddyfile` does this correctly.

## 2. First release

```sh
docker build -f deploy/Dockerfile -t cloudesk .
docker run --env-file .env.production cloudesk node scripts/migrate.mjs   # once per release
```

Then start web servers (`APP_ROLE=web`) and **exactly one** worker (no `APP_ROLE`; several of its schedulers are not safe to run twice). Make the first platform owner:

```sql
update users set is_platform_admin = true where email = 'you@yourdomain.com';
```

Open `/admin` → **Go-live** and work through the checklist. Turn on two-step sign-in for yourself, then require it for admins (Admin → Settings → Admin security).

## 3. Shapes

- **TLS and customer domains:** `deploy/Caddyfile` — HTTPS for the app and on-demand certificates for customer domains, approved by `/api/v1/domains/ask` (verified domains with a live site only).
- **One host:** `deploy/docker-compose.yml` — Postgres, migrate, `web` (scale with `--scale web=3`), `worker`. Put Caddy or Nginx with TLS in front.
- **Kubernetes:** `deploy/kubernetes.yaml` — a migration Job, an autoscaled web Deployment (3–20 pods), a worker Deployment and a Service. Add an Ingress with TLS for the app host and on-demand certificates for customer domains.
- **AWS (ECS Fargate):** `deploy/aws/` — task definitions for web, worker and migrate (secrets from Secrets Manager, logs to CloudWatch), a Caddy edge for customer domains behind an NLB, and `.github/workflows/deploy-aws.yml` (build → ECR → migrate task → roll web, then worker). The ALB health check is `/api/v1/health`; the container health check is `/api/v1/health/live`.
- **Any container platform** (Cloud Run, Fly, Render, Railway): one web service with `APP_ROLE=web` and a health check on `/api/v1/health`, one worker service, a release command for migrations.

## 4. Upgrades

1. Build the new image.
2. Run migrations (a one-off task). Keep each migration compatible with the version still running — add first, remove in a later release.
3. Roll web servers; then the worker.

## 5. Operating

- **Health:** `GET /api/v1/health` is readiness (checks the database; 200 / 503) — use it for the load balancer. `GET /api/v1/health/live` is liveness (the process answers) — use it for container restarts, so a database blip never restarts every server. Admin → Health shows database latency, connections, migrations, job backlog, failing deployments, domains, emails and sign-ins.
- **Shutdown:** on SIGTERM the worker stops claiming jobs and `next start` finishes in-flight requests; give containers a 60 s (web) / 120 s (worker) stop timeout.
- **Maintenance:** Admin → Notices → Maintenance mode makes workspaces read-only with your message; published sites keep serving.
- **Backups:** rely on the managed database's point-in-time recovery, and do a restore drill into a scratch database before launch (Go-live tracks it).
- **Logs:** JSON lines on stdout; ship them to your log store and alert on 5xx rate and job backlog.

## What production does at start-up

- Refuses to start without `DATABASE_URL`, `APP_URL` and an `APP_ENCRYPTION_KEY` of at least 32 characters; warns if `APP_URL` isn't https.
- Every server loads console-saved integration settings (refreshing every 30 s) and writes request metrics once a minute (Admin → Scalability).
- Worker nodes take an hourly snapshot of database and table sizes (growth trends and projections), keep request metrics for 14 days, and prune expired rate-limit counters.
- Security headers: CSP, HSTS (two years, when `APP_URL` is https), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy; no X-Powered-By.

## Known limits when running many servers

- An AI task runs on the server that started it; cancelling works only there. The worker fails tasks nobody has touched for `AI_TASK_STALE_MIN` minutes (default 20), at start and every 5 minutes.
- The firewall's per-IP rate limit and strikes are per server; API rate limits are shared through the database. Put AWS WAF (or the load balancer's rate rules) in front for fleet-wide limits.
- Uploaded media is stored in Postgres; size database storage and backups for it.
- Platform settings and release flags are cached per server for up to 10 and 30 seconds respectively, so a change reaches other servers within that time.
