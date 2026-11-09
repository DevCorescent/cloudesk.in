# Feature checklist

Status against the master build specification and the advanced specification. **Done** means implemented, wired end to end, and covered by tests or verified in the browser. **Partial** says exactly what exists. **Not started** means nothing in the product claims it.

## Foundation

| Item | Status |
| --- | --- |
| Design system (tokens, light/dark/system, components, empty/loading/error states) | Done |
| App shell, grouped navigation, org switcher, ⌘K command palette with project search | Done |
| Email/password auth, sessions, verification, reset, password change, session revocation | Done |
| Organizations, invitations, 7 roles, server-side permission matrix | Done |
| Custom roles | Done — workspace roles limited to modules (migration 0041); data limits by company and branch (migration 0047) |
| OAuth, passwordless, MFA | GitHub sign-in (needs a GitHub OAuth app) and authenticator-app two-step sign-in that a workspace can require: done. Passwordless and enterprise SSO (SAML/OIDC): not started (ERP phase V) |
| Account deletion, data export | Not started |
| Audit log | Done (org-scoped viewer) |
| Structured logging, health endpoint, consistent API error contract | Done |
| Super-admin control center | Done — see “Platform control centre” below |

## Creation

| Item | Status |
| --- | --- |
| Conversational brief → structured spec, review/edit, answer questions and re-plan | Done (LLM or rule-based; the UI labels which ran) |
| Templates that create real files | Done (26 templates in 17 categories; pick any of 11 design directions before creating) |
| Design intelligence: directions, palettes, font pairings, layout variants, decoration, motion, photography | Done (deterministic engine in `src/lib/site/design.ts`; WCAG AA enforced on every generated palette) |
| Design direction choice with live previews before creating a project | Done (also for templates) |
| Frosted glass surfaces for published sites | Done (Glass direction or the Style → Surfaces switch; CSS only, solid fallback without backdrop-filter) |
| One-click design actions ("make it premium", dark mode, fix contrast, new palette/fonts…) | Done (also understood as plain-language assistant commands without a model) |
| Example figures/names/logos blocked from production until edited | Done |
| Reference URL / logo upload / brand fonts during onboarding | Not started |
| Visual builder: canvas, layers, drag-and-drop reorder, insert, properties, pages, theme | Done |
| Undo/redo, autosave, version history, restore, conflict handling | Done |
| Responsive viewports and per-breakpoint visibility/columns | Done |
| Free-form positioning | Done as a free-form section type: drag, resize, keyboard nudging, layering, 12-column desktop grid and a stacked or custom 4-column phone layout. Grouping, multi-select, locking and reusable global components are not started |
| Section motion (entrance, stagger, hover, parallax) | Done (CSS only; scroll-driven effects run in browsers with `animation-timeline` support, others show content without the effect; off with reduced motion) |
| Collaboration: presence, live sync, comments, @mentions, client review links | Done (near-real-time polling of saved edits, not character-level co-editing; simultaneous edits use the existing conflict prompt) |
| Version branches with three-way merge and branch previews | Done (field-level merge; conflicts resolved one by one; branch previews cannot be promoted; AI edits and version history work on main only) |
| SEO/accessibility checks with explanations | Done (rule-based; errors block production deploys) |
| AI design edits with diff and accept/reject | Done (built-in commands without a provider; free-form edits need Claude) |
| Asset uploads / asset manager | Done (PostgreSQL-backed; magic-byte validation, no SVG, crop, de-duplication, 200 MB per project) |
| Brand kit import (website URL or logo) | Done (SSRF-safe fetch with DNS pinning; colours/fonts/logo → accessible theme) |
| Design review with fixes | Done (rule-based; AI critique available with a model) |
| Section variations compare, per-device overrides | Done |
| Blog, products, maps, multilingual | Done (products link to external payment pages; no cart/checkout) |

## AI IDE

| Item | Status |
| --- | --- |
| File explorer, tabs, Monaco, save with revision check, conflict diff | Done |
| Create, rename/move, delete, history/restore | Done |
| Project search, problems panel (schema + Monaco diagnostics) | Done |
| AI multi-file changes with diff review, cancel, retry, token/cost display | Done (needs Claude) |
| Terminal, running tests/builds, dev servers, preview of generated apps | **Not started**: needs isolated per-project sandboxes, so no user code runs |
| Git/source control panel | Not started (file revisions serve as history) |

## Full stack and modules

| Item | Status |
| --- | --- |
| App builder / backend generator | Not started |
| Database studio | Done as Data tables (see Platform) |
| API & serverless studio | Generated REST API per data table and a public API: done. Serverless functions: not started |
| E-commerce: catalog, variants, collections, inventory, cart, checkout, orders | Done (see Commerce below) |
| Store payments (Razorpay, Stripe, PayPal, COD, UPI/bank transfer) | Done; online providers tested against mocked APIs only |
| Chatbots, knowledge retrieval, agents | Site chatbot with knowledge base: done (see Platform). Agents: not started |
| Workflow automation | Done — triggers (forms, orders, bookings, schedule, webhook, manual) and steps (email, HTTP, Slack, delay, condition) as durable jobs; approval rules in ERP phase A |
| Integrations marketplace, plugin SDK | Not started (only AI provider connections exist) |
| Analytics | Done for published sites (anonymous daily counters, bots excluded) |
| A/B testing | Done (section layout variants; conversions = form submissions; two-proportion z-test, 100-visit minimum) |
| Growth autopilot | Done: suggests tests (button wording, layouts, AI-written headlines when a model is connected) and store/design quick wins from live data; runs tests with per-experiment buckets; credits add-to-cart, checkout and orders to groups; decides at 95% / 100 visits per group or ends after 28 days; applies winners to the draft (auto-publish and auto-start are opt-in); emails owners. Hourly in-process scheduler (single instance) |
| Brand guardrails | Done: lock colours, fonts and logo (enforced on every save, for people and AI); voice, banned words and preferred terms guide and validate AI copy; brand check report; restore locked brand |
| Bookings | Done: services with duration, price, capacity and buffer; weekly hours, notice, horizon, closed dates, time zones (DST-safe); no-JS booking pages; overbooking prevented with a per-service lock; online payment with 30-minute holds via the store's providers; customer cancellation by link; calendar files and Google Calendar links; day-before reminders; owner calendar |
| GST suite (India) | Done: GSTIN checksum validation, HSN/SAC on products (snapshotted on orders), buyer GSTIN at checkout, invoice numbers per financial year on payment, GST tax invoices with CGST/SGST or IGST and amount in words, monthly GSTR-1-style summary (B2B, B2CL, B2CS, HSN, refunds) with CSV. Not a filing tool; no e-invoice (IRN) integration |
| AI translation | Done: dedicated translate task sends only text (by field), validates every key back, applies after review; layout, links and prices cannot change. Needs an AI provider |
| Business kit | Done: from the plan, set up a store, hidden booking services and a launch kit (social posts, welcome emails, Google Business Profile text, checklist) as editable files |
| Clone the feel | Done: brand import also reads corner rounding, button shape, spacing, headline size and light/dark from a site's CSS and class names; style only |
| Digital products & memberships | Done: private file storage (PDF/ZIP/EPUB/MP3/MP4/images, 25 MB, type-checked), download links per order with limits; membership products, members-only pages with emailed sign-in links and signed cookies, manual members, revoke |
| WhatsApp | Done: click-to-chat links (no API); Cloud API order updates and cart reminders using owner-approved templates, opt-in at checkout; signed delivery receipts. Tested against a mocked Graph API only |
| Billing, subscriptions, entitlements | Done — see "Subscriptions, trials and sign-up with a code" (an organization AI budget is also enforced) |
| Real-time collaboration, comments, approvals | Comments/approvals done; live character-level co-editing for IDE files (Yjs over SSE + Postgres NOTIFY, live cursors); the visual builder still syncs saved edits |

## Commerce

| Item | Status |
| --- | --- |
| Store setup wizard with 9 business templates (fashion, jewellery, beauty, home, bakery, books, gadgets, fitness, gifts) | Done; sample products cannot be bought until the owner confirms them |
| Products: variants generated from up to 3 options, compare-at price, cost, SKU, weight, per-product tax, SEO, images from the media library | Done |
| CSV import/export (formula-injection safe) | Done |
| Inventory with adjustment log, low-stock alerts, holds for unpaid online orders | Done |
| Checkout: row-locked stock, no overselling, 30-minute holds for online payments, automatic release | Done (tested with concurrent carts) |
| Payments verified server-side (return URL is never trusted); signed, de-duplicated webhooks | Done |
| Orders: mark paid, pack, ship with carrier tracking link, deliver (COD marked paid on delivery), cancel with restock, refund via provider API or recorded manually, private notes, timeline | Done |
| Printable tax invoice with CGST/SGST or IGST split | Done |
| Discounts: percent, fixed, free shipping, minimum order, dates, usage limit (atomic), once per customer | Done |
| Automatic abandoned-cart recovery: reminder after 1–24 h by email and/or WhatsApp, restore link that works in any browser (14 days), optional auto-applied code, consent-only, once per cart, stats (sent, came back, recovered orders and revenue) | Done (needs the store published; runs every 15 min, `CART_RECOVERY=off` to disable) |
| Store sales in Finance: paid online and counter sales after refunds next to invoices, "all income", tax collected; project books include their store, standalone books can link one | Done |
| Photo → product listing: title, description, tags, suggested HSN and GST rate, collection; reviewed in the editor before saving | Done (needs an AI provider; never sets price or stock; counted in AI usage) |
| Catalogues (2026-10-23): live-linked product catalogues by rule (all / collections / tags / hand-picked, exclusions, sort, sections by collection, hide sold-out); four looks (Studio, Editorial, Noir, Price list) with accent, columns, cover, field toggles, contact and terms; public page at `/c/<token>` that takes orders (store checkout via the real cart, or a written-out WhatsApp order) with stock checks; print layout = A4 PDF with cover and QR back page; sharing by link, QR (PNG/SVG), WhatsApp, email, SMS, PDF, Facebook/X/LinkedIn/Telegram/Pinterest, native share and plain text; views, orders started and shares by channel; hide, end date and link rotation; importing products can create a catalogue of exactly those products. Pro options (2026-10-23): private catalogues with an access code (hashed; 30-day pass tied to link + code; rate-limited), scheduled start date, embedding on other sites (per catalogue), minimum order value and per-item minimum, a live store discount code auto-applied at checkout, buyer name/phone on WhatsApp orders, prices on request (quote requests), cover styles, typefaces, "New" and "Bestseller" badges (bestsellers from real paid orders, 90 days), buyer search and section filters, Insights (14-day views/orders, views by channel via tagged share links, most-ordered products), 30-day dashboard totals | Done; integration and e2e tested. PDF is the browser's Save as PDF (no server PDF library); checkout needs a published store with a payment method |
| Promotions: announcement bars (rotating, countdown), pop-ups (centre / corner / bottom; link, email capture, code reveal; delay / scroll / exit-intent / click triggers; frequency caps), floating buttons, free-delivery progress and cart upsell; page/device targeting, schedules, views/clicks/sign-ups | Done (codes must exist in Discounts; countdowns need a real end date; served live without redeploy) |
| Shipping zones by country, state and PIN prefix; flat, free-over, weight-tier and pickup rates; COD per rate | Done |
| Taxes: inclusive or exclusive pricing, default and per-destination rates | Done |
| Customers, abandoned carts with consent-only reminder emails, review moderation | Done |
| Dashboard: sales, orders, AOV, conversion, net sales, gross profit, units, returning customers, funnel, top products, payment methods, locations, low stock, launch checklist | Done |
| Shiprocket: verified connection, courier booking (order + AWB + label + pickup, resumable), tracking sync to shipped/delivered | Done; tested against a mocked Shiprocket API only |
| Gift cards: issue (with email), redeem at checkout (partial or full), balance-safe under concurrency, returned to the card on cancel/refund | Done |
| Returns: customer requests from the order page or "My orders" link, window setting, approve → receive (restock) → refund | Done |
| "My orders": signed 24-hour email link listing a customer's orders | Done (no customer passwords) |
| Low-stock alert emails (once per variant until restocked) | Done |
| Bulk mark packed/delivered, packing slips, order CSV export | Done |
| Sitemap, robots.txt, Google Merchant product feed | Done (production deployments only) |
| EasyPost and Shippo labels: live rates, customs for international parcels, label purchase, tracking webhooks | Done; tested against mocked provider APIs only. Direct carrier APIs: not started |
| Multi-currency storefronts (presentment prices with rounding, base-currency reporting) and product subscriptions via Stripe or Razorpay | Done; providers mocked in tests |
| Live payment test with the merchant's own test keys (passes only on a signed webhook) | Done; checks run against the real provider when keys are saved, tests use a mocked API |

## Platform (2026-10-21)

| Item | Status |
| --- | --- |
| IDE terminal: ls/cat/grep/wc/validate, `run` and `js` in a QuickJS WebAssembly sandbox (3 s, 64 MB, 64 KB output, no network/timers/modules), script writes saved as revisions | Done |
| Docker runner for Python/Node (no network, read-only, 256 MB, 1 CPU, 64 PIDs, all caps dropped, unprivileged) | Built; tested with a simulated Docker CLI only (no Docker on the test machine) |
| Data tables: 12 field types, links with expand, filters/sort/search/paging, type conversion with explicit clearing, CSV import/export | Done |
| Generated REST API per table (API-key scopes, optional public read/insert with CORS), per-project OpenAPI, in-app API console | Done |
| "Data list" site section rendering live rows on published pages | Done |
| Site chatbot: knowledge base from pages/products/policies/notes/URLs, full-text + trigram search, optional Voyage embeddings, Claude answers with citations or search fallback, hand-over email, staff inbox | Done (AI and Voyage mocked in tests) |
| Live co-editing of IDE files with cursors | Done (two real browser sessions converged) |
| Free-form multi-select (shift-click, marquee), groups, locking, align/distribute | Done |
| Global components kept in sync across pages, detach and unlink, out-of-sync diagnostic | Done |

## Builder: advanced editing (2026-10-21)

| Item | Status |
| --- | --- |
| Click-to-select any text element on the canvas, element style panel (colour, background, size + phone size, weight, font, alignment, italic/underline/uppercase, spacing, padding, corners, opacity, shadow, hide / hide on phones) | Done |
| Inline text editing (double-click, Enter to save, Esc to cancel, plain-text paste) | Done; e2e covered through to the live site |
| Advanced section design (backgrounds incl. video, overlay, blur; colours; typography; spacing incl. phone; width/height; cards; borders; shape dividers; anchors; scoped custom CSS) | Done; values validated, CSS sanitised and scoped |
| New sections: video, embed, tabs, timeline, comparison, marquee, socials, spacer, custom form | Done (script-free; embeds allowlisted in the site CSP) |
| Custom form backend: validated against the published definition, inbox, data table row, team-only email, automations | Done |
| Site-wide interface settings | Done |

## Cloudesk Chat (2026-10-26, migration 0089)

Team chat at `/chat` (module id `chat`; permissions `chat:use` for everyone, `chat:manage` for owner/admin). Tables `team_*` (not the website chatbot's `chat_*`). Live updates use Server-Sent Events from `GET /api/v1/orgs/:org/chat/stream` over Postgres LISTEN/NOTIFY (`team_chat`); only ids travel on the stream — content is always read through the permission-checked API.

| Item | Status |
| --- | --- |
| Conversations: #general and #announcements (admins post) made on setup with everyone in them, people who join later added on first visit; public and private channels (name, topic, emoji, colour, admins-only posting), one DM per pair, group chats; join/leave, add/remove people, admin roles, archive, star, mute / mentions-only, hide DMs | Done; integration tested |
| Privacy: private channels, group chats and DMs are visible only to members — workspace admins can't read them; outsiders get 404s; files are only for the conversation's members | Done; integration tested |
| Messages: formatting (bold, italic, strike, code, blocks, quotes, lists, links), @people, @everyone/@here, #records from any module (via the global search; links kept inside the app), #topics, threads (also send to channel), edit, delete (author or channel admin), reactions, pin, forward, save with reminder, mark unread, copy link, email it, scheduled send (only the author sees it until it posts), priority important/urgent | Done; integration and unit tested (text parser) |
| Notifications: mentions, DMs, thread replies, approvals; per-conversation setting; Do not disturb holds everything except urgent; urgent messages re-notify every 2 minutes for 20 minutes while unread (CHAT_SCHEDULER worker, every minute) | Done; integration tested with a fixed clock |
| Interactive messages: polls (single/multi, anonymous, closing time, close), shared checklists, decisions (agree / object with reason / abstain; settled by the proposer or an admin; Decisions tab), approvals (named approvers in the conversation; reject needs a reason; the asker is notified, reply kept in the thread), video calls (a random Jitsi Meet room), meetings (each person adds it to their own calendar in one click) | Done; integration tested (calls and meetings checked in the browser) |
| Share any record to chat as a card (key fields + link back): CRM contacts, deals, companies; invoices/quotes; purchase and sales orders; HR people; contracts — with a note and optional urgent flag, to a channel, chat or a new DM | Done; checked in the browser (CRM contact) |
| Into the rest of Cloudesk: message → task(s) in Projects (assignee notified, the thread says so), meeting card → your calendar, message → email | Done; integration tested (tasks) |
| AI (workspace AI connection; off per conversation): catch-up (unread / 24 h / 7 days / all) with summary, decisions, action items with owners, questions waiting on you, "make these tasks", share the summary; ask the conversation (answers cite messages); rewrite a draft (polish, shorter, friendlier, formal, bullets, translate) | Done; integration tested with a stubbed model only |
| Presence: available / busy / away / Do not disturb with note, emoji and auto-clear; online from a 1-minute heartbeat; "in a meeting" from Cloudesk Calendar (repeating events included); typing indicators; "seen by" in DMs and groups | Done; presence integration tested, typing/seen checked in the browser |
| Screens: Home (what's waiting, who's around), Activity (mentions, replies, DMs, reactions), Saved (reminders, done), Search (from:, in:, has:file/link/poll/decision, is:pinned/saved/urgent, tag:, before:/after:), Browse channels, per-conversation tabs (Pinned, Files, Decisions, Polls & lists, Links & records), find in conversation, ⌘J jump-to, Alt ↑/↓, sidebar unread badge, ⌘K entries; responsive to phone width | Done; checked in the browser (desktop and 390 px) |
| Import and export: channels from CSV/XLSX (name, topic, description, visibility, member emails; admins); any conversation to CSV | Done; integration tested |
| Guests (2026-10-30, migration 0097): conversation admins make invite links (`/j/<code>`; expiry 1 h–never, use limit, "an admin lets each person in" on by default, earlier messages yes/no, files yes/no; turn off any time) and share them by copy, QR (SVG download), WhatsApp (any chat or straight to a number), email sent from Cloudesk (one per person, replies to the inviter, logged on the link), Cloudesk Mail, the phone's mail app, text message, Telegram, Microsoft Teams, LinkedIn, X, Facebook and the device share sheet. The invitee types only a name (optional contact and note) — no account; admins are notified (`chat.guest`) and see a "waiting" badge, then let in or decline with a reason. Guests use their own page: live messages, threads, reactions, polls and checklists, files, edit/delete their own, typing, presence, browser notifications, a personal link for another device, leave. Members see a "Guest" badge and a notice that outsiders can read the conversation; admins remove guests from the dialog or the People tab | Done; integration tested (17 cases incl. isolation from other conversations and members' API, no history, use limits, revoke, archive, rate limit, no notifications to guests) and unit tested (share links) |
| Speed, scale and touch (2026-10-30, migration 0098) | Messages redraw only when they change (stable actions, steady channel object; previously every typing indicator or sidebar refresh redrew the whole list); off-screen rows skip rendering (`content-visibility`); a new message updates sidebar counts straight from the live event and the full sidebar refetch is throttled to one per 2.5 s; the sidebar query caches default-channel setup, everyone-channel checks and "in a meeting" (30 s) per process and reads the last message in one lateral join; live-stream permission re-checks are throttled (adding people sends a change event); the LISTEN connection reconnects with backoff; indexes on chat files by message and a trigram index on message text. Touch screens get an action sheet (tap or long-press a message: quick reactions + every action) instead of hover-only controls; clicks on reactions/votes/menus inside Search, Activity and Saved results no longer navigate away; copy works on plain-HTTP installs (fallback); the edit box takes focus. UI: glass header, pill tabs, softer rail, floating composer, animations for new messages, reactions, toolbars, panels, sheet, typing and badges (reduced-motion respected) | Done; click-through audit of every chat control at 1440 px and 390 px touch in a real browser; 40-message live burst with 140+ messages on screen produced no main-thread task over 50 ms |
| Guest security | A guest has a hidden `users` row (no password, unroutable `@guest.cloudesk.invalid` address, no membership) so messages work unchanged, but never a session: a random secret (SHA-256 in `team_guests`) in an HttpOnly cookie scoped to `/api/v1/guest/chat/c/<conversation>`. `channelFor` refuses guests anything but that conversation; members' emails are hidden from guests; guests can't @everyone, post polls/approvals/records, invite, pin or manage; notifications skip guests; guest identities are excluded from Admin → Users and sign-up stats. Join requests are limited to 15 an hour per address and 100 waiting per conversation |
| Limits | Calls are Jitsi Meet rooms in the browser (Cloudesk doesn't host or record calls). No push notifications to phones — in-app (and email where the person's preferences say so). Files up to 25 MB each, stored in the database. Message search is a text match (no fuzzy or semantic search). AI answers come from the stubbed model in tests; with a real key they depend on the provider. The live stream reconnects every 5 minutes and polls every 60 s as a fallback. Read receipts are per conversation (not per message in channels). |

## Keyboard shortcuts across devices (2026-10-30)

