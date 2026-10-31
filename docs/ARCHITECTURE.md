# Architecture

## Overview

```
Browser ──► Next.js (App Router, Node runtime)
              ├─ Pages (server layout checks the session; client components fetch via /api/v1)
              ├─ /api/v1/*  route handlers ─► route() pipeline ─► services ─► PostgreSQL (Drizzle)
              │                                              └─► AI gateway ─► Anthropic API
              ├─ /sites/<deploymentId>/…   and  /s/<org>/<project>/…   (deployed site hosting)
              └─ in-process AI task runner (single instance)
```

A single Next.js application serves the UI, the versioned REST API and deployed sites. Server code lives in `src/server`. Code shared by client and server (the site model, renderer, planner and diagnostics) lives in `src/lib/site`, so the builder preview and the deploy pipeline produce **identical HTML**.

`cacheComponents` is deliberately disabled. Almost every page depends on the session, so static prerendering would gain nothing and would force a Suspense boundary around every cookie read.

## One project, one source of truth

Every project artifact is a row in `project_files`. That includes the visual builder's **design document** at `site/site.json`.

- The **builder** loads, edits and autosaves `site/site.json`.
- The **IDE** opens the same file (and any others) in Monaco.
- **AI tasks** read files and propose new contents for them.
- **Deployments** render from the saved `site/site.json` revision and record which revision they used.

Every write goes through `writeFile(projectId, path, content, baseRevision, author)`:

1. It locks the row (`SELECT … FOR UPDATE`) and compares the revision.
2. If someone saved in between, it rejects with `revision_conflict` (HTTP 409). It never merges silently.
3. Otherwise it increments the revision and appends an immutable row to `file_revisions`, attributed as `user`, `ai` (with the task id), `template`, `system` or `restore`.

That gives version history, diffs, restore (written as a new revision, so nothing is lost) and stale-patch protection, all from one mechanism. The design document is also schema-validated on every write, so an invalid file is never stored where the builder or deploy pipeline would choke on it.

## Data model

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | Accounts | Unique index on `lower(email)`; argon2id password hash |
| `sessions` | Login sessions | Primary key is **SHA-256 of the cookie token**; revocable; 30-day expiry |
| `auth_tokens` | Email verification / password reset | Hashed, single-use, expiring |
| `outbound_emails` | Mail outbox | Development transport until a mail adapter exists |
| `organizations`, `memberships` | Tenancy and roles | `memberships(org_id, user_id)` composite primary key |
| `invitations` | Org invitations | Hashed token, 7-day expiry, bound to an email address |
| `projects` | Projects | Unique `(org_id, slug)`; `spec` holds the approved plan; `production_deployment_id` points at the live deployment |
| `project_files` | Current file contents | Unique `(project_id, path)`; `revision` counter |
| `file_revisions` | Immutable history | Content snapshot per revision; `null` content records a deletion |
| `ai_tasks`, `ai_task_steps` | AI task lifecycle | Status, input, proposed result, tokens, cost, attempt/parent for retries |
| `provider_credentials` | Organization AI keys | AES-256-GCM ciphertext and a masked hint only |
| `deployments` | Builds and releases | Rendered artifact (path → HTML), source revisions, structured log |
| `form_submissions` | Published-site forms | Linked to project and deployment |
| `audit_logs` | Security audit trail | Actor, action, target, metadata, IP |

Deleting an organization cascades to its projects, files, tasks and deployments. Deleting a user nulls out authorship columns (`set null`) so history is kept.

## Authentication and sessions

- Passwords use argon2id (`@node-rs/argon2`, 19 MiB memory, 2 iterations).
- On sign-in the client receives a random 256-bit token in an `HttpOnly; SameSite=Lax` cookie (`Secure` when `APP_URL` is https). Only its SHA-256 hash is stored.
- Unknown emails still run a full argon2 verification, so response timing does not reveal which accounts exist. Wrong-password and unknown-email errors are identical.
- A password reset revokes every session. A password change revokes every session except the current one.
- Rate limits cover sign-up, sign-in (per IP and per email), reset, verification, invitations, deploys, provider operations and public form posts.

## Authorization

All checks happen on the server in `src/server/http/handler.ts`:

- `requireOrg(ctx, orgId, permission)` and `requireProject(ctx, projectId, permission)` join through `memberships`. **Non-members get 404, not 403,** so organization and project ids cannot be probed.
- Permissions are a static role → permission matrix (`src/server/authz/permissions.ts`). Editing `site/site.json` needs `design:write`; any other file needs `code:write`. Designers and editors can change the design but not code.
- AI tasks are authorized through their project (or organization, for planning). Planning briefs are visible only to the person who wrote them.
- Only owners can assign the owner role, and the last owner cannot be demoted or removed.
- Hidden buttons in the UI are a convenience. The API enforces every rule independently, and the integration tests exercise the API directly.

## Request pipeline (`route()`)

Every API handler is wrapped by `route()`, which:

1. Rejects state-changing requests (`POST/PUT/PATCH/DELETE`) whose `Origin` is missing or not the app origin (CSRF).
2. Resolves the session from the cookie header.
3. Enforces a 2 MB body limit and Zod validation (`readJson`).
4. Converts errors into the stable envelope `{ error: { code, message, details } }` (see [API.md](API.md)). Unexpected errors are logged as structured JSON, and clients see a generic message.
5. Sets `Cache-Control: no-store`.

