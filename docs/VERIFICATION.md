# Verification report

Date: 2026-10-21 · Environment: macOS, Node 26.8.2, PostgreSQL 16 (local), Chromium (Playwright 1.64.1).

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | Pass, 0 errors |
| Lint | `npm run lint` | Pass, 0 errors and 0 warnings (four intentional full-page reloads are annotated inline) |
| Unit + integration | `npm test` | **335 / 335 passed** (51 files) |
| Production build | `npm run build` | Pass; all routes compile |
| End-to-end | `npm run test:e2e` | **12 / 12 passed** in a real browser against a production build (core journey including a real terminal command and an inline canvas edit that reaches the live site, branches, online store) |

## Finance books (2026-10-21, latest)

- Data model: invoicing tables point at `invoice_owners` (a project or a standalone book, never both — DB check), so deleting either cascades cleanly; existing project data was migrated in `0031`.
- `finance.test.ts`: books created per workspace with no project; editor allowed, viewer refused, other workspaces get 404; documents, numbering, client page, payments, reports and the books list all work in a book; logos served from /f/ with nosniff; books are isolated from each other and from project books; editors rename, only owners/admins delete, and deleting removes every document and kills shared links.
- `e2e/finance.spec.ts`: Finance from the sidebar → set up → invoice → dashboard total → rename; no project created.
- Browser review (light, dark, phone). Found and fixed: a redirect race after creating the first books, and book cards assuming rupees.

## Invoicing (2026-10-21)

