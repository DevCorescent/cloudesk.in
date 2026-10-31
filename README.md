# Cloudesk

Describe a website in plain language, review a structured plan, shape it in a visual builder, open the same project in a browser IDE, and publish it with validated, link-checked deployments.

This repository holds the **first vertical slice** of the platform described in the master build specification. Everything listed as available works end to end against a real PostgreSQL database and is covered by automated tests. Larger modules from the spec (e-commerce, chatbots, workflows, code execution sandboxes, billing and so on) are **not built yet**. They are listed honestly in [docs/CHECKLIST.md](docs/CHECKLIST.md) and on the in-app Roadmap page.

## Marketing site

The public site lives in `src/app/(marketing)`: the landing page at `/`, `/features`, and a page per feature at `/features/<slug>`. Copy and feature data are in `src/components/marketing/features.tsx`; the animated illustrations are CSS/SVG in `scenes.tsx`.

## What works today

| Area | Status |
| --- | --- |
| Sign-in & onboarding | Split-screen sign-in and sign-up with a soft pastel showcase. New accounts get a needs-discovery onboarding (`/welcome`): describe the business in your own words and see what was understood (with the words it came from), where customers buy (online, in a shop, both, or not selling), what it should do (bookings, POS, subscriptions…), what you already have (product list, logo, your domain), then a personal plan with pages, features and a time estimate. The launch opens pre-filled. Internal software is marked Coming soon |
| Dashboard tour & checklist | Each project's overview opens with the live site, a setup checklist worked out from real data (and what you asked for), shortcuts, and a spotlight tour of how to run your store or site — shown after launch, replayable any time |
| Five-minute launch | Home → “Launch a store or website in 5 minutes” (`/launch`). Store or website, brand, product spreadsheet, look (live previews with your products and logo colours), payments (COD/UPI), your address (free, or connect your own domain — the exact DNS records are shown with a live check), then one click streams real progress and ends with the live link |
| Smart product import | Any Excel/CSV, in the browser: header row and sheet detection, column matching by name or values (MRP, selling price, “Qty”, sizes, colours, Google Drive links…), variant grouping, photo-link checks, and a review that highlights required (red) and suggested (amber) fields per product. Also in Online store → Products → Import |
| Accounts | Email/password and GitHub sign-in, two-step sign-in (authenticator app + recovery codes, orgs can require it), email verification, password reset, session list and revocation |
| Organizations | Multiple organizations per user, invitations by email (7-day expiry, bound to the invited address), 7 roles enforced on the server |
| Planning | Plain-language brief → structured spec (pages, sections, data, integrations, questions, assumptions). Uses Claude if connected, otherwise a clearly labelled rule-based planner |
| Design engine | 11 design directions (including an Apple-style frosted Glass look), 34 contrast-checked palettes, 13 font pairings (16 web fonts), 20 section types with 2–5 layout variants each, 40 icons, decorative backgrounds, CSS-only scroll motion, a curated placeholder photo library, and 15 one-click design actions. Works offline; Claude uses the same catalogue |
| Editor | Icon rail (Add, Layers, Pages, Media, Style, Review), section gallery with live thumbnails, floating section toolbar, variations compare, per-device spacing/alignment/text overrides, AI command bar, keyboard shortcuts, phone layout with bottom tabs. Click any text on the canvas to style it on its own; double-click to type in place |
| Advanced design | Design tab → Advanced design: colour/gradient/image/video backgrounds with tint and blur, per-section colours and fonts, heading size/weight/spacing, exact padding (plus phone values), width, minimum height, card style, corners, borders, shape dividers, anchors and scoped custom CSS. Style → Interface: header behaviour, container width, base size, section spacing, buttons |
| Extra sections | Video, embed (allowlisted hosts), tabs, timeline, comparison table, scrolling text, social links, spacer, and a custom form builder (inbox + optional data table + team email + automations) |
| Media & brand | Image uploads (type checked from bytes, no SVG, 5 MB, de-duplicated) with in-browser crop; stock library; brand import from a website (SSRF-safe) or from a logo's colours |
| Content | Blog (posts, journal page, post list section, Markdown articles), products with payment links, Google map embeds, multilingual sites (language copies, switcher, hreflang, AI translation) |
| Review & analytics | Rule-based design review with one-click fixes; anonymous production analytics (no cookies or IPs); A/B tests on section layouts with conversion attribution and significance |
| Templates | 26 templates across 17 categories (health, law, accounting, photography, weddings, hotels, travel, jewellery, fashion, architecture, music, automotive, home services, pet care, nonprofits, app launches and more), with search, category filters and a choice of 11 design directions before creating |
| Website builder | Canvas rendered by the real renderer in a sandboxed iframe, layers with drag-and-drop, insert library (13 section types), per-section content/layout/responsive controls, pages, theme, SEO/accessibility checks, undo/redo, autosave, conflict detection, version history and restore, desktop/tablet/mobile viewports |
| AI IDE | File explorer, Monaco editor, tabs, save with revision checks, conflict diff, rename/move/delete, project search, problems panel, file history; live co-editing with everyone's cursors |
| Terminal | IDE → Terminal. `ls`, `cat`, `grep`, `wc`, `validate`, `run <file.js>` and `js <code>` in a QuickJS WebAssembly sandbox (3 s, 64 MB, no network); script writes become file revisions. `python`/`node` run in Docker only with `EXEC_DOCKER=on` |
| Data & API | Project → Data. Typed tables with links, filters, CSV import/export; generated REST API with OpenAPI, API-key scopes, optional public read/insert, and an API console; "Data list" section shows live rows on the site |
| Chatbot | Project → Chatbot. Answers visitors from your pages, products, policies and notes (Claude with citations, or best passages without AI); /chat page and floating button; hand-over to email; conversations inbox |
| Automations | Project → Automations. Triggers (forms, orders, bookings, schedule, webhook) and steps (email, HTTP, Slack, delay, condition) run as retried jobs |
| Integrations | Project → Integrations. Slack, Discord, Telegram, Mailchimp, outgoing signed webhooks, API keys, public API, apps and a JS SDK (`packages/sdk`) |
| Billing | Settings → Billing. Free/Pro/Business plans through Stripe or Razorpay with enforced limits |
| AI changes | Design and code changes are *proposed* as diffs. Nothing is written until the user accepts. Stale proposals are refused, and tasks can be cancelled or retried |
| Deployments | Validate → render every page → verify links → mark ready. Previews are visible to members only, production is public at `/s/<org>/<project>`, and older deployments can be promoted back (rollback) |
| Forms | Contact and booking forms on published sites store submissions (honeypot, rate limit, field allowlist); the inbox is on the project page |
| Online store | Project → Online store. Setup wizard with 9 business templates; products with variants, inventory, collections, cart and checkout on the published site; orders (pack, ship with tracking, deliver, cancel, refund, GST invoice); discounts, shipping zones, taxes, customers, abandoned carts, reviews and a sales dashboard. Payments: Razorpay, Stripe and PayPal hosted checkout (verified server-side, signed webhooks), cash on delivery and UPI/bank transfer. Also: gift cards, customer returns, "My orders" email links, low-stock alerts, bulk order tools and packing slips, Shiprocket (India), EasyPost and Shippo labels, multi-currency prices, product subscriptions, a live payment test with your own test keys, sitemaps and a Google product feed |
| Invoicing | **Finance** in the sidebar (standalone books for any business — no website or store needed, several sets of books per workspace), and Project → Invoices & quotes. GST tax invoices, quotations (clients accept online), proforma invoices and credit notes; clients and saved items; payments, part-payments and PAID status; recurring invoices and automatic reminders; numbering per financial year. Eight professional templates and a studio to change every detail — or upload your current invoice and have it matched (AI reads it when a provider is connected). Share by link, QR, email, WhatsApp, SMS or PDF; reports for sales, collections, ageing, quote win rate and GST, with CSV exports |
| Point of sale | Online store → Point of sale. A full-screen till for your shop: scan barcodes or product QR codes with a USB/Bluetooth scanner or the camera, take cash (with change), UPI (pay-by-QR) or card, print an 80 mm GST receipt, and see the day's totals. Sales update stock and appear in Orders. Online store → Labels & barcodes creates in-store EAN-13 codes and prints price labels with barcode and QR |
| Growth | Project → Growth. Test suggestions and store quick wins from live data; A/B tests on button wording, layouts and (with an AI key) headlines; winners applied automatically if enabled; estimated monthly impact |
| Brand | Project → Brand. Lock colours, fonts and logo for everyone (enforced on save); voice, words to avoid and preferred terms for AI writing; brand check |
| Bookings | Online store → Bookings. Services, opening hours, time zones, capacity for classes, online payment or pay-at-visit, reminders, calendar files; customers book at /book |
| Custom domains | Deployments → Custom domains. TXT + CNAME verification; store and checkout work on the domain. TLS needs an edge proxy (see .env.example) |
| WhatsApp | Online store → WhatsApp. Click-to-chat on product and order pages; Cloud API order updates and cart reminders with approved templates |
| GST (India) | Invoices with GSTINs, HSN, CGST/SGST/IGST and invoice numbers per financial year; buyer GSTIN at checkout; monthly GST summary with CSVs (Online store → Taxes) |
| Digital products & memberships | Sell files (private, limited downloads) and memberships; mark pages “Members only” in the builder; manage members in Online store → Members |
| Motion | Inspector → Design → Motion. Entrance (fade, rise, zoom, slide, blur), stagger, hover (lift, glow, scale) and parallax per section; CSS only, off for visitors who prefer reduced motion |
| Collaboration | Builder: avatars show who is editing which section; saved edits sync within ~5 s; IDE files are co-edited live; comments with @mentions (emailed) and resolve; More → Share for review creates a no-login client link with comments and approve / request changes |
| Branches | Builder → More → Branches. Edit a copy of the design, preview-deploy it (never promotable), update it from main, and merge it back; only parts changed on both sides need a decision. AI edits and version history work on main |
| Free-form sections | Add → Free-form. Drag, resize (or use the keyboard) text, images, buttons and shapes on a 12-column grid with layering; phones stack in reading order or use a custom 4-column layout; multi-select, marquee, groups, locking, align and distribute. Any section can become a global component shared across pages |
| Business kit | Project overview → “Turn this site into a whole business”: store, bookings and launch kit from your plan |
| App design | Apple-inspired glass interface: translucent surfaces over soft ambient light, frosted bars, menus and dialogs, SF system type, light and dark |
| AI providers | Anthropic key connection (verified before saving, AES-256-GCM at rest), model catalog, task routing, per-task token/cost tracking, monthly per-organization budget |
| Audit | Security-relevant actions are recorded and viewable by owners and admins |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 16 · Drizzle ORM · Zod · TanStack Query · Monaco · Anthropic SDK · Vitest · Playwright.