Shortcuts are written once in a portable form (`mod+shift+z`, alternatives as `a / b`) and shown the way the device names them: ⌘ ⌥ ⇧ ⌃ ↵ on Mac, iPhone and iPad (Apple's ⌃⌥⇧⌘ order), Ctrl / Alt / Shift / Enter on Windows, Linux, ChromeOS and Android. Phones and touch-only tablets (no mouse or trackpad) get no shortcut hints, and touch-friendly wording instead where a sentence needed one ("Tap a conversation to open it", "Tap the search bar…"); an iPad with a keyboard and trackpad gets them back live. `src/lib/client/keys.ts` (detection + formatting, unit tested), `src/components/ui/shortcut.tsx` (`useShortcuts().keys/withKeys`, `<Keys k>`, `<KeyboardOnly>`; nothing device-specific renders on the server, so no hydration mismatch). Used by the app header search, sidebar collapse, command palette footer, Chat (composer tooltips, new-line hint, tips, guest page), Mail (send, shortcut list, help, empty state), Notes (format tooltips, hints), the site builder (shortcut sheet, tooltips, menus, toasts, freeform, style and page hints), IDE and product Save, the project tour, CRM search and the marketing header. Ctrl-click now multi-selects in the Notes editor and the builder's free-form canvas, like ⌘-click on a Mac.

## Calculator (2026-10-29, migration 0093)

| Item | Status |
| --- | --- |
| Calculator at /calculator (sidebar and command palette, every plan): typed or keypad input with its own parser (no eval) — order of operations, business percentages (200 + 18% = 236, 18% of 200), grouped numbers (1,23,456), ₹ signs, factorial, mod, implicit multiplication, functions (sqrt, log, trig in degrees or radians, min/max/avg/median, gst(), exgst(), change(), pct()), constants, `ans`, named values (rate = 18); live answer while typing; clear error messages | Done; `tests/unit/calculator.test.ts` (15) |
| Result in Indian or international grouping, chosen decimals, in words like a cheque ("Rupees … Only") and short form (lakh/crore); memory keys; one-tap +5/12/18/28% GST; scientific keypad; this session's tape; ↑/↓ recall; copy; share to Chat | Done; checked in the browser at 1440 and 390 px |
| Business formulas (26 in 8 groups): add/remove GST with CGST/SGST/IGST, TDS, margin & markup, price for a margin or markup, successive discounts, break-even, commission with a target slab, loan EMI with the full schedule (CSV), simple and compound interest/FD, SIP, CAGR, ROI, reorder point, EOQ, depreciation (straight line/WDV) with a schedule, unit-price comparison, LTV:CAC, percentage change, percentage of, days and working days between dates, due date, bill split — results as you type, with the working shown | Done; formulas unit-tested against known answers (e.g. ₹10 lakh at 9% for 20 years → EMI ₹8,997.26) |
| History: every calculation kept per person (private, even from colleagues), search, pin, note, open again (formulas reopen with their inputs), delete, clear (pinned kept unless "everything"), CSV export (formula-safe), newest 1,000 kept | Done; `tests/integration/calculator.test.ts` (3); e2e `e2e/calculator.spec.ts` |
| Limits | Tax rates are inputs, not looked up (check current GST/TDS rates); SIP and investment results assume a constant return; working days don't remove public holidays; display settings, memory and named values are kept on the device, not synced. |

## Security, firewall, Cloudflare and legal pages (2026-10-27, migration 0092)

| Item | Status |
| --- | --- |
| Web application firewall in front of every request (`src/proxy.ts` → `src/server/security/firewall.ts`, rules in `src/lib/security/waf.ts`): SQL injection, XSS, path traversal, scanner probes (.env, .git, WordPress, backups…), attack tools by user agent, protocol abuse, Log4Shell/Shellshock/command/template injection, cloud-metadata SSRF, header splitting; IP allow/block lists (IPv4 CIDR), country blocking (behind Cloudflare), custom rules, per-address rate limit, automatic bans after repeated attacks, monitor mode, emergency `FIREWALL=off`; refused requests get a 403/429 with a reference id and are logged (30 days) | Done; `tests/unit/firewall-rules.test.ts` (52: attack corpus and a corpus of everyday requests that must pass), `tests/integration/firewall.test.ts` (10). Checked live: /.env, /wp-login.php, UNION SELECT and a sqlmap user agent get 403; normal pages and APIs 200 |
| Visitor address from a trusted header only (first/last X-Forwarded-For, X-Real-IP or Cloudflare's CF-Connecting-IP), validated as an IP — rate limits and bans can't be dodged with a forged header once the right source is chosen | Done; unit tested |
| Cloudflare control centre (Admin → Security → Cloudflare): connect with a scoped API token (encrypted, never shown back), zone status, "I'm under attack", security settings (SSL mode, HTTPS, TLS, browser check…), cache purge, IP access rules, custom WAF rules, Cloudflare firewall analytics, copying bans to Cloudflare, origin lock (Cloudflare adds a secret header; the firewall can then refuse anything else) | Done; integration tested against a faked Cloudflare API. **Not run against a real Cloudflare account** (no token here) |
| Admin → Security: Posture (17 live checks with fixes, weighted score), Firewall (mode, rules, address source, limits, lists, countries, custom rules, bans, request log with references), Cloudflare | Done; checked in the browser |
| Authentication hardening: per-account pause after repeated wrong passwords (any address, no enumeration); other sessions end when two-step is turned on/off; challenge guesses counted atomically; code limits per account across challenges; all reset links die after a reset or password change; outbox page hides reset links and codes outside development; Secure cookies in production; admins can't disable or sign out a platform owner; safe redirects after sign-in (`/\evil.com`, tab tricks) | Done; `tests/integration/auth-hardening.test.ts`, `tests/unit/safe-next.test.ts` |
| Injection & SSRF hardening: one safe fetch for user-supplied URLs (private, loopback, link-local, metadata and IPv4-in-IPv6 addresses refused, DNS checked, redirects re-checked) incl. mail servers; LIKE wildcards escaped in searches; CSV/Excel formula injection quoted in exports; linear-time parsing of invites/markdown; oversized calendar text ignored; `__proto__` ignored when merging site documents; A/B variants and CSS escapes checked in rendered pages; only http(s) meeting links; script URLs stripped from email HTML links | Done; `tests/unit/security-hardening.test.ts` |
| Tenant isolation: HR records, leave balances, departments, CRM deal references, logistics carriers, apps, automation runs, roles (SSO/SCIM owner-only, module-limited roles can't lift themselves), chat presence doesn't reveal meeting titles | Done; `tests/integration/tenant-isolation.test.ts` (10) |
| Security headers: CSP, HSTS (two years) on HTTPS, X-Frame-Options DENY / frame-ancestors none, nosniff, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy | Done; checked on live responses |
| Legal pages: Terms, Privacy (DPDP Act 2023, IT Act/SPDI Rules, GDPR/UK GDPR, CCPA), Cookies, Refunds & cancellation, Acceptable use, Data Processing Addendum, Sub-processors, Grievance Officer (IT Rules 2021), Security & responsible disclosure, Legal index, Contact; `/.well-known/security.txt`; sitemap and robots; company details from Admin → Settings → Legal (nothing invented when empty) | Done; every page checked at 1440 and 390 px. **Should be reviewed by a qualified lawyer before launch** |
| Trust strip (homepage, pricing): only true statements — payments by Razorpay/Stripe (no card data stored), HTTPS, two-step sign-in, GST invoices, data export, DPDP/GDPR-aligned privacy, built for Indian businesses; no certifications claimed | Done |
| Cookie banner | Not needed: only strictly necessary cookies (cc_session, cc_org, cc_mfa) and no trackers; explained on /cookies |
| Limits | The firewall inspects URLs and headers, not request bodies (bodies are validated by each route). Rate counts are per server process. Country blocking needs Cloudflare. CSP still allows 'unsafe-inline' and 'unsafe-eval' (needed by the builder/IDE). Security audit agents stopped early (usage limit) after the fixes above; file-upload content checks weren't reviewed in full. |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities (DOMPurify in the code editor forced to 3.4.17 via `overrides`, Monaco 0.57) | Done |

## Marketing site: workday features, hero slider, mobile and fresh screenshots (2026-10-26)

| Item | Status |
| --- | --- |
| Header tabs for My work, Mail, Calendar, Chat and Copilot (from 1280 px; in the phone menu as "Your workday"), each with its own feature page; new My work feature page; Calendar and Chat pages now have real screenshot tours | Done; checked in the browser |
| Hero: lighter, word-by-word animated headline; a slider of eight main features (Website, Online store, Business software, Your workday, Mail, Calendar, Chat, Copilot), each with a hookline, the real desktop screen and the same feature on a phone; arrows, keyboard, swipe, progress, pause on hover, still for reduced motion | Done; checked in the browser (desktop and 390 px) |
| Hero on a subtle light background (soft mesh and faint grid), headline set full width at a light weight (smaller: up to 5.6rem) with a gradient "Ready in minutes.", copy and calls to action split left/right under a hairline; the feature slider spans the full content width and shows each screen whole (no cropped fade), with the phone overlapping its corner | Done; checked in the browser at 1024, 1280, 1440, 1920 and 390 px |
| Headings on one row: every h1, h2, large h3 and slider hookline on the marketing site is shrunk just enough to fit its width (`OneLineHeadings`); below 22 px it wraps instead. Hero headline is one row with "Ready in minutes." in the logo's coral-to-amber gradient, flowing slowly (still for reduced motion); descenders no longer clipped. Marketing pages always render light, whatever the device theme; the app theme is restored on leaving | Done; audit of 52 pages at 1440 px: 0 headings on two lines (was 89). At 390 px, 53 long headings still wrap, since one row would be under 22 px |
| Header: same width and gutters as the page; search, Sign in and Start free pinned right; workday tabs from 1280 px. Menus on a solid panel with the page dimmed behind. Products: a category rail (Build & sell, Run your business, Operations, Industry suites, AI, data & automation), each split into sections (e.g. Your workday, Customers & sales, Money, People & work) with a one-line description per feature and a screen from that category; Industries: by sector with the industry suites beside | Done; checked in the browser; sections covered by `tests/unit/marketing-nav.test.ts` |
| Phone swipe rows (snap scrolling) for the homepage pillar, "new" and suite card grids; grids again from tablet width up | Done; checked at 390 px |
| "Your workday" section on the homepage (Home, My work, Mail, Calendar, Chat, Copilot) with real screens | Done |
| Headings site-wide at lighter weights (display 380, section 450, cards 500) | Done |
| Phones see the app's own mobile interface: the hero, the workday section and every feature page with a phone capture show it in a phone frame instead of a shrunken desktop screenshot | Done for 40 feature pages' phone captures (phones/, workspace/m-*) |
| Screenshots re-captured from the current app (new sidebar with badges) for every feature, by scripts in scripts/marketing/ (capture-workspace, -new, -mail, -ops, -industry, -suite-a, -suite-b, -horeca, -build, -store, -books, -phones; run one at a time); hotspot positions re-checked against the new images | Done |
| No horizontal overflow on any of the 54 marketing pages at 390 px | Done; checked with an automated audit |
| Limits | Screenshots come from demo businesses seeded on a dev server, so dates and greetings are those of the capture day. Phone captures show the app's real mobile layout, which on some screens is denser than the desktop. Store-project screens show the project sidebar, not the workspace badges. The accounting balance sheet shows "Opening balance adjustments" rather than prior-year profit, because no prior-year entries were invented. Noticed while capturing, not yet fixed: the ledger's Opening card reads ₹0 when the opening journal falls on the range's first day (the balance shows as the first row instead). |

## Feature requests and releases (2026-10-26, migration 0090)

Workspaces ask the Cloudesk team for features at `/requests` (sidebar "Request a feature", the Home dashboard, ⌘K); platform admins handle them in Platform admin → Feature requests (permissions `requests:read` / `requests:write` for owner, admin, support; releasing needs `flags:write`).

| Item | Status |
| --- | --- |
| Asking: title, the problem, details, where in Cloudesk, how much it matters, and who it's for (our workspace / everyone); "already asked?" suggestions from the roadmap while typing; the asker's vote counted; edit or withdraw only by the asker and only while Submitted | Done; integration tested |
| Following it: status pipeline (Submitted → Under review → Planned → In progress → Testing → Released; Not planned; Merged) with a progress bar, expected date, the team's reply, a conversation with the team, votes from colleagues | Done; integration tested |
| Privacy: a workspace sees its own requests in full; the public roadmap shows only the title, the team's reply and status of requests the team made public (never another workspace's words or names); comments only from the asking workspace; internal team notes never shown to workspaces | Done; integration tested |
| The team: all requests with status counts, filters (status, who it's for), search (title, problem, #number), sort by newest / votes / urgency; edit the title, status, expected date, reply, public roadmap; internal notes or messages to the workspace; merge duplicates (votes move over) | Done; integration tested |
| Releasing: through a release flag — to every workspace, or to chosen workspaces (the asker's preselected; added to any that already have it); release notes; the people who asked (and voters in that workspace) are always told, optionally everyone in the chosen workspaces; "What's new" in each workspace lists what was released to it; roll back everywhere (flag off, request back to Testing) | Done; integration tested |
| Building on it: the server checks `isFlagOn(key, orgId)`, the browser `useFlag(key)` / `<WhenFlag flag="…">` (GET /api/v1/orgs/:org/requests/flags) | Done; flags API integration tested |
| New requests reach the team by email to platform owners/admins/support (through the platform's mail service — recorded in the outbox when none is set up) and show in the console's counts | Done; email path not delivered in tests (outbox) |
| Limits | Releasing turns the flag on — the feature itself still has to be built and to check its flag; a request released to a workspace shows as live there even if the code isn't deployed yet. No attachments on requests. No public roadmap outside Cloudesk (it's inside the app, for signed-in workspaces). |

## Sidebar badges and notification sounds (2026-10-26)

| Item | Status |
| --- | --- |
| Sidebar badges: Chat (unread; red with the count of mentions/DMs when someone needs you), Mail (unread inbox mail; red when replies are overdue), Calendar (invites waiting to add + minutes to write; red when invites wait); a dot when the sidebar is collapsed | Done; checked in the browser |
| Notification tunes made in the browser with Web Audio (no audio files): 12 tunes — Aurora, Crystal, Pulse, Executive, Reception, Halo, Cascade, Momentum, Lumen, Ping, Beacon, Signal — bell, glass, marimba, pad and pluck timbres through a soft room reverb and a limiter | Done; unit tested (tune data), played in the browser (oscillator counts checked) |
| A tune per purpose: chat message, mention, direct message, urgent, new email, meetings, approvals & tasks, everything else ("No sound" allowed); volume; preview; silent in Do not disturb (urgent still plays); only when not looking at Cloudesk; quiet hours (across midnight; urgent still plays); one tab plays, not every open tab | Done; quiet hours and purposes unit tested, mention/DM/new-mail sounds checked in the browser |
| Limits | Sound settings are per browser on each device (not synced between devices). Sounds play only while Cloudesk is open in a tab, after the first click or key press on the page (a browser rule) — not when the browser is closed, and not as phone push. New-mail sounds follow the inbox count Cloudesk sees (refreshed every 30 s after a sync), so they're not instant. Meeting and approval sounds follow the bell, which refreshes every minute. |

## Home page: "Ideas that make Cloudesk different" (2026-10-30)

`#ideas` on the home page (`src/components/marketing/innovations.tsx`, styles `mk-inv-*` in marketing.css): five groups — Everything connected, AI that does the work, Talk to anyone, Made for India, Safe by design — four cards each in an asymmetric bento, every card with a small animated mock-up (flows, chat bubbles, typing, a scan catching bad items, a week of sends, a UPI QR being paid) and a link to its feature page. Groups take turns with a progress line while on screen, pause on hover/focus, sit still for reduced motion. Every card describes a feature that exists in the app.

Sign-in screens (`(auth)` layout, `src/components/auth-showcase.tsx` + `auth-showcase.css`): on lg+ a panel tours four real features — Build (AI-drafted site + store order), Bill (GST invoice, paid stamp, collections chart), Mail (email filed to Notes / Calendar / Chat, recurring send) and Chat (guest join request approved, shared invoice card) — each scene a few seconds of staged animation; the tab's fill is the timer, paused on hover or keyboard focus, no auto-advance with reduced motion. Below lg: four feature cards (tablets) and a scrolling strip of modules under the form. The /start hero shows one module tile per spot (previously ~30 tiles stacked on 11 spots), right-side tiles anchored from the right.

Home → "Your desk" (`src/components/home/desk.tsx`, `GET /dashboard/desk` → `src/server/dashboard/desk.ts`): a tile each for My work (approvals, to-dos, unread notifications), Mail (unread first, needs-reply / past-SLA / invites, compose), Calendar (next meeting with countdown, Join and progress while on, the rest of the week, invites and minutes due — replaces the old "Up next" strip), Chat (mentions, then unread, then recent; guests waiting), Notes (pinned and recent, reminders), Copilot (ask box → `/copilot?q=`, prefilled; recent conversations) and the Calculator (latest results, only you). Only features with at least one item get a tile; each goes through its module's own access rules and the plan/role check. It's a dashboard section ("desk", first by default, inserted into saved layouts at its usual place), refreshed every minute. Tests: tests/integration/dashboard-desk.test.ts.

Collapsed sidebar (icon rail, `src/components/shell/sidebar.tsx` `RailTip` / `RailGroup`, styles `.rail-*` in globals.css): 64px wide, one centre line, fits a 900px window without scrolling. Every icon has a styled tooltip (label, unread count, shortcut) on hover or keyboard focus; counts are number bubbles; the page you're on gets its accent colour and a marker on the rail edge. Group icons sit on a soft tint with a corner notch; hover opens the flyout, a click keeps it open (Escape, a click elsewhere or choosing an item closes it; arrow keys move through it), and its header names the group and how many features it holds.

Phones & tablets (below 1024px, `src/components/shell/mobile-nav.tsx`, styles `.dock-*` / `.sheet-*` in globals.css): a floating glass tab dock — Home, Mail (or My work), a Create button, Chat (or Calendar / Notes, whichever the workspace has), More — with live unread bubbles; employees get My work, My HR, Account. More opens a bottom sheet with the workspace switcher, app tiles, every feature group, the theme switch and sign out; Create opens email, note, message, event, Copilot, web app and a note on this page. Sheets drag down, Escape or the backdrop to close. The dock hides while the keyboard is up. The top bar is an app bar (the page's name, search, notifications, account). `--bar`, `--dock` and `--app-h` keep full-height views (mail, chat, calendar, notes) above the dock and page content scrolls clear of it; toasts, undo bars and save bars sit above it; dialogs open as bottom sheets on phones. Safe areas (notch, home indicator) are respected with `viewport-fit=cover`. Every app page checked at 360 / 390 / 768px with real data: nothing pokes past the screen edge.

## Mail into Notes, Calendar, Tasks and Chat (2026-10-30, migration 0100)

Marketing: `/features/mail` has a "Connected to everything" section (`src/components/marketing/mail-connections.tsx` — an email whose lines flow to Notes, Calendar, Tasks and Chat, each card showing what it becomes, the email's Connected list filling as it cycles; click a destination; pauses on hover; still for reduced motion; stacked on phones) and a "Recurring emails" week (sends dropping in at 9:00, a skipped holiday, the stand-up landing in the calendar). Highlights, good-to-know, FAQs and related features updated; home page Mail chips/points updated. The real-screenshot tour on that page still shows the earlier screens — rerun scripts/marketing/capture-mail.spec.ts to refresh them.

Every conversation has "Send to" in its action bar, a "Connected" panel (beside the sender card, or under it on narrow screens) and "Save this message to Notes…" on each message; `n` saves the open conversation to Notes. Table `mail_links` (one row per thing it became; dropped when that's deleted), server `src/server/mail/links.ts`, rules in `src/lib/mail/links.ts`, UI `src/components/mail/links.tsx`.

| Item | Status |
| --- | --- |
| Notes: a new note (title, tags, your own line on top, reminder tomorrow / next Monday) or added to the end of a note you can edit; keeps the whole conversation, the latest message, one message, or an AI summary with its to-dos as a checklist. What was written only — no quoted history, "On … wrote:", Outlook headers or signature; lists stay lists; attachments linked; a card back to the email. New notes attach to the email (they land in the Notes "Mail" folder and show "Launch plan…" as their page) | Done; integration + unit tested, checked in the browser |
| Calendar: a meeting with the people on the email (pick who), its time and video link read from the email, optional invite emailed from your mailbox; or time blocked out to deal with it. The event keeps the email ("Open the email" in Calendar; minutes go as a reply) | Done; integration tested (invite sent through the fake server), checked in the browser |
| Tasks: in any open project, assignee, due date, priority, with the email (who, when, what, link) in the description | Done; integration tested |
| Chat: shared as a card (subject, excerpt, from, received, messages, attachments) to any channel, chat or person; the email remembers where (only your own message is accepted) | Done; integration tested |
| Connected: everything made from the email plus notes attached to it from "Notes on this page" and events from its invites — only what you may see (others' private notes and calendars stay hidden); disconnect any link; deleted items drop off | Done; integration tested |

## Mail full-screen reader (2026-10-30)

A conversation opens full screen from its action bar (or `v`): it covers the app and, on computers, the screen (the browser's full-screen mode — the expand/shrink button turns that part off and is remembered). Previous / next with ←/→ or j/k and a "3 of 48" position; archive, trash or snooze move on to the next conversation; text size 85–150% (remembered on the device, emails included); every conversation action still works; Esc (or the browser's own exit) leaves both at once. Rises in, crossfades sideways between conversations, settles away on exit; the page behind doesn't scroll. `src/components/mail/reader.tsx`, `mail.css`. Checked in the browser at 1440 px and 390 px.

## Recurring emails (2026-10-30, migration 0099)

Mail → Recurring emails (`/mail/recurring`), or "Repeat on a schedule…" in the composer's send menu (the draft — recipients, groups, subject, body, attachments, signature — carries over). Tables `mail_schedules`, `mail_schedule_runs`, `mail_schedule_files`; rules in `src/lib/mail/schedule.ts` (shared with the editor's live preview), server in `src/server/mail/schedules.ts`, worker tick every minute (`MAIL_SCHEDULES=off` disables).

| Item | Status |
| --- | --- |
| When: every day, every weekday, chosen weekdays every N weeks, monthly, yearly or any custom "every N days/weeks/months/years"; up to 6 send times a day; any time zone (wall-clock time kept across daylight saving); start date; ends never / on a date / after N emails (emails actually sent); skipped days (holidays) | Done; unit tested (incl. DST) |
| The email: mailbox, To/Cc/Bcc and address-book groups (members resolved at each send), one each personally, subject and body with placeholders filled per send — {{date}} {{day}} {{time}} {{month}} {{year}} {{n}} {{meeting_link}} {{meeting_time}} plus contact ones ({{first_name}}…), attachments (stored once), signature choice | Done; integration tested |
| Meetings: a meeting link in the email (Google Meet, Zoom, Teams, Jitsi…) makes it a meeting automatically; or paste a link, or have a Jitsi room made once for the series. One repeating event in the owner's calendar mirrors the schedule (its days, the meeting's own time or the send time, length, reminders, skipped days, end — computed from the email limit); paused = removed, resumed = back, ended = closed off, deleted = gone. Each email can carry that day's calendar invite (Accept/Decline lands it in recipients' calendars) and the time + join link under the message | Done; integration tested (fake mail server) and checked in the browser |
| Behaviour: keep all in one conversation (each replies to the last) or a new email each time; stop when anyone replies; missed sends (system offline) sent late up to 12 h or skipped; notify me each time; failures notify, 3 in a row pause it; send one now, skip the next, pause/resume, duplicate (new video room), edit (recomputes from now), delete | Done; integration tested |
| Exactly once: a run is claimed by moving next_run_at only if unchanged, and recorded once per planned moment (unique index) — two workers at the same moment send one email | Done; integration tested |
| Screens: list (running/paused/finished, next send, people, sent of limit, meeting badge), editor with live "next sends" preview and schedule sentence, details with coming-up sends and full history (sent #, skipped with reason, failed with error, link to each conversation); phone layout | Done; checked in the browser (1440 px and 390 px) |
| Limits | Times are per schedule, not per recipient's own time zone. With several send times a day the meeting rides on the first. Sending uses the mailbox's SMTP; nothing goes if the mailbox is paused (counts as a failure). At most 100 running schedules per person. |

## Mail across Cloudesk — contacts, groups and one-click email (2026-10-26, migration 0087)

| Item | Status |
| --- | --- |
| Address book at `/mail/contacts`: shared workspace contacts (name, email, company, title, phone, tags, notes, favourite), groups with colours, search, bulk add/remove from group, favourite and delete (confirmed), "Email the group", CSV/XLSX import (groups made by name) and export; "Save contact" on a sender in a conversation | Done; integration tested |
| Recipient suggestions as you type, in To/Cc/Bcc: groups, saved contacts, people you've emailed, CRM contacts and teammates (keyboard and screen-reader friendly); paste many addresses at once | Done; integration tested (suggest API), checked in the browser |
| Send to a group (it becomes its members when sent; an empty group is refused); "Send separately to each" — one email per person (up to 500), nobody sees the others and `{{first_name}}` becomes each person's own name (an unknown name drops cleanly: "Hi {{first_name}}," → "Hi,"); contacts remember when they were last emailed | Done; integration tested |
| Email from anywhere: compose button in the header (write an email, email this page's link, contacts), ⌘K "Write an email" and "Contacts & groups"; Email buttons filled in with the right person, subject and body on CRM contacts, deals and companies (everyone), invoices/quotes (with the share link), purchase orders (supplier), HR people, contracts (counterparty), sales orders, and calendar events ("Email guests") | Done; checked in the browser (CRM contact, calendar, header) |
| Invoice and quote PDFs: a real PDF file (pdf-lib, Geist font embedded for ₹ and other currency symbols) following the document's labels, accent colour, columns and paper; multi-page for long documents with repeated table headers and page numbers; draft/void watermark. Attached by the Email button (sent from your mailbox) and, by default, by invoicing's own Send (switch "Attach the PDF"); "Download PDF" in Share | Done; integration tested (file parses, page count, attachment in Resend, Postmark, SendGrid and SMTP formats), checked by eye |
| Sales orders: the Email button is addressed to the customer's email from the books | Done; integration tested |
| Groups on sent mail: an email to groups remembers them and expands to their members when it actually goes (people added while it was scheduled get it); the conversation shows the group chips and the head-count | Done; integration tested |
| Names on recipient chips when opened from a record (CRM, HR, suppliers, contracts, invoices, sales orders) | Done; checked in the browser |
| "Send a test" on each mailbox (Mail → Settings): sends from the mailbox to itself through its real SMTP server and reports the server's answer | Done; integration tested against the fake server (success and a refused sign-in), and run for real on 2026-10-26 from a Hostinger mailbox: accepted by smtp.hostinger.com and found in the mailbox's INBOX over IMAP |
| Limits | Delivery through a real provider is proved per mailbox with "Send a test" — the automated tests use a fake mail server. The PDF is a clean standard layout, not a pixel copy of every HTML template design (logos, signature images and the UPI QR appear only on the designed page; the UPI ID is printed). "Send separately" fixes its list when it's scheduled. Projects have no customer email on record, so there's no prefilled recipient there. |

## Cloudesk Calendar (2026-10-26, migration 0086)

A personal calendar at `/calendar` (module id `calendar`, permission `calendar:use` for every role), tied to Mail. Work and Personal calendars are made on first use.

| Item | Status |
| --- | --- |
| Meetings in mail: the attached calendar invite is read (iCalendar REQUEST/CANCEL; UTC, IANA, Outlook Windows zones and VTIMEZONE offsets; DURATION; RRULE), otherwise a meeting link (Google Meet, Zoom, Teams, Webex, Jitsi, Whereby, GoTo) and a time read from the text ("tomorrow at 3pm", "28 Oct, 11:30 AM IST", "Thursday 4–5pm", dd/mm/yyyy, zone abbreviations). Stored on the message; the conversation gets its meeting time | Done; unit tested (Google- and Outlook-style invites, text times) and integration tested |
| Robust finding (scan v2): the invite's own conference link (X-GOOGLE-CONFERENCE, Teams' meeting URL) first; links unwrapped from Outlook Safe Links, Google redirects, Proofpoint, Mimecast and HTML entities; Zoho Meeting, Chime, BlueJeans, Skype, RingCentral, Zoomgov and new Teams links too; invites read even from mailing tools (unsubscribe links); mail already synced is scanned automatically once per mailbox (and again when the finder improves) and on demand ("Find meetings in my email"); a reply quoting the same link is matched to the meeting already in the calendar | Done; unit and integration tested, and run on a real mailbox (a Google Meet invite found and added) |
| Real invites are added automatically by default (per-mailbox switch to turn off); meetings read from text are never added on a guess — a notification asks to check the time | Done; integration tested |
| Mail → Meetings view and count, meeting chip on rows (✓ once in the calendar), meeting card on the email (Join, Add to calendar, Going/Maybe/No), the invite file kept once | Done; integration tested |
| Add to calendar on a click (time editable; a text-read time is flagged to check), or automatically per mailbox ("Add meeting invites to my calendar automatically", invites with a calendar file only) | Done; integration tested |
| Organiser updates move the event (higher SEQUENCE only) and cancellations cross it out, with a notification | Done; integration tested |
| RSVP: Going/Maybe/No sent to the organiser as an iCalendar REPLY from your mailbox; our own invites, updates and cancellations sent as REQUEST/CANCEL (a calendar part, so mail apps show Accept/Decline) | Done; integration tested |
| Calendar UI: day, week, month and agenda; drag to create, move and resize (15-minute steps); overlapping events side by side; now line; all-day row; mini month; calendars shown/hidden; repeats (daily, weekdays, weekly on days, monthly, yearly, every N, until/count) with "only this one / all"; colours; guests; reminders; .ics download; keyboard shortcuts | Done; repeats unit tested, events integration tested; drag tested by hand in the browser |
| Reminders: per event, default 1 day, 3 h, 1 h, 10 min and at the start, as notifications with the join link (once each; skipped if more than 20 minutes late); "Up next" strip on the dashboard; "starting soon" bar with Join in the calendar | Done; integration tested (calendarTick with a fixed clock) |
| Minutes of meeting: after a meeting with other people (20 minutes or more), one nudge and a "Minutes to write" list (skippable); present, summary, discussion, decisions, action items (owner, due, done), next meeting; shared by email to the organiser and anyone else, as a reply in the invite's conversation, HTML table + plain text, with your signature; printable copy | Done; integration tested |
| Limits | No two-way sync with Google Calendar or Outlook calendars — events live in Cloudesk; invites reach Cloudesk only through synced mail (every few minutes). Times read from email text are a best guess (confirmed before adding; English wording only). Cloudesk doesn't create Meet/Zoom/Teams links — paste one. Reminders are in-app notifications (no push to phones, no email by default). Attendees' answers to invites we send aren't read back yet. One personal calendar set per person — no shared team calendars or free/busy. |

## Cloudesk Mail (2026-10-25, migration 0083)

A workspace inbox at `/mail` (module id `mail`, on for every workspace; permissions `mail:use` for everyone, `mail:manage` for owner/admin). Mail is read over IMAP (imapflow) and sent over SMTP (nodemailer); passwords and OAuth tokens are encrypted at rest and never returned by the API.

| Item | Status |
| --- | --- |
| Connect wizard: address → provider from the domain or its MX records; provider-specific steps with links (Gmail, Google Workspace, Microsoft 365/Outlook, Zoho, Yahoo, iCloud, Titan, Hostinger, GoDaddy, any IMAP/SMTP server); live IMAP + SMTP check before saving, with the failure sorted by cause (password, server name, port, TLS, IMAP off) and the fix in plain words | Done; unit, integration (fake server) and e2e tested (unreachable server) |
| Sign in with Google / Microsoft (XOAUTH2), signed state + nonce cookie, token refresh; client ids set by the platform admin in Admin → Integrations | Done; integration-tested against mocked token endpoints |
| Sync: INBOX and Sent, new UIDs since the last run, UIDVALIDITY resets, first sync limited to the chosen days; threading by In-Reply-To/References, then subject + participants; attachments ≤ 15 MB kept | Done; integration-tested |
| Sorting: People, Finance, Updates, Promotions, Newsletters, Social, Primary, with the reasons shown; screener for first-time senders (allow / block / VIP); phishing warnings for look-alike display names, failed SPF/DKIM/DMARC and reply-to on another domain | Done; unit and integration tested |
| Unified and per-mailbox inbox, views (important, starred, snoozed, waiting for reply, follow-ups due, scheduled, sent, archive, spam, trash, assigned, attachments), search operators (from:, to:, subject:, has:attachment, is:, label:, category:, before:, after:, in:), keyboard shortcuts | Done; integration-tested (search) |
| Read / star / archive / trash / spam mirrored back to the mailbox over IMAP | Done; integration-tested |
| Compose, reply, reply-all, forward with threading headers, signature, templates with name fields, attachments (15 MB each, 25 MB total), undo send, schedule send, remind-me-if-no-reply; failed sends kept with the reason and a retry; sent mail filed in Sent | Done; integration-tested |
| Team inboxes: members, assign (members only, notified), internal notes with @mentions | Done; integration-tested |
| Rules (conditions on sender, recipient, subject, body, category or attachments; actions: label, category, priority, star, mark read, archive, trash, assign, add to CRM, make a ticket); templates with the smart CSV/Excel importer (matched by name: update or skip) and CSV/Excel export; conversation list export to CSV (formula-safe) | Done; integration-tested |
| CRM contact and deals beside a thread, add sender to CRM, email → Helpdesk ticket; one-click unsubscribe (RFC 8058) | Done; integration-tested |
| HTML mail shown in a sandboxed frame with a no-script CSP; remote images blocked until "Show images" | Done; integration-tested |
| AI: summarise, suggest a reply, extract actions, morning briefing — only when asked, never sends | Done; tested with a stubbed model only |
| Needs reply + reply targets (migration 0084): each conversation tracks when the oldest unanswered message arrived (auto-replies don't count as answering); a per-mailbox "reply within N hours" target; a "Needs reply" view (personal mail, oldest first) with waiting/overdue badges and an overdue count in the menu | Done; unit and integration tested |
| Mail analytics (`/mail/analytics`): received/sent with the previous period, median and 90th-percentile reply time, reply rate, share within target, needs-reply/overdue now, daily chart, weekday × hour heatmap (viewer's time zone), reply-time buckets, categories, top senders/domains, per mailbox and per teammate — all counted from stored mail | Done; integration-tested (sums and time-zone fallback checked) |
| Sender clean-up (`/mail/cleanup`): senders by volume with unread/in-inbox counts; archive, mark read, unsubscribe, trash or block everything from one sender (trash/block ask first), mirrored to the mailbox | Done; integration-tested |
| Auto-reply (out of office) per mailbox with dates, subject, message and "only people I know": RFC 3834 rules (never to lists, robots, Auto-Submitted mail, Precedence bulk, suspicious mail or promotions), once per sender per 4 days (claimed atomically), only mail that arrived after it was switched on; sent with `Auto-Submitted: auto-replied` | Done; unit and integration tested |
| Mute a conversation (replies stay archived), message details (SPF/DKIM/DMARC, IDs, size, folder), print view, advanced search form, `/mail/t/<id>` links open the conversation | Done; integration-tested (mute, details) |
| Marketing: `/features/mail` with five chapters of real screenshots (demo mail put through the real ingest pipeline) | Done |
| Limits | **Never tested against a real mail provider** — only an in-memory IMAP/SMTP fake and a closed local port. Microsoft 365 / Outlook.com need "Sign in with Microsoft" (an Azure app registration by the platform admin); Google OAuth uses a restricted scope that needs Google's verification before public use — app passwords work without it. Sync polls every 2–3 minutes (no IMAP IDLE / push). Only INBOX and Sent are synced; other folders and labels are not. Attachments over 15 MB are listed but not stored. Snooze, labels, notes and assignment live in Cloudesk, not in the mailbox. AI needs an AI provider connected. Analytics only know mail synced into Cloudesk (the chosen sync window, Inbox and Sent); replies sent from another app count once they sync from Sent, shown as "Outside Cloudesk". Auto-replies go out on the next sync after mail arrives (every few minutes), not instantly. No overdue push notification yet — overdue shows in the app. |

## Marketing site refresh (2026-10-25)

| Item | Status |
| --- | --- |
| Header: categorised Products mega-menu (Build & sell, Run your business, Operations, Industry suites, AI/data/automation) with a "New" card, Industries menu, site search in the bar (⌘K or “/”), mobile menu with the same groups | Done; unit-tested categories and search ranking |
| Homepage: dark hero ("Your website, store and business software. Ready in minutes.") switching between Website / Online store / Business software with real screens; one-platform pillars; What's new bento (drag-and-drop, live dashboard, connected sections, publish anywhere, search, phone styles, onboarding); the full suite by category; phone deck, Horeca, industries, integrations, security & trust, FAQ, final CTA | Done |
| All features page grouped by category with a sticky category bar and a real screenshot per feature; footer by category | Done |
| Real screenshots for every feature page: 16 previously without one (sales, manufacturing, quality, maintenance, documents, logistics, reports, portals, marketing, helpdesk, clinic, construction, custom objects, education, compliance, Copilot) plus the newest features (dashboard, search, builder drag/connect/phone styles, hosting & publishing, onboarding) | Done — captured from demo workspaces by `scripts/marketing/capture-*.spec.ts` (re-runnable against a dev server). Copilot shows its rule-based checks and the honest "no AI provider" state; no AI answer is faked |

## Platform control centre — super admin (2026-10-25, migrations 0080–0082)

| Item | Status |
| --- | --- |
| Admin roles (owner, admin, support, analyst) with a server-side permission matrix; the console doesn't exist for anyone else; owners can't remove the last owner or change their own role | Done; integration tested |
| Console guards: optional IP allowlist (exact IPs and IPv4 ranges) and "require two-step sign-in for admins" | Done; integration tested. The allowlist trusts X-Forwarded-For, so it needs a proxy that sets it |
| Overview analytics: workspaces, people, active workspaces/people (1/7/30 days), daily sign-ups / new workspaces / active workspaces / sign-ins, funnel to paying, plans in force, trials, MRR from the billing provider's real prices, module adoption, industries, store sales, AI cost, emails, busiest workspaces | Done; counted live from the database. MRR shows “—” until billing is connected |
| Health: database latency, size, connections, migrations applied vs shipped, largest tables, server uptime/memory, job states, jobs that gave up (with retry), schedulers, failures across workspaces (deployments, domains, external publishing, emails, webhooks, sign-ins by address) | Done; integration + e2e |
| Go-live checklist: 13 automatic checks (production mode, HTTPS address, encryption key, migrations, email, billing, domains, worker, admins, admin two-step, support/legal links, maintenance, sign-up) and 8 manual confirmations (backups, monitoring, TLS, secrets, legal, load test, incident, DNS) with who/when | Done; integration + e2e |
| Workspaces: search/filter, CSV export, usage counts, suspend (optionally taking public sites offline — they answer 503), trials, complimentary plans, private notes, activity only under support access | Done; integration tested |
| People: search/filter, CSV export (formula-safe), workspaces, sessions, sign-ins; disable (ends sessions, blocks every sign-in path), enable, sign out everywhere, mark email verified | Done; integration tested |
| Platform-wide audit log search (action prefix, workspace, actor, period) | Done |
| Settings: product name, support email, status/terms/privacy links; sign-up open / invite-only / closed, allowed and blocked domains, the trial new workspaces start on | Done; sign-up rules enforced for email and GitHub sign-up (SSO/SCIM provisioning is per workspace and not affected) |
| Maintenance mode (workspaces read-only for members, banner; admins, sign-in and public sites unaffected) and announcement banner (all or one plan, tone, link, end time) | Done; integration + e2e |
| Plan limit overrides per plan | Done; applied wherever limits are enforced (only once billing is configured) |
| Integrations: status of every platform-level integration from the environment (never values) with live tests for database, email, Stripe/Razorpay (fetches a price) and AI (lists models, no tokens) | Done; database test integration tested. Email/billing/AI tests need real credentials and were not run here |
| Infrastructure: live server facts, a scaling-readiness list, reference architecture, `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/kubernetes.yaml`, `docs/DEPLOY.md`, and `APP_ROLE=web` to split web and worker nodes | Done. **The Docker and Kubernetes files were not built or run here (no Docker on this machine)** |

| Revenue: what clients take through the platform (store, POS, invoice payments, restaurant bills, bookings, school/clinic/construction payments) by currency — 30 days, previous 30, all time, by source, 12-month series, top 20 clients — and platform subscription revenue (MRR only from the billing provider's real prices) | Done; integration tested. Payment tables without a currency column (school, clinic, construction) are treated as INR; booking revenue is dated by booking creation; restaurant refunds aren't tracked separately |
| Module dashboards: all 32 modules plus web apps & hosting — switched on vs actively used, records (30 d vs previous 30), growth, module-specific results (e.g. deals won value, tickets resolved and median first response, payroll processed, deploy success rate), 30-day trend, top 5 workspaces | Done; integration tested. Amounts from tables without a currency are shown without a symbol |
| Client 360: profile, owners and members (last seen, two-step), plan and billing, usage vs limits, modules, web apps with domains and last deployment, revenue, AI spend, storage, failing jobs, sign-ins, activity by area, health flags | Done; counts and totals only — no business record contents |
| Scalability insights: requests, server-error rate and latency percentiles (from a per-minute histogram written by every server), by area, servers serving, peak per minute, database size/connections/active queries/cache hit ratio, daily growth with a straight-line projection, table growth, job throughput and backlog, and rule-based recommendations | Done; integration tested. Projections need three days of snapshots |
| Integration setup from the console: step-by-step guides for every integration; email, Stripe, Razorpay, GitHub, AI and Voyage settings saved encrypted (never returned, audited by key name only, environment wins, active on every server within 30 s), format-checked, live tests | Done; integration + e2e |
| Password re-entry (15 minutes) for sensitive admin actions: admin roles, disabling accounts, admin security settings, integration secrets | Done; integration tested |
| Shared rate limits in Postgres for production (one atomic upsert per check, falls back to memory if the database is unreachable); all 133 call sites | Done; integration tested |
| Production start-up check, HSTS / COOP headers, no X-Powered-By, `deploy/Caddyfile` with on-demand TLS for customer domains | Done. Docker/Kubernetes/Caddy files not run here (no Docker on this machine) |

Honest limits:
- No impersonation (“log in as”) — by design; support works through the owner-granted support access.
- No in-console provisioning of servers or databases; the console shows and checks the installation, and `deploy/` has the files to run it.
- Platform settings take up to 10 seconds, and console-saved integration settings up to 30 seconds, to reach other servers.
- The admin IP allowlist and rate limits trust the first X-Forwarded-For address, so the proxy must overwrite that header (Go-live tracks it).
- Plan prices are set in Stripe/Razorpay, not in the console.

## Builder Pro: direct editing, connected sections, export and deploy (GitHub, Netlify, Vercel, Cloudflare Pages), SEO (2026-10-25, migration 0079)

| Item | Status |
| --- | --- |
| Drag a section from the gallery (or a global component) onto the canvas, with an insertion line and edge auto-scroll; navigation/banner stay first and the footer last | Done; e2e `builder-pro.spec.ts` |
| Move a section by its toolbar handle on the canvas (release outside or Esc cancels) | Done; e2e |
| Copy / paste a section, and copy / paste just its style — across pages and web apps (⌘C/⌘V, ⌥⌘C/⌥⌘V, toolbar menu); pasted content is schema-validated | Done; e2e |
| Element tree per section in Layers; click to select an element | Done |
| Per-device element styles (tablet and phone overrides for colour, size, weight, alignment, spacing, width, hide) and hover styles (colour, background, scale, lift, shadow), CSS-only | Done; unit tested |
| Connect panel: per-module status for CRM, Helpdesk, HR hiring, Marketing, Store, Bookings, Data, Chatbot, Automations, with one-click sections | Done; e2e |
| Live sections: open jobs (HR), upcoming events (Marketing), support form → Helpdesk ticket; newsletter sign-ups become CRM subscribers with marketing consent | Done; integration tested. Filled per request on the hosted site — no republish needed |
| Download the published version as a .zip (one folder per page, 404, sitemap, robots, _headers with the same CSP) | Done; integration tested with `unzip` |
| Publish to GitHub (one commit, stale exported files removed), Netlify (zip deploy, waits for ready) and Vercel (production deployment) with the person's own token, encrypted at rest and never returned | Done against each provider's documented REST API; **tested only against a mocked provider** — no real account was used. Success is reported only when the provider confirms it |
| Cloudflare Pages: Direct Upload (upload token → only missing files → deployment with `_headers`), project made if missing, waits for the deploy stage | Done against the documented Direct Upload flow; **tested only against a mocked provider**. File keys are SHA-256 based where Wrangler uses BLAKE3 — whether Cloudflare accepts them is unverified until a first real publish |
| Hosting & publishing card: live status per host (not connected / connected / published / needs attention), step-by-step guide per provider with links, 4-step connect wizard, "Check connection" asks the provider whether the token works before saving (nothing published) | Done; integration + e2e `hosting.spec.ts` (e2e stops at local validation — no real provider is called) |
| Forms on an exported copy keep working (post back to the platform, only from origins of connected targets) | Done; integration tested |
| Page SEO: hide from search engines (noindex + left out of sitemaps), canonical address | Done; unit + e2e |
| Site SEO: favicon, Google/Bing verification codes, schema.org business data on the home page and BlogPosting on posts (escaped JSON-LD) | Done; unit + e2e |

Honest limits:
- No direct S3 or FTP publishing — download the zip and upload it there.
- Shop, cart, checkout, account, booking and order pages need the server, so on an exported copy they link to the site hosted here.
- Live sections on an exported copy are a snapshot from export time; publish again to refresh them (on the hosted site they are always live).
- GitHub publishing commits static files; it does not set up GitHub Pages or a build workflow for you.
- Sections are composed from the section library plus the freeform section; there is no arbitrary nested element tree (add elements inside elements).
- No third-party analytics or tag-manager scripts (the CSP forbids them); built-in Growth analytics is used instead.

## Sign-in & onboarding (2026-10-21)

| Item | Status |
| --- | --- |
| Pastel split-screen sign-in/sign-up (light and dark), password reveal and strength hint | Done |
| `/welcome` onboarding: welcome → create (website / store / internal software “Coming soon”) → about you → ready → `/launch?kind=…` | Done; e2e covered |
| Answers and “notify me about internal software” saved on the user (`users.onboarding`, `onboarded_at`) | Done; nothing emails people yet when internal software opens — the list is recorded for when it does |
| Needs discovery (2026-10-21, later): describe the business → live understanding (category, store vs website, goals, with the matched words) → where customers buy → goals → what you have (incl. domain) → personal plan | Done; rules in `src/lib/onboarding/understand.ts` (keyword matching, no AI), unit-tested; e2e covered |
| Animated onboarding art (CSS/SVG, no downloads), reduced-motion respected, light and dark | Done |
| Launch pre-filled from onboarding; domain step (free address or your own domain, www suggestion for bare domains); domain added during launch with exact DNS records and a live check | Done; integration and e2e tested. DNS checks run against real DNS — not exercised against a real registrar here |
| Bookings set up during launch when asked for (services hidden until priced) | Done; integration-tested |
| Project dashboard: live site with preview, setup checklist from real data, shortcuts | Done; integration-tested |
| Spotlight product tour (auto after launch, invitation otherwise, replayable; keyboard and phone layouts) | Done; e2e covered |

## Five-minute launch (2026-10-21)

| Item | Status |
| --- | --- |
| Guided `/launch` journey with animated steps, store or website | Done; e2e covered end to end |
| Smart import of any Excel/CSV (xlsx, xls, xlsb, ods, numbers, csv, tsv; Shopify/WooCommerce exports; European and Indian number formats) | Done; unit-tested with real workbooks |
| Per-product highlighting of required and suggested fields, inline fixes, bulk fixes, column remapping | Done |
| Photo-link check before import (broken links removed and flagged) | Done |
| Launch endpoint: project, design, logo, store, products (incomplete → drafts), COD/UPI, production publish, streamed progress | Done; integration-tested |
| Launch-ready copy (no template placeholders; delivery and payment answers from the owner's choices) | Done; every store template × look checked against the publish rules |

## In-store selling (2026-10-21)

| Item | Status |
| --- | --- |
| Point of sale (`/projects/:id/pos`): scan box that always catches a USB/Bluetooth scanner, camera scanning (BarcodeDetector), product grid with search, variants, quantities, `3*code` multiples | Done; e2e covered |
| Cash with quick amounts and change, UPI pay-by-QR from the store's UPI ID, card with reference; discount (% or amount); customer and buyer GSTIN; price override for catalog managers only | Done; integration-tested |
| Sales are paid, delivered orders (`channel = pos`) with invoice numbers, stock decrement, events; idempotent retries; oversell needs confirmation | Done; integration-tested |
| 80 mm receipt with CGST/SGST split and a shop-online QR; daily summary by payment method | Done |
| In-store EAN-13 barcodes (GS1 "20" prefix) for every variant; own EAN/UPC accepted; unique per store | Done; unit-tested with an independent decoder |
| Labels & barcodes page: thermal rolls (50×25, 50×30, 38×25, 58×40, 100×50 mm, and 2-across 38×25), A4 sheets of 21, 24, 40 and 65; shop name, name, price, MRP, barcode, QR; copies or copies = stock; start position on part-used sheets | Done; unit-tested |
| Exact print preview: one generated document laid out in millimetres with the stock's @page size is both the preview and the printout; warnings for unscannable sizes | Done; checked as real PDFs |
| Barcode and labels card in the product editor | Done |
| Fixes: imported products could fail to save (long titles, 5-digit HSN); samples crowded real products on the home page; drafts were invisible without notice; no save guard | Done; integration-tested |

## Templates by business & adding a store to a website (2026-10-23)

| Item | Status |
| --- | --- |
| Templates → **By business**: five templates for each of the 9 businesses (mix of websites and online stores), opening on the visitor's own industry. Mapping in `lib/templates/collections.ts`, checked by a unit test (every id exists, five distinct per business) | Done; unit-tested |
| New website templates: patisserie, fine dining, bar & lounge, resort & villas, hair salon, makeup studio, multi-speciality clinic, physiotherapy, skin clinic, eye care, yoga studio, boxing gym — each with a set design direction, its own hero words and hand-checked photos (`templateDoc`) | Done |
| New store templates (glass collection): Aurum fine jewellery, Kundan bridal jewellery, Crumb artisan bakery — with sample catalogues and full-page previews | Done |
| **Add a store to an existing website** (`POST /projects/:id/store/embed`, needs store:manage + design:write; audited `store.embedded`): sets up the store and optional sample products, then adds a Shop link and cart to every menu, store links to every footer, and a product grid (+ optional category tiles) on the home page — after the hero or near the end — in the site's design direction (grid variant, spacing, motion, background rhythm). Pure transform in `lib/store/embed.ts`; idempotent; the previous site stays in file history. Switches the Online store feature on when an owner/admin had it off | Done; unit and integration tested |
| Store page for a website project: choose **Add it to this website** (live before/after preview of the changed part of the home page, using the chosen sample products) or **Build a separate store** (five-minute launch or store templates), or redesign as a store | Done; browser-reviewed |
| Shop, product, cart and checkout pages already use the website's own header, footer and theme | Existing behaviour, verified on a published site |

## Business pages & navigation (2026-10-23)

| Item | Status |
| --- | --- |
| `/for` and `/for/<slug>` for 9 businesses (boutiques & fashion, bakeries & cafés, restaurants & hotels, salons & spas, jewellery, studios & consultants, clinics, home & décor, fitness & wellness): stacked real-screenshot hero, “what changes”, a day-in-the-life tour of real screens, the toolkit switched on at sign-up, good-to-know limits and FAQs. Content in `components/marketing/businesses.ts`; claims checked against the code (e.g. follow-ups run after a booking — reminders timed before appointments aren't built) | Done; e2e covered |
| “Start free as a …” signs up straight into onboarding with that industry pre-picked (`/welcome?industry=…`) | Done; e2e covered |
| Header: Features and Businesses menus in one shared panel that glides and resizes between them, icon rows instead of photos, hover-intent open/close, keyboard and Escape support; phone menu with accordions; footer Businesses column; homepage business cards link to their pages | Done; browser-reviewed |

## Onboarding & workspace features (2026-10-23)

| Item | Status |
| --- | --- |
| Workspace features per organization (`organizations.modules`, `industry`; migration 0037): Online store, Point of sale, Cloudesk for Horeca, Invoices & finance, Bookings, Promotions, Growth, Automations, Chatbot, Data & APIs, AI code editor. Always included: home, projects, website builder, brand, integrations, deployments, team, settings. `null` = everything on, so existing workspaces are unchanged | Done; integration-tested |
| `GET/PUT /api/v1/orgs/:id/modules` (owners and admins; audited as `org.modules_updated`) | Done; integration-tested |
| Sidebar, command palette, project overview shortcuts, the dashboard tour and launch “what's next” cards only show switched-on features; opening a switched-off page shows a “Switch on …” card (or “ask an owner”) instead of the page | Done; e2e covered |
| Settings → Features: switch features on/off, back to the industry's recommendation, or everything on | Done; e2e covered |
| Onboarding (about 2 minutes, rebuilt 2026-10-25): welcome → the business (name, a line about it — what it picked up is shown as chips, e.g. "sells online", "12 people" — and 15 photo industry tiles, one suggested from the line) → five quick questions (how customers buy, team size, what you track, money, customers), pre-answered from the industry's usual answers plus the line, with the plan forming live beside them → the plan: recommended features each with the reason it's there, an on/off switch and the parts to leave out, plus "Add something else" with search, and a live dashboard preview grouped like the sidebar → real setup steps → ready. Full-width two-column layout on desktop, sticky progress and action bars, a slide-up preview sheet on phones. Recommendations are plain rules in `src/lib/onboarding/recommend.ts` (not AI), tested in `tests/unit/onboarding-recommend.test.ts` (8) | Done; e2e covered (store, restaurant, retail-with-parts and clinic-link paths) |
| Removed from onboarding | The domain question (asked in the launch flow instead) and the “internal software” waitlist (replaced by the Startup & software industry) |
| Not a permission boundary | Switching a feature off hides it in the dashboard; its API stays available to roles that already have access |

## Home dashboard (2026-10-25, migration 0078)

| Item | Status |
| --- | --- |
| What it shows | `GET /api/v1/orgs/:id/dashboard` assembles, for switched-on modules the member's role can see: key numbers (invoiced this month with change vs the same days last month, customers owe you, cash and bank, profit this month, owed to suppliers, open pipeline, won this month, shop sales, orders to deliver, stock value, team in today, hours this week, open tickets, appointments today), charts (income vs expenses from the books — or invoiced vs collected without them — shop sales 14 days, pipeline by stage, tickets opened vs resolved 14 days, attendance 7 days, drawn with the Reports chart component: tooltips, legend, table view), "needs attention" (overdue invoices, suppliers past due, negative cash, GST payable, quiet and late deals, missed ticket targets, unassigned tickets, low and negative stock, late tasks and sales orders, pending leave, payroll not finalised, fees overdue — most serious first), "waiting on you" (from My work), recent activity (audit log, in plain words), recent web apps, AI usage and the launch/brief box |
| Accuracy | Every figure comes from the workspace's records; money is rupees only (other currencies are left out, said in the chart subtitles); shop sales are paid, not-cancelled orders net of refunds; a block with no records isn't shown (no row of ₹0 tiles for empty books); a block that fails is logged as an error and left out rather than shown as zero |
| Personal | Sections reorder (drag or arrows) and hide/show in Customise; saved per person and workspace (`user_dashboards`), so it follows them across devices; quick actions rank by the person's own use from Home, then their activity in the last 60 days, then defaults; refreshes every two minutes and on demand |
| Tests | `tests/integration/dashboard.test.ts` (6) |
| Limits | No per-widget date range or drill-down filters on Home (use Reports); charts are fixed per module; activity covers what's in the audit log |

## Custom fields, objects, rules, bulk changes, offline & residency — ERP phase X (2026-10-25, migration 0077)

Settings → Customise (fields, rules, records & bulk changes, bulk history) and a new module `objects` (Custom objects, at /objects; on by default for the "Startup & software" industry). Permissions `custom:read` (team), `custom:write` (owner, admin, billing, developer, designer, editor), `custom:manage` (owner, admin: fields, objects, rules, bulk deletes). Filling in a built-in record's fields also needs that module's own write permission (e.g. `inventory:write`; employees need `hr:manage`).

| Item | Status |
| --- | --- |
| Custom fields on built-in records | Items, suppliers, employees, projects, maintenance assets, vehicles, helpdesk tickets, students, patients and construction contracts (CRM keeps its own custom fields); types text, long text, number, amount (paise), date, one/several of a list, yes/no, web link (http/https only), email, phone, link to a record; needed fields, help text, order; key fixed once made; type can't change once any record has a value; at most 40 per kind; a "Your fields" card on each record's page (and the supplier dialog) |
| Custom objects | Up to 30 per workspace: singular and plural names (unique), description, numbering prefix (VIS-0001, numbered in order even when two save at once), the field that names records, which roles may add and change records (owners and admins always); records with search (title, any value, or number; the API also filters on one field), a page each with who changed it last; deleting a record keeps its values in the audit log; deleting an object needs its name typed when it has records, and is refused while another object's field links to it |
| Links | A link field points at a built-in record or a custom object's record; the record must exist in the workspace; shown as a link on both ends ("Linked from" lists records linking here); search-as-you-type picker |
| Rules | Per kind of record, up to 30: "when all of these… then all of these must be true", with is / isn't / more / at least / less / at most / filled / empty / contains / one of, compared with a value, `today`, or another field (`@key`); rules on built-in records can also look at the record's own fields (category, status…); a broken rule refuses the save with your message — on edits, imports and bulk changes; a field a rule uses can't be deleted; rule changes are audited |
| Import & export | Built-in records: their custom fields from any spreadsheet, matched by SKU, employee no., code, registration, ticket number, admission no., MRN or name ("leave filled-in ones alone" mode); objects: records from a spreadsheet (same title updates); links matched by the linked record's name or number; export of both through the workspace's download rule |
| Bulk changes | Pick records (up to 1,000) and set one field — each record checked like a single save, ones a rule refuses left alone and listed; owners/admins can delete picked object records after typing how many; every run is audited with the record ids and kept with what each record was before; undo (by whoever ran it, or an owner/admin) puts values back except on records changed since, and brings deleted records back unless their number was reused |
| Offline | Installable (web app manifest, own window); a service worker keeps the app's code for fast and offline start and shows an offline page — it never stores API answers or pages, so no business data is kept on the device by it; a strip shows when the connection is down and what's waiting; construction measurements, the site diary and new custom-object records made offline are kept in the browser and sent when the connection returns (also on the next visit), each with an Idempotency-Key; refused ones stay listed with the reason (try again or discard) |
| Idempotency | Any signed-in write with an `Idempotency-Key` header (8–80 letters, digits, - or _) is done once: a repeat gets the first answer (`Idempotent-Replayed: true`); the same key on a different request is refused; failures aren't kept, so a retry runs again; answers kept 7 days per person |
| Data residency | Settings → Workspace shows where the data is kept as the operator declared it (`DATA_REGION`; files are in the same database) and which outside services this deployment is set up to send data to (Resend, Anthropic, Voyage, OpenAI — only whether each is configured, never a key) |
| Tests | `tests/unit/custom-model.test.ts` (6), `tests/integration/custom.test.ts` (13), `e2e/custom.spec.ts` |
| Limits | Rules run when custom values are saved, not on every save of a module's own form, and can't change values (use Automations); built-in reports, automations, approvals and the ERP API don't read custom fields or objects yet; no formula or roll-up fields, no per-field permissions, no custom object views/kanban; offline covers only the three screens above (others need a connection, and data on screen isn't kept across a reload while offline); outbox items are per browser and lost if site data is cleared; two identical writes sent at the same instant with one key can both run (the outbox sends one at a time); one data region per deployment — choosing a region per workspace isn't available |

## Industry pack: Construction — ERP phase W (2026-10-25, migration 0076)

A new module (`construction`, at /construction: contracts, each with BOQ, Measurements, RA bills, Money received and Site diary); the onboarding industry "Construction & contracting" switches it on with Inventory, HR, Accounting, Invoicing, Documents and Maintenance. Permissions `con:read` (team), `con:write` (owner, admin, billing, developer, designer, editor: measurements, preparing and submitting bills, the diary), `con:manage` (owner, admin: contracts, the BOQ, checking measurements, certification, money received). Accounts 4060 Contract revenue, 1430 TDS receivable, 1440 Retention receivable.

| Item | Status |
| --- | --- |
| Contracts | Client and GSTIN, work order no., site, start and completion; retention % (default 5), mobilisation advance recovery % (default 10), GST rate (18/12/5/none) with IGST for an inter-state client, the client's TDS % (default 2); the terms can't change once a bill has been submitted; status active, completed, closed; certified value against the BOQ (progress) and what's still to receive on every contract |
| Bill of quantities | Item code (unique per contract), description, unit, quantity, rate; import from the tender's spreadsheet (existing codes updated) and export with measured and billed quantities; measured beyond the BOQ shown in red |
| Measurement book | Per BOQ item: date (not in the future), location, nos × length × breadth × depth (any dimension can be left out) or a direct quantity, a live preview of the quantity; checked by an owner/admin; locked once in an RA bill |
| RA bills | Prepared from every measurement up to a date that's not yet billed (one draft at a time); each item's up-to-date, previous and this-bill quantity at the BOQ rate, flagged when over the BOQ quantity; retention, advance recovery (never more than the advance still to recover), GST and TDS on the work; draft → submitted → certified (a lower certified amount re-works the deductions on it, with the client's reference) → paid; a draft can be deleted to free its measurements; a printable abstract |
| Money received | Against a certified bill (never more than due; the bill becomes paid when fully received), a mobilisation advance (then recovered from later bills), or retention released (never more than held), into a chosen cash/bank account |
| Site diary | One entry per day: weather, labour by trade ("Mason 8, Helper 12"), work done, hindrances, who wrote it |
| Books | A certified bill: Dr receivables (net), Retention receivable, Customer advances (recovery), TDS receivable; Cr Contract revenue and CGST/SGST or IGST. Receipts: Dr the account, Cr receivables / Customer advances / Retention receivable |
| Tests | `tests/unit/construction-model.test.ts` (2), `tests/integration/construction.test.ts` (6), `e2e/construction.spec.ts` |
| Limits | Bills the client only — subcontractor bills and labour go through Payables and HR; no extra items, variation orders or price escalation (add BOQ items); no deductions for material issued, no secured advance, no labour cess or GST TDS; no drawings, Gantt schedule, material reconciliation against the BOQ or site photos (use Documents); one GST rate per contract |

## Industry pack: Clinic — ERP phase W (2026-10-25, migration 0075)

A new module (`clinic`, at /clinic: Today, Patients, Appointments, Settings); the onboarding industry "Clinic & healthcare" now switches it on (with Accounting). Permissions `clinic:read` (team: the front desk), `clinic:write` (owner, admin, billing, developer, designer, editor), `clinic:manage` (owner, admin). Clinicians are chosen in settings (none chosen: owners and admins). Account 4050 Clinic income.

| Item | Status |
| --- | --- |
| Patients | MRN-00001 numbering; name, date of birth or age, gender, phone, email, address, blood group, allergies, long-term conditions, emergency contact; registration needs the patient's consent (time recorded); search by name, MRN or phone |
| Appointments & queue | Booked with one of the clinicians, a day (not past) and optional time; a token per doctor and day (unique, retried if two book at once); overlapping times for a doctor refused; statuses booked → arrived (waiting) → in consultation (clinicians only) → done, or no-show / cancelled, with only sensible moves allowed; the day's queue by doctor; follow-ups due today on the overview |
| Consultations | Clinicians only: vitals (BP, pulse, temperature, SpO₂, weight, height) with BMI and its band and flags for high/low BP, low SpO₂, fever and fast/slow pulse; complaints, examination, diagnosis with an optional ICD-10 code (format checked), prescription lines (medicine, strength, dose like 1-0-1, days, instructions), advice, tests, follow-up date; starting one from an arrived appointment moves it to "with doctor"; signing (by the doctor who wrote it) locks it and closes the appointment; afterwards any clinician can add dated notes; a printable prescription |
| Privacy | The front desk sees details, appointments and bills — not consultations, allergies or conditions; every look at a patient's clinical record and every prescription print is in the audit log |
| Bills | Services with default fees (and per-doctor consultation fees in settings), quantity, discount (not more than the bill); CB-00001 numbering; part and full payments by UPI, cash, card, bank or insurance into a chosen account, never more than due; void only if nothing is paid |
| Books | Each bill Dr receivables, Cr Clinic income (no GST — healthcare services are exempt); each payment Dr the account it went into, Cr receivables |
| Tests | `tests/unit/clinic-model.test.ts` (3), `tests/integration/clinic.test.ts` (5), `e2e/clinic.spec.ts` |
| Limits | Not an ABDM/ABHA-linked electronic health record and not a certified medical device; no lab orders and results, pharmacy stock or dispensing, insurance/TPA claims, e-prescriptions with drug interaction checks, or patient app; reminders aren't sent (no SMS/WhatsApp provider); one clinic location; no image or document attachments on consultations (use Documents) |

## Industry pack: Education — ERP phase W (2026-10-25, migration 0074)

A new module (`education`, at /school: Overview, Students, Classes, Fees, Attendance, Exams, Settings), an onboarding industry "School & coaching" that switches it on with HR, CRM, Accounting, Finance, Helpdesk and Automations. Permissions `edu:read` (team), `edu:write` (owner, admin, billing, developer, designer, editor), `edu:manage` (owner, admin). Account 4040 Fee income.

| Item | Status |
| --- | --- |
| Classes & students | Classes by year and section with a class teacher and seats; students with admission number (ADM-0001 when left blank, unique), class, roll number, date of birth, gender, guardian with phone and email, address, status (studying, left, passed out); a fee concession percentage with its reason that only owners and admins can give; each student's fees, receipts, attendance and exams on one page; import from any spreadsheet (classes matched by name and section, existing students by admission number) and export |
| Fee plans | Heads (tuition, transport…) with whether concessions apply to each, instalments with due dates that must add up to 100% (split to the paisa, rounding on the last), the classes it's for, GST (none, or 18% for coaching) split as CGST/SGST; raising a plan creates each student's instalments with their concession — running it again only adds what's missing (new students); a plan can't change once raised |
| Collecting | Part or full payments by UPI, cash, card, bank or cheque into a chosen cash/bank account, each with a numbered receipt (RCT-00001), never more than what's due and never in the future; waivers with a reason (owners/admins, not on part-paid fees); dues overdue first with totals and export; this month's collections by method |
| Reminders | An hourly sweep emails guardians about fees due within the reminder window (default 3 days) and weekly while overdue; paid, waived and no-email students are skipped |
| Attendance | By class and day: present, absent, late, leave (not in the future), "everyone present"; monthly percentage per student (late counts as attended, leave is excused); today's attendance on the overview |
| Exams & report cards | Exams per class with subjects and maximum marks; a marks sheet (no marks over the maximum); report cards with percentages, a CBSE-style grade scale (A1…E, editable floors), pass/fail at the pass mark (default 33% in every subject), "incomplete" until every subject is in, and rank in class; printable |
| Books | Each fee posts Dr receivables, Cr Fee income (and CGST/SGST); each payment Dr the account it went into (cash, the default bank, or the chosen account), Cr receivables; waived fees aren't posted |
| Tests | `tests/unit/education-model.test.ts` (5), `tests/integration/education.test.ts` (8), `e2e/education.spec.ts` |
| Limits | No online fee payment for parents, no SMS/WhatsApp reminders, no timetable, transport routes, hostel, library or admissions enquiry pipeline; inter-state GST (IGST) on coaching fees isn't handled; report cards are per exam (no term aggregation or co-scholastic areas); no guardian login (the customer portal is for invoicing clients) |

## Platform admin, SSO/SCIM & security monitoring — ERP phase V (2026-10-25, migration 0073)

Workspace settings: Identity (`/settings/identity`) and Workspace (`/settings/workspace`); personal sign-ins on the Account settings page; the platform console at `/admin` (users with `is_platform_admin`; a 404 for everyone else).

| Item | Status |
| --- | --- |
| Single sign-on (OIDC) | Owners/admins verify an email domain with a DNS TXT record (`_cloudesk.<domain>` = `cloudesk-verify=…`; public domains like gmail.com refused; one workspace per verified domain) and connect any OpenID Connect provider (issuer checked through its discovery document; client secret stored encrypted, never returned). "Sign in with SSO" on the login page takes a work email to that provider with PKCE (S256), a state and a nonce sealed in a 10-minute cookie; the code is exchanged with client_secret_basic; the ID token is verified here — RS256 or ES256 signature against the provider's JWKS, issuer, audience/azp, expiry, issued-at, nonce, a subject, and a verified email on a verified domain. New people are created and added with the chosen role (seat limit applies); existing people sign in; logged as `user.login` via sso |
| Require SSO | With a verified domain, "require SSO" stops that domain's members from signing in to their account with a password or GitHub (the message says to use SSO); the setting warns to keep an owner on another domain |
| SCIM 2.0 | `/api/v1/scim/v2` with a workspace bearer token (`scim_…`, shown once, hashed; replace or switch off): ServiceProviderConfig, ResourceTypes, Users list with `userName eq` filter and paging, get, create (409 if already a member), PUT, PATCH (active, name), DELETE; deprovisioning removes the workspace membership (never an owner) and signs the person out if it was their only workspace; reactivating re-adds them; every change in the audit log |
| Sign-in monitoring | Every attempt recorded (password, two-factor, GitHub, SSO; success or the reason it failed; address and browser); a successful sign-in from a browser and network not seen before for that person emails them; each person sees their recent sign-ins; owners and admins see members' sign-ins for the week and who had 5 or more failures; kept a year |
| Platform console | Every workspace with effective plan, paid plan and status, members, last activity, and state; search and filter (trial, suspended, deleting); suspend with a reason (members get "This workspace is suspended: …" on every request) and lift; give a Pro/Business trial for 1–90 days (counted in the effective plan, so limits follow) and end it; all logged |
| Support access | A workspace owner/admin lets platform support look in for 4, 24 or 72 hours with a reason, and can end it; only then does the console show the workspace's recent activity and modules, each look written to the workspace's own audit log; no impersonation or record access |
| Release flags | Platform-wide flags (key, description) on for everyone or for listed workspaces; `isFlagOn(key, orgId)` for code paths (cached 30 seconds) |
| Export & offboarding | Owners/admins export the whole workspace — every table with its id, as gzipped JSON, files as base64, members without credentials, and password/secret/token/hash columns left out — made in the background, emailed when ready, downloadable for 7 days (each download logged). An owner schedules deletion by typing the workspace name; it's removed with everything in it after 30 days unless an owner cancels; all owners are emailed |
| Retention | Per workspace: audit log forever / 1 / 3 / 7 years, notifications 90 days / 1 / 3 years; an hourly sweep applies it, clears expired exports and deletes workspaces past their date |
| Error handling | Any schema validation that reaches the shared error handler is a 422 with the field messages (it was a 500) |
| Background jobs | The integration hub's webhook delivery job (phase U) and the export job are now registered with the job worker — before this, queued webhook deliveries in production would have failed as an unknown job |
| Tests | `tests/integration/sso.test.ts` (6, with a mock identity provider signing real RS256 tokens), `tests/integration/platform-admin.test.ts` (8), `e2e/platform.spec.ts` |
| Limits | SAML isn't supported (OIDC only); SSO hasn't been run against a live identity provider here; SCIM covers Users, not Groups; no just-in-time role mapping from IdP groups; no account lockout beyond rate limits (repeated failures are shown, not blocked); new-device detection uses browser, OS and the first two parts of the IP address, so it can miss or over-report; backups, disaster recovery and data residency are infrastructure matters outside the app; platform admins are set in the database (no UI to grant it) |

## Integration hub — ERP phase U (2026-10-25, migration 0072)

Workspace-wide, at Settings → Integrations (Webhooks, API keys, Background work, Reconciliation); members' API `/api/v1/orgs/:org/hub`; the ERP API at `/api/v1/erp` with its description at `/api/v1/erp/openapi.json`. Viewing needs `audit:read` (owner, admin); changing needs `integrations:manage` (owner, admin, developer). Project-level website/store integrations, keys and webhooks are unchanged.

| Item | Status |
| --- | --- |
| ERP events | crm.contact.created, crm.deal.won, sales.order.confirmed, accounts.bill.created, accounts.bill.paid, inventory.po.sent, inventory.goods.received, helpdesk.ticket.created, helpdesk.ticket.resolved, logistics.shipment.delivered, grc.incident.reported (and hub.test) — raised where the work happens; a webhook problem never undoes the work |
| Workspace webhooks | Up to 20; an https address on a standard port (checked against private addresses when sent), chosen events or every event; JSON `{id, type, createdAt, orgId, data}` signed in `CC-Signature: t=…,v1=HMAC-SHA256("t.body")` with a `whsec_` secret shown once (roll a new one any time); retried with backoff up to 8 attempts; 410 Gone or 25 failures in a row switch it off with the reason (switching it back on resets the count); delivery log with status, attempts, HTTP status and error; send again; send a test; add/delete/off logged in the audit log |
| ERP API | Workspace keys `ck_org_…` (shown once, SHA-256 stored, up to 25, scopes, expiry 30/90/365 days or never, revoke) with scopes contacts:read/write, deals:read, items:read (with stock on hand), suppliers:read (no bank details), sales_orders:read, bills:read, tickets:read/write; GET lists oldest first with `limit` (≤100) and `next_cursor`; POST contacts (409 if the email/phone exists) and POST tickets (channel "api", optional acknowledgement email); amounts in paise; 600 requests a minute per key; module switched off → 403; every call logged (method, path, status, version, time) for 30 days with a 7-day usage view |
| Versioning | `Cloudesk-Version` header (supported: 2026-10-25); an unknown version is refused; every answer carries the version that served it; new versions will be added alongside, with the date in the version name |
| Background work | Counts of waiting, running, retrying, given-up and done-in-24-hours jobs for the workspace; the failures with their last error; retry now; webhook deliveries retrying and given up in the last 7 days |
| Reconciliation | Per day (India time) and webhook for 14 days: events sent, delivered, still trying, gave up |
| Tests | `tests/integration/hub.test.ts` (6), `e2e/integrations.spec.ts` |
| Limits | No pre-built connectors to Tally, Zoho, QuickBooks, Shopify, Shiprocket, banks or the GST portal (each needs that service's credentials and API work) — the API and webhooks are how to connect them today; no field-mapping designer for connectors; write endpoints are contacts and tickets only; the ERP API covers the lists above, not every module; OAuth apps exist for projects but not yet for workspace keys; the rate limiter is per server instance |

## Master data & migration — ERP phase T (2026-10-25, migration 0071)

Workspace-wide, at Settings → Data (Imports, Duplicates, Saved columns, Downloads); API `/api/v1/orgs/:org/masterdata`. Reading needs workspace membership; changing the download rule and merging need `org:update` (owner, admin); everyone's import history needs `audit:read`.

| Item | Status |
| --- | --- |
| Import history | Every import through the smart importer (any list) is recorded: what, file, mode, rows, added/updated/skipped/not imported, who and when; the rows not imported (first 500, with the reason and the row as sent) can be downloaded again; totals of every money and number column in the file against what was saved, with the difference highlighted; an import that stopped part-way shows as not finished; logged as `data.imported`. People see their own imports; owners and admins see all |
| Saved columns | In the importer's column step, "Save these columns as…" keeps the heading → field mapping (and one-for-all values) for that list; a later file with the same headings uses it automatically ("Using saved columns …"); listed and deletable under Saved columns; saving the same name again replaces it |
| Big files | Imports are sent in batches of 300 rows from the browser with progress, each batch checked and saved row by row on the server (one bad row never stops the rest) — there is no server-side background job for files |
| Download rules | Who can download lists to Excel/CSV: everyone who can see the list, the team (not viewers or employees), or only owners and admins. Every download is checked against the rule and logged (`data.exported`, with list name, rows, format and page); blocked attempts are logged too (`data.export_blocked`) |
| Duplicates | Suppliers with the same GSTIN, PAN (or the PAN inside the GSTIN), bank account, email or name (ignoring Pvt/Ltd/M/s/case/punctuation); items with the same SKU or name; invoicing customers (across the workspace's books) with the same GSTIN, email or name |
| Merging suppliers | Owners and admins, after confirming: every reference to the supplier — found from the database's foreign keys, plus `supplier_id` columns kept without one (quotes, supplier returns, carriers, AMC contracts, inspections, NCRs) and the supplier lists inside RFQs and their awards — moves to the one kept, in one transaction; blank details (GSTIN, PAN, email, phone, contact, bank) are filled from the other, which is then removed; refused (nothing changes) when both have something that can exist only once per supplier, or a bank change is pending; logged with counts per table |
| Approving master changes | A new kind of approval, "Supplier bank detail changes": with a policy set (Settings → Approvals), changing a supplier's bank account or IFSC keeps the old details in use and holds the new ones until approved (other changes save at once); approving applies them, rejecting drops them; every bank change, requested, made or rejected, is in the audit log with the old and new account endings; the supplier card shows a pending change |
| Tests | `tests/integration/masterdata.test.ts` (6), `e2e/data.spec.ts` |
| Limits | Download rules stop the download buttons; anyone who can see a list can still copy it from the screen, and API access is governed by API keys' scopes. Import history is written by the importer in the browser (counts come from the server's replies; a closed tab mid-import leaves it "not finished"). Items and customers can't be merged (their ids live inside order and invoice lines) — mark the extra one inactive or archived. No UoM conversion master or tax master beyond what Inventory and Accounting already have; only supplier bank changes go through approval |

## Governance, risk & compliance — ERP phase S (2026-10-25, migration 0070)

A new module (`grc`, at /compliance: Overview, Risks, Controls, Calendar, Policies, Incidents, Internal audits, Checks, Emissions). Parts: "Risks & controls", "Compliance calendar", "Internal audits", "Emissions (ESG)". Permissions `grc:read` (everyone, employees too: read and acknowledge policies, report incidents, see their own reports), `grc:registers` (the team: see the registers), `grc:write` (owner, admin, billing, developer, editor), `grc:manage` (owner, admin: factors and limits).

| Item | Status |
| --- | --- |
| Risk register | RSK-0001; category, owner, likelihood and impact 1–5 (score 1–25: low < 5, medium < 10, high < 20, critical), residual likelihood/impact after controls (both or neither), treatment (reduce, accept, transfer, avoid), plan, status, review date (default 6 months; due reviews flagged), linked controls and incidents; a 5×5 heat map of where open risks stand now (residual where assessed); import a register from Excel/CSV (category and treatment words matched, scores clamped to 1–5, titles already present skipped) and export |
| Controls | Code (unique), owner, preventive/detective/corrective, test frequency; tests recorded with result (effective, partly, ineffective) and notes — the latest test sets the result and the next due date (month-end safe); overdue tests and failing controls on the overview |
| Compliance calendar | Obligations repeating monthly (for the month before, with a March override such as TDS by 30 April), on dates each year, or once; an Indian statutory pack (GSTR-1, GSTR-3B, GSTR-9, TDS/TCS deposit and quarterly returns, Form 16, advance tax, tax audit, audited ITR, PF, ESI, AOC-4, MGT-7, DIR-3 KYC) at standard due dates with notes on what varies; due dates laid out a year ahead from when the obligation was added; each marked done (ARN/challan reference), waived (with a reason) or back to pending; the owner (or owners/admins) is reminded N days before and once more if it goes overdue (hourly sweep) |
| Policies | Drafts published to everyone or chosen roles, who are asked to acknowledge; changing a published policy's text makes a new version that everyone acknowledges again; progress and who's still pending for the team; review dates; retire |
| Incidents | INC-0001; anyone reports (type, severity, when, personal data involved); owners and admins are told; the team investigates (owner, status, root cause — required to resolve — actions, linked risk); a reminder about CERT-In / Data Protection Board duties when personal data is involved; employees see only their own reports |
| Internal audits | AUD-0001 with scope, period, auditor and status; findings with severity, owner, due date (overdue flagged), recommendation and management's response (required to close) |
| Segregation of duties | By role: who can both raise POs and record supplier bills/payments, change employee records and run payroll, take sales orders and manage invoices; in the last 90 days: POs raised and received by the same person, bills entered and paid (payment run) by the same person. Needs access to Accounts |
| Fraud indicators | Suppliers sharing a bank account with each other; suppliers with an employee's bank account or PAN (from the PAN or GSTIN; needs payroll access); possible duplicate bills; unusually large bills; bills from one supplier on one day each under a limit (default ₹1,00,000) but together over it; round-sum bills of ₹50,000 or more |
| Emissions | Monthly readings of electricity (kWh), diesel, petrol (litres), LPG and CNG (kg); diesel and petrol from the Logistics fuel log counted automatically; scope 1 and scope 2 kg CO₂ by month as a chart and table; editable factors (defaults 0.716 kg/kWh grid, 2.68 diesel, 2.31 petrol, 2.98 LPG, 2.69 CNG) |
| Tests | `tests/unit/grc-model.test.ts` (9), `tests/integration/grc.test.ts` (11), `e2e/compliance.spec.ts` |
| Limits | Statutory dates are the standard ones — extensions and turnover/state/AGM-dependent dates must be edited by hand, and there's no feed of government notifications; no filing with any portal (GSTN, TRACES, EPFO, MCA) from here; checks are fixed rules, not learned models, and the 90-day duty checks only see what Cloudesk records (bill payments outside payment runs don't carry who paid); no scope 3 emissions, BRSR report format or assurance; policies are plain text (attach files via Documents); incidents don't file regulator reports |

## Helpdesk, customer & supplier portals — ERP phase R (2026-10-25, migrations 0067–0069)

Two new modules. **Helpdesk** (`helpdesk`, at /helpdesk: Tickets, Saved replies, Reports, Settings; a customer's ticket page at /support/:link). Permissions `hd:read` (team), `hd:write` (owner, admin, billing, developer, designer, editor), `hd:manage` (owner, admin). **Customer & supplier portals** (`portal`, parts "Customer portal" and "Supplier portal"; the team's page at /portals, the public portal at /portal/:workspace-slug). Permissions `portal:read` (team), `portal:manage` (owner, admin).

| Item | Status |
| --- | --- |
| Tickets in | Logged by the team (phone, chat, walk-in; the customer is emailed their reference and link unless turned off); by email to the workspace's inbound address (Postmark inbound JSON, or `{from, fromName, subject, text, messageId}`); from the customer portal. Numbered HD-0001 (prefix configurable); linked to the CRM contact with that email; automatic senders (mailer-daemon, no-reply) ignored; a redelivered email (same Message-ID) isn't added twice |
| Email threading | A reply whose subject carries the ticket number joins the ticket — only from the ticket's customer; anyone else starts their own ticket; quoted text ("On … wrote:", "> …", "Original Message") is dropped; a reply to a closed ticket starts a new one. Agent replies go out as "Re: subject [HD-0001]" with the workspace's Reply-To and signature |
| Targets (SLA) | First reply and resolve targets per priority in business minutes — India time, working days and hours, holidays off. The resolve clock stops while waiting on the customer, on hold or resolved (the time left is kept) and restarts from there; changing priority moves the targets by the difference. A sweep every 5 minutes marks missed targets, notes them on the ticket and tells the assignee (or owners/admins if unassigned), and closes resolved tickets after N days without a reply (default 7) |
| Working tickets | Views: mine, unassigned, all open, waiting, missed target, resolved — oldest due first; search; status, priority, assignee and tags with every change noted; replies (emailed) and internal notes (never shown or sent to the customer); "then set status" on reply (default: waiting on customer); saved replies with {{name}}, {{ticket}}, {{agent}}; the customer's other tickets and CRM contact alongside; round-robin assignment over all agents or a chosen rota |
| The customer's link | Signed (HMAC) per ticket, no expiry while the ticket exists; shows the conversation without internal notes, lets them reply (reopening a waiting or resolved ticket and telling the agent) and rate 1–5 with a comment once resolved; asked to rate by email on resolve |
| Reports | Tickets, open, first reply and resolution on time (%), average business time to first reply and to resolve, satisfaction (average and share 4–5), by agent and channel, for a date range (default last 30 days) |
| Helpdesk import/export | Import tickets from another helpdesk (CSV/Excel; subject, description, customer, priority, status, created on, tags, reference — kept as a "ref:" tag so rows aren't brought in twice; nobody is emailed; open ones get targets from today, finished ones none); export any view. CRM contacts show their tickets |
| Portal sign-in | A one-time link (30 minutes, single use, only its hash stored) emailed only to addresses the workspace knows — customers: on an invoice client, a CRM contact or a ticket; suppliers: an active, not-blocked supplier — with the same answer either way (no probing); rate limited by address and IP; sessions in an HttpOnly cookie per side (30 days, hash stored); blocking a supplier ends their access at once; the team sees who's signed in and can sign anyone out, and can send someone their link (and is told if the address isn't known) |
| Customer portal | What they owe and what's overdue (INR invoices), every invoice and credit note to their email across the workspace's books (each opening its share page with payment details), payments, sales orders with what's delivered and tracking links from Logistics, support tickets (with their links) and raising a new one into the Helpdesk; each section can be switched off; a welcome message |
| Supplier portal | Open RFQs they were asked on — quote rates (rupees), GST, lead days, validity and terms, which land on the RFQ beside other quotes; purchase orders once sent (stage, lines, deliver-to) — acknowledge with a promised date and note, add dispatches (date, LR/AWB/challan, transporter) — shown on the PO to the team, who are notified; their bills with TDS, paid and still to pay; send an invoice (number, date, total, PO, PDF/photo up to 10 MB checked by content; one number once unless returned). RFQ and PO emails include the portal link when it's open |
| Booking supplier invoices | /portals → Supplier invoices: download, return with a reason (emailed; they can resend the same number), or "Book as a bill" — opens the Accounts bill form with a draft read from the file by AI when a provider is connected (warning when the file disagrees with what they typed), otherwise their total as one line to split; saving links the bill |
| Tests | `tests/unit/helpdesk-model.test.ts` (10), `tests/integration/helpdesk.test.ts` (9), `tests/integration/portal.test.ts` (8), `e2e/helpdesk.spec.ts`, `e2e/portals.spec.ts` |
| Limits | Inbound email needs an inbound email service configured to post to the address (not tested against a live provider here); email attachments aren't stored; no live chat widget, macros beyond saved replies, or escalation rules beyond targets; the customer portal has no online payment (no gateway for invoices yet — the invoice page shows bank/UPI details), no quote acceptance from the portal list (it's on the invoice page) and no profile editing; suppliers can't update their own bank or GST details; the in-memory rate limiter is per server instance |

## AI copilot & bill reading — ERP phase Q (2026-10-25, migration 0066)

A new module (`copilot`), at /copilot: Ask, Conversations, Checks, AI activity. Permission `copilot:use` (team). Uses Claude (`claude-opus-5-5`) through the workspace's Anthropic key (Settings → AI providers) or the platform key; every call counts against the monthly AI budget (`AI_MONTHLY_BUDGET_USD`) and is refused once it's spent. Accounts gains "Read a bill".

| Item | Status |
| --- | --- |
| Asking | A question runs a tool loop (up to 8 model calls) with adaptive thinking, medium effort and server-side fallback; the instructions are prompt-cached; the full message history is saved append-only per conversation; refusals and cut-off answers are reported as such; provider errors become plain messages (never the key or raw provider text); 60 questions an hour per person |
| What it can read | `list_datasets` / `run_report`: the Reports engine's datasets and fields, run as the person (module visibility, role, the CRM's "own records" rule, payroll-only fields); `search_records`: contacts and deals (CRM, own-records rule), suppliers and items (Inventory), employees (HR managers only), projects; `find_anomalies`: the checks below. Tool input is validated; bad input goes back to the model as an error |
| What it can change | Nothing directly. `propose_action` saves a suggestion — a CRM follow-up task, a CRM note on a contact/company/deal, or a project task — shown as a card with Confirm / Dismiss. Confirm runs the CRM's or Projects' own functions as the person (their role and module access apply; a viewer's Confirm fails with the reason, and can be retried); claimed atomically so a double click can't do it twice |
| Privacy | Conversations and suggestions belong to the person who had them; others get 404. Owners and admins see AI activity (calls, tokens, estimated cost by kind and person, suggestions carried out, last 30 days) — not conversation text |
| Checks (no AI) | Fixed rules on the books, limited to the companies the person may see: the same supplier's bill entered twice (bill number ignoring case, punctuation and leading zeros; or the same total within 3 days), a bill from the last 30 days over 3× the supplier's median (needs 4 earlier bills), an expense account's month-to-date over 2× its average of the 3 months before and at least ₹10,000 more |
| Reading a bill | Accounts → Bills → Read a bill (shown only when a provider is connected): a PDF, JPG, PNG or WebP up to 10 MB (checked by content, not name) goes to the model with the workspace's expense accounts, answered in a fixed JSON schema and validated; the supplier is matched by GSTIN, then by name; lines are put to the suggested account or the supplier's last one; GST rate snapped to standard rates; inter-state from the GSTIN's state; warnings when the GSTIN fails its check digit, the lines and GST don't add up to the bill's figures (₹1 a line), the date is missing or in the future, or the supplier is new. Opens the normal bill form to check — nothing is saved until Save bill |
| Tests | `tests/unit/copilot-model.test.ts` (10), `tests/unit/bill-extract.test.ts` (5), `tests/integration/copilot.test.ts` (10), `tests/integration/bill-extract.test.ts` (3) — all against a stand-in client, no real API calls; `e2e/copilot.spec.ts` (the not-connected state) |
| Limits | Not exercised against the live Anthropic API in this environment (needs a key and spends money) — the loop, tools and checks are tested with a stand-in model. No streaming of answers to the page (the answer appears when complete); no voice; it can't read document or email text, attach files, or send anything; three kinds of change only; checks are rules, not learned models; bill reading doesn't create suppliers or handle multi-page statements of several bills |

## Reports & dashboards — ERP phase P (2026-10-24, migration 0065)

A new module (`bi`), at /reports: Home, Reports (builder at /reports/new), Dashboards, Scheduled emails. Permissions `bi:read` (team), `bi:write` (owner, admin, billing, developer, designer, editor), `bi:manage` (owner, admin: anyone's reports, dashboards and schedules).

| Item | Status |
| --- | --- |
| Datasets | 22: invoices (in rupees at each invoice's exchange rate), payments, bills, ledger lines; store orders, sales orders, sales order lines, deals, contacts, CRM activities, campaign emails; stock on hand, stock movements, purchase orders, work orders, inspections, maintenance orders, shipments; employees, leave, attendance, time. Each is offered only when its module is visible to the person and their role reads that module; rows follow module rules (the CRM's "own records" visibility; Projects time limited to your own unless you manage Projects); the CTC field needs payroll access. Dates are days in India |
| Builder | Up to 3 group-bys (dates by day, week from Monday, month, quarter, year), up to 6 measures (count, total, average, lowest, highest, distinct count; totals and averages only on numbers), up to 12 filters (is, is not, one of, contains, more/less than, at least/most, empty, yes/no; money typed in rupees), dates by preset (today … this/last financial year from the accounting year's start month, all time) or custom, sort, up to 1,000 rows, total row |
| Safety | Fields are chosen by key from a fixed catalogue; every typed value is a bound parameter; each query runs read-only with a 15-second limit; unknown fields and non-numeric totals are refused |
| Charts | Table, bars, line, area, donut, single number; one axis (measures of another unit stay in the table, with a note); series in the validated categorical palette (6 slots, light and dark, fixed order; the rest fold into "Other"); legends for 2+ series; hover tooltips with a crosshair on lines; the table one click away |
| KPIs | A single number compared with the same length of time before (change shown, none when the period before is empty), and a target on dashboards |
| Saved reports | Shared with the team or private; only the maker or an owner/admin edits; open as the viewer (so each sees their own allowed data); another date preset on the fly; export rows to Excel/CSV; download and import a report file (JSON) |
| Dashboards | Reports and KPIs in small, medium or wide tiles; a tile whose data isn't open to the viewer says so instead of showing anything |
| Scheduled emails | Daily, weekly or monthly at an hour in IST, to chosen members; run as whoever set it up; plain text with the top 20 rows and a link; sent every 5 minutes when due; paused with the reason when the maker leaves or loses access |
| Tests | `tests/unit/bi-model.test.ts` (4), `tests/integration/bi.test.ts` (7), `e2e/reports.spec.ts` |
| Limits | No free-form SQL, joins across datasets, calculated fields or pivot cross-tabs; no drill-down from a chart; emails aren't PDFs or attachments; dashboards don't auto-refresh while open; no forecasting |

## Logistics & fleet — ERP phase O (2026-10-24, migration 0064)

A new module (`logistics`; uses Sales, Inventory, Assets & maintenance, HR, Accounting), at /logistics: Home, Shipments, Trips, Vehicles, Drivers, Fuel log, Carriers & rates, Reports, Settings; a public tracking page at /track/:token. Part "Own fleet". Permissions `lgx:read` (team), `lgx:write` (owner, admin, billing, developer, editor), `lgx:manage` (owner, admin). Accounts 5255 Vehicle running costs and 5265 Freight outward.

| Item | Status |
| --- | --- |
| Carriers & rate cards | Transporters (LR) and couriers (AWB) with a tracking-link template; rates by lane (from/to state by name or code, or any), per kg, minimum, fixed, volumetric divisor; the most specific lane wins; chargeable weight = actual or volumetric (L×W×H × packages ÷ divisor), whichever is more |
| Shipments | SHP-0001; made from Sales challans (dispatched, one live shipment each; consignee, phone, address and state from the order's client, location from the challan) or by hand; by carrier or own fleet; LR, tracking/AWB, e-way bill number, weight, packages, freight cost (from the rate card when left blank) and freight charged; promised date (default + N days); status trail (picked, in transit, out for delivery, held up with a reason, returned) with who and when; proof of delivery (received by, note) marks the challans delivered in Sales; cancel; freight paid from a bank/cash account; a "Ship" link on Sales deliveries; export |
| Tracking page | Status, expected or delivered date, who received it, the carrier and their tracking link, the steps with times — never costs, notes or the full address |
| Trips | TRP-0001; a vehicle (in use), a driver (the usual one by default; refused if their licence has lapsed), own-fleet shipments as ordered stops (reorder before starting); refused when insurance/PUC/permit/fitness has lapsed or the load exceeds capacity, unless confirmed; start with the odometer (never backwards; a linked asset's meter counts) — stops go in transit; finish with the odometer and costs (toll, parking, loading, driver allowance, repairs) paid from an account; stops still open are reported |
| Fleet | Vehicles (registration normalised and unique, type, ownership, capacity, fuel, usual driver, papers with numbers and expiry dates, linked asset in Assets & maintenance); drivers (licence and expiry, flagged); every odometer reading (trip start/finish, fuel) is passed to the linked asset's meter and raises its servicing when due; import vehicles (matched by registration, expiry columns become papers) and export |
| Fuel | Fills with litres, amount, odometer (never below an earlier fill or the vehicle's last reading), full or part, station, paid-from account (optional, for fuel cards billed later); mileage by the full-tank method and fuel cost per km; import fuel-card statements (matched by registration however it's spaced) and export |
| Reports | Per carrier (and own fleet): shipments, on-time delivery against the promised day in IST, held up, freight cost and charged; per vehicle: trips, km, litres, km/l, fuel and trip costs, cost per km; export |
| Books | Fuel paid: Dr Vehicle running costs, Cr the account. Trip costs: the same, on finishing. Freight paid: Dr Freight outward, Cr the account (with the location's company and branch) |
| Tests | `tests/unit/logistics-model.test.ts` (4), `tests/integration/logistics.test.ts` (3), `e2e/logistics.spec.ts` |
| Limits | No carrier API tracking, label printing or pickup booking (needs each carrier's API); no route optimisation, maps or live GPS; e-way bills are generated in Accounting (number recorded here); freight charged to customers isn't added to invoices automatically; no driver app — updates are made in Cloudesk |

## Marketing — ERP phase N (2026-10-24, migration 0063)

A new module (`marketing`, needs CRM), at /marketing: Home, Campaigns, Segments, Settings; public pages /m/:token (tracked links, unsubscribe) and /e/:token (event registration). Parts: "Email campaigns", "Events". Permissions `mkt:read` (team), `mkt:write` (owner, admin, billing, developer, designer, editor), `mkt:manage` (owner, admin: budgets, spend, settings).

| Item | Status |
| --- | --- |
| Segments | Rules over CRM contacts: lifecycle, source, tags (any / all), minimum score, cities, countries, owner, added within N days, open deal, won deal; live preview (who's in, who may be emailed); counted fresh when used |
| Email campaigns | Plain-text email to a segment, only contacts who agreed to marketing, have an email and haven't unsubscribed or asked not to be contacted (checked again as each is sent); merge fields {{first_name}} {{name}} {{company}} {{email}}; optional second subject (contacts split evenly and stably); test send; send now or schedule; sent in background batches of 50 through the workspace's email (recorded in the outbox when email isn't set up); each link replaced by a signed tracked link that redirects only to links that were in the email; one-click unsubscribe (page shows a button; posting it unsubscribes across the CRM and stops sequences); results per subject: sent, failed, skipped, clicked and click rate, unsubscribed; clicks per link |
| Events | Registration page with date/time, venue or online link, description and places left; registrations become (or update) CRM contacts with source "Event" (and marketing consent if ticked); the same email twice isn't registered twice; full or past events close; confirmation email; check-in and undo; export |
| Ads & other | Dates, budget, spend (entered by hand), notes |
| UTM & forms | Tagged links (utm_source from settings, medium, utm_campaign = the campaign's slug); a web-to-lead form carrying utm_campaign credits the campaign |
| Attribution & ROI | Touches: sent, clicked, registered, attended, form. A won deal is credited to campaigns that touched its contact within the attribution window before it was won: first touch, last touch, and shared evenly; ROI = (shared value − spend) ÷ spend. Shown per campaign and on Home; export |
| Tests | `tests/unit/marketing-model.test.ts` (5), `tests/integration/marketing.test.ts` (4), `e2e/marketing-app.spec.ts` |
| Limits | No HTML/designed emails, open tracking, bounce handling or sending-domain setup; SMS and WhatsApp need a provider (not connected); ad platforms aren't connected; no automated journeys beyond CRM sequences; one owner per segment rule; A/B is a fixed even split without automatic winner |

## Documents, contracts & e-sign — ERP phase M (2026-10-24, migration 0062)

A new module (`documents`; uses CRM, HR, Projects), at /documents: Home, Library, Contracts, Signatures, Settings; a public signing page at /sign/:token. Permissions `doc:read` (team), `doc:write` (owner, admin, billing, developer, designer, editor), `doc:manage` (owner, admin).

| Item | Status |
| --- | --- |
| Library | Folders (nested) open to the team, to owners and admins, or to chosen people (a folder is open only if every folder above it is); files up to 25 MB, 1 GB per workspace, recognised from their bytes (PDF, Word/Excel/PowerPoint, PNG/JPEG/WebP, ZIP, CSV/text; executables and anything else refused); title, tags, status (draft/final/archived), expiry, notes; every version kept with its SHA-256; downloads as attachments (PDFs and images can open inline); search across open folders by title, file name, tag and notes; export |
| Links | A file or contract can belong to a deal, company, contact, employee, project, supplier, sales order or asset (checked to be in the workspace); a Documents panel on deal, employee (HR managers), project and asset pages lists them and uploads straight to the record |
| Contracts | CTR-0001; type, counterparty and email, owner, value, start/end, auto-renew (term months) and notice days, the document, obligations with due dates and owners; draft → approval (rules for "Contracts", by value; with none an owner or admin decides) → approved (terms locked) → out for signature → signed; "signed elsewhere"; terminate (stops renewal, record kept). The current term rolls forward for auto-renewing contracts; notice-by date and running / renews soon / notice due / ending / expired, flagged within the alert days; import (owners/admins; matched by number) and export |
| E-signatures | Send the file's current version (SHA-256 recorded) to up to 20 signers, in order or all at once, with a message; each signer gets a link whose secret is kept only as a hash (shown to the sender once; emailed when email is set up, otherwise recorded in the outbox); a new link can be made for whoever's turn it is (the old one stops working). Signers must open the file before signing, type their name and agree to sign electronically; views, signatures and declines are logged with time, IP and browser. In order, the next signer is sent their link when the previous signs. A decline stops the request and notifies the sender. When everyone has signed: a certificate of completion PDF (file, version, SHA-256, signers, trail), the contract becomes signed, the sender is notified. Links expire after the set days; void a request any time |
| Tests | `tests/unit/documents-model.test.ts` (4), `tests/integration/documents.test.ts` (4), `e2e/documents.spec.ts` |
| Limits | Click-to-sign electronic signatures, not Aadhaar eSign or DSC (those need a licensed eSign provider; not connected); the signed file isn't stamped — the certificate is separate; no signature drawing, signing fields or initials per page; no in-browser editing, templates with merge fields, OCR or search inside file contents; no retention schedules or legal hold yet (phase S); storage is in the database, so very large libraries need external object storage |

## Assets & maintenance — ERP phase L (2026-10-24, migration 0061)

A new module (`maintenance`; uses Inventory and Accounting), at /maintenance: Home, Work orders, Preventive plans, Assets, Contracts, Reliability & cost, Settings. Permissions `mnt:read` (team), `mnt:write` (owner, admin, billing, developer, editor), `mnt:manage` (owner, admin). Account 5290 Repairs and maintenance gains the key `repairs`.

| Item | Status |
| --- | --- |
| Asset register | AST-0001 codes; category, location, make, model, serial, status (running, down, under maintenance, standby, retired), criticality, custodian, purchase and warranty dates, notes; components (part of another asset; loops refused); linked to a fixed-asset line ("From fixed assets" brings in the active register once); import (matched by code, then serial; a meter column records a reading) and export |
| Meters | A unit per asset (hours, km, cycles); readings by date; a lower reading is refused unless the meter was replaced (which re-bases meter plans); average use per day over 90 days |
| Preventive plans | Every N days, every N on the meter, or whichever comes first, counted from the last time done (or a start date/meter); lead days/meter; checklist, spare parts, estimate, assignee. A reading, or "Raise due work orders", raises one preventive order per due plan (never two open); finishing it resets the plan from that day and meter. Next due date includes a projection from meter use |
| Work orders | MWO-0001; breakdown, preventive, request, inspection, improvement; priority, assignee, due; members without work-order rights can report a problem (a request, if allowed in settings) that a technician accepts; start, hold, resume; asset stopped/back running (downtime; the asset is down until no open order has it stopped); checklist; labour (minutes × the workspace's labour rate, or a rate an owner sets); spare parts issued from a location (allocated by batch; negative returns, never more than issued), at stock cost; outside work cost and note; finishing needs the checklist done (or "finish anyway") and, for breakdowns, a cause; a meter reading at finish; cancelling refused while parts are out |
| Contracts | AMC, warranty, insurance, calibration, lease: vendor (optionally an Inventory supplier), reference, assets covered, term, cost, visits; active / ending within the notice days / expired, on the home screen and each asset |
| Reliability & cost | Per asset over a period: breakdowns, downtime (clipped to the period, open ones to now), MTBF, MTTR, availability, jobs done and the preventive share, labour/parts/outside cost; export |
| Books | Spare parts issued: Dr Repairs and maintenance, Cr Inventory at stock cost (returns reverse), with the location's company and branch. Labour isn't posted (it's in payroll); outside work is entered as a bill in Accounting |
| Tests | `tests/unit/maintenance-model.test.ts` (4), `tests/integration/maintenance.test.ts` (5), `e2e/maintenance.spec.ts` |
| Limits | No QR-code scanning or IoT meter feeds; no calibration certificates or permits-to-work; planned servicing isn't counted as downtime unless marked stopped; no spare-part reservations for planned jobs; contract visits aren't tracked against jobs; one labour rate for the workspace unless an owner sets one per entry |

## Expense & travel — ERP phase K (2026-10-24, migration 0060)

In HR: Claims gains mileage, the expense policy and project links; new part "Travel & company cards" with Trips and Company cards; Settings → Expenses & travel. Accounts gain 1420 Staff advances and 2060 Company cards.

| Item | Status |
| --- | --- |
| Expense policy | Limits per category: per claim, per day (adding the person's other claims in that category that day) and receipt-above; claims outside it need a reason (flagged with the message for approvers and in the export), or are refused when "Refuse claims over a limit" is on |
| Mileage | Kilometres × the car or two-wheeler rate; refused until a rate is set |
| Trips | TR-0001 numbering; destination, purpose, dates, mode, estimate, advance, in India or abroad, project; draft → sent → approved by the manager or HR (approval rules for "Business trips" can add steps; amount = estimate + advance); declined trips can be edited and sent again; cancel until an advance is paid or claims exist |
| Advances & settlement | Payroll pays the advance from a bank/cash account; claims (and one per diem: days incl. both ends × the domestic/abroad rate) go on the approved trip; settling needs every claim decided, then pays the balance or takes back the unused advance; trip claims never go into payroll or "paid separately" |
| Company cards | Cards by holder and last four digits (never the full number); statements imported from CSV/Excel (matched by last four, the same line never twice, credits skipped); the cardholder explains a spend as a claim (paid by the company, approved like any claim; declined goes back to be explained) or marks it personal; payroll marks personal spends repaid |
| Projects | A claim (or trip) on a project puts the approved amount on the project's expenses — billable or not — so it's in project profit and, if billable, its next invoice |
| Books | Advance paid: Dr Staff advances, Cr bank. Trip settled: Dr Staff reimbursements (claimed), Cr Staff advances (advance), the balance through the bank. Card spend approved: Dr Staff reimbursements, Cr Company cards. Personal: Dr Staff advances, Cr Company cards; repaid: Dr bank, Cr Staff advances. Paying the card bill is a transfer in Accounting |
| Tests | `tests/unit/travel-model.test.ts` (3), `tests/integration/travel.test.ts` (3), `e2e/travel.spec.ts` |
| Limits | No flight/hotel booking (needs a travel provider), no receipt OCR, no live card feeds; policy limits don't vary by grade or city; per diem is a flat daily rate (no partial days or meals provided); GST on travel bills isn't claimed as input credit from claims; currencies other than rupees aren't handled on claims |

## Projects+ — ERP phase J (2026-10-24, migration 0059)

In Projects & timesheets: a project's Schedule, Expenses and Risks & changes tabs, and Resources in the menu. New parts: "Schedule & resources", "Project expenses", "Risks & changes".

| Item | Status |
| --- | --- |
| Dependencies & Gantt | Link tasks on a project: finish-to-start or start-to-start, with lag in days; loops refused. Gantt chart of dated tasks with the due date marked; critical path (no slack before the last finish) in red; tasks that start before what they wait on are flagged and "Push them later" moves them (keeping their length, moving later tasks too, never earlier; done tasks stay); warning when the schedule ends after the project's due date |
| Resources | Book people on a project for a date range at hours a day (booking puts them on the project's team); per person, capacity is working days × daily hours less approved HR leave (half days count half); booked, free, load and the weeks they're over-booked; 2–13 weeks; export |
| Expenses | Date, category, description, vendor, amount, receipt link, billable with markup %; billable ones appear in Billing (tick which) and become invoice lines at amount + markup, claimed once and freed when the invoice is voided or deleted; invoiced ones are locked; import from CSV/Excel and export |
| Profit | Cost adds everything spent on the project; revenue adds billable expenses at their re-charge (fixed-fee: fee plus re-charges; invoiced re-charges aren't counted twice against the fee); billing overview includes expenses waiting |
| Risks & issues | Kind, probability and impact 1–5, score and level (high ≥ 15, medium ≥ 8), owner, mitigation, review date (overdue flagged), status open/watching/closed; export |
| Change requests | CR-001 numbering per project; budget hours, fee and due-date days (+ or −); sent through approval rules for "Project change requests" (amount is the change in fee); with no rule an owner/admin's change takes effect at once and anyone else's waits for an owner/admin; approval adds to the budget hours and fee (not below zero) and moves the due date — once; approved changes stay on record |
| Documents | Links (http/https only) to contracts, briefs and folders per project |
| Tests | `tests/unit/work-plus-model.test.ts` (4), `tests/integration/work-plus.test.ts` (7), `e2e/work-plus.spec.ts` |
| Limits | Lag and durations are calendar days (weekends aren't skipped); no finish-to-finish links, baselines or auto-levelling; bookings are a plan and don't stop anyone logging time; capacity ignores public holidays; expenses aren't posted to the accounts (record the bill in Accounting); documents are links, not stored files |

## HR & payroll+ — ERP phase I (2026-10-24, migration 0058)

In HR: Roster and Overtime (part "Shifts & overtime"), Full and final (with Payroll), Documents and Training (part "Documents & training"), Grievances (part "Grievances & discipline"), Workforce plan (part "Workforce plan"); Settings → Payroll gains overtime and full-and-final rules.

| Item | Status |
| --- | --- |
| Shifts & roster | Shifts (start/end across midnight, break, grace, colour); a weekly roster per person (shift or day off; "usual" falls back to the work week and hours); managers roster their own people; copy a week forward (keeps what's set). Check-in lateness uses the day's shift; no lateness on a day off |
| Overtime | When on: at check-out, minutes past the shift's working time (all of a day off or holiday) from a minimum become overtime — pending, or approved if approval is off; managers add it by hand (approved); approve/reject for your people. Payroll pays approved overtime as an earning: monthly Basic ÷ 26 ÷ the full day's hours × the multiplier; finalising the run locks it |
| Full and final | For people on notice or gone: leave encashment (encashable leave codes' balance × Basic ÷ 26), gratuity (15/26 of monthly Basic × counted years — six months or more counts — after the minimum service, capped at ₹20 lakh), notice not served (gross ÷ 30 per day short); assets still held are listed; lines editable (bonus, advance, asset); approval through rules for "Full and final settlements" (approved at once without one); paid from a bank/cash account and posted (Dr Salaries for earnings, Cr Other income for recoveries, Cr/Dr the account for the net). The final month's salary is paid by payroll |
| Documents | Per person: kind (contract, offer, ID, certificate, policy, visa, other), number, issued, valid to, a link to where the file is kept; expired and expiring-in-30-days flags; people see their own, managers their people's |
| Training | Courses, workshops, certifications, induction, safety: provider, hours, cost, refresh period; mandatory for everyone or some departments with "who still needs it" (counting refreshers); assign or record completion (date, score) |
| Grievances & discipline | Grievances raised by employees (optionally anonymous to everyone but HR admins), seen only by HR, the raiser and the investigator; disciplinary cases opened by HR with an action (warnings, suspension, termination); status, investigator, outcome (required to close) and a timeline of notes |
| Workforce plan | Positions by department and role with planned headcount, budget CTC and date; filled/leaving/open from people matching department and designation; planned vs actual cost; "Hire" opens a hiring role |
| Tests | `tests/unit/hr-plus-model.test.ts` (5), `tests/integration/hr-plus.test.ts` (5), `e2e/hr-plus.spec.ts` |
| Limits | Overtime isn't split by weekday/holiday rates; no shift swaps, shift allowances or biometric devices; settlement doesn't compute bonus (Payment of Bonus Act) or TDS on gratuity/leave encashment exemptions — add them as lines; documents are links, not stored files; no LMS (course content, quizzes); no workforce scenarios or attrition forecasts |

## Quality — ERP phase H (2026-10-24, migration 0057)

A new module (`quality`, needs Inventory; uses Manufacturing), at /quality: Home, Inspections, Non-conformances, Inspection plans, Settings. Permissions `qc:read` (team), `qc:write` (owner, admin, billing, developer, editor), `qc:manage` (owner, admin).

| Item | Status |
| --- | --- |
| Inspection plans | For an item, or every item in a category; stage (goods received / after production / before dispatch); samples as a number or % of the lot (never more than the lot); how many samples may fail; checks: measurements with lower/upper limits and units, or pass/fail. An item's own plan wins over its category's |
| Inspections | QC-0001…: queued automatically for every received line (accepted quantity, with the bin it went into and the supplier) and every finished work order whose item has a plan at that stage; or raised by hand for any lot. Results per sample; a sample fails if any check fails or any reading is out of limits; the lot passes if no more than the allowed number fail. All samples must be recorded; recorded once |
| Quarantine & reports | A failed lot raises a non-conformance report (NCR-0001…, severity by how badly it failed) and, when set, moves whatever of the lot is still where it was received into the location's quarantine bin (on hand, not available, not counted by MRP) |
| Non-conformances | Also raised by hand (customer complaint, supplier, in-house): item, supplier, batch, quantity, severity. Root cause, corrective and preventive actions (owner, due date, done), disposition (decided by owners/admins). Closing needs a root cause, a decision and every action done, and carries out the decision on the held stock: use as is / rework → released from quarantine; scrap → written off out of the quarantine bin (posted as a stock adjustment); return to supplier → a return to the supplier from the quarantine bin with a debit note against the receipt's bill |
| Dashboard | Lots to inspect, 90-day pass rate overall, by supplier and by item, open reports, units held, overdue actions |
| Tests | `tests/unit/quality-model.test.ts` (3), `tests/integration/quality.test.ts` (4), `e2e/quality.spec.ts` |
| Limits | No certificates of analysis, calibration, SPC/control charts, audits or document control here; inspections before dispatch are raised by hand (not queued on delivery); only stock still where it was received is held; scrapping a hand-raised report doesn't move stock (adjust it in Inventory) |

## Manufacturing — ERP phase G (2026-10-24, migration 0056)

A new module (`manufacturing`, needs Inventory; uses Sales), at /manufacturing: Home, Work orders, MRP, Recipes, Work centres, Settings. Parts: routing & work centres, MRP. Permissions `mfg:read` (team), `mfg:write` (owner, admin, billing, developer, editor), `mfg:manage` (owner, admin). New account by key: Production costs absorbed (5160).

| Item | Status |
| --- | --- |
| Work centres | Code, name, cost per hour (machine + labour), hours a day; load from released/running work orders against capacity over the next days |
| Recipes (BOM + routing) | Per item, several recipes with one default: output per run, components with scrap %, steps on work centres (run and setup minutes); loops refused (directly or through other recipes); standard cost per unit from components at average cost plus time at centre rates. Smart import (one row per component, grouped by product and recipe name) |
| Work orders | MO-0001…: item, recipe, quantity, location, dates. Draft → released (materials reserved at the location) → materials issued out of stock at average cost (batches earliest expiry first; extra or substitute materials allowed; returns with a negative quantity) → minutes logged per step → finished: output (and its batch) received at (materials issued + conversion) ÷ made; the item's average cost takes it in; reservations released. Cancel only with nothing issued. Variances: material used against the recipe for what was made (qty and value), time against plan, yield |
| Books | Each finished order posts its conversion cost: Dr Inventory, Cr Production costs absorbed (materials move within stock, so they don't post) |
| MRP | Demand: goods still to deliver on confirmed sales orders due within the horizon, open work orders' unissued materials, safety stock. Supply: on hand less quarantine, open purchase orders, open work orders' output. Level by level through default recipes: what to make (draft work orders) and what to buy (one requisition with Procurement on, otherwise draft purchase orders by usual supplier; buys rounded up to the reorder quantity) |
| Wiring | Inventory stock engine, reservations, batches; Sales orders as demand; Accounting posting; nav, command palette, icon, marketing page |
| Tests | `tests/unit/manufacturing-model.test.ts` (4), `tests/integration/manufacturing.test.ts` (4), `e2e/manufacturing.spec.ts` |
| Limits | No scheduling by date or finite capacity planning (load is shown, not levelled); requisitions don't count as incoming in MRP; no by-products or co-products; finished goods with serial numbers can't be made in a work order; no job cards, shop-floor app or machine integration; subcontracting (job work) isn't supported |

## Warehouse — ERP phase F (2026-10-24, migration 0055)

In Inventory: a "Warehouse floor" part (Bins; Pick, pack & dispatch), Cycle counts due, Stock value & age; items gain safety stock and serial numbers; receiving and Sales deliveries/returns take serials and bins. Settings: valuation shown (average or FIFO), count frequency for A/B/C items, wave prefix.

| Item | Status |
| --- | --- |
| Bins & quarantine | Bins per location (code, zone, kind: storage / receiving / dispatch / quarantine). Stock is put away from "not put away", moved between bins, or taken out; receipts can put away straight into a bin. Stock leaving without a named bin (a sale, an adjustment) comes out of what isn't put away first, then storage bins, quarantine last, so bins never hold more than the location has. Quarantined stock is on hand but not available |
| Reservations | Confirmed sales orders reserve what's still to deliver at their location; deliveries, cancelling and closing release it; editing an order back to draft releases it. Available = on hand − reserved − quarantined (item page, availability API); reorder suggestions work on what's free |
| Safety stock | Per item; reorder suggestions keep free stock above reorder level + safety stock |
| Serial numbers | Per item: receipts need one serial per unit accepted (duplicates refused); Sales deliveries need serials that are in stock at that location; returns bring them back into stock; returns to suppliers mark them returned; a cancelled challan puts them back. Item page lists units and their status |
| Waves | WV-0001…: confirmed sales orders with goods to go from one location (not already in a wave); pick list with bin suggestions (fullest bins, quarantine excluded), picked quantities by typing or scanning (barcode, SKU or serial — each scan picks one), serials per line; packing (boxes, weight per order); dispatch makes one delivery challan per order through Sales, taking stock out of the bins picked from |
| Scanning | One lookup for a scanned code: item by barcode or SKU, a serial number, or a bin code |
| Stock value & age | Per item: value at weighted average and FIFO (what's in hand taken to be the newest receipts; anything older than the history at average cost), and age buckets 0–30 / 31–60 / 61–90 / 91–180 / 180+ days by receipt date |
| Cycle counts | ABC classes from a year's issues at cost (A top 80%, B next 15%, C the rest); items at each location are due when not counted (on a count sheet, even one that matched) within their class's days |
| Tests | `tests/integration/warehouse.test.ts` (5), `e2e/warehouse.spec.ts` |
| Limits | FIFO is for valuation and ageing in reports; the books (and cost of sales) still use weighted average. Store and POS sales reduce stock without going through bins or serials. No handheld app — scanning works with any scanner that types into the browser. No putaway rules, replenishment between bins, or carrier labels |

## Procurement — ERP phase E (2026-10-24, migration 0054)

In Inventory, a new part "Procurement" (needs Purchasing): Requisitions, RFQs & quotes, Returns to suppliers, Purchase control (3-way match, supplier performance, budgets); supplier onboarding and agreed rates from Suppliers; inspection in the receive dialog. Settings: requisition/RFQ/return prefixes, only buy from approved suppliers, budget check (off / warn / block), match tolerance %.

| Item | Status |
| --- | --- |
| Requisitions | REQ-0001…: items, quantities, location, needed-by, reason; estimate from average cost. Approval through rules for "Purchase requisitions" (approved at once without one); approvers decide in My work. Approved → draft purchase orders (one per supplier: the item's usual supplier or one picked) or → an RFQ |
| RFQs | RFQ-0001…: items and quantities, suppliers asked (blocked ones refused), quote-by date; emailed to suppliers with an address when a mail service is set up. Quotes entered per supplier (rate, GST, lead days); comparison picks the lowest rate before GST, then the shortest lead time, with the saving shown. Award per item → draft POs at the quoted rates; can't be awarded twice |
| Agreed rates | Per supplier and item, with quantity tiers and dates; a PO above the agreed rate shows a warning |
| Supplier onboarding | Pending / approved / blocked with a document checklist (GST certificate, PAN, bank, MSME, agreement), audited. Blocked suppliers can't get orders; with "only approved suppliers" on, new suppliers start pending and can't get orders until approved |
| Inspection on receipt | Each received line can have a rejected quantity and reason: it doesn't enter stock, isn't billed (the bill made from the receipt is for what was accepted), and stays due on the order. A receipt where everything was rejected makes no bill |
| Returns to suppliers | RTV-0001…: from a receipt, up to what's left of it; stock goes out (batches earliest expiry first); a debit note against the receipt's bill is made in Accounts when there is one (otherwise the reason is shown) |
| 3-way match | Every sent PO: ordered, received (accepted) and billed values before GST; flags price differences beyond the tolerance, over-receiving and bills that differ from the receipt; otherwise still to receive / still to bill / matched |
| Supplier performance | Last 12 months: bought, deliveries, on-time % (received by the PO's expected date), rejected %, average days from order, returned |
| Purchase budgets | By item category and month (before GST): POs raised that month count against it; over budget, orders warn or are refused by setting |
| Tests | `tests/integration/procurement.test.ts` (5), `e2e/procurement.spec.ts` |
| Limits | No supplier portal (suppliers don't enter their own quotes — that's phase R); no blanket POs or scheduled deliveries; inspection is pass/fail by quantity (no quality plans or test results — phase H); budgets are by category, not department or cost centre; agreed rates and quotes aren't imported from spreadsheets yet |

## Sales orders — ERP phase D (2026-10-24, migration 0053)

A new module (`sales`, needs Invoices & finance; uses Inventory and CRM), at /sales: Home, Orders, Deliveries, Returns, Customers, Price lists, Commissions & targets, Settings. Parts: price lists & credit, deliveries & returns, commissions & targets. Permissions: `sales:read` (team), `sales:write` (owner, admin, billing, developer, editor), `sales:manage` (owner, admin). Onboarding sets up settings and a "Standard prices" list.

| Item | Status |
| --- | --- |
| Price lists | A default list (standard selling prices) and others: fixed prices with quantity breaks, or a discount off standard; valid between dates; on/off. Margin against Inventory average cost. Smart import of rate lists (item by SKU then name); export |
| Customer terms | For each client in the invoicing books: price list, usual discount, credit limit, payment terms, salesperson, hold. Shows what they owe (issued invoices less credit notes, INR) and have on order. Smart import (customer, limit, days, discount, price list, salesperson, hold); export |
| Orders | SO-0001…: customer from the books, lines from Inventory items (priced from the customer's list, tier by quantity, list price kept) or free lines (services), discount %, GST per line, expected date, salesperson, location, customer PO. Draft → confirmed; a partly delivered or invoiced order can't be edited (close it). Cancel, close short, delete drafts |
| Credit and discount control | Confirming refuses customers on hold; checks owed + other open orders + this order against the limit (setting: needs approval / refuse / warn); discounts above the workspace limit hold the order. Held orders follow an approval rule for "Sales orders" if one exists, otherwise an owner/admin approves or sends back on the order (managers' own orders aren't held); approvers are notified |
| Delivery challans | DC-0001…: partial deliveries from any location with vehicle and transporter; stock goes out through the stock engine (batch items earliest expiry first; negative stock refused when the workspace blocks it); proof of delivery (received by); cancel a challan that never left (stock back) unless what it delivered is already invoiced |
| Invoicing | A draft GST invoice in the order's books for what's due: goods as delivered (or as ordered, by setting), services as ordered; customer's payment terms set the due date; lines aren't linked to stock items so the invoice doesn't move stock again. Each invoice's quantities are recorded; voiding or deleting it frees them |
| Returns | SR-0001…: back into stock or written off (damaged etc.), with a draft credit note for the part that was invoiced only; once the credit note is issued the quantities count as un-invoiced |
| Commissions & targets | Plans per salesperson or for everyone, % of invoiced or collected sales before tax (less credit notes) from their orders; monthly targets with % achieved; members see only their own line; export |
| Wiring | CRM won deal → "Sales order" (customer matched by name in the books); invoicing issue/void/delete recompute order quantities; approvals kind `sales.order`; nav, command palette, module icon, marketing page |
| Tests | `tests/integration/sales.test.ts` (7), `e2e/sales.spec.ts` |
| Limits | Orders are in rupees; tax on the order is an estimate (the invoice is exact); no blanket/scheduled orders, schemes (buy X get Y), route/beat planning or e-way bill from a challan (use GST → E-invoices & e-way bills on the invoice); proof of delivery is a name, not a signature or photo |

## Finance+: foreign currency, intercompany & consolidation, e-invoice & e-way bill files — ERP phase C3 (2026-10-24, migration 0052)

New accounts by key: Exchange gain or loss (4120), Due from group companies (1350), Due to group companies (2350). Accounts → Group (Intercompany, Consolidated); GST returns → E-invoices & e-way bills.

| Item | Status |
| --- | --- |
| Foreign-currency invoices | Invoices and credit notes in another currency post in rupees at the rate set on the invoice ("Rate for the books") or the workspace rate on the issue date (Settings → Organisation → Currencies); without either, a sync note says what's missing. Taxes convert per row |
| Foreign payments received | Each payment settles its share of the receivable at the invoice's rate (settling in full leaves no rounding); the bank gets the rupees received ("Rupees received" on the payment) or the amount at the day's rate; the difference posts to Exchange gain or loss |
| Foreign bills | Bills in a currency set up for the workspace: lines entered in that currency, posted in rupees at the bill's rate (or the workspace rate). Paying one takes the amount in the currency and the rupees the bank debited; the difference is an exchange gain or loss. Not allowed: TDS (section 195 isn't worked out), debit notes, payment runs |
| Month-end revaluation | At each completed month end (last 24), open foreign invoices and bills are restated at that day's rate per company, posted as an exchange gain/loss and reversed the next day; a missing month-end rate is noted |
| Intercompany | An entry between two companies (IC-0001…): the "from" company debits Due from group companies and credits the chosen account; the "to" company debits its account and credits Due to group companies; both sides are tagged with the other company. When the credited account is income (a fee or recharge), the income and the other company's cost are tagged too. Same company, or the group accounts themselves, are refused; closed months respected; members limited to some companies can only use those |
| Consolidation | Any set of the workspace's active companies: balance sheet accounts to a date, income and costs for a range, one column per company, what's taken out (lines tagged with a partner in the set) and the group total; profit per company and for the group; each pair's positions shown side by side with a warning when they don't mirror. Journals can also carry a partner company by API |
| E-invoice JSON | For a month's invoices and credit notes to a GSTIN or abroad: NIC schema 1.1 JSON (seller from the invoicing business details, falling back to the company's GSTIN; CGST/SGST or IGST per line; inclusive prices handled so AssAmt = TotAmt − Discount; charges as other charges; exports as EXPWP/EXPWOP in rupees at the books' rate with currency and country). Problems that would stop an upload (missing GSTIN, PIN, address, HSN, place of supply, rate) are listed and the export refused until fixed. IRN, ack no. and date recorded back |
| E-way bill JSON | From an invoice with goods (HSN not 99…): bulk generation format with transport (mode, vehicle, distance, transporter, LR/RR); only goods lines; EWB no., date and validity recorded back |
| Tests | `tests/unit/fx-model.test.ts` (4), `tests/unit/einvoice-model.test.ts` (5), `tests/integration/group-fx.test.ts` (5), `e2e/group-fx.spec.ts` |
| Limits | Rates are entered or imported, not fetched. No IRP / e-way bill API (that needs a GSP account): no signed QR, IRN cancellation or e-way bill extension from Cloudesk. Companies all keep books in rupees (no foreign functional currency, no translation reserve); consolidation doesn't handle minority interests, unrealised profit in stock between companies, or eliminations of untagged entries. Store orders and refunds in another currency are still not posted |

## Finance+: TDS, debit notes, receipts & advances, payment runs, petty cash — ERP phase C2 (2026-10-24, migrations 0049–0051)

In Accounts: Payment runs, TDS, Money received; "Debit note" on a bill; "Count cash" on cash accounts in Banking; Settings → TDS. Suppliers (Inventory) gain PAN, TDS section, company/other, and bank account + IFSC (also in the supplier import). New accounts by key: Customer advances, Cash short or over.

| Item | Status |
| --- | --- |
| TDS on bills | Sections 194C, 194J (professional / technical), 194I (building / plant), 194H, 194Q with FY 2025-26 rates and thresholds (single bill, yearly total including earlier bills, monthly rent, 194Q above ₹50 lakh only on the excess); 20% minimum without a valid PAN; workspace rate overrides. The bill dialog suggests the section (from the supplier) and the amount (from their year so far), editable. The bill posts AP net of TDS and TDS owed; what's owed and payable excludes it |
| TDS deposits and report | Record a challan (section, amount, bank, challan no., BSR); posts TDS owed → bank. Quarter view (April-based quarters): deducted / deposited / to deposit per section, each deduction with PAN (flagged if invalid), and a 26Q-style CSV (formula-safe) |
| Debit notes | Against a posted bill from the same supplier (DN-0001…): can't exceed what's still owed; reduce what's owed ("credited"), post AP / expense and input GST reversed, and come off GSTR-3B input credit. Voiding one gives the amount back; a bill can't be voided under live debit notes. Not routed for approval |
| Receipts & advances | One receipt (RC-0001…) for a customer in an invoicing book, into a named bank/cash account: spread oldest-due first or as chosen, as payments on the invoices (which post to that account); the rest is a customer advance (bank → Customer advances). Use an advance on a later invoice (advance → AR). Removing a receipt takes its payments off the invoices. INR invoices only |
| Payment runs | Pick open bills and amounts (PR-0001…), pay-from account and date; "Send for approval" goes through approval rules for payment runs (approved at once when none apply); approved runs give a bank bulk-upload CSV (beneficiary, account, IFSC, amount, reference — flagged when bank details are missing) and are marked paid, which records each bill payment. Cancel withdraws a pending approval. Cloudesk does not send money |
| Petty cash count | Count a cash account on a day; the difference from the books posts as a journal to Cash short or over (following journal approval rules) |
| Numbering | Debit notes, payment runs and receipts have their own sequences (started after any numbers already used) |
| Tests | `tests/integration/payables.test.ts` (7), `e2e/payables.spec.ts` |
| Limits | No TDS on advance payments to suppliers or on expenses recorded as paid; no lower-deduction certificates, surcharge or 206AB higher rates; no Form 16A or FVU/e-TDS file (the CSV is for your return preparer); rates need checking after each budget. No bank API — runs are paid by uploading the file. Receipts don't cover foreign-currency invoices |

## Finance+: fixed assets, repeating & spread journals, budgets, cash flow, forecast — ERP phase C1 (2026-10-24, migration 0048)

In Accounts: Fixed assets, Repeating & spread, Budgets, and Reports → Cash flow / Cash forecast. New accounts are added to every chart by key: Prepaid expenses, Accumulated depreciation, Accrued expenses, Gain or loss on assets, Depreciation (Fixed assets gets its key).

| Item | Status |
| --- | --- |
| Fixed asset register | Code (FA-0001), category, account, bought / in-use dates, cost, residual, method (straight line over a life, written-down value at a yearly rate, or none for land), company/branch/cost centre, serial, location; smart import (Tally-style columns, life in years); export |
| Depreciation | Daily-prorated first month; straight line computed cumulatively so it lands exactly on cost less residual; WDV on the remaining value, never below residual. Each completed month is posted by the sync (Depreciation / Accumulated depreciation, with the cost centre and branch) and follows edits; the schedule shows what's posted and what's to come |
| Disposal | Sell or scrap on a date: depreciation to that day, cost and accumulated depreciation leave the books, proceeds into a bank/cash account, gain or loss to "Gain or loss on assets"; undo; closed months respected |
| Repeating journals | Any balanced journal every month / quarter / year from a date (same day, capped at month end) to an optional end; optional reversal on the 1st of the next period (accruals). Stopping keeps what's posted |
| Spread journals | A total split evenly over N months (last month takes the rounding), from a prepaid account to an expense, with a cost centre |
| Budgets | Per financial year, optionally per company and cost centre; monthly amounts per account; budget against actual by account, year to date, with better/worse (income above plan and costs below plan are better) |
| Cash flow statement | Indirect method from balances: profit, depreciation added back, working-capital changes, investing (fixed assets), financing (loans, equity); checked against the change in cash and bank, with a visible difference if any. Filters by company/branch/cost centre |
| Cash forecast | 13 weeks: cash and bank today, receivables by due date (overdue in week 1), bills due, next payrolls at last month's net, repeating journals touching the bank |
| Tests | `tests/unit/finance-model.test.ts` (10), `tests/integration/accounting-finance.test.ts` (9), `e2e/assets.spec.ts` |
| Limits | The register doesn't post an asset's purchase (that's its bill or an opening-balance journal); no Income Tax Act block-of-assets depreciation, impairment or revaluation; budgets are entered as a monthly figure per account in the screen (per-month values via the API); the forecast only knows recorded documents |

## Organisation: companies, branches, cost centres, currencies, periods — ERP phase B (2026-10-24, migration 0047)

Platform-wide, at Settings → Organisation (owners and admins). Every workspace gets a default company on first use (from invoicing's business details or the books' GSTIN, else the workspace name); everything not linked to a branch belongs to it.

| Item | Status |
| --- | --- |
| Companies (legal entities) | Name, legal name, GSTIN (checked; state filled from it), PAN, CIN, state, address, group parent; one default (can be changed; can't be switched off); delete refused once it has branches, books or entries |
| Branches | Under a company, with regions above them (no loops); office, store, warehouse, plant, region; own GSTIN and state for branches registered elsewhere; manager. Stock locations, HR work locations, stores/venues/project books and finance books are linked to a branch and take its company. Smart import (company by name, parent in a second pass) |
| Cost centres, profit centres, business units | Codes (unique), hierarchy, optional company; on bill lines, journal lines and people (their pay); smart import |
| Books per company | Every journal carries its company, lines carry branch and cost centre. Posting follows the source: invoices → their books' branch; store, POS and restaurant sales → the project's branch; stock adjustments → the location's branch; bills → their company/branch (goods-received bills from the location); payroll split into one journal per company, salary costs split by cost centre; claims follow the person. Trial balance, P&L, balance sheet, day book and ledgers filter by company, branch and cost centre. Entries posted before this keep their fingerprint (not re-posted) |
| Closed months | Per company or for all; no new entries or changes from people or automatic posting; year-end closes all twelve months once the year is over; reopen (audited). Works alongside the existing lock date |
| Currencies & exchange rates | Currency list with common ones to pick from; rates (₹ per unit) by date, entered or imported; "rate on a date" = latest on or before it. Rates are not fetched from any source |
| Groups | Named sets of people; usable as approvers in approval rules |
| Data limits | A member (not an owner) can be limited to companies and/or branches: accounts reports and day book are cut to those companies and posting elsewhere is refused; inventory shows and moves stock only in their locations; HR shows and acts only for people in their work locations |
| Access reviews | Everyone's role, workspace role, groups, data limits, two-step sign-in and last seen; record a review with notes and changes (a copy of access is kept) |
| Tests | `tests/integration/organisation.test.ts` (10), `e2e/organisation.spec.ts` |
| Limits | Multi-currency posting, intercompany and consolidation come in phase C (foreign-currency invoices are still listed, not posted); GST returns aren't yet split per company/branch GSTIN; data limits don't yet apply to CRM, Projects, Horeca, the store or invoicing screens; delegated administration (admins managing only their branches) isn't built; there's one chart of accounts shared by all companies |

## Approvals & notifications — ERP phase A (2026-10-24, migration 0046)

Platform-wide (not a switchable module). Rules at Settings → Approvals (owners and admins), "My work" at `/inbox` for everyone, a bell in the top bar, Settings → Notifications for each person's preferences and (admins) the workspace's wording. Gap analysis and phase plan for the whole ERP list: [ERP-ROADMAP.md](ERP-ROADMAP.md).

| Item | Status |
| --- | --- |
| Approval rules | Per document kind (supplier bills, expenses, manual journals, purchase orders, expense claims, payroll runs — only kinds whose module is on): amount range, HR departments, order of precedence, on/off. Ordered steps; each step "any one" or "all" (parallel, a different person per approver), applies only from an amount, approvers are a person, anyone with a role, or the requester's HR manager, each with an optional approval limit; escalation after N hours to named people (owners otherwise). Editing a rule bumps its version; requests already waiting keep the steps they started with |
| Engine | First matching rule applies; nobody approves their own request (a slot with nobody else falls back to the owners; only a sole owner approves their own); approvals over an approver's limit don't count; one decision at a time per request (row lock); a changed amount restarts the request; sending back needs a note; edits after sending back resubmit; deleting/voiding/cancelling the document cancels its request; full history (submitted, approved, sent back, escalated, cancelled, on whose behalf) |
| Wired documents | Bills and expenses wait as "Waiting for approval" — out of the ledger, GST and payables, not payable; an expense's payment is recorded on approval. Manual journals are held by the request and posted on approval. Purchase orders can't be sent or received against until approved. Claims get the rule's steps after the manager's approval ("Further approval"). Payroll is finalised on approval, unless it was recalculated to pay more since (then it's re-sent) |
| Delegation | Anyone can name a stand-in for dates and kinds; admins for anyone; recorded as approved by them on your behalf |
| My work | Approvals waiting on you plus, where the module is on and you may act: leave, claims and attendance corrections you can decide, timesheet weeks to approve, project tasks and CRM tasks due today or overdue, and your reminders. My requests; when I'm away |
| Notifications | In-app list and bell (unread count, mark read), email through the outbox with delivery shown honestly (recorded / sent / retrying / failed), per-person per-kind switches, workspace wording with `{{fields}}`, reminders (sent once, each claimed atomically), escalations every 15 minutes. Task assignments, timesheets sent back, leave requests and decisions now go through it |
| Analytics | Waiting, overdue, approved and sent back in 90 days, average time to decide, and where requests wait longest |
| Tests | `tests/unit/approvals-model.test.ts`, `tests/integration/approvals.test.ts` (11: thresholds, multi-step, self-approval, delegation, escalation, limits, send back and resubmit, void, expenses, journals, POs, claims, payroll, preferences, wording, reminders, analytics), `e2e/approvals.spec.ts` |
| Limits | No SMS or push channel (needs a provider); approval rules can't yet be conditioned on supplier, project or account; purchase orders aren't re-approved when edited after sending; HR's own leave/attendance approvals stay manager-based (they appear in My work but aren't rule-driven); invoices and discounts aren't gated yet (sales phase D); escalation notifies — it doesn't reassign |

## Cloudesk Projects & timesheets (2026-10-24, migration 0045)

Module `work` at `/work` (feature page `/features/projects`; picked at onboarding for agencies & consulting and startups). Permissions: `work:read` (the team, not the Employee role), `work:write` (owner, admin, billing, developer, designer, editor), `work:manage` (owner, admin). Switchable parts: timesheets, billing, cost & profit (needs timesheets).

| Item | Status |
| --- | --- |
| Projects | Codes (PRJ-0001), status, client from any invoicing books in the workspace, hourly / fixed fee / not billed, rate per hour, fixed fee, hours or ₹ budget, dates, lead, colour, team with per-person rates (and cost rates for owners and admins). Delete is refused once time or milestones were invoiced |
| Tasks | Board with four renamable columns (drag or menu), per-project numbers, assignee (emailed a link when someone else assigns them), priority, dates, estimate, milestone, tags, checklist (the assignee can tick), one level of subtasks, comments; list view; My tasks across projects by due date |
| Time | Weekly grid (1:30, 1.5, 90m, 2h 15m), entries by hand, a timer (one per person; stopping logs whole minutes, at most 16h), 24-hour daily cap, no more than a week ahead, closed projects refuse time. Approved HR leave is marked and taken off capacity |
| Approval | Send a week, take it back, approve or send back with a note (emailed). Submitted/approved time is locked for the person; owners and admins can still correct it. Can be switched off in settings |
| Billing | Approved, billable time (member rate, else project rate; optional round-up per entry) and reached milestones become a draft invoice in the project's books for its client, with the books' GST rate, terms and due days. Lines grouped per task, per person or one line; different rates never share a line. Entries keep the invoice id and the rate used; voiding or deleting the invoice frees them (on void/delete in invoicing, and whenever billing is opened) |
| Cost & profit | Revenue = invoiced subtotals (not void) + unbilled billable time (hourly) or the fee (fixed). Cost = hours × cost rate set on the project, else HR yearly CTC ÷ (working days × hours) — only for callers with `hr:payroll`; people with neither are listed as missing |
| Reports | Hours per day (billable / not), by project, by person against capacity less leave (everyone for owners/admins, otherwise yourself), budget burn on open projects; every table exports to Excel/CSV |
| Wiring | Onboarding setup (settings row), CRM won deal → "Start a project" (name, value, company, matching client), project page links back to the deal; invoicing void/delete releases billed time; HR leave and salaries as above; command palette entries |
| Import / export | Smart import for projects (code or name match, client by name in the workspace's books, lead by email/name), tasks (project by code or name or picked, milestones found or added, assignee by email/name/first name) and time (duration type, task by title or #number; others' time only for owners/admins). Exports for projects, tasks, project time, the week, profit and reports |
| Tests | `tests/unit/work-model.test.ts`, `tests/integration/work.test.ts` (13), composer setup test, `e2e/work.spec.ts` |
| Limits | No Gantt chart, task dependencies or recurring tasks; one level of subtasks; Employee-role members can't join projects; HR-based costs ignore overtime, bonuses and unpaid leave; invoice lines carry hours to three decimals (47 min = 0.783h); task emails need a mail service; an invoice made by hand isn't linked to time; the demo showcase's teammate weeks were marked sent in directly in the database |

## Smart import & export, module setup and wiring (2026-10-24, migration 0044)

| Area | Status |
| --- | --- |
| Onboarding module picker | Every module in the catalog, grouped by area, with "For you" picks per business type. Turning a module on brings what it needs (Accounting brings Invoicing); turning one off takes its dependants with it. Parts (e.g. HR's Payroll) can be left out. Each picked module shows its own setup step |
| Module setup | Every module has a setup step (`MODULE_SETUP`, typed so a new module can't be left out). Each step also runs when a module is switched on later in Settings → Features. It sets up CRM settings, HR settings, Inventory's first store room, an invoice book, and the Accounts chart. Other modules need nothing set up yet |
| Smart importer | CSV, TSV, XLSX, XLS, ODS and Numbers files, or pasted rows. It finds the heading row under title rows and skips blank columns. It matches columns by name, alias, similar spelling and the values in them (emails, phones, GSTINs, PANs, dates, links), and shows why it matched each one. It reads Indian, European and Excel dates, ₹/Rs/lakh/crore amounts, state names, codes and GST numbers, and yes/no values. Blank cells can be filled for every row; problems show inline with one-click fixes (applied to one row or every row). Rows can be edited or left out before importing. The server checks every row again. Results show what was added, updated or left out, and the rows that weren't imported can be downloaded. Row numbers match the spreadsheet |
| Import targets | Inventory items (opening stock, supplier, location, batches) and suppliers; HR people (departments, locations, managers in a second pass, CTC with payroll permission); chart of accounts (Tally group names); opening balances (the difference goes to Opening balance equity); bills; bank statement rows (amount, or deposit and withdrawal); invoicing clients and items; CRM contacts (custom fields, owner, tag). Each matches existing records and updates them or skips them, as you choose |
| Export | Excel or CSV (formula-safe) for inventory items (stock per location) and suppliers, HR people, chart of accounts, day book, ledgers, bills, P&L, balance sheet, trial balance, aging, invoicing clients and items |
| Wiring | Restaurant bills post to the ledger: sales, CGST/SGST, tips payable to staff, round-off; payments go to cash, bank, receivables or returns. Invoicing items can be linked to an inventory item: an issued invoice takes stock out of the default location, a credit note puts it back, and editing or voiding an invoice corrects stock without counting twice |
| Tests | Unit tests (engine), integration tests (every import target, server re-check, setup for every module, switch-on setup, restaurant bill posting, invoice stock), and e2e tests (onboarding picks plus an Excel supplier import with fixes, CRM import, bank statement import) |
| Limits | At most 1,000 rows per request (the screen sends 300 at a time, so bigger files work); no PDF or image import; store products keep their own importer; Horeca menu, CRM companies and deals have no smart import yet; invoice stock always uses the default location; per-module prices aren't set |

## Cloudesk Accounts — Accounting & GST (2026-10-24, migration 0043)

A workspace-level double-entry ledger at `/accounts` (module `accounting`, requires Invoices & finance — the first module using `requires`; feature page `/features/accounting`; picked at onboarding for retail and services). Permissions: `accounts:read`/`accounts:write` (owner, admin, billing), `accounts:manage` (owner, admin). Switchable parts: bills & expenses, bank reconciliation, GST returns.

| Item | Status |
| --- | --- |
| Chart of accounts created on first use (45 accounts for Indian businesses: bank/cash, receivables, inventory, input/output CGST/SGST/IGST, PF/ESI/PT/TDS payables, sales, store sales, returns, COGS, salaries, common expenses); GSTIN and state taken from invoicing settings; rename, add, switch off; accounts Cloudesk posts to can't be deleted or switched off; type can't change once used | Done; integration-tested |
| Posting engine (`server/accounting/sync.ts`): builds the journal each source should have and makes the ledger match — invoices and credit notes (tax split from the printed tax rows), invoice payments (cash vs bank), store and POS sales (clearing / bank / cash; intra- vs inter-state like the store's GST report) with COGS for Inventory-linked products, refunds (tax apportioned), bills (input credit or GST into cost), bill payments, stock adjustments and counts, payroll runs (gross, employer PF/ESI, reimbursements → PF, ESI, PT, TDS, advances recovered, salaries payable), salary payments, claims paid outside payroll. Idempotent by source; changes replace, cancellations remove; locked periods and bank-matched entries are never touched and are listed instead. Runs every 15 minutes and when the books are opened (if older than a minute) | Done; integration-tested |
| Goods received in Inventory become bills automatically (one line per GST rate, due date from the supplier's terms, inter-state from supplier vs location state) and follow the receipt | Done; integration-tested |
| Bills (multi-line, GST rate per line, input credit on/off, inter-state), part payments from bank or cash, void (no payments), expenses (bill paid in full in one step) | Done; integration and e2e tested |
| Manual and opening journals (must balance; numbered JV-0001), delete only hand-written ones; day book with search and filters; account ledger with opening, running and closing balances | Done; integration and e2e tested |
| Banking: bank/cash accounts with book balances; statement CSV import (Indian day-first dates, `5-Oct-26`, debit/credit or signed amount columns, commas, brackets), duplicate lines skipped by fingerprint; auto-match when exactly one book entry of the same amount is within 5 days; suggestions, manual match/unmatch, ignore, post-from-line (already matched) | Done; unit, integration and e2e tested |
| Reports: trial balance, profit & loss (gross and net), balance sheet with retained and current-year profit and a balance check, receivables and payables ageing (from invoices and bills), home with cash, overdue, month/FY profit, 6-month trend and GST position | Done; integration-tested |
| GST: GSTR-1 working summary (B2B, B2CL > ₹1L inter-state, B2CS by state and rate, credit notes/refunds, HSN) from invoices and every store's GST summary, CSV per section; GSTR-3B (outward tax, input credit from bills, IGST-first set-off, cash payable and credit carried forward, ineligible credit shown) | Done; integration-tested |
| Lock date: no journal, bill, payment, statement post or sync change on or before it | Done; integration-tested |
| Marketing: `/features/accounting` with 10 chapters of real screenshots; the demo workspace's 120 posted entries come from its own invoices, counter sales, goods received and September payroll; bills, expenses and the October statement (built from the bank ledger plus three bank-only lines) were added through the API for the tour | Done |
| Limits | GST returns aren't filed or exported as portal JSON; ITC isn't checked against GSTR-2B; no TDS on bills, depreciation, e-invoicing (IRN) or e-way bills; non-INR invoices/orders are listed, not posted; no live bank feeds (CSV only); gateway payouts must be recorded to move money out of "Online payments to settle"; room charges settled to a stay are posted as receivables, not as separate room folios; gift cards and store fees aren't separated from sales |

## Cloudesk Inventory & purchasing (2026-10-24, migration 0042)

A workspace-level module at `/inventory` (module `inventory`, feature page `/features/inventory`; picked at onboarding for retail, food and home). Permissions: `inventory:read` (team), `inventory:write` (owner, admin, billing, developer, editor), `inventory:manage` (owner, admin). Switchable parts: purchasing, more than one location, batches & expiry.

| Item | Status |
| --- | --- |
| Items with SKU, barcode, unit (pcs to kg/l, three decimals), category, HSN, GST rate, weighted average cost, reorder level/quantity, usual supplier, batch tracking; SKU unique per workspace; items with history are switched off, not deleted; CSV export | Done; integration-tested |
| Store link: one click turns a store's physical, stock-tracking variants into items and gives the store a location whose quantity *is* the variant's stock (shop and POS keep selling from it); moves there also write the store's inventory log; store sales, returns and edits appear on the item's history; whole units only on a store shelf; re-running adds only new products | Done; integration-tested |
| Locations: any number, a default, state for GST, one per store shelf; a location with history can't be deleted or re-pointed | Done; integration-tested |
| Stock engine: every change goes through one ledger with balance per item/location/batch; blocks going below zero (setting); oldest-expiry-first when no batch is named | Done; integration-tested |
| Suppliers with GSTIN validation (state filled from the GSTIN), payment terms, lead time | Done; e2e covered |
| Purchase orders: draft → sent → part received → received / closed / cancelled; GST lines with CGST+SGST inside a state and IGST across states; edit while open (never below what's received); printable PO; email to supplier only when a mail service and an address exist — otherwise marked sent and the screen says it wasn't emailed | Done; integration and e2e tested |
| Goods received against an order (remaining quantity prefilled, over-receiving refused, part deliveries) or without one; batch and expiry; supplier invoice no.; weighted average cost re-worked on each receipt (an unknown cost of ₹0 doesn't dilute it) | Done; unit, integration and e2e tested |
| Transfers: draft → in transit (leaves source) → received (arrives); cancelling in transit returns stock; batches carried across | Done; integration-tested |
| Counts (difference in units and value before saving, history) and single adjustments with reasons (damaged, expired, lost, found, used, opening) | Done; integration and e2e tested |
| Reorder: items at/below level with on-order counted, suggested quantity, one draft PO per supplier, items without a supplier listed as left out | Done; integration-tested |
| Home and reports: stock value, low/out, on order, expiring batches, value by location and category, received by month, top suppliers, stock not moving for 90 days, valuation, full movement ledger | Done; integration-tested |
| Build your app: parts enforced on the server (purchasing, transfers, batches) and hidden in the menu; workspace roles can be limited to Inventory | Done; integration-tested |
| Marketing: `/features/inventory` with 10 chapters of real screenshots from the demo ceramics studio (suppliers, orders, deliveries, transfers and a count made through the app; one item's average cost was corrected by hand after the dilution rule was fixed) | Done |
| Limits | No supplier bills or payables yet (that's Accounting); Horeca kitchen stock and recipes aren't merged into Inventory; no barcode scanning in receiving; no landed-cost (freight) allocation; no serial numbers; manufacturing (bills of materials) not included |

## Build your app: module parts, dependencies and workspace roles (2026-10-24, migration 0041)

The composer layer that later modules plug into. Module catalogue in `src/lib/workspace/modules.ts`: each module has a group, optional `requires`, switchable `parts` (each owning API sections), the API sections it owns, and the other modules' APIs its screens `use`.

| Item | Status |
| --- | --- |
| Settings → Features rebuilt as "Build your app": modules by group (Sell & serve, Customers & marketing, People & operations, Money, Website & platform), part switches inside each module, a live "Your sidebar" preview, recommended set for the industry, switch everything on | Done; e2e covered |
| Switchable parts: HR (attendance, leave, payroll, claims, hiring, performance, assets) and CRM (deals & pipelines, sequences). Stored in `organizations.parts_off`; enforced on the server for every API section the part owns (403 with a clear message), hidden in menus, home widgets, person tabs, contact page and reports; a switched-off part's page says so | Done; integration and e2e tested |
| Parts switched off inside a module's own logic: with attendance off, payroll counts only unpaid leave as loss of pay and Horeca till unlocks don't mark presence; with hiring off, the public careers page is not found | Done; integration-tested (payroll) |
| Dependencies: switching a module on brings what it `requires`; switching off one that others need asks to switch those off too; the server always saves the closure | Done (mechanism; unit-tested). No current module has a hard requirement yet — the new modules will use it |
| Workspace roles (Team → Your roles): a name, a built-in base role for permissions, and the modules it may use. Assign from the member's role menu; changing the base role moves its members; deleting keeps members on the base role without the limit; admins can't create roles above their own | Done; integration and e2e tested |
| Role limits enforced in `requireOrg`/`requireProject` for every module API (org, project and root sections), allowing the APIs a permitted module's own screens call (e.g. Horeca → store, invoicing) one step deep; sidebar, command palette and project home hide what the role doesn't include; a direct link shows "Not in your role" | Done; integration-tested |
| Limits | Switching a whole project module (store, Horeca, invoicing, promotions…) off still only hides it, as before — their APIs are shared between modules; parts are enforced only for HR and CRM (Horeca's sections stay per venue in Horeca → Settings); invitations use built-in roles (assign a workspace role after they join); per-module pricing isn't built — it needs your prices |

## Cloudesk HR & payroll (2026-10-24, migration 0040)

A workspace-level HRMS at `/hr` (module id `hr`, feature `hrms`; picked at onboarding for retail, restaurant, hotel and other staff-heavy industries, otherwise switched on in Settings → Features; workspaces that never chose features have everything on). A new **Employee** role sees only "My HR" and "My account". Permissions: `hr:read` (everyone, scoped to self and reports), `hr:manage` (owner, admin), `hr:payroll` (owner, admin, billing). Managers act for everyone below them in the reporting line (recursive).

| Item | Status |
| --- | --- |
| Employees: job, department, location, manager (no reporting loops), type, probation, CTC, bank, PAN/UAN/ESIC/Aadhaar-last-4, a history (joined, promotion, transfer, manager change, salary revision); people can edit only their own contact and bank details; salaries visible only to payroll roles and the person | Done; integration-tested |
| Accounts: auto-link a member by email, invite with the Employee role (linked on accept), link by hand; import Horeca staff | Done; integration-tested |
| Joining and leaving checklists (owner-based ticks), notice period and exit, cancel exit, exited on the last day; assets with assign/return on the timeline; letters (offer, experience, relieving, salary) from editable templates with merge fields; org chart | Done |
| Attendance: web check-in/out, late after shift start + grace, half day under full-day hours, mark by managers (no future dates), correction requests with approve/decline, today board, month sheet with CSV; Horeca till unlock = check-in (later unlocks move check-out) | Done; integration-tested |
| Leave: own types (yearly/monthly accrual, pro-rated by join month, carry-forward cap, paid/unpaid), live balances, half days, holidays and weekly offs excluded, clash and balance checks, manager email on request and employee email on decision, HR files for someone (auto-approved), cancel, calendar, adjust balance, close year | Done; integration and e2e tested |
| Payroll: CTC → Basic/HRA/special; PF (₹15,000 ceiling or full Basic), ESI (≤ ₹21,000 gross), professional tax for MH/KA/GJ/TS/AP/WB/TN by work location, new-regime TDS estimate (FY 2025-26 slabs, ₹75k standard deduction, rebate with marginal relief, 4% cess); loss of pay from unpaid leave, absences and half days; mid-month joiners/leavers pro-rated; whole rupees; bonuses and deductions on drafts, hold, recalculate, finalise, mark paid, delete draft | Done; unit, integration and e2e tested |
| Payslips (printable, masked account; employees see only finalised ones), salary register CSV, bank transfer CSV (finalised only, held excluded, audited) | Done; integration-tested |
| Claims: file with receipt link (no future dates), approve/decline by manager, paid with the next payroll run for claims dated up to that month's end, or marked paid on their own | Done; integration-tested |
| Hiring: roles, public careers page `/careers/<token>` (own CSP, honeypot, rate-limited, duplicate emails merged), candidate board with ratings and notes, Hire → employee with checklist, role closes when openings are filled | Done; integration and e2e tested |
| Performance: goals with progress; review cycles, self review first then manager (409 otherwise), manager rating hidden from the employee until done | Done; integration-tested |
| Home by role (check-in, approvals, team today, HR stats, payroll, announcements, birthdays/anniversaries, holidays); reports (headcount by month, joiners/leavers, attrition, tenure, by department/location/type, payroll cost, leave taken, exits); settings (company, teams & places, work week & shift, leave types, payroll, checklists, letters) | Done; integration-tested (reports) |
| Marketing: `/features/hrms` with 12 chapters of real screenshots from the demo workspace; HR in the header and Features menu. Demo October attendance before 24 Oct was inserted directly into the database; leave, claims, payroll, hiring, reviews and assets were created through the app | Done |
| Limits | TDS is an estimate (new regime only, no declarations or other income); no ECR/ESI/PT challan filing; bank file is a CSV for bulk upload, not a bank API; check-in is web-only (no biometric, GPS or selfie); no shift rosters or overtime; professional tax only for the seven states listed |

## Cloudesk CRM (2026-10-23, migration 0039)

A workspace-level CRM at `/crm` (feature id `crm`; on by default for existing workspaces, picked at onboarding for retail, home, hotel, salon, clinic, fitness, agency and software). Permissions: `crm:read` (everyone), `crm:write` (owner, admin, billing, developer, editor), `crm:manage` (owner, admin).

| Item | Status |
| --- | --- |
| Contacts with lifecycle stage, lead status, owner, source, tags, custom fields, marketing consent and do-not-contact; companies (accounts) with domain auto-linking of work emails; no duplicates (matched by email, then the last 10 digits of the phone) | Done; integration-tested |
| Lists: ready-made views (mine, new leads, hot leads, customers, gone quiet), saved personal and shared views, filters (stage, owner, tag, activity, score, source), sorting, paging, global search with `/` | Done; e2e covered |
| Bulk actions on chosen contacts or everyone matching the filters: assign, stage, lead status, add/remove tag, marketing, add to sequence, merge, delete (admins) | Done; integration-tested |
| Contact page: lifecycle stepper, score, tags, details and custom fields, deals, company, sequences, duplicate warning with merge, and “Across Cloudesk” — store and counter orders, invoices/quotes (projects and finance books), bookings, restaurant visits and form entries by email or phone, with the total paid | Done; integration-tested |
| Timeline and composer: notes, calls (outcome, minutes), emails (templates, merge fields, sent through the workspace's mail service with a signed unsubscribe link), meetings (scheduled or held), tasks with due dates and priority; system entries for stage, owner and lifecycle changes | Done; integration and e2e tested |
| Deals: several pipelines with custom stages, win chance and “flag after N days”; drag-and-drop board with weighted column totals, list view, deal page with stage path; Won makes the contact a customer and stops their sequences; Lost requires a reason; reopen | Done; integration and e2e tested |
| Tasks: my day (overdue, today, coming up), done recently; managers see anyone's | Done |
| Sequences: email and task steps spaced in days, run by the job queue; enrol one or many; stop on unsubscribe, do-not-contact, a won deal or by hand | Done; integration-tested (queue drained in tests) |
| Lead scoring with editable rules (0–100), rescored on every change and when rules change | Done; unit and integration tested |
| Lead capture wired into the event bus (website forms, online and POS orders, bookings) plus Horeca guests and invoicing clients; per-source switches; assignment (none, one person, round-robin); owner email on new form leads; one-click sync of everyone already in the workspace; public web-to-lead endpoint (CORS, honeypot, rate-limited, rotatable link) | Done; integration-tested |
| Reports: won, win rate, average deal, sales cycle, pipeline by stage, weighted forecast by month, lost reasons, team table, lead sources with conversion, lifecycle funnel, weekly new leads | Done; integration-tested |
| Settings: visibility (all, or members see their own), assignment, currency, pipelines and stages, custom fields (text, number, date, choice, yes/no, link), lead capture, scoring, email templates, lost reasons and sources; CSV import with column matching and CSV export; audit log for deletes, merges, imports and exports | Done; e2e covered (import) |
| Marketing: `/features/crm` with 12 chapters of real screenshots from a demo workspace (its first 55 contacts were brought in by the sync); CRM in the header and Features menu | Done |
| Limits | Email replies aren't read back in; no calendar sync; no built-in dialler (tel:/wa.me links); without a mail service, emails are recorded but not delivered (the screen says so); one currency per deal, reports add values as stored |

## Cloudesk for Horeca (2026-10-23)

Restaurants, cafés, bars, hotels and cloud kitchens, at `/projects/:id/horeca`. Brand renamed to **Cloudesk** across the UI (technical ids such as `_creationcloud`, `@creation-cloud/sdk` and `cc-` keys are unchanged).

| Item | Status |
| --- | --- |
| Setup wizard (name, venue type, starting tables, GST, service charge); venue settings for bills, kitchen stations, room times and room GST, valet slots and fee | Done; integration-tested |
| Areas and tables with a QR code each (rotate to invalidate a code), bulk add, printable A6 table tents, SVG download; rooms get their own in-room dining QR | Done |
| Menu: categories with station and serving hours (cross-midnight), dishes with photo, diet mark, spice, prep time, tags, per-dish GST, sold-out switch; add-on groups with min/max; drinks linked to a bar bottle and pour size | Done; integration-tested |
| Guest QR menu at `/t/<token>` (own CSP, hashed script): search, veg-only, category tabs, add-ons sheet, cart, live order tracking, call waiter / water / bill, UPI pay link with the exact amount, tips; options for ordering vs browse-only, auto vs waiter approval, minimum order, name/phone, notes, theme, accent, cover, logo, welcome and footer, with a live preview in the dashboard | Done; integration and e2e tested |
| Floor: live table map by area (seated, ready, bill printed, awaiting OK, guest calling), order panel, staff menu picker with add-ons and notes, approve QR orders, per-item status and void (void returns bar stock), takeaway/counter orders | Done; integration-tested |
| Kitchen display: tickets (KOT numbers per station) in New / Cooking / Ready, station filter, timers with late tickets in red, bump a ticket or one dish, full screen, optional chime | Done; e2e covered |
| Bills: GST added to menu prices, discount (% or amount), service charge (taxed), tips; 80 mm print; payments by cash (change), UPI, card, other or charge-to-room; split and part payments | Done; integration-tested (billing maths) |
| Rooms: room types and rates, rooms (bulk numbers like 101-108), tape-chart calendar, availability by dates, bookings with overlap and capacity checks, check-in (date and clean-room checks, overridable), check-out (blocked while due, overridable; room becomes dirty), cancel / no-show, folio with room GST, extras, room service and payments, printable folio; front desk lists; housekeeping board | Done; integration-tested |
| Bar: bottles in ml, purchases (bottles or ml), wastage, adjustments, pours from orders, 7-day pours and days-left, reorder levels, physical counts with variance in ml and money, history | Done; integration-tested |
| Valet: tickets with plate, slot and key tag, board by status, printable ticket with QR; guest page `/v/<token>` with “Bring my car”; guest pre-booking `/v/book/<venue token>` | Done; integration-tested |
| Today: sales, average bill, payment split, best sellers (IST day) | Done |
| Marketing: `/features/horeca` with a stacked real-screenshot hero, a 10-chapter tour with hotspots and phone close-ups, and a homepage spotlight; screens come from the demo hotel “Saffron House”, whose orders, bookings, bar counts and valet tickets were made through the real dashboard and guest APIs | Done |
| Limits | UPI is a deep link confirmed by staff (no gateway callback); printing is via the browser (no direct thermal-printer link); no OTA channel-manager sync; no SMS/WhatsApp alerts for valet |

### Horeca Pro: POS, staff, stock, guests and reports (2026-10-23, migration 0038)

| Item | Status |
| --- | --- |
| Full-screen POS (`/horeca/pos`): dine-in, takeaway, delivery and room service; table/room picker with live totals; category rail, veg filter, dish grid with add-ons; short codes (type `BC` + Enter) and `/` to search; covers; customer by phone (welcome-back, points); held tickets (per device); counter orders; Send, Send & pay, KOT print, bill, pay | Done; e2e covered |
| Staff with roles and 4–6 digit PINs (argon2); full-window lock screen with staff tiles and PIN pad; lock button, auto-lock after idle minutes; the operator's name goes on orders, payments and events; PIN guesses rate-limited | Done; e2e covered |
| Manager approval: voids of fired dishes, comps ("on the house"), discounts above a % limit and cash pay-outs need a manager/owner — either at the till or by entering their PIN in a prompt (asks again on a wrong PIN); reasons recorded; activity log | Done; integration and e2e tested |
| Full-screen mode for the whole Horeca dashboard (browser Fullscreen API) | Done |
| Floor: move a table, merge two tables, split chosen dishes to a new check, several checks per table, comp, void with reason, guest and points on the order | Done; integration-tested |
| Bills: round-off to the rupee (setting), delivery fee, CGST/SGST split on receipts with GSTIN, FSSAI, address and custom header/footer; service charge only on dine-in and room service | Done; integration-tested |
| Happy hours / time-based offers: % off chosen categories on chosen days and hours, shown on the bill line | Done; integration-tested |
| Till: open with a float, cash in/out (out needs approval), live expected cash, close by counting notes, variance, printable Z report, past sessions; optional "require an open till to take payment" | Done; integration-tested |
| Reservations and waitlist: day view, covers, table clash check, confirm → seat (opens the order with covers) → complete / no-show; online booking page `/r/<token>` within opening hours and party limit | Done; integration-tested |
| Kitchen stock: ingredients in g / ml / pcs, suppliers, purchases (latest price becomes the cost), wastage and adjustments, counts with variance, reorder levels, 7-day use and days left; dish recipes deduct stock when sent and return it on void; food cost % per dish (also shown in the dish editor) | Done; integration-tested |
| Guests & loyalty: guest found or created by phone, visits and spend, tags and notes, points per ₹100, pay with points (minimum), history; post-meal rating on the QR page after paying; feedback list | Done; integration-tested |
| Reports for any range (venue time): totals, GST by rate, payment methods, order types, busiest hours, days, categories, dishes, staff, voids/comps/discounts, ratings; CSV downloads | Done; integration-tested |
| Outlets: every Horeca venue in the workspace with today's sales; copy a menu from one outlet to another | Done; integration-tested |
| Marketing: `/features/horeca` has 17 chapters (new: POS, staff PINs & lock, reservations, recipes, kitchen stock & food cost, guests & loyalty, till, reports) and a POS-first hero stack; the homepage spotlight has 12 modules; the restaurant and café business pages show the POS. Every screen was re-captured from the demo hotel “Saffron House”, whose staff, stock, sales, till moves and bookings were made through the real API and dashboard | Done; e2e covered (chapter counts) |
| Sections can be switched off per venue (POS, rooms, bar, valet, stock, reservations, guests) so a small café sees only what it uses | Done |
| Limits | One open till session per venue (not per terminal); the lock covers this screen only — the signed-in account stays signed in; refunds after payment are not built (cancel before paying); held tickets live in that browser; no Swiggy/Zomato or payment-terminal integration; printing via the browser |

## Invoicing (2026-10-21, latest)

| Item | Status |
| --- | --- |
| Invoices, quotations, proforma invoices, credit notes; drafts, issue, edit, duplicate, convert quote → invoice/proforma, credit note from invoice, void (owner/admin/billing), delete drafts | Done; integration + e2e tested |
| Totals: line and document discounts, charges, GST (CGST/SGST vs IGST by place of supply) or VAT/sales tax, inclusive/exclusive, round-off, amount in words (lakh/crore), HSN summary | Done; unit-tested |
| Numbering per type with prefix, digits, financial-year reset; manual numbers checked for clashes | Done; integration-tested |
| Clients (with open balances), saved items, store products as line items | Done |
| Payments (part/full, methods, references), PAID status, payment removal (owner/admin/billing) | Done; integration + e2e tested |
| Sharing: public link (no-index, view tracking), QR, email (honest when delivery isn't set up), WhatsApp, SMS, native share, print/PDF; UPI pay-by-QR for the exact balance; quote accept/decline online | Done; e2e tested. PDF is the browser's “Save as PDF” — no server-side PDF file |
| Recurring invoices (week/month/quarter/year, optional auto-email) and automatic reminders | Done; integration-tested (hourly scheduler) |
| 8 prebuilt templates; studio with layout, colours, fonts, size, paper (A4/Letter/A5), margins, logo, table style and columns, show/hide blocks, every label, signature image, footer | Done |
| Upload your current invoice (image/PDF): stored for side-by-side matching; with an AI provider, layout/colours/columns/wording and your business, bank and numbering details are read and offered for review | Done; mapping unit-tested. The AI read was not exercised against the live API here (no key) |
| Reports: invoiced vs collected (12 months), receivables ageing, top clients, quote win rate, days to pay, payment methods, tax/GST summary; CSV exports (register, GST, payments, clients) | Done; integration-tested |
| Onboarding detects invoicing needs; plan, dashboard checklist, shortcuts and tour include it | Done; unit-tested |
| Standalone **Finance** module: workspace-level books outside any project (several per workspace), same features, workspace roles, rename/delete (owners/admins, typed confirmation), own logo files at /f/:id; onboarding “Just need invoicing & billing?” | Done; integration + e2e tested |
| Pastel dashboard: soft tinted hero and figure cards with gentle gradients, light and dark | Done; browser-reviewed |

## Marketing site (2026-10-21, latest)

| Item | Status |
| --- | --- |
| Landing page `/` in the onboarding's pastel style: animated hero demo (sentence → understood → site → live), marquee, feature grid, how it works, four spotlights, “made for” use cases, promises, FAQ, CTA | Done; e2e covered |
| `/features` index and `/features/<slug>` for all 13 features: hero with a living CSS/SVG scene, steps, highlights, “Good to know” limits, FAQs, related features | Done; every page e2e-checked |
| Header with features menu and phone menu; signed-in visitors see “Open dashboard” | Done |
| Scroll reveals and motion respect reduced-motion; light and dark | Done; browser-reviewed |
| Copy states only what's built; limits listed on each page; no testimonials, logos or invented statistics | Done |
| Homepage “Quick actions”: a button for every feature (links to its page; hover previews it) and a looping 3D carousel of phones showing each feature’s real 402×874 screen in a CSS-drawn phone frame; drag/swipe, arrows, keyboard, autoplay only while visible, still under reduced motion | Done (2026-10-23); e2e covered |
| All 14 feature pages (incl. Promotions & recovery) have a real-screenshot hero (tilt or stack), a stacked screenshot tour with hotspots and close-ups, and an interactive highlights explorer; `/features` index uses the real screenshots. Screens come from demo projects (Still Waters Spa, The Bread Room) whose bookings, enquiries, chats, visits and promotion views were made through the live public pages, not inserted | Done (2026-10-22); tour counts e2e-checked |

## Deployment

| Item | Status |
| --- | --- |
| Validation → render → verify → ready pipeline with logs | Done |
| Preview (members only) and production (public) environments | Done |
| Rollback / promote | Done |
| Adapter architecture | Done (platform static host; GitHub, Netlify, Vercel and Cloudflare Pages through Hosting & publishing) |
| Custom domains, DNS verification | Done: TXT ownership + CNAME/A check, sites served at the domain root (store and checkout included), sitemap and links use the domain; `/api/v1/domains/ask` for on-demand TLS |
| SSL certificates | Needs an edge proxy (e.g. Caddy on-demand TLS) in front of the app; not issued by the app itself |
| Environment variables / secrets for generated apps | Not started |

## Known limitations

1. **Many web servers, one worker**: API rate limits are shared through Postgres and sessions live in the database, so web servers scale out (`APP_ROLE=web`). The firewall's per-IP counters and the AI runner are per server; run exactly one worker (see "Production readiness pass for AWS").
2. **Email delivery needs configuration**: with `RESEND_API_KEY` and `MAIL_FROM` set, mail is sent through Resend (tested against a mocked API); otherwise it is only recorded (visible to the recipient in Settings → Developer). Store owners see which mode is active in Store settings.
3. **Code execution is a sandbox, not a VM**: JavaScript runs in QuickJS (WebAssembly) inside the web server process with time/memory/output limits and no network. Python and full Node need `EXEC_DOCKER=on` and Docker; that runner is only tested with a simulated Docker CLI.
4. **Monaco loads from jsDelivr**: the app CSP allows that CDN and `'unsafe-eval'`.
5. **Free-form layout lives inside free-form sections**: the rest of the page stays section-based. Live co-editing covers IDE files; the visual builder syncs saved edits every few seconds.
6. **The rule-based planner is keyword matching**: it handles restaurants, software, portfolios and professional services well and anything else generically.
7. **Built-in edit commands are a small fixed set**: add/remove a section, apply a theme preset.
8. **OpenAPI**: the public API has `/api/public/v1/openapi.json`; data tables get a generated document per project. The internal app API is documented in [API.md](API.md).
9. **Uploads are stored in PostgreSQL** (`bytea`), which works at any number of web servers but grows the database; move to S3-compatible storage as media grows. Asset URLs are public but unguessable.
10. **A/B buckets** use a daily hash of network address and browser, so a visitor can switch group on a new day; conversions only count form submissions.
11. **Placeholder photos are Unsplash images loaded from images.unsplash.com**; there are no uploads yet, and diagnostics warn until they are replaced.
10. **Web fonts load from jsDelivr** (pinned Fontsource packages); published sites allow only that host for styles and fonts.
11. **Not all of the advanced specification was available**: the second document was cut off after "Accessibility / Performance" in Part A because the message exceeded 50,000 characters.

## Needs external credentials or infrastructure

| Feature | Needs |
| --- | --- |
| Free-form AI design edits, AI planning, AI code changes | Anthropic API key (organization or platform) |
| Calendar invites from real mail | A connected mailbox (as for Mail); no Google/Microsoft calendar API is used |
| Mail inbox with real mailboxes | The mailbox owner's app password; for Microsoft 365, a Microsoft Entra app (`MICROSOFT_OAUTH_CLIENT_ID/SECRET`); for Google sign-in, a verified Google OAuth app (`GOOGLE_OAUTH_CLIENT_ID/SECRET`) |
| Email delivery | A Resend account and verified sending domain (`RESEND_API_KEY`, `MAIL_FROM`) |
| Automatic courier booking | A Shiprocket account with an API user and wallet balance (India) |
| Multi-instance deployment | Supported for web servers today (Postgres-backed rate limits and sessions); more than one worker needs atomic claims in a few schedulers; fleet-wide firewall limits need AWS WAF or a shared store |
| Python / full Node in the terminal | Docker on the host and `EXEC_DOCKER=on` |
| Taking real store payments | Your own Razorpay, Stripe or PayPal keys; run the live payment test (needs a public `APP_URL`) |
| Platform billing | Stripe or Razorpay keys and price/plan ids (built; tested against mocked APIs) |
| Chatbot semantic search | Optional `VOYAGE_API_KEY` |
| GitHub sign-in | A GitHub OAuth app (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) |
| Asset uploads | S3-compatible storage |
| Custom domains | DNS and TLS automation (e.g. a CDN/edge provider) |

## Subscriptions, trials and sign-up with a code (2026-10-26, migration 0091)

| Item | Status |
| --- | --- |
| Engine (`src/server/billing/subscriptions.ts`, maths in `src/lib/billing/catalog.ts`): plan catalogue in the database (Workday — Mail, Calendar, Chat; Starter; Growth; Enterprise — every value editable), build-your-own (base + per-feature monthly prices + extra seats; yearly = 10 months), every new workspace on a 30-day trial of everything with the largest limits (sign-up, GitHub, extra workspaces; existing workspaces got a fresh 30-day trial in migration 0091) | Done; `tests/unit/subscription-pricing.test.ts` (12), `tests/integration/subscriptions.test.ts` (20) |
| Changing plan: in the trial it sets the plan for afterwards and raises its first invoice (due at the trial's end; paying early keeps every trial day); upgrades are invoiced for the time left at the new price less the unused time on the current plan (to the minute; interval changes start a fresh period) and apply once paid (at once when credit covers it); downgrades are scheduled for the period end; snapshots mean catalogue edits never change what someone already pays | Done; integration tested with exact amounts |
| Payments: Cloudesk raises the invoice (GST added and shown), the provider only takes the money — Razorpay Orders (checkout signature verified with our secret, then the payment fetched: same order, amount, currency, captured) or Stripe Checkout (session fetched: paid, same invoice and amount); webhooks (`payment.captured`/`order.paid`, `checkout.session.completed`) settle the same invoice; one payment pays one invoice, whichever arrives first | Done; Razorpay flow integration tested against a faked HTTP layer. **Not run against live Razorpay/Stripe** (no keys here) |
| Renewals and endings (scheduler every 10 min, `SUBSCRIPTION_SCHEDULER`): trial reminders 7/3/1 days before; renewal invoices raised 7 days before a period ends; unpaid → grace (7 days, full access) → ended; cancelled → ended at period end; ended = read-only (every write refused except paying; everything can still be opened and exported) | Done; integration tested |
| Plan enforcement: features outside the plan are refused by the API and shown as "Not in your plan" with "Add it to your plan"; limits (seats, web apps, domains, automations) follow the plan | Done; integration tested |
| Sign-up with an emailed code: six digits, HMAC-stored, 10 minutes, 5 tries, one use, newest only, 30 s between sends, rate-limited per address and IP; the password is hashed before it's held; nothing is created until the code is right; then the verified account, workspace, chosen features (set up), trial and plan; no session — the person signs in. Sign in with a code; invited people create just their account (no workspace) and join the inviting one. Direct password sign-up is refused in production (allowed in development/tests, and in e2e via `ALLOW_DIRECT_SIGNUP=1`) | Done; integration tested; UI checked in the browser |
| Public `/pricing` page (plans by month/year, build-your-own calculator, comparison, FAQ) from the live catalogue; "Pricing" in the header and site search | Done; checked at 1440 and 390 px |
| Limits | Renewals are invoices paid each period (no card/UPI auto-debit mandates). GST is one line at the configured rate (no CGST/SGST/IGST split or GSTIN on subscription invoices). Refunds aren't issued for downgrades or cancellations (unused time becomes credit only on upgrades). Live payment providers were not exercised. In development without a mail service the code is shown on screen (never in production). |
| Admin → Subscriptions tab: MRR/ARR (from active, non-complimentary subscription amounts), paying, on trial, trials ending this week, payment due, ended, collected 30 days, outstanding; by-plan table; state chips, search, "Show more", CSV export; row → workspace drawer; deep link `#subscriptions/<orgId>` | Done; checked in the dev server with Playwright at 1440 and 390 (no horizontal scroll, no console errors); CSV download checked via the API |
| Subscription drawer: state, plan with features and limits, usage, dates, credit, pending change, invoices (Record payment with reference, Void), timeline; actions — extend/start trial (+7/14/30), end trial, assign catalogue or built plan (paid → invoice, or complimentary for N months / until removed, with price + tax preview), add/remove credit, cancel at period end / reactivate, end complimentary, expire now (type the workspace name) | Done; walked in the browser on a test workspace: trial +7 days (DB confirmed), complimentary Starter 3 months, paid Growth invoice ₹3,538.82 → recorded payment (paid via manual, plan active), credit ₹250.50 (25050 paise). Password re-entry prompt appeared for the fresh-only action after the session was made stale. Void, end trial, cancel/reactivate, end complimentary and expire not clicked through (expire's typed confirm checked disabled) |
| Admin → Plans & pricing (replaces the old Free/Pro/Business limit overrides): plan cards with price, features, limits, subscribers; editor (all fields, grouped module picker or every feature, rupee prices), new plan, archive/restore; pricing & trial rules form (enforce switch with warning, trial days, tax %, label, yearly months, grace, renewal notice, build-your-own base/modules/seats/limits, per-module prices in rupees) | Done; edited Starter's monthly price to ₹1,049 and the trial to 31 days / HR to ₹525.75 in the browser, confirmed via the API, then restored (₹999, 30 days, ₹499). New plan and archive not clicked through |
| Workspaces dialog: legacy Give trial / End trial / Complimentary controls replaced with a subscription summary + "Manage subscription" (opens the Subscriptions drawer); list shows the subscription plan and status. Client 360 shows the new subscription summary and uses its limits/usage. Settings → Sign-up: legacy "New workspaces start on" / "Trial days" removed, pointer to Plans & pricing | Done; checked in the browser |
| Nested dialogs in the console (confirm inside the drawer, suspend confirm and Full profile inside the workspace dialog) no longer close the outer dialog | Done; fixed by stopping React's close/cancel propagation (`Nested` in admin/subscriptions.tsx) |
| Public sign-up at `/start` (onboarding first): welcome → your business (name, one line, industry; `?industry=` pre-picks) → quick questions → features (on/off + parts) → choose your plan → account → emailed code → "You're all set". Same steps and look as `/welcome` (shared components); `/welcome` unchanged for signed-in people | Done; full sign-up run in the dev server with Playwright at 1440 and 390: account created verified, workspace with the 12 chosen features (DB checked); `/welcome` re-checked signed in (Skip setup, ?industry, set up to "ready") |
| Choose your plan: 30-day trial banner, Monthly/Yearly ("2 months free" from yearlyMonths), catalogue cards (price/month, billed yearly total, seats / web apps / custom domains, included features or "Every feature", "Recommended" on the highlighted plan, "X doesn't include …" for chosen features a plan lacks, "Covers everything you picked"), Build your own (base always on, features by group with monthly prices, requirements auto-added with a note, seats stepper from the included seats, itemised lines + subtotal + GST + total per month/year; pre-filled from the features step), Decide later (no choice sent). `?plan=&interval=` and `?build=&seats=&interval=` from /pricing preselect it (invalid values ignored) | Done; yearly, Starter, builder with an extra seat and Manufacturing checked in screenshots; `?plan=growth&interval=year`, `?build=manufacturing,bogus&seats=7` and `?plan=nope` checked with Playwright |
| Account step: name, work email, password (same rules + strength meter as before), business name prefilled, terms checkbox (links to the Terms/Privacy URLs from Admin → Settings → General when set, plain text otherwise); 409 → "Sign in instead"; field errors from the API shown on the fields | Done; terms-required error and the start call checked in the browser. 409/403/429 paths not clicked through |
| Check your email: six digit boxes (auto-advance, paste/autofill a whole code, backspace back, numeric keyboard, `one-time-code`), auto-submit on the 6th digit, wrong code shows tries left, "Send a new code" after a 30 s countdown (new ticket), Change email, development-only code note when the server returns `devCode` | Done; wrong code ("That code isn't right. 4 tries left.") then the right code typed digit by digit, at both widths. Resend not clicked through (countdown seen) |
| No auto sign-in: "Log in" → `/login?email=…&welcome=1` with the email prefilled and "Your workspace is ready — log in to start your free trial"; in-progress answers kept in sessionStorage across a refresh (never the password) and cleared on success | Done; password login after sign-up landed on /home; refresh on the features step kept the answers |
| Login: "Email me a code instead" → send code → the same digit boxes → signed in (two-step accounts go to the existing authenticator step); resend countdown, change email, back to password. `/signup` redirects to `/start` (keeps `?industry`, `/welcome?industry=` from old business links, and other `?next`); marketing "Start free" links and the invite page point to `/start` | Done; code login checked at both widths; `/signup?next=/welcome?industry=clinic` → 307 `/start?industry=clinic`. MFA-after-code not run (no 2FA account) |
| E2E: journey.spec signs up through `/start` with the code from the outbox and logs in with the password, then with an emailed code; other specs create accounts through `e2e/helpers.ts` (direct sign-up, allowed in E2E) instead of the removed form; businesses/marketing specs follow `/start` | Updated; not run here (needs a production build) |
| Settings → Billing rebuilt on the subscription engine (`src/app/(app)/settings/billing/view.tsx`, `src/components/billing/*`): hero with plan, state badge (Free trial / Active / Payment due / Cancels on … / Ended — read-only / Complimentary), trial or period progress bar, next payment (open invoice with Pay now / View) or next renewal incl. GST, account credit, scheduled downgrade note, cancel/resume with a confirm that says what happens; stat tiles (features X of Y, seats / web apps / custom domains meters, total paid, customer since) | Done; walked in the dev server with Playwright on a fresh sign-up at 1440 and 390 — trial, trial with a chosen plan, cancelled-then-resumed, active with a scheduled downgrade, grace and expired (dates/status set in the dev DB) |
| Change plan: Monthly/Yearly toggle, catalogue cards (current / "after your trial" marked; re-choosable once ended), Workday row, Build your own (grouped features with prices, requirements auto-added with a note, seats stepper, itemised lines + GST, sticky total bar); `?add=<module>` opens the builder with the current plan's features + that one, highlighted and scrolled to. Every choice goes through `/preview`; the confirm is worded by mode ("Choose for after the trial", "Confirm and pay ₹…", "Schedule change") and after a start/upgrade goes straight to paying the new invoice | Done; Starter for after the trial, built plan (CRM, HR, Accounting, extra seat, yearly), upgrade Growth → Enterprise (credit line for unused Growth, total due now) then straight to payment, downgrade to Starter (₹0 now, takes effect at period end), start Starter from expired, `?add=hr` — all in screenshots |
| Paying: provider picker when both are set up, Razorpay checkout (script loaded on demand) + `/confirm`, Stripe redirect and `?paid=stripe&invoice=&session_id=` confirmed once then URL cleaned, `?paid=cancelled` note; with no provider keys "Online payments aren't set up yet — contact support to pay by bank transfer or UPI" (quoting the invoice number and amount) | No-provider message verified in the browser. Razorpay and Stripe flows written to the API contract but not run (no keys in dev) |
| Invoices table (number, description, period, total, status chip, due/paid date; Pay on open ones) and printable invoice (Cloudesk, workspace, dates, lines incl. − credit lines, subtotal, credit applied, GST %, tax, total, paid via/date) with Print — print CSS shows only the invoice | Done; dialog and print-media emulation checked in screenshots. Real print dialog / PDF save not checked |
| History timeline in plain sentences ("Asha Rao chose Starter (monthly) · CD-2026-000001", "Cloudesk team extended your trial by 14 days", …) for every event kind | Done; trial_started, plan_chosen, cancel_requested, cancel_undone, upgrade_requested, change_scheduled seen; platform-made events only checked by reading the code |
| Members without owner/billing role: read-only card with the plan from the session and who can manage it (also used if the API answers 403); legacy Pro/Business box only when the old provider subscription exists | Read-only card checked as an editor (role flipped in the dev DB). Legacy box not seen (no legacy subscription in dev) |
| App-wide banner under the top bar (`SubscriptionBanner`): trial ≤ 7 days, grace ("Payment due — everything keeps working until …"), expired (always shown, can't be hidden); hidden for the day per workspace (localStorage, guarded); owners/billing get the button, others "Ask an owner…". Sidebar chip by the workspace name ("Trial · 18 days", "Payment due", "Read-only", "Ends …") | Done; trial 5 days, grace and expired banners and chips in screenshots; hide-for-today checked (gone after reload, key stored for today) |
| Home: compact subscription card for owners/billing only (plan, state, days left / renewal, next payment, Manage billing / Choose a plan) | Done; checked for trial and grace as owner and absent as an editor |

## Free plan and conversion (2026-10-29, migration 0094)

| Item | Status |
| --- | --- |
| Free plan in the catalogue (kind `free`, ₹0, never sold or quoted): Mail, Calendar, Chat, Invoicing, CRM; 2 seats, 1 web app, no custom domain, no automations; monthly allowances of 10 invoices, 100 CRM contacts (in total), 25 AI requests. Every value editable in Admin → Plans & pricing | Done; `tests/integration/free-plan.test.ts` (7) |
| When a trial ends unpaid the workspace drops to Free (state `free`) instead of read-only — Admin → Pricing "After the trial" picks Free plan or read-only. Data in features outside Free is kept but locked ("Not in your plan") | Done; integration tested |
| Trial fair-use allowances (100 invoices/month, 1,000 contacts, 200 AI requests/month by default, editable) | Done; integration tested |
| Dashboards, quick actions and the sidebar show only the features in the workspace's plan; the sidebar adds an "Unlock with a plan" list (up to 4 locked features) | Done; dashboard quick actions integration tested; UI checked in screenshots |
| Allowances enforced on the server: creating a contact (and CSV import — rows over the allowance are skipped and reported), issuing an invoice (quotes and other documents don't count), AI requests. Over the allowance → 409 naming the limit, the usage and the cheapest plan that covers it | Done; integration tested |
| Conversion: usage meters (Billing, home card, upgrade prompt), one in-app warning per allowance per month at 80%, a global upgrade prompt whenever the API refuses for a plan or allowance (recommends the cheapest plan with that feature), "Keep what you've built" recap during the trial (records in features Free doesn't include, the plan that keeps them, and the build-your-own price), banner/chip/home card for the Free state, Free card on `/pricing`, "Made with Cloudesk" link on published sites of Free workspaces | Done; upgrade prompt, meters, banner and sidebar checked in screenshots; badge integration-tested via the serving code |
| Limits | Allowances count by calendar month in UTC. Website leads (forms, chat) are always captured even over the contact allowance, so a Free workspace can exceed 100 contacts that way; only manual creates and imports are refused. The 80% warning is an in-app event, not an email. The badge appears only on Free-state sites (not trial or paid). The plan recommendation compares catalogue plans only, not the build-your-own price. |

## Partner program (2026-10-29, migration 0095)

| Item | Status |
| --- | --- |
| Public `/partners` page: hero with live rates by kind of partner, benefits, the five kinds (Partner organisation, Freelancer, Sales partner, Marketing partner, Influencer) with scope of work, rates and dashboard tools, an earnings calculator worked out from the live rates and catalogue prices (labelled as an estimate), how it works, tiers, payouts, FAQ; "Partners" in the header, mobile menu, footer, site search and sitemap | Done; checked at 1440 and 390 px (no horizontal scroll) |
| Application: kind → details (type-specific questions, required ones enforced on the server) → account (if signed out) → emailed 6-digit code; the account (no workspace) and the application are created together in one transaction. Signed-in people apply with their account; a declined application can be sent again | Done; integration tested; full form flow run in the browser and in `e2e/partners.spec.ts` |
| `/partner-terms` (in the legal pages): attribution, commission table from the live settings, tiers, holds and reversals, payouts and TDS (s.194H), promotion rules (TCCCPR, CCPA endorsement guidelines 2022, ASCI influencer guidelines, FTC/CAP), personal data (DPDP/GDPR), brand use, ending | Done |
| Attribution: `/go/CODE?c=campaign&to=/path` counts the visit (per code, campaign and day; bots skipped; only internal `to` paths) and sets `cc_ref` for the program's cookie days; the `/start` sign-up attaches the partner from a typed code, then the cookie, then a registered lead's email; Billing → "Have a partner code?" once per workspace; one partner per workspace; never the partner's own workspace | Done; integration tested |
| Discounts: a code's % off is applied to the customer's next N invoices (first, upgrade, renewal) as a "Partner code …" line before GST, shown in the change-plan preview; used up one per paid invoice | Done; integration tested with exact amounts |
| Commission: every paid subscription invoice of a partner's customer within the window earns the rate (code's own rate, else partner override, else kind's rate, plus the tier bonus from customers paying now) on the subtotal before tax; once per invoice; held N days | Done; integration tested |
| Partner dashboard `/partner` (own frame, works without a workspace): review/declined/paused states with payout details; once approved — overview (available, this month vs last, paying customers, monthly earnings now, 12-month chart with hover and a table for screen readers, click → sign-up → paying funnel, tier progress, revenue brought), customers, leads (sales partners and organisations), links & campaigns & codes (make codes within the program's limits), earnings ledger with CSV, payouts (withdraw with TDS shown, history, cancel a request, UPI/bank/international details stored encrypted with only a hint shown), profile and terms, playbook (scope of work, messages, rules, logo) | Done; walked in the browser at 1440 and 390 with a real approved partner, a customer through a link and a recorded payment |
| Admin → Partners: stats, list with filters, drawer (application answers, approve/decline/pause/reactivate with emailed notes, terms and overrides, code rename, private note, codes on/off and new codes with their own rates, customers with reverse and "give a workspace", commissions with cancel, adjustments, payout details revealed after a fresh sign-in and logged, payouts), payout queue (approve, reject, mark paid with UTR — fresh sign-in), Program & rates (open/closed, hold, minimum payout, TDS %, cookie and lead days, codes per partner, rates per kind, tiers) | Done; approve, list and program tab checked in the browser; every action integration tested through the admin API |
| Limits | Payouts are sent outside the app (bank/UPI) and recorded here with the reference — there is no payout API integration (e.g. RazorpayX). No TDS certificates (Form 16A) or partner GST invoices are generated. Commission is on Cloudesk subscription invoices only. Only the `/start` sign-up and Billing attach a partner; GitHub sign-up and the development-only direct sign-up don't read the link cookie. Link visits are counted per request (not de-duplicated per person). Refunds aren't processed in the app, so an admin cancels the commission on a refunded payment by hand. Leads match on the exact email only. TDS defaults to 0% until an admin sets it. |

## Notes (2026-10-29, migration 0096)

| Item | Status |
| --- | --- |
| Notes for every member in every workspace and plan (sidebar → Notes, command palette, ⌥N new, ⌥T today, / search): nested folders (colour, emoji, drag folders into folders), tags, pinned, daily notes, shared with me, reminders, templates, trash (30 days) — three panes on wide screens, two on tablets, one at a time on phones | Done; checked in the browser at 1440, 820 and 390 px (no horizontal scroll) |
| Block editor: text, headings 1–3, to-dos, bullets, numbered lists (nesting with Tab), quote, callout (5 kinds), toggle, table (add/remove rows and columns, copy as CSV), code, divider, image (by link), live calculation (named results reused below, e.g. `total = rent + salaries`), record from any module (picked through the app search), web link, date. "/" menu, Markdown shortcuts as you type, inline **bold** *italic* ~~strike~~ `code` ==highlight== [links](…) [[note links]], a selection toolbar, ⌘B/I/E/K, ⌥↑/↓ to move, ⌘D duplicate, shift-click to select several blocks | Done; unit tests for parsing, Markdown round trip, calculations and link safety (`tests/unit/note-blocks.test.ts`) |
| Drag and drop: blocks by their handle (several at once when selected), elements from the Elements panel into the note, notes onto folders (several at once), folders into folders, .md / .txt files onto a note or the list to import | Done; drag of an element and reordering checked in the browser |
| Saving: automatic (0.8 s after typing, and when leaving), one save at a time, never replacing what's on screen; if someone else saved first it says so (load theirs / keep mine). Versions kept after a 10-minute pause and before any restore (last 100), with preview and restore | Done; integration tested (stale version → 409, restore) |
| Sharing: private, workspace can read, workspace can edit, or chosen members (read/edit, notified); share into a chat as a card (optionally opening it to the workspace so people in the chat can open it); email it (text and a link) through Mail; a read-only public link at /n/… (not indexed; off breaks it) | Done; integration tested; share dialog checked in the browser |
| Notes on any page of any module: the top bar's notes button lists the notes attached to the page you're on and saves a quick note to it — in that module's own folder (made on first use) unless you pick another | Done; integration tested; checked on CRM in the browser |
| Daily notes: one per day, made on first open with your meetings that day (Calendar) and your open tasks due by then (Projects) as links; previous/next day | Done; integration tested |
| Backlinks: [[Title]] links to other notes (click to open, or to make it), "Linked from" and "Links to" under the note; outline of headings; word count and reading time; lock (read-only), pin, colour, emoji, reminders (notification + email if turned on), duplicate, save as template | Done; integration tested (links, lock, reminders) |
| AI (the workspace's own connection; counts against the plan's AI allowance): rewrite a selection (improve, fix, shorter, longer, simpler, professional, friendly, points), summarise into the note, action items → to-dos or tasks in a Projects project, continue writing, title + emoji + tags, turn into a table, translate into a new note, ask this note, ask across all your notes with the notes it used, draft a new note from a prompt | Done; integration tested with a stubbed model (no live model calls in tests) |
| Export: Markdown, text, HTML, print / save as PDF, copy as Markdown; all notes as CSV; import Markdown / text files | Done; CSV export and import integration tested |
| Limits | Images are added by link (no file upload store for notes). Two people editing the same note at the same moment aren't merged live — the second save is told to reload or keep theirs. Live co-editing, handwriting/voice notes and offline editing aren't built. Mentions (@name) are formatting only, they don't notify. The daily note's meetings are read when the note is made, not kept in sync. Reminders are checked every minute by the server (`NOTES_SCHEDULER=off` turns that off). |

## Production readiness pass for AWS (2026-10-29)

Verified on a clean copy of the working tree (`npm ci`, then the same steps CI runs): `typecheck`, `lint` and `next build` pass; `node scripts/migrate.mjs --test` applies all 97 migrations; the vitest suite passes (the start-up test was updated for the stricter key check). The checks cannot be trusted from the iCloud-synced folder — evicted `node_modules` files load as empty modules — so they run in CI (`.github/workflows/ci.yml`) or from a copy outside iCloud.

Fixed:
- `deploy/Dockerfile` no longer hides a failed build (`|| true`), prunes dev dependencies, drops `.next/cache`, ships Amazon's RDS CA bundle at `/app/certs/rds-global-bundle.pem`, and health-checks `/api/v1/health/live`.
- `scripts/migrate.mjs` (plain JavaScript) runs inside the production image; compose, Kubernetes and the ECS migrate task use it. `npm run db:migrate:prod`.
- Database pool: `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS`, `DATABASE_SSL_CA` (verified TLS) or `DATABASE_SSL=no-verify`.
- `recoverInterruptedTasks(staleMs)` runs on the worker only (start + every 5 min, `AI_TASK_STALE_MIN`, default 20) — a web server starting no longer fails AI tasks other servers are running.
- SIGTERM stops the job worker (`stopWorker`) so a deploy never cuts a job in half.
- `GET /api/v1/health/live` — liveness without the database; `/api/v1/health` stays the readiness check.
- Boot checks: `APP_ENCRYPTION_KEY` must decode to exactly 32 bytes (what the cipher needs); warnings when there is no TLS to the database, no `TRUST_PROXY` (behind AWS ALB set `xff-last`), no email provider in the environment, or a worker without `WORKER_SINGLETON_ACK=1`.
- `.dockerignore` excludes video/, media/, biz/, docs/, tests/, screenshots; `.nvmrc` and `engines` pin Node 22.
- `deploy/aws/`: ECS Fargate task definitions (web, worker, migrate) with Secrets Manager and CloudWatch, a Caddy edge for customer domains; `.github/workflows/ci.yml` and `deploy-aws.yml` (build → ECR → migrate → roll web, then worker).

Honest limits that remain (also in the go-live guide):
- Exactly one worker: education fee reminders, chat reminders, mail follow-ups, helpdesk auto-close and the growth tick select-then-update without an atomic claim.
- AI tasks run on the web server that started them; cancel works only there.
- The firewall's per-IP rate limit, strikes and bans are per server (API rate limits are shared through Postgres); use AWS WAF for fleet-wide limits.
- Uploads and attachments are `bytea` in Postgres; an S3 adapter is the next storage step.
- QuickJS runs in the web process (a run can block the event loop up to 3 s); Python/Node exec needs a Docker daemon, which Fargate does not have.
- No error tracking, tracing or request ids; CSP still allows `unsafe-inline`/`unsafe-eval` for Monaco from jsDelivr; HSTS without `preload`.
- The repository holds a single template commit; the product must be committed and pushed before CI/CD can run.

Documents — drive & editor (`/documents`, `src/components/documents/drive|editor`, `src/server/documents/{drive,live,comments,exporting,convert,ai}.ts`, migrations 0101–0103): My documents (private until shared), Shared with me, Starred, Recent, Team folders (their own access rules, plus private folders) and a 30-day Trash; grid/list, sort, filters, search inside documents, multi-select, drag to move, drop files or whole folders to upload, right-click menus, details panel, previews. Shares per file or folder (view / comment / edit) with notifications, and a read-only public link (`/read/:token`, signed with APP_ENCRYPTION_KEY, can be turned off). The editor (Tiptap): live co-editing with cursors (Yjs through Postgres, same bus as code co-editing), autosave, versions every 10 minutes or by name, restore; File/Edit/View/Insert/Format/Tools menus, styles, fonts, sizes, colours, highlight, alignment, line spacing, lists, checklists, indents, tables, images (own asset store), callouts, toggles, page breaks, live table of contents, @people and #record mentions, "/" block menu, find & replace, word count, page setup (paper, orientation, margins, header/footer, page numbers, pageless), fill-in {{fields}} for templates, comments anchored by Yjs relative positions (commenters never change the text), the writing assistant (rewrite, translate, draft, continue, summarise, ask). Download as PDF, Word, Markdown, HTML or text; import Word, Markdown, HTML or text as editable documents; make a PDF copy and send it for signature. Joined up with: record pages (Documents panel with Write on deals, companies, contacts, employees, projects, sales orders, assets), Mail (attach from Documents, save an attachment to Documents, email a document as PDF), Chat (share a document), Notes (turn a note into a document), global search and the command palette (New document / proposal / NDA / meeting notes), Copilot's record search, and Home's desk (recent and newly shared documents). Phones: the same drive and editor, toolbar scrolls, panels open as sheets.

Documents — viewer, PDF tools, conversions, QR (`src/components/documents/viewer/*`, `src/server/documents/tools.ts`, `src/lib/documents/formats.ts`, PDF.js 6.4.299 with its worker, cmaps, fonts, wasm and ICC profiles in `public/pdfjs`): uploaded files open in a full-screen viewer — PDFs drawn by PDF.js (the app forbids framing, so the browser's PDF frame stayed blank) with selectable text, thumbnails, page jump, zoom/fit, rotate and find; images with zoom and rotate; Word and Markdown laid out as pages; spreadsheets as tables with every sheet; slides' text; text/JSON/code with line numbers; ZIP contents; ←/→ through the folder. PDF tools: a page grid to select, rotate, delete and drag into a new order (one new version, the old one kept, or a copy), extract, split every N pages, merge with other PDFs, watermark, page numbers, pages to PNG/JPG, images to PDF. Convert: Word/Markdown/text → editable document, PDF, Word, Markdown, HTML; spreadsheets → Excel, CSV, JSON, PDF, editable table; slides → document, PDF, text; images → PDF or PNG/JPG/WebP; PDFs → editable text document or images; written documents → PDF/Word/Markdown/HTML/text — each saved next to the original or downloaded. QR code for any document or file: for the team (signs in, access rules apply) or for anyone (turns on the read-only link; public links now work for uploaded files too, with the PDF viewer), as PNG, SVG or a printable card. Also on the file page (inline preview + the same actions) and the editor's File menu.

## Requisitions — chase clients for documents by email (2026-11-09, migration 0110)

Module id `requisitions` (Customers group; in Growth and up, ₹299/month as an add-on). Routes: `/requisitions` (list, `lists/new`, `lists/:id`, `templates`, `reports`, `settings`); API `/api/v1/orgs/:id/requisitions/…`; the client's page `/collect/:token` with API `/api/v1/collect/:token` (no sign-in, rate limited). Permissions: `rq:read` (team), `rq:write` (owner, admin, billing, developer, designer, editor), `rq:manage` (owner, admin). Tables `rq_settings`, `rq_lists`, `rq_items`, `rq_messages`, `rq_files`, `rq_events`, `rq_templates`.

| Item | Status |
|---|---|
| Requisition: client (CRM contact or typed), copies, due date, title, message, items (required/optional), owner | Done |
| Request + reminders from a connected mailbox, one conversation (In-Reply-To), or from the platform address | Done |
| Schedule: every N days at a time (IST), weekdays only, stop after N, quiet after a reply, firmer wording (friendly → still waiting → final) | Done |
| Reminder sweep every 5 min (instrumentation + cron), claimed per row so it never double-sends; stops at the limit and tells the owner | Done |
| Replies read as Mail syncs: matched by the message they answer, the thread, `[REQ-n]` in the subject, or the client's address; attachments filed | Done |
| Items ticked off by AI (sure → received, unsure → "check this", promised date holds reminders) or by file name without AI; one file goes to one item | Done |
| Client link: checklist, upload per item with progress, "something else", note; views tracked; rotate link | Done |
| Send a wrong file back with a note (in the next reminder and on the link); not needed; add items later | Done |
| Completes when everything required is in; thank-you email; notifications (replied, uploaded, completed, stalled) | Done |
| Tracking: timeline, emails both ways, files, progress, overdue; report (time to complete, reminders needed, engagement, how items arrive) | Done |
| Templates (5 starters: KYC, ITR, GST monthly, joining, loan) and saved ones; import (rows → one requisition per client+title) and export | Done |
| Wiring: CRM contact card, do-not-contact respected, Email/Share buttons, ⌘K, onboarding setup + screenshot, operator usage, plan storage counts client files | Done |
| **Tests** | `tests/unit/requisitions-model.test.ts` (13), `tests/integration/requisitions.test.ts` (15) |
| **Limits** | Replies are read only from a mailbox connected in Mail (IMAP sync, every ~2 min); with the platform address, clients use their link. AI reading needs an AI provider and uses the plan's AI allowance. Files up to 25 MB, stored in the database (not yet copied into Documents). No WhatsApp/SMS reminders. |