## AI pipeline

```
request ─► createTask (budget + concurrency checks, audit) ─► runner (in-process)
   ─► gather context (design doc / project files, bounded)
   ─► built-in command? ── yes ─► proposal (no model, labelled "built-in")
   └► model call via gateway (Claude, streaming, timeout, retries, refusal handling)
        ─► extract JSON ─► Zod + semantic validation ─► up to 2 repair rounds
   ─► status awaiting_review with a diff ─► user accepts ─► transactional apply with revision checks
```

- **Provider gateway** (`src/server/ai/gateway.ts`) uses the organization's own key first, then the platform key. Without either it raises `provider_not_configured`. It never pretends a model ran.
- **Capability registry** (`catalog.ts`): providers, models, prices and task routes. The OpenAI adapter is declared but marked not implemented, and the UI says so.
- **Model**: `claude-opus-5-5` with streaming, effort set per task, and server-side refusal fallback enabled (`fallbacks: "default"`).
- **Prompt-injection posture**: file contents and briefs are wrapped in tags and declared untrusted data. The model has **no tools**: it can only return a JSON proposal, which is validated against the schema, path-checked (no traversal, no deleting the design document), and then shown to the user. Applying requires an authorized user action, and permissions are rechecked per file at apply time.
- **Bounds**: 3 concurrent tasks per user, a 180-second task timeout, at most 2 repair rounds, at most 5 retries per lineage, a 200k-character context cap, and a monthly cost ceiling per organization.
- **Cancellation** aborts the in-flight provider request through an `AbortController`. Queued tasks are cancelled directly.
- **Recovery**: on boot (`src/instrumentation.ts`), tasks left `queued` or `running` by a restart are marked failed with a clear message, and can be retried.
- **Accounting**: input/output tokens and cost in micro-USD are stored per task and summed for the usage display and the budget check.

## Hosting deployed sites

- Deployments render every page to static HTML with no JavaScript. Internal links use a base-path placeholder, so one artifact serves both `/sites/<id>/…` and `/s/<org>/<project>/…`.
- Responses carry `Content-Security-Policy: default-src 'none'; script-src 'sha256-…'; img-src https: http: data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'`. The only script allowed is the promotions runtime (`PROMO_SCRIPT` in `src/lib/promotions/model.ts`), pinned by its hash, so even content that slipped past escaping could not run scripts. Promotions are injected at serve time from the `promotions` table (like the chat launcher), so they go live, pause and end without a redeploy; stats arrive as an image ping to `<site>/__promo`.
- Preview deployments require a signed-in member of the owning organization. The production deployment is public.
- Forms post to `/api/v1/sites/<deploymentId>/forms/<formId>`. Only `contact` and `booking` exist, only allowlisted fields are kept, values are length-capped, a honeypot field drops bots, and posts are rate-limited per IP.

## Builder canvas isolation

The canvas is the real renderer's HTML in an `<iframe sandbox="allow-scripts">` **without** `allow-same-origin`. Its small bridge script can only `postMessage` to the parent: section clicks and a ready signal. The parent accepts a message only when `event.source` is that iframe. Edits are sent as patches (new CSS and `<main>` markup) rather than reloading the frame.

## Security boundaries

| Boundary | Control |
| --- | --- |
| Browser ↔ API | Session cookie (HttpOnly, SameSite=Lax), Origin check on mutations, Zod validation, body limits, rate limits |
| Tenant ↔ tenant | Every project/org/task query joins through `memberships`; 404 for non-members; tested in `tests/integration` and `e2e` |
| Role ↔ action | Server-side permission matrix with design/code split |
| User content ↔ HTML | Renderer escapes all text; URL allowlist (http, https, mailto, tel, `#`, `/`); no scripts in published output except the hash-pinned promotions runtime; strict CSP |
| Model ↔ project | Model output is data only: schema-validated, path-validated, shown as a diff, applied only by an authorized user, with revision checks |
| Secrets ↔ everything | Provider keys verified before saving, stored AES-256-GCM encrypted (versioned envelope for rotation), never returned to the browser, never placed in prompts or logs |
| Platform ↔ user code | No user code is executed. There is no terminal or build of user code (see limitations) |

## Production readiness

Not yet production-ready. Before launch:

- [ ] Replace the in-memory rate limiter with a shared store (Redis is available locally) and move the AI runner to a durable queue, so the app can run on more than one instance.
- [ ] Connect a mail provider adapter and turn off the outbox transport.
- [ ] Add MFA and OAuth sign-in.
- [ ] Decide on retention for `file_revisions`, `audit_logs`, `form_submissions` and `ai_tasks`, then add data export and account deletion flows.
- [ ] Self-host Monaco instead of loading it from jsDelivr, then remove `'unsafe-eval'` and the CDN from the app CSP.
- [ ] Set up backups and point-in-time recovery for PostgreSQL, plus a restore drill.
- [ ] Add dependency scanning in CI.
- [ ] Have an independent security review and a privacy review (for example under India's DPDP Act) before handling real customer data.