- `invoicing.test.ts` (unit): GST split within/across states, VAT naming and no-tax mode, inclusive prices, line + shared document discounts with taxed charges and round-off, fractional quantities and zero-decimal currencies, amounts in words (Indian and international), status rules, month-end-safe recurrence, schema defaults and messages; every prebuilt template renders with escaped text, IGST, UPI and the right paper size; template switches are honoured; drafts are watermarked.
- `invoicing.test.ts` (integration): defaults from the store; access rules (viewer refused, editor can't void or remove payments); totals recomputed on the server; numbers only on issue, per financial year, with clashes refused and hand-typed numbers skipped; drafts never public; client view counting; part/full payments and overpayment refused; credit notes; voids; email recorded honestly when delivery isn't set up; share history; quote acceptance (name required, once only, not after expiry) and conversion; recurring invoices created once and auto-emailed; reminders once a day; reports and CSV exports (formula-safe); prebuilt and uploaded templates, file type checked by content; AI extraction mapping.
- `e2e/invoicing.spec.ts`: settings with GSTIN validation → choose a design → invoice with live GST → share link and WhatsApp text → client view with UPI and amount in words → part payment → quote accepted online → converted → reports.
- Browser review at desktop and phone width. Found and fixed: previews cut off at fixed zoom (now fit to width), the item name squeezed in the editor, the price field had no accessible name, the API-hosted preview would be blocked by X-Frame-Options (now rendered in the page), required fields shown red before typing, drafts counted in the list's balance, and the PAID/ACCEPTED stamp overlapping the details.

## Onboarding, domains and the tour (2026-10-21)

- `understand.test.ts`: eight real-world descriptions map to the right store type or website category; whole-word matching (“spring” isn't a ring, “classic” isn't a class, “online shop” isn't a counter); goals with the words that triggered them; plans for a shop-plus-counter brand and a clinic; the person's own choice wins over detection; domain clean-up.
- `launch.test.ts`: a domain given at launch is added with the exact TXT record (and CNAME/A when the server has a target); a domain already used elsewhere doesn't stop the launch and is reported plainly; a clinic website gets hidden booking services and a website checklist; the dashboard checklist follows real data (domain ticks only when verified).
- `onboarding.test.ts`: the new answers are stored and validated; tour completion is saved.
- `e2e/launch.spec.ts`: describe → understood chips → both online and shop → POS pre-selected → invalid domain blocked → plan shows POS and the domain → launch pre-filled (name, domain) → live → DNS records shown → dashboard tour walked to the end → checklist and domain status shown.
- Browser review (desktop, phone, dark). Found and fixed: DNS values overlapping in the record row (now shown in full), the tour dialog invisible to assistive tech (zero-size wrapper), a tour pop-up that would block every dashboard visit (now an invitation unless coming from launch), and the app's `Permissions-Policy: camera=()` which silently blocked the POS camera scanner (now `camera=(self)`).

## In-store selling (2026-10-21)

- `barcode.test.ts`: EAN-13 check digits for real codes, encoding round-tripped through an independent decoder, in-store codes, Code 128 structure, SVG bar count, the exact UPI link.
- `pos.test.ts`: an imported product with a long title and a 5-digit HSN saves after editing; real products show on the live home page and samples step aside; barcodes are assigned once, valid and unique; a duplicate barcode is refused; lookup by barcode, SKU and product QR; a cash sale's totals, GST, change, invoice number and stock; retries don't charge twice; short cash, oversell, and price overrides by a billing-only member are refused; % discount; the day's summary by method; receipt contents; refunds.
- `e2e/pos.spec.ts` (production build): create barcodes from Labels, open the till, scan with simulated scanner keystrokes (`2*code`, a lower-case SKU), short cash is blocked, change shown, receipt opens, scanning straight from "Sale complete" starts the next sale, oversell asks first, today's summary adds up.
- Browser review at desktop and phone width. Found and fixed: a fast scan right after a sale could be wiped by the dialog's delayed close; the first scanned character could be lost while focus moved; the barcode field in the editor was too narrow for 13 digits; times wrapped in the day summary.
- `labels.test.ts`: every stock fits its page; printer page sizes; roll rows; sheet order and start position (exact mm positions); preview page limits; escaping; MRP only when higher; warnings for small QR codes, long Code 128 barcodes, missing barcodes and unpublished sites.
- Label documents for thermal, 2-across and A4 stocks were printed to PDF through Chromium's print engine and inspected. Found and fixed: barcode digits overlapping the guard bars (now fitted between them, plain sans-serif digits), long names clipped on A4 labels (text now fits by dropping to one line, then shrinking type), and the side preview never measuring its box.
- Not verified: camera scanning on real phones (BarcodeDetector is in Chrome on Android and desktop Chrome; other browsers get a message), real thermal printers.

## Onboarding (2026-10-21)

- `onboarding.test.ts`: answers start empty, merge, and completion is recorded once; invalid values and signed-out requests are refused.
- e2e: sign-up lands on `/welcome`; the core journey visits the Coming soon screen and joins the notify list; the launch journey goes welcome → Online store → straight into the brand step.
- Browser review in light and dark at desktop and phone widths. Fixed: text fields shorter than the password field, a headline breaking on a single word, the notify button wrapping with long emails.

## Five-minute launch (2026-10-21)

- `smart-import.test.ts`: prices like ₹1,299.00, Rs. 499/-, 1.299,50 €, 1,00,000, ₹ 1.200; stock words; kg/lb weights; several image links per cell and Google Drive links; Shopify export with variants and image-only rows; an Indian seller sheet with a title row, M.R.P. and selling price; columns recognised by their values; fake discounts dropped; WooCommerce, semicolon and tab files; the right sheet picked from a workbook; real `.xlsx` (with hyperlink cells), `.xls` and `.ods` files.
- `launch-compose.test.ts`: every store template × three looks and every website category produces a valid site with no blocking problems and no placeholder copy; previews use the owner's products, line, colours and payment choices.
- `launch.test.ts`: one request creates the project, store, collections and products (incomplete ones as drafts), turns on COD and UPI, publishes, and streams each step; the live shop shows ready products and hides drafts; a website launch leaves out sample sections; invalid designs and outsiders are refused.
- `e2e/launch.spec.ts` (real browser, production build): sign up → launch → upload a CSV with its own headings → fix the highlighted missing price → pick a look → launch → the live shop shows both products, with pack sizes as variants at the right prices.
- Manual browser runs at desktop and phone width with a messy multi-sheet `.xlsx`: about 50 seconds from sign-up to live in automation. Found and fixed: dotted "M.R.P." headings not recognised, "₹999.00" in the banner, broken photo links becoming blank tiles, "₹ 1.200" read as 1.20, and the look picker pushing the preview off-screen on phones.

## Advanced builder (2026-10-21, later)

- `advanced-design.test.ts`: custom CSS is scoped to its section and loses `<`/`>`, escapes, @-rules, `javascript:` and non-https URLs; `url()` values can't break out; advanced values produce the expected CSS; out-of-range or malformed values are rejected by the schema; editable elements carry `data-f`; anchors, video layers and element styles render; every new section renders without scripts; video/embed links outside the allowlist are refused.
- `custom-forms.test.ts`: a published custom form accepts only its own fields, validates required/email/choice values, writes to the inbox and a data table, emails a team address, and never emails an outside address.
- Browser: inline edit + element colour in the builder; advanced design panel; new sections published and checked at desktop and phone widths (two layout bugs found and fixed: shape dividers clashing with the editor outline, stretched radio buttons).

## 2026-10-21 additions

| Area | Tests | What they prove | Mocked |
| --- | --- | --- | --- |
| Terminal | `sandbox.test.ts`, `terminal.test.ts`, e2e | Console output, top-level await, staged writes; no fetch/timers/require/process/WebAssembly/imports; infinite loops stop at the time limit, runaway memory and deep recursion stop; output capped; path traversal and writes without permission refused; failed runs discard writes; viewers can read but not run; script writes saved as revisions; invalid site.json writes rejected | Docker runner: a simulated CLI (isolation flags asserted, not exercised) |
| Data & API | `data-studio.test.ts` | Typed validation and coercion; filters (incl. multiselect, `in`, empty, dates), sort, search with literal wildcards, paging, link expansion; deleting a linked row clears links; type changes convert or are refused with counts, or clear on request; CSV all-or-nothing, skip-invalid, formula neutralised on export; API-key scopes; anonymous access only for public tables with CORS, insert-only returns just the id; console; live rows on the published site, escaped, without redeploying | — |
| Chatbot | `chatbot.test.ts` | Indexing of site/products/policies/notes; typo-tolerant search; search-mode answers with links; AI mode grounded in numbered passages and cost recorded; /chat page is script-free and per-visitor; hand-over and staff reply emails; launcher only when enabled | Claude (stand-in), Voyage not used |
| Co-editing | `codoc.test.ts`, two real browser sessions | Concurrent edits merge identically; late joiners get merged state; cursors relayed; save writes a revision and notifies others; outside writes reset the document; another project's document never streams; viewers can't type; malformed updates rejected | — |
| Free-form & global components | `globals-freeform.test.ts`, browser run | Align/distribute/move-together stay on the grid; groups/locks parsed but not rendered; global instances sync, detach, unlink; out-of-sync diagnostic | — |
| Live payment test | `payment-test.test.ts` | Live keys refused; Stripe webhook registration actually checked; localhost flagged; redirect and "provider says paid" never pass the test; forged webhook rejected; signed webhook passes; wrong amount fails; late webhooks don't change finished tests; refund through the API | Stripe API |

The earlier phases of this session (MFA/GitHub, jobs and automations, mail providers, platform API and SDK, billing, multi-currency, labels, subscriptions) are covered by `auth-security`, `automations`, `mail-providers` (real local SMTP server), `platform-api`, `billing`, `commerce-intl` and unit tests, with every external API mocked except SMTP.

**Not verified against real services**: Stripe, Razorpay, PayPal, EasyPost, Shippo, Mailchimp, Slack, Discord, Telegram, Resend, Postmark, SendGrid, GitHub OAuth, Voyage, Claude, and Docker. Run the in-app live payment test with your own test keys before taking real orders.

**Dependency audit**: nodemailer upgraded to 10.1.7 (fixes a high-severity advisory). `dompurify` inside `monaco-editor` has moderate advisories with no fixed Monaco release yet (0.57.0 still bundles 3.4.15); it affects the IDE editor only.

## Chat guests (2026-10-30)

- `chat-guests.test.ts` (integration, 17 cases): only conversation admins make invite links (never for a DM); anyone with the link sees what it's for, a wrong code gets a 404; joining needs only a name and sets an HttpOnly cookie scoped to that conversation's guest API; a waiting guest reads nothing; admins are notified and see the request, other members don't; once let in the guest sees only messages after joining (or all, when the link allows history), can't see members' emails, can't @everyone or post polls, reacts, replies in threads, edits/deletes only their own, votes, shares and downloads files; the same secret is refused for another conversation and by the members' API; guests get no notifications or emails even when mentioned; removal ends access and keeps their name on old messages; use limits, turned-off links and archived channels refuse joins; a declined guest sees the reason; a waiting guest can withdraw; invites emailed from Cloudesk go one per address and are logged; join requests are rate-limited per address.
- `chat-guests.test.ts` (unit): expiry and "why this link can't be used", share links for each app (WhatsApp to a number, email, SMS, Telegram…), the join form's rules, guest-address detection, device labels.
- Not checked in a browser in this pass: the guest page and the Invite dialog were typechecked and linted, not clicked through.

## What the tests prove

**Integration tests** (`tests/integration/platform.test.ts`) call the real route handlers against a real PostgreSQL database:

- Sign-up rejects duplicate emails case-insensitively and validates passwords. Sign-in returns identical errors for an unknown email and a wrong password. The cookie is `HttpOnly; SameSite=Lax`. A signed-out session is rejected.
- Cross-origin and Origin-less mutations are rejected (CSRF).
- Email verification tokens work once only. A password reset revokes existing sessions.
- A project from a template creates real files. Saves increment revisions, stale saves get `409 revision_conflict`, history is recorded, and restore creates a new revision. Invalid design documents and path traversal are rejected.
- **Tenant isolation**: another organization's user gets 404 for the project, file list, file content, deployments (read and create), AI tasks, submissions, the org's project list and provider settings. AI tasks cannot be read or applied across tenants.
- **Roles**: an invitation cannot be redeemed by a different account. A viewer can read but not write, deploy or use AI. A designer can edit the design but not code files. The last owner cannot be demoted.
- **AI lifecycle** (no provider configured): the built-in planner produces a spec, and another user cannot read someone's private brief. A design change is proposed, nothing is written until it is applied, and the applied revision is attributed to `ai` with the task id. A second apply is refused. **A stale proposal is refused after a newer edit, and the newer edit survives.** A model-only request fails with `provider_not_configured`, and retry creates attempt 2 linked to its parent. A queued task can be cancelled, and a second cancel is refused.
- **Deployments**: a production deploy with a broken internal link fails with a clear error, while a preview succeeds. A production deploy succeeds once the link is fixed. Production pages are public, script-free and served with a strict CSP. Previews are hidden from anonymous users and other tenants. Unknown paths return 404. Booking submissions store only allowlisted fields, and honeypot submissions are dropped. Rollback switches production.

**Commerce integration tests** (`tests/integration/commerce.test.ts`) drive the store admin API and the real storefront form handlers:

- Applying a template is refused until the owner confirms replacing the design; it then writes a storefront with product grids and a cart link, seeds sample products and turns on cash on delivery. Sample products cannot be checked out.
- People outside the organization get 404 from the store admin API.
- A cash-on-delivery order goes from cart to checkout, decrements stock, is packed, shipped with a tracking link and delivered (which records the cash as paid), is partly refunded (over-refunds are rejected), and prints a GST invoice. Order item counts, customer totals, collection counts and dashboard figures match.
- Two shoppers racing for the last unit: exactly one order succeeds and stock ends at zero.
- Discount codes enforce once-per-customer and the usage limit.
- Stripe (mocked HTTP): keys are verified before saving and never returned. A webhook with a bad signature is rejected and leaves the order unpaid; a valid one marks it paid once, and a replay is reported as a duplicate. The refund goes through the Stripe refunds API. Stock held by an unpaid online order is released when the hold expires.

A manual browser run (Playwright script, dev server) covered the setup wizard, publishing, browsing the live store, cart, two-step checkout, placing a COD order and the admin order view with no console errors. It found and fixed three bugs: correlated subqueries counting against the wrong table, store links failing the production link check, and an inventory query error.

**Store operations tests** (`tests/integration/store-ops.test.ts`):

- Email: with Resend configured, mail is sent with the store name as sender and the owner as reply-to, and the provider id is recorded; a provider error is recorded as failed without breaking checkout.
- Gift cards: a card pays for a whole order (marked paid at once) and part of another (COD collects the rest); balances never go negative; cancelling returns the card share; a refund goes to the cash first and the remainder back to the card; the ledger sums to the balance; disabled cards are refused.
- Low-stock alerts fire once when a sale crosses the alert level and again only after restocking.
- Returns: refused before shipping, over-quantity and wrong-key requests are rejected, duplicates are refused; approve → receive restocks the items and marks the order returned. "My orders" links are signed per store, expire after 24 hours, cannot be tampered with, and unknown emails get the same response without any mail.
- Bulk packing, CSV export and packing slips (with the COD amount to collect).
- Shiprocket (mocked HTTP): bad credentials are refused and never stored; a booking that fails at courier assignment resumes without creating a second shipment; tracking sync marks the order delivered and the COD order paid.
- Published sites serve robots.txt, a sitemap listing products and collections, and a Google product feed with prices and availability.

**Growth, brand, domains, bookings and WhatsApp tests:**

- Growth (`growth.test.ts`): suggestions come from the real site and store data (a sold-out featured product is flagged and fixed in one click); a test serves group A the original and group B the new button on the published site, views are counted per experiment, an add-to-cart is credited to the shopper's group while the store funnel still counts it once; a clear winner is applied to the design and owners are emailed; a losing test keeps the original; an unclear test ends after 28 days; tests may change only text and layout fields.
- Brand (`brand.test.ts`, `brand-rules.test.ts`): only owners and admins set rules; locked colours cannot be changed by anyone (including the owner) until unlocked; AI saves that add banned words are refused while people get warnings; drift can be restored; banned-word matching is whole-word, case-insensitive and works in Hindi.
- Domains (`domains.test.ts`): invalid, platform and IP hostnames are refused and a domain cannot belong to two sites; ownership needs the TXT record and the CNAME; the ask endpoint answers only for verified domains with a live site; the site is served at the root with root-relative links and a domain-based sitemap; the store accepts root-based forms only from the verified domain; payment returns go only to a verified domain of the same project.
- Bookings (`bookings.test.ts`, `slots.test.ts`): time zones and daylight saving are handled; slots respect hours, notice, horizon, buffers and capacity; concurrent requests for the last slot book it exactly once; customers cancel only with their link; a paid booking holds the slot, is confirmed from a signed Stripe webhook (mocked), and unpaid holds are released.
- WhatsApp (`whatsapp.test.ts`, mocked Graph API): numbers are normalised; credentials are verified and never returned; only shoppers who opted in receive messages, with the right template variables; delivery receipts must be signed and never move status backwards; cart reminders need both marketing consent and the WhatsApp opt-in.

**Phase 5 tests:**

- GST (`gst.test.ts`, `gst` unit): GSTINs are validated with the official check digit (a published sample passes, a one-character change fails); invalid store or buyer GSTINs and HSN codes are refused; invoice numbers run INV/<FY>/0001, 0002 in payment order; invoices show both GSTINs, place of supply with state code, HSN, IGST for inter-state and CGST/SGST for intra-state, and the amount in words; the monthly summary puts the B2B sale in B2B, reconciles to the invoiced totals and lists refunds as credit notes.
- Translation (`translate.test.ts` with the model replaced by a stand-in): only the target language's text is sent and changed, the source page is untouched, the result is applied after review; incomplete or marked-up answers are rejected.
- Business kit: recommendations fit the business; services are created hidden at price 0; files are created once and never overwritten; starter copy contains no invented numbers or reviews.
- Clone the feel (unit): rounding, pill/outline buttons, spacing, headline size and background are read from CSS and Tailwind classes; only detected properties change.
- Digital products and memberships (`digital.test.ts`): disguised HTML and executables are refused; files from another store cannot be attached; digital-only checkout has no delivery or cash on delivery; downloads need payment and the order key, return the exact bytes and stop after 10; membership purchases grant and then extend access; members-only pages show a sign-in gate (and are left out of the sitemap), sign-in links go only to active members, forged cookies and revoked memberships are refused.

**Templates and themes** (`templates.test.ts`): all 26 templates build valid sites in their intended industry and design direction; placeholder photos are on-topic for each industry (every photo ID was checked to load and reviewed by eye); names ending in a full stop never produce "Co.."; specific briefs route before general ones (a wedding photographer is Photography, an automation platform is not Automotive); a chosen look is honoured and unknown looks are ignored; every palette meets AA after harmonising; the glass look is CSS only.

**Phase 6 tests:**

- Motion (`motion.test.ts`): entrance, stagger, hover and parallax become CSS inside a reduced-motion guard; nothing is emitted in the editor; no JavaScript.
- Collaboration (`collab.test.ts`): editors see each other and stale presence expires; the meta endpoint reports newer revisions and who saved them without the content; viewers can comment but not resolve; @mentions email the right teammates; deleting a comment removes its replies; review links need a ready deployment and preview rights; a client without an account sees the preview (noindex), comments and approves, and the team is emailed; turned-off links return 404 for the page and the preview.
- Branches (`merge.test.ts`, `branches.test.ts`): separate edits merge key by key; same-field edits become a conflict and the chosen side is applied; additions keep their position; delete-vs-edit is flagged; the side that reordered wins; key order is ignored. Over the API: viewers cannot change branches; branch saves check revisions and never touch main; branch previews deploy the branch and cannot be promoted; merging needs every conflict decided and fresh revisions, writes a main revision "Merged branch …"; syncing from main leaves main untouched.
- Free-form (`freeform.test.ts`): elements are placed with CSS grid rules only (no inline styles or scripts), in reading order; out-of-range positions are clamped and text is escaped; unsafe links are dropped; phones stack (shapes hidden) or use the custom layout, with unplaced elements hidden; text is picked up by translation.
- Branch end-to-end (`journey.spec.ts`): create a branch in the builder, edit it, confirm main is unchanged, preview-deploy it, and merge it into main without conflicts.

**Store end-to-end test** (`e2e/store.spec.ts`): an owner creates a store from the gift template (the design is replaced only after ticking the confirmation), confirms one sample product as real, deletes the rest and publishes; a shopper buys with cash on delivery; the owner ships with a tracking number; the shopper sees the tracking number on their order page and requests a return, which the owner approves.

**End-to-end tests** (`e2e/journey.spec.ts`) cover the core user journey in Chromium:

1. A new user signs up, writes the restaurant brief, receives a plan explicitly labelled as rule-based, and creates the project.
2. Editing the hero heading updates the canvas, autosaves, and survives a reload. Undo restores the earlier value and saves it.
3. The assistant handles "Add a FAQ section": the diff shows the new section and accepting applies it to the canvas. "Make the whole site feel more premium" fails clearly because no model is connected.
4. The same project opens in the IDE with `site/site.json`. Search finds the edited text, and the terminal panel states that no sandbox exists.
5. Preview, then production deploy. The live URL serves the edited heading. A booking form submission appears in the project's submissions inbox.
6. A different account gets "Project unavailable" in the UI and 404 from the API.

## Design engine checks (`tests/unit/design.test.ts`)

- All 10 templates × 10 directions compose into valid documents, render without scripts, and have no non-content errors.
- Every section variant escapes injected markup.
- Every curated palette meets WCAG AA after harmonizing, and every design action keeps text contrast at AA or better.
- Web fonts load only from pinned jsDelivr URLs; example content blocks production; documents saved before design tokens existed still open.

Ten industry/direction combinations were rendered in Chromium and reviewed visually. This caught and fixed:
- Scroll reveals hiding content when printing.
- A weak hero scrim on bright photos.
- Off-topic gallery photos.
- A branded (Nike) stock photo.
- Unreadable price periods on dark bands.
- A broken `/about` link in the blank template.

## Manual visual review

Screenshots were taken of Home, Templates, the builder (desktop and 390 px mobile), the IDE (Monaco loaded), Deployments, and the project overview in dark mode. Problems found and fixed during review:

- The meta description reused the user's private brief → it is now generated from the business name and positioning.
- The consulting template said "Book a table" → booking copy is now industry-specific.
- The mobile builder toolbar overflowed and opened in the desktop viewport → the toolbar is compacted and the viewport now follows the device.
- Template previews were cropped → they now scale to the card width.
- A failed task showed its error message twice → shown once.
- The overview read `window` during render (hydration mismatch) → removed.

Phase 6 review (screenshots of the free-form editor, published free-form section at 1280 px and 390 px, branch bar, merge dialog with a real conflict, branches dialog) found and fixed:

- In a custom phone layout, elements without a phone position covered the whole canvas → they are now hidden on phones and listed under "Not shown on phones" with an add button.
- Keyboard nudging stopped working after a drag → the element is focused when picked up.
- The merge summary lower-cased the branch name, and conflict labels showed an internal "props" segment → fixed.
- The editor grid was too narrow to judge text wrapping → the dialog is wider.

E2E also caught a real issue: reloading within one second of an edit could lose it. There was already a `beforeunload` prompt; a best-effort `keepalive` save on `pagehide` was added as well.

## Not verified

- **Live Claude calls.** No Anthropic key was available in this environment. The gateway, JSON repair loop and key verification follow the SDK documentation and typecheck, but have **not been exercised against the real API**. Run one planning task and one design edit with a real key before relying on them.
- Load, performance and multi-instance behaviour.
- Screen-reader testing with assistive technology. Semantics, labels, focus states and keyboard paths were built in, but no WCAG audit was run.
- Browsers other than Chromium.