## Local development

Requirements: Node 22+ (developed on Node 26) and PostgreSQL 14+.

```bash
npm install
cp .env.example .env.local          # then fill in the values (see below)
createdb creation_cloud_dev
createdb creation_cloud_test
createdb creation_cloud_e2e
npm run db:migrate                  # dev database
npm run db:migrate:test             # test database
npm run dev                         # http://localhost:3000
```

Generate `APP_ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

No email provider is connected yet. Verification, reset and invitation emails are recorded and shown to the recipient under **Settings → Developer**.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection for the app |
| `APP_URL` | yes | Public origin. Mutating API requests must come from this origin (CSRF defence). Setting an `https://` origin also marks cookies `Secure` |
| `APP_ENCRYPTION_KEY` | yes | 32 random bytes, base64. Encrypts provider credentials |
| `TEST_DATABASE_URL` | for `npm test` | Wiped by the integration tests |
| `E2E_DATABASE_URL` | for `npm run test:e2e` | Wiped by the end-to-end tests |
| `ANTHROPIC_API_KEY` | no | Platform-wide fallback key. Organizations can add their own under Settings → AI providers |
| `AI_MONTHLY_BUDGET_USD` | no | Per-organization monthly AI spend ceiling (default 20) |
| `VOYAGE_API_KEY`, `VOYAGE_MODEL` | no | Semantic search for the chatbot |
| `EXEC_DOCKER`, `EXEC_PYTHON_IMAGE`, `EXEC_NODE_IMAGE` | no | Container runner for Python/Node in the terminal (off by default) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | no | GitHub sign-in |
| `MAIL_PROVIDER` and provider keys | no | Resend, Postmark, SendGrid or SMTP (see `.env.example`) |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | Generates route types, then `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js and React Hooks rules) |
| `npm test` | Unit and integration tests (Vitest, against `TEST_DATABASE_URL`) |
| `npm run test:e2e` | Builds, starts the app on port 3100 against `E2E_DATABASE_URL`, and runs the Playwright journeys |
| `npm run check` | typecheck + lint + tests + build |
| `npm run db:generate` | Create a migration from `src/db/schema.ts` changes |
| `npm run db:migrate` | Apply migrations |

## Project layout

```
src/
  app/
    (auth)/            sign-in, sign-up, reset, verify, invite pages
    (app)/             signed-in application (shell, home, projects, builder, IDE, deployments, team, settings)
    api/v1/            versioned REST API (route handlers)
    sites/, s/         hosting of deployed sites (script-free CSP)
  components/          design system (ui/), shell, builder, ide, ai review
  db/                  Drizzle schema and client
  lib/site/            site document model, renderer, planner, templates, diagnostics (shared client/server)
  server/              auth, authorization, HTTP pipeline, services, AI gateway and task engine, hosting
drizzle/               SQL migrations
tests/                 Vitest unit + integration tests
e2e/                   Playwright end-to-end journeys
docs/                  architecture, API, checklist, verification report
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture, data model, security boundaries, AI pipeline
- [docs/API.md](docs/API.md): REST API reference and error contract
- [docs/CHECKLIST.md](docs/CHECKLIST.md): feature checklist against the specification, known limitations, and features that need credentials or infrastructure
- [docs/VERIFICATION.md](docs/VERIFICATION.md): what was verified, how, and the results

## Production deployment

The app is a standard Next.js Node server with PostgreSQL.

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Set `APP_URL` to the `https://` origin, and generate a new `APP_ENCRYPTION_KEY` (never reuse the development key).
3. `npm ci && npm run build && npm run db:migrate && npm start`, behind TLS.
4. Health check: `GET /api/v1/health` returns 503 when the database is unreachable.
5. Run a **single instance** for now: rate limiting and the AI task runner are in-process (see the known limitations).

Before calling an environment production-ready, work through the checklist in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#production-readiness). A successful local build is not enough.
