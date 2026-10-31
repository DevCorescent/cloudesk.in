# REST API (v1)

All endpoints live under `/api/v1`. Requests and responses are JSON. Authentication is the `cc_session` cookie set by sign-up or sign-in.

## Conventions

- **CSRF**: `POST`, `PUT`, `PATCH` and `DELETE` must send an `Origin` header equal to the app origin; otherwise the response is `403 forbidden`.
- **Body limit**: 2 MB per request; files are limited to 1 MB each.
- **Caching**: every API response is `Cache-Control: no-store`.
- **Tenancy**: resources outside your organizations return `404`, never `403`.
- **Concurrency**: file writes send `baseRevision`. If the file changed since then, the response is `409 revision_conflict`.

### Error envelope

```json
{ "error": { "code": "revision_conflict", "message": "This file changed since you opened it…", "details": { "currentRevision": 4 } } }
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_request` | 400 | Malformed request |
| `unauthenticated` | 401 | No valid session, or wrong credentials |
| `forbidden` | 403 | Role lacks permission, or the cross-origin check failed |
| `not_found` | 404 | Missing, or not visible to you |
| `conflict` | 409 | State does not allow the action |
| `revision_conflict` | 409 | Stale `baseRevision` |
| `payload_too_large` | 413 | Body or file too large |
| `validation_failed` | 422 | `details` maps field → messages, or holds `{ problems: [...] }` for the design document |
| `provider_not_configured` | 424 | The action needs an AI provider that is not connected |
| `rate_limited` | 429 | `Retry-After` header is set |
| `provider_error` | 502 | The AI provider failed or its output did not validate |
| `internal_error` | 500 | Unexpected error (logged server-side) |

## Auth

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/auth/signup` | `{ name, email, password, orgName? }` | Creates the user and an organization, sends verification, sets the cookie |
| POST | `/auth/login` | `{ email, password }` | Sets the cookie |
| POST | `/auth/logout` | – | Revokes the session |
| GET | `/auth/me` | – | `{ user, organizations[] }` |
| POST | `/auth/verify-email` | `{ token }` | Single use |
| POST | `/auth/resend-verification` | – | |
| POST | `/auth/forgot-password` | `{ email }` | Always `200` |
| POST | `/auth/reset-password` | `{ token, password }` | Revokes all sessions |
| PATCH | `/auth/password` | `{ currentPassword, newPassword }` | Revokes other sessions |
| GET | `/auth/sessions` | – | Active sessions (short reference ids) |
| DELETE | `/auth/sessions` | `{ id }` or `{ others: true }` | |
| GET | `/auth/outbox` | – | Emails recorded for your address (development mail transport) |

## Organizations

| Method | Path | Permission |
| --- | --- | --- |
| GET / POST | `/orgs` | member / any user |
| GET | `/orgs/:orgId/members` | `org:read` |
| PATCH / DELETE | `/orgs/:orgId/members/:userId` | `members:manage` (anyone may remove themselves) |
| GET / POST | `/orgs/:orgId/invitations` | `members:manage` |
| DELETE | `/orgs/:orgId/invitations/:id` | `members:manage` |
| POST | `/invitations/preview` | public: `{ token }` → org, email, role |
| POST | `/invitations/accept` | signed in as the invited email |
| GET | `/orgs/:orgId/audit?before=ISO` | `audit:read` (50 per page) |
| GET | `/orgs/:orgId/usage` | `org:read`: monthly AI cost, tasks, tokens, budget |
| GET | `/orgs/:orgId/providers` | `org:read`: providers, models, routes, masked credential status |
| PUT / DELETE | `/orgs/:orgId/providers/:provider` | `secrets:manage`; PUT `{ apiKey }` verifies the key with the provider before storing it |
| POST | `/orgs/:orgId/providers/:provider/test` | `secrets:manage` |

## Projects and files

| Method | Path | Permission | Body / query |
| --- | --- | --- | --- |
| GET | `/orgs/:orgId/projects` | `project:read` | `?q=&limit=&offset=` → `{ items, total }` |
| POST | `/orgs/:orgId/projects` | `project:create` | `{ templateId, name? }` or `{ spec, planTaskId? }` |
| POST | `/orgs/:orgId/plan` | `project:create` | `{ brief, name?, answers? }` → `202 { task }` |
| GET / PATCH / DELETE | `/projects/:id` | read / update / delete | DELETE archives the project |
| GET | `/projects/:id/files` | read | `{ files: [{ path, revision }] }` |
| POST | `/projects/:id/files` | design/code write | `{ path, content }` |
| GET / PUT / DELETE | `/projects/:id/file?path=` | read / write | PUT `{ content, baseRevision }`, DELETE `{ baseRevision }` |
| POST | `/projects/:id/file/rename` | `code:write` | `{ from, to, baseRevision }` |
| GET | `/projects/:id/file/history?path=` | read | |
| GET | `/projects/:id/file/revision?path=&revision=` | read | |
| POST | `/projects/:id/file/restore` | write | `{ path, revision, baseRevision }` |
| GET | `/projects/:id/search?q=` | read | Case-insensitive, at most 500 matches |
| GET | `/projects/:id/activity` | read | Recent revisions and AI tasks |
| GET | `/projects/:id/submissions` | `submissions:read` | |

## AI tasks

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/projects/:id/ai/tasks` | read | |
| POST | `/projects/:id/ai/tasks` | `ai:use` (site_edit) / `code:write` (code_edit) | `{ kind: "site_edit", input: { instruction, pageId?, sectionId? } }` or `{ kind: "code_edit", input: { instruction, paths? } }` → `202` |
| GET | `/ai/tasks/:taskId` | read | Status, steps, proposed changes with before/after, tokens, cost |
| POST | `/ai/tasks/:taskId/cancel` | `ai:use` | Queued or running only |
| POST | `/ai/tasks/:taskId/retry` | `ai:use` | Failed or cancelled; creates a new attempt linked by `parentTaskId` |
| POST | `/ai/tasks/:taskId/apply` | `ai:use` + write permission for each file | All-or-nothing; `409 revision_conflict` if any file changed |
| POST | `/ai/tasks/:taskId/reject` | `ai:use` | |

Task status: `queued → running → awaiting_review → succeeded` (applied), or `failed` / `cancelled`. Planning tasks finish as `succeeded` with `result.spec`.

## Deployments and hosting

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/projects/:id/deployments` | read: history, current production id, adapters |
| POST | `/projects/:id/deployments` | `{ environment: "preview" }` needs `deploy:preview`; `"production"` needs `deploy:production` |
| GET | `/projects/:id/deployments/:deploymentId` | read: structured log |
| POST | `/projects/:id/deployments/:deploymentId/promote` | `deploy:production` (rollback) |
| POST | `/sites/:deploymentId/forms/:formId` | public; `application/x-www-form-urlencoded`; redirects back with `?submitted=1` |
| GET | `/sites/:deploymentId/…` (no `/api` prefix) | preview: members only; production: public |
| GET | `/s/:orgSlug/:projectSlug/…` (no `/api` prefix) | current production deployment |

## Other

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `200 {status:"ok"}`, or `503` when the database is unreachable |
| GET | `/templates` | Template catalog |

An OpenAPI document is not generated yet; this file is the reference.
