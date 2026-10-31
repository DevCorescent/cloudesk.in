// Real screenshots for the marketing site's feature pages: marketing,
// helpdesk, custom objects, compliance, copilot, clinic, construction and
// education. Each run signs up fresh demo businesses on the local dev server,
// fills them with believable data through the app's own APIs, and captures
// the screens into public/marketing/<feature>/.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-industry
import { config } from "dotenv";
import { Pool } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { ip, shoot, phoneShots, asVisitor } from "./shoot";

config({ path: ".env.local", quiet: true });
// Read-only look at the dev outbox, to follow the tracked links in campaign emails like a recipient would.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(() => pool.end());
async function linksFor(to: string, subjectLike: string) {
  const r = await pool.query<{ body: string }>("select body from outbound_emails where lower(\"to\") = lower($1) and subject ilike $2 order by created_at desc limit 1", [to, subjectLike]);
  return [...(r.rows[0]?.body ?? "").matchAll(/\/m\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]!);
}

const PW = "correct-horse-42";
const T = Date.now().toString(36);
const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const today = iso(0);

type Api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<T>;

/** Signs up a demo owner and returns a helper for the workspace's module APIs. */
async function business(page: Page, name: string, email: string, orgName: string): Promise<{ api: Api; orgId: string; userId: string }> {
  await asVisitor(page);
  const r = await page.request.post("/api/v1/auth/signup", { data: { name, email, password: PW, orgName }, headers: { origin: "http://localhost:3000", "x-forwarded-for": ip() } });
  expect(r.status(), await r.text()).toBe(201);
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const orgId = me.organizations[0].id as string;
  // Skip the welcome flow, keeping every module on.
  await page.request.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: { origin: "http://localhost:3000" } });
  const api: Api = async (method, path, body) => {
    const res = await page.request.fetch(`/api/v1/orgs/${orgId}/${path}`, { method, data: body === undefined ? undefined : body, headers: { origin: "http://localhost:3000" } });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as never;
  };
  return { api, orgId, userId: me.user.id as string };
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
  // Leave the welcome flow / tours if they appear.
  const skip = page.getByRole("button", { name: /Skip setup|Not now|Got it/ }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
}

test.describe.configure({ mode: "serial" });

test("Lumen Living — marketing, helpdesk, custom objects, compliance, copilot", async ({ page }) => {
  const { api, userId } = await business(page, "Ananya Kapoor", `ananya.${T}@lumenliving-demo.in`, "Lumen Living");

  // ── CRM contacts that marketing works with ──
  await api("GET", "crm/meta");
  const people: [string, string, boolean, string[]][] = [
    ["Riya Sharma", "riya.sharma@gmail.com", true, ["vip", "newsletter"]],
    ["Arjun Mehta", "arjun.mehta@outlook.com", true, ["vip"]],
    ["Kavya Iyer", "kavya.iyer@yahoo.in", true, ["newsletter"]],
    ["Rohan Desai", "rohan@desaiinteriors.in", true, ["wholesale", "vip"]],
    ["Sneha Reddy", "sneha.reddy@gmail.com", true, ["newsletter"]],
    ["Vikram Singh", "vikram@studiovs.in", false, ["wholesale"]],
    ["Meera Joshi", "meera.joshi@gmail.com", true, ["vip", "newsletter"]],
    ["Aditya Rao", "aditya.rao@hotmail.com", true, []],
    ["Pooja Nair", "pooja.nair@gmail.com", true, ["newsletter"]],
    ["Karan Malhotra", "karan@malhotrahomes.com", true, ["wholesale"]],
  ];
  const contacts: Record<string, string> = {};
  for (const [name, email, marketing, tags] of people) contacts[name] = (await api<{ contact: { id: string } }>("POST", "crm/contacts", { name, email, marketing, tags })).contact.id;

  // ── Marketing ──
  await api("GET", "marketing/meta").catch(() => {});
  const vip = (await api<{ segment: { id: string } }>("POST", "marketing/segments", { name: "VIP customers", rules: { tagsAny: ["vip"] } })).segment.id;
  const readers = (await api<{ segment: { id: string } }>("POST", "marketing/segments", { name: "Newsletter readers", rules: { tagsAny: ["newsletter"] } })).segment.id;
  await api("POST", "marketing/segments", { name: "Wholesale buyers", rules: { tagsAny: ["wholesale"] } });
  const diwali = (await api<{ campaign: { id: string } }>("POST", "marketing/campaigns", { name: "Diwali collection launch", kind: "email", segmentId: vip, subject: "Our Diwali collection is here ✨", subjectB: "{{first_name}}, first look at our Diwali lamps", body: "Hi {{first_name}},\n\nHand-thrown brass diyas, block-printed cushions and our new lamp range are live.\nSee the collection: https://lumenliving.in/diwali\n\nWarmly,\nAnanya — Lumen Living", budget: 2500000, spend: 1450000 })).campaign.id;
  await api("POST", `marketing/campaigns/${diwali}/send`, {});
  const news = (await api<{ campaign: { id: string } }>("POST", "marketing/campaigns", { name: "October newsletter", kind: "email", segmentId: readers, subject: "New in: block-printed table linen", body: "Hi {{first_name}},\nOur new table linen is hand block-printed in Bagru.\nShop it: https://lumenliving.in/linen\n\nAnanya", budget: 500000, spend: 120000 })).campaign.id;
  await api("POST", `marketing/campaigns/${news}/send`, {}).catch((e) => console.log(String(e).slice(0, 200)));
  await api("POST", "marketing/campaigns", { name: "Winter cushions sale", kind: "email", segmentId: vip, subject: "Winter is cosier with 20% off cushions", body: "Hi {{first_name}},\nOur winter edit is 20% off this week.\nhttps://lumenliving.in/winter", budget: 1500000 });
  await api("POST", "marketing/campaigns", { name: "Instagram reels — festive", kind: "ads", budget: 4000000, spend: 2860000 });
  await api("POST", "marketing/campaigns", { name: "Kala Ghoda pop-up stall", kind: "other", budget: 3500000, spend: 3150000 });
  // Wait for the sends to go out (the background worker sends them), then follow some links like recipients would.
  await expect.poll(async () => (await api<{ campaign: { status: string } }>("GET", `marketing/campaigns/${diwali}`)).campaign.status, { timeout: 60_000 }).toBe("sent");
  for (const who of ["riya.sharma@gmail.com", "rohan@desaiinteriors.in", "meera.joshi@gmail.com"]) {
    const [click] = await linksFor(who, "%Diwali%");
    if (click) await page.request.get(`/m/${click}`, { maxRedirects: 0 }).catch(() => {});
  }
  await expect.poll(async () => (await api<{ campaign: { status: string } }>("GET", `marketing/campaigns/${news}`)).campaign.status, { timeout: 60_000 }).toBe("sent").catch(() => {});
  for (const who of ["kavya.iyer@yahoo.in", "pooja.nair@gmail.com"]) {
    const [click] = await linksFor(who, "%linen%");
    if (click) await page.request.get(`/m/${click}`, { maxRedirects: 0 }).catch(() => {});
  }
  const ev = (await api<{ campaign: { id: string; regUrl: string } }>("POST", "marketing/campaigns", { name: "Home styling workshop", kind: "event", eventAt: `${iso(12)}T11:00:00+05:30`, onlineUrl: "https://meet.google.com/lmn-styl-ing", capacity: 40, budget: 800000, spend: 450000 })).campaign;
  const token = ev.regUrl.split("/e/")[1];
  for (const [n, e] of [["Riya Sharma", "riya.sharma@gmail.com"], ["Kavya Iyer", "kavya.iyer@yahoo.in"], ["Divya Menon", "divya.menon@gmail.com"], ["Sahil Gupta", "sahil.g@gmail.com"], ["Meera Joshi", "meera.joshi@gmail.com"], ["Rohan Desai", "rohan@desaiinteriors.in"]]) {
    await page.request.post(`/e/${token}`, { form: { name: n, email: e, consent: "yes" }, headers: { origin: "http://localhost:3000" } });
  }
  // A won deal the campaigns influenced (Rohan got the email, clicked it, and registered).
  const meta = await api<{ pipelines: { stages: { id: string; kind: string }[] }[] }>("GET", "crm/meta");
  const won = meta.pipelines[0]!.stages.find((s) => s.kind === "won")!.id;
  const deal = (await api<{ deal: { id: string } }>("POST", "crm/deals", { title: "Desai Interiors — festive bulk order", value: 48500000, contactId: contacts["Rohan Desai"] })).deal.id;
  await api("POST", `crm/deals/${deal}/move`, { stageId: won });
  const deal2 = (await api<{ deal: { id: string } }>("POST", "crm/deals", { title: "Meera Joshi — living room makeover", value: 18600000, contactId: contacts["Meera Joshi"] })).deal.id;
  await api("POST", `crm/deals/${deal2}/move`, { stageId: won });

  await open(page, "/marketing");
  await shoot(page, "marketing", "home");
  await open(page, "/marketing/campaigns");
  await shoot(page, "marketing", "campaigns");
  await open(page, `/marketing/campaigns/${diwali}`);
  await shoot(page, "marketing", "campaign");
  await open(page, `/marketing/campaigns/${ev.id}`);
  // Just the registrations card (the panel beside it shows the dev server's address).
  await shoot(page, "marketing", "event", { clip: { x: 500, y: 290, width: 545, height: 400 } });
  await open(page, "/marketing/segments");
  await shoot(page, "marketing", "segments");

  // ── Helpdesk ──
  await api("GET", "helpdesk/meta");
  await api("POST", "helpdesk/canned", { title: "Delivery update", body: "Hi {{name}}, your order is on its way — here's the tracking link. Ticket {{ticket}}." }).catch(() => {});
  await api("POST", "helpdesk/canned", { title: "Return approved", body: "Hi {{name}}, your return is approved. Our courier will pick it up within 48 hours." }).catch(() => {});
  await api("POST", "helpdesk/canned", { title: "Refund processed", body: "Hi {{name}}, your refund for {{ticket}} has been processed — it reaches your account in 5–7 working days." }).catch(() => {});
  await api("POST", "helpdesk/canned", { title: "Bulk enquiry", body: "Hi {{name}}, thanks for thinking of us for your project! {{agent}} from our trade desk will send a quote within a day." }).catch(() => {});
  await api("POST", "helpdesk/canned", { title: "GST invoice", body: "Hi {{name}}, here's the GST invoice with your company's GSTIN. Let us know if anything needs changing." }).catch(() => {});
  const tickets: [string, string, string, string, string, string][] = [
    ["Brass lamp arrived with a dent", "The base of the Aarna brass lamp is dented. Can I get a replacement?", "Riya Sharma", "riya.sharma@gmail.com", "high", "email"],
    ["Change delivery address for order #1042", "Please deliver to my office in Bandra instead.", "Arjun Mehta", "arjun.mehta@outlook.com", "normal", "phone"],
    ["Bulk pricing for 200 cushion covers", "We're furnishing a boutique hotel in Goa. What's your best price?", "Rohan Desai", "rohan@desaiinteriors.in", "normal", "web"],
    ["Refund not received yet", "I returned the jute rug 10 days ago and the refund hasn't arrived.", "Kavya Iyer", "kavya.iyer@yahoo.in", "urgent", "email"],
    ["Can the table runner be customised?", "Looking for a 3-metre runner in indigo.", "Sneha Reddy", "sneha.reddy@gmail.com", "low", "web"],
    ["Invoice needs our GSTIN", "Please re-issue the invoice with GSTIN 27AAACM1234F1Z5.", "Karan Malhotra", "karan@malhotrahomes.com", "normal", "email"],
    ["Order shows delivered but not received", "Tracking says delivered yesterday but nothing came.", "Pooja Nair", "pooja.nair@gmail.com", "high", "phone"],
  ];
  const tid: string[] = [];
  for (const [subject, body, customerName, customerEmail, priority, channel] of tickets) tid.push((await api<{ ticket: { id: string } }>("POST", "helpdesk/tickets", { subject, body, customerName, customerEmail, priority, channel })).ticket.id);
  await api("POST", `helpdesk/tickets/${tid[0]}/replies`, { body: "Checked with the warehouse — the dent happened in transit. Approving a replacement.", internal: true });
  await api("POST", `helpdesk/tickets/${tid[0]}/replies`, { body: "Hi Riya, so sorry about that! A replacement Aarna lamp ships today and our courier will collect the dented one." });
  await api("POST", `helpdesk/tickets/${tid[1]}/replies`, { body: "Done, Arjun — order #1042 will now go to your Bandra office." });
  await api("PATCH", `helpdesk/tickets/${tid[1]}`, { status: "resolved" });
  await api("POST", `helpdesk/tickets/${tid[5]}/replies`, { body: "Hi Karan, the corrected invoice with your GSTIN is attached." });
  await api("PATCH", `helpdesk/tickets/${tid[5]}`, { status: "resolved" });
  await api("POST", `helpdesk/tickets/${tid[2]}/replies`, { body: "Hi Rohan, for 200 covers we can do ₹640 each including GST. Sending a quote now." });
  for (const t of [tid[3], tid[4], tid[6]]) await api("PATCH", `helpdesk/tickets/${t}`, { assigneeId: userId }).catch(() => {});
  // Customers rate the resolved tickets on their own support links.
  for (const [t, score, comment] of [[tid[1], 5, "Super quick, thank you!"], [tid[5], 4, "Sorted the same day."]] as const) {
    const link = (await api<{ link: string }>("GET", `helpdesk/tickets/${t}`)).link;
    const tok = new URL(link).pathname.split("/support/")[1]!;
    await page.request.post(`/api/v1/support/${tok}/rate`, { data: { score, comment }, headers: { origin: "http://localhost:3000" } });
  }

  await open(page, "/helpdesk");
  await page.getByRole("tab", { name: /All open/ }).click().catch(() => {});
  await shoot(page, "helpdesk", "inbox");
  await open(page, `/helpdesk/tickets/${tid[0]}`);
  await shoot(page, "helpdesk", "ticket");
  await open(page, "/helpdesk/reports");
  await shoot(page, "helpdesk", "reports");
  await open(page, "/helpdesk/canned");
  await shoot(page, "helpdesk", "canned");

  // ── Custom fields, rules and objects ──
  await api("GET", "inventory/meta").catch(() => {});
  const items: Record<string, string> = {};
  for (const [name, sku, category] of [["Aarna brass table lamp", "LMP-AAR", "Lighting"], ["Indigo block-print cushion", "CSH-IND", "Textiles"], ["Hand-woven jute rug 5×8", "RUG-JUT", "Rugs"], ["Terracotta planter set", "PLN-TER", "Decor"], ["Sheesham coffee table", "TBL-SHE", "Furniture"]]) {
    items[sku] = (await api<{ item: { id: string } }>("POST", "inventory/items", { name, sku, category })).item.id;
  }
  const E = "entity=inventory.item";
  for (const f of [
    { key: "warranty_months", label: "Warranty (months)", type: "number" },
    { key: "artisan_cluster", label: "Artisan cluster", type: "select", options: ["Moradabad", "Jaipur", "Bhadohi", "Saharanpur"] },
    { key: "handmade", label: "Handmade", type: "checkbox" },
    { key: "care_guide", label: "Care guide", type: "url" },
  ]) await api("POST", `custom/fields?${E}`, f);
  await api("POST", `custom/rules?${E}`, { name: "Furniture carries a warranty", when: [{ field: "category", op: "eq", value: "Furniture" }], then: [{ field: "warranty_months", op: "gte", value: 12 }], message: "Furniture must carry at least 12 months' warranty" });
  await api("PUT", `custom/values?${E}&id=${items["LMP-AAR"]}`, { warranty_months: 12, artisan_cluster: "Moradabad", handmade: true, care_guide: "https://lumenliving.in/care/brass" });
  await api("PUT", `custom/values?${E}&id=${items["TBL-SHE"]}`, { warranty_months: 24, artisan_cluster: "Saharanpur", handmade: true });
  await api("PUT", `custom/values?${E}&id=${items["RUG-JUT"]}`, { warranty_months: 6, artisan_cluster: "Bhadohi", handmade: true });
  const obj = (await api<{ object: { id: string } }>("POST", "custom/objects", { name: "Showroom visit", plural: "Showroom visits", prefix: "VIS" })).object.id;
  const OE = `entity=obj:${obj}`;
  for (const f of [
    { key: "client", label: "Client", type: "text", required: true },
    { key: "visited_on", label: "Visited on", type: "date" },
    { key: "interested_in", label: "Interested in", type: "link", linkTo: "inventory.item" },
    { key: "budget", label: "Budget (₹)", type: "number" },
    { key: "stage", label: "Stage", type: "select", options: ["Browsing", "Quote sent", "Ordered"] },
  ]) await api("POST", `custom/fields?${OE}`, f);
  await api("PUT", `custom/objects/${obj}`, { name: "Showroom visit", plural: "Showroom visits", prefix: "VIS", titleField: "client" });
  await api("POST", `custom/rules?${OE}`, { name: "Orders need a visit date", when: [{ field: "stage", op: "eq", value: "Ordered" }], then: [{ field: "visited_on", op: "filled" }], message: "Add the visit date before marking it ordered" });
  for (const [client, d, sku, budget, stage] of [["Mehta residence, Juhu", -1, "TBL-SHE", 85000, "Ordered"], ["Café Saffron, Indiranagar", -2, "LMP-AAR", 120000, "Quote sent"], ["Desai Interiors", -4, "CSH-IND", 240000, "Ordered"], ["Nair family, Kochi", -5, "RUG-JUT", 32000, "Browsing"], ["The Banyan Hotel, Goa", -7, "LMP-AAR", 450000, "Quote sent"], ["Joshi apartment, Pune", -9, "PLN-TER", 18000, "Ordered"]] as const) {
    await api("POST", `custom/objects/${obj}/records`, { client, visited_on: iso(d), interested_in: items[sku], budget, stage });
  }
  const wc = (await api<{ object: { id: string } }>("POST", "custom/objects", { name: "Warranty claim", plural: "Warranty claims", prefix: "WC" })).object.id;
  for (const f of [{ key: "customer", label: "Customer", type: "text", required: true }, { key: "product", label: "Product", type: "link", linkTo: "inventory.item" }, { key: "issue", label: "Issue", type: "text" }, { key: "status", label: "Status", type: "select", options: ["Received", "Approved", "Replaced"] }]) await api("POST", `custom/fields?entity=obj:${wc}`, f);
  await api("PUT", `custom/objects/${wc}`, { name: "Warranty claim", plural: "Warranty claims", prefix: "WC", titleField: "customer" });
  for (const [customer, sku, issue, status] of [["Riya Sharma", "LMP-AAR", "Dent on the base", "Replaced"], ["Arjun Mehta", "TBL-SHE", "Drawer runner loose", "Approved"], ["Pooja Nair", "RUG-JUT", "Fraying at one edge", "Received"]]) await api("POST", `custom/objects/${wc}/records`, { customer, product: items[sku], issue, status });
  await open(page, `/objects/${obj}`);
  await shoot(page, "custom-objects", "records");
  await page.getByRole("tab", { name: /^Rules/ }).click().catch(() => {});
  await shoot(page, "custom-objects", "rules");
  await open(page, "/objects");
  await shoot(page, "custom-objects", "objects");
  await open(page, `/settings/customise?${E}`);
  await shoot(page, "custom-objects", "fields");
  await open(page, `/inventory/items/${items["LMP-AAR"]}`);
  await shoot(page, "custom-objects", "item", { clip: { x: 500, y: 60, width: 940, height: 388 } });

  // ── Compliance ──
  await api("GET", "grc/meta");
  await api("POST", "grc/obligations/pack", {});
  const ctl: string[] = [];
  for (const [code, name, frequency] of [["AP-01", "Two people approve supplier bank changes", "quarterly"], ["IT-02", "Laptops use full-disk encryption", "monthly"], ["FIN-03", "Monthly bank reconciliation reviewed", "monthly"], ["HR-04", "Exit checklist revokes all access", "quarterly"]]) {
    ctl.push((await api<{ control: { id: string } }>("POST", "grc/controls", { code, name, frequency, ownerId: userId })).control.id);
  }
  await api("POST", `grc/controls/${ctl[0]}/tests`, { testedOn: iso(-14), result: "effective", notes: "Sampled 12 supplier changes — all dual-approved" });
  await api("POST", `grc/controls/${ctl[1]}/tests`, { testedOn: iso(-6), result: "ineffective", notes: "2 of 9 laptops without FileVault" });
  await api("POST", `grc/controls/${ctl[2]}/tests`, { testedOn: iso(-3), result: "effective", notes: "September reconciliation signed off" });
  for (const r of [
    { title: "Payment to a fake supplier", category: "financial", likelihood: 3, impact: 5, residualLikelihood: 1, residualImpact: 5, controlIds: [ctl[0]], ownerId: userId },
    { title: "Customer data on an unencrypted laptop", category: "security", likelihood: 3, impact: 4, residualLikelihood: 2, residualImpact: 4, controlIds: [ctl[1]], ownerId: userId },
    { title: "Key artisan supplier can't deliver for Diwali", category: "supply_chain", likelihood: 4, impact: 4, ownerId: userId },
    { title: "GST return filed late", category: "compliance", likelihood: 2, impact: 3, residualLikelihood: 1, residualImpact: 3, controlIds: [ctl[2]], ownerId: userId },
    { title: "Warehouse fire in peak season", category: "operational", likelihood: 1, impact: 5, ownerId: userId },
    { title: "Former staff keep system access", category: "security", likelihood: 2, impact: 4, controlIds: [ctl[3]], ownerId: userId },
  ]) await api("POST", "grc/risks", r);
  const pol = (await api<{ policy: { id: string } }>("POST", "grc/policies", { title: "Acceptable use of company devices", body: "Use company laptops for work. Keep disk encryption on. Report a lost device within an hour." })).policy.id;
  await api("POST", `grc/policies/${pol}/publish`);
  const pol2 = (await api<{ policy: { id: string } }>("POST", "grc/policies", { title: "Customer data protection (DPDP)", body: "Collect only what we need, keep it only as long as needed, and honour deletion requests within 30 days." })).policy.id;
  await api("POST", `grc/policies/${pol2}/publish`);
  await api("POST", "grc/incidents", { title: "Laptop left in a cab", type: "security", severity: "high", occurredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), description: "Sales laptop left in an Uber; recovered next morning.", personalData: true });
  const aud = (await api<{ audit: { id: string } }>("POST", "grc/audits", { title: "Purchase cycle FY27 H1", periodFrom: "2026-04-01", periodTo: "2026-09-30", auditorId: userId })).audit.id;
  await api("POST", `grc/audits/${aud}/findings`, { title: "POs raised after the invoice", severity: "high", ownerId: userId, dueDate: iso(10) });
  await open(page, "/compliance");
  await shoot(page, "compliance", "home");
  await open(page, "/compliance/risks");
  await shoot(page, "compliance", "risks");
  await open(page, "/compliance/calendar");
  await shoot(page, "compliance", "calendar");
  await open(page, "/compliance/controls");
  await shoot(page, "compliance", "controls");

  // ── Copilot: rule-based checks on the books (no AI model is connected) ──
  const acc = await api<{ accounts: { id: string; code: string; name: string }[] }>("GET", "accounts/meta");
  const exp = (code: string) => acc.accounts.find((a) => a.code === code)?.id ?? acc.accounts.find((a) => a.code.startsWith("5"))!.id;
  for (const [supplierName, billNo, date, code, amount] of [
    ["Blue Dart Express", "BD-51200", iso(-96), "5260", 1180000],
    ["Blue Dart Express", "BD-52410", iso(-66), "5260", 1240000],
    ["Blue Dart Express", "BD-53770", iso(-36), "5260", 1310000],
    ["Shree Packaging", "SP-7012", iso(-70), "5260", 410000],
    ["Shree Packaging", "SP-7390", iso(-40), "5260", 395000],
    ["Moradabad Brass Works", "MBW/2026/311", iso(-20), "5010", 18450000],
    ["Moradabad Brass Works", "mbw 2026 311", iso(-18), "5010", 18450000],
    ["Bhadohi Weavers Co-op", "BWC-0921", iso(-12), "5010", 6420000],
    ["Shree Packaging", "SP-7781", iso(-9), "5260", 845000],
    ["Blue Dart Express", "BD-55120", iso(-6), "5260", 9650000],
    ["Studio Lightbox (photo shoot)", "SL-004", iso(-4), "5260", 9800000],
  ] as const) {
    await api("POST", "accounts/bills", { supplierName, billNo, date, lines: [{ accountId: exp(code), amount, gstRate: 18 }] }).catch((e) => console.log(String(e).slice(0, 200)));
  }
  await open(page, "/copilot/checks");
  await shoot(page, "copilot", "checks");
  await open(page, "/copilot");
  await shoot(page, "copilot", "ask");
  await phoneShots(page, [["/marketing", "marketing"], ["/helpdesk", "helpdesk"], ["/objects", "custom-objects"], ["/compliance", "compliance"]]);
});

test("Sunrise Dental Clinic — clinic", async ({ page }) => {
  const { api, userId } = await business(page, "Dr. Neha Kulkarni", `neha.${T}@sunrisedental-demo.in`, "Sunrise Dental Clinic");
  await api("GET", "clinic/meta");
  await api("PUT", "clinic/settings", { clinicians: [userId] }).catch(() => {});
  const pts: string[] = [];
  for (const [name, ageYears, gender, phone, allergies] of [["Ramesh Iyer", 54, "male", "9820012345", "Penicillin"], ["Priya Deshmukh", 31, "female", "9819934567", ""], ["Aarav Shah", 9, "male", "9833345678", ""], ["Sunita Patil", 62, "female", "9869912340", "Sulfa drugs"], ["Imran Qureshi", 45, "male", "9920011223", ""], ["Lakshmi Menon", 38, "female", "9004455667", "Latex"], ["Harsh Vardhan", 27, "male", "9819988776", ""], ["Fatima Sheikh", 50, "female", "9867766554", ""]] as const) {
    pts.push((await api<{ patient: { id: string } }>("POST", "clinic/patients", { name, ageYears, gender, phone, allergies: allergies || undefined, consent: true })).patient.id);
  }
  const appts: string[] = [];
  for (const [i, time] of [[0, "09:30"], [1, "10:00"], [2, "10:30"], [3, "11:00"], [4, "11:30"], [5, "12:00"], [6, "16:00"]] as const) {
    appts.push((await api<{ appointment: { id: string } }>("POST", "clinic/appointments", { patientId: pts[i], doctorId: userId, date: today, time, minutes: 20 })).appointment.id);
  }
  await api("POST", "clinic/appointments", { patientId: pts[7], doctorId: userId, date: iso(1), time: "10:00", minutes: 20 });
  // The morning so far: two seen, one in the chair, two waiting.
  for (const a of appts.slice(0, 5)) await api("POST", `clinic/appointments/${a}/status`, { status: "arrived" });
  for (const a of appts.slice(0, 3)) await api("POST", `clinic/appointments/${a}/status`, { status: "in_consultation" });
  const visits = [
    { patientId: pts[0], appointmentId: appts[0], vitals: { systolic: 148, diastolic: 92, pulse: 84, weightKg: 81, heightCm: 172 }, complaints: "Pain in lower left molar for a week", diagnosis: "Irreversible pulpitis, tooth 36", prescription: [{ drug: "Amoxicillin", strength: "500 mg", dose: "1-1-1", days: 5 }, { drug: "Ibuprofen", strength: "400 mg", dose: "1-0-1", days: 3 }], followUp: iso(7) },
    { patientId: pts[1], appointmentId: appts[1], vitals: { systolic: 118, diastolic: 76, pulse: 72, weightKg: 58, heightCm: 162 }, complaints: "Routine cleaning and check-up", diagnosis: "Mild gingivitis", prescription: [{ drug: "Chlorhexidine mouthwash", strength: "0.2%", dose: "rinse twice daily", days: 14 }], followUp: iso(180) },
  ];
  const vids: string[] = [];
  for (let i = 0; i < visits.length; i++) {
    const v = (await api<{ visit: { id: string } }>("POST", "clinic/visits", visits[i])).visit.id;
    vids.push(v);
    await api("POST", `clinic/visits/${v}/sign`);
    await api("POST", `clinic/appointments/${appts[i]}/status`, { status: "done" }).catch(() => {});
    const b = (await api<{ bill: { id: string } }>("POST", "clinic/bills", { patientId: visits[i].patientId, visitId: v, items: i === 0 ? [{ name: "Consultation", rate: 50000 }, { name: "IOPA X-ray", rate: 30000 }, { name: "Root canal — first sitting", rate: 350000 }] : [{ name: "Consultation", rate: 50000 }, { name: "Scaling & polishing", rate: 150000 }] })).bill.id;
    await api("POST", `clinic/bills/${b}/payments`, { amount: i === 0 ? 200000 : 200000, method: i === 0 ? "upi" : "card", paidOn: today });
  }
  await open(page, "/clinic");
  await shoot(page, "clinic", "queue");
  await open(page, "/clinic/patients");
  await shoot(page, "clinic", "patients");
  await open(page, `/clinic/patients/${pts[0]}`);
  await shoot(page, "clinic", "patient");
  await open(page, `/clinic/visits/${vids[0]}/print`);
  await shoot(page, "clinic", "prescription", { clip: { x: 650, y: 60, width: 620, height: 340 } });
  await phoneShots(page, [["/clinic", "clinic"]]);
});

test("Greenfield Builders — construction", async ({ page }) => {
  const { api } = await business(page, "Vikram Joshi", `vikram.${T}@greenfield-demo.in`, "Greenfield Builders");
  await api("GET", "construction/meta");
  const make = async (name: string, client: string, wo: string, rows: { code: string; description: string; unit: string; qty: number; rate: number }[]) => {
    const c = (await api<{ contract: { id: string } }>("POST", "construction/contracts", { name, client, workOrderNo: wo, retentionPct: 5, advancePct: 10, gstRate: 18, tdsPct: 2 })).contract.id;
    await api("POST", `construction/contracts/${c}/boq/import`, { rows, mode: "update" });
    const items = (await api<{ items: { id: string; code: string }[] }>("GET", `construction/contracts/${c}/boq`)).items;
    return { c, item: (code: string) => items.find((i) => i.code === code)!.id };
  };
  const school = await make("Zilla Parishad school — block B", "Pune Municipal Corporation", "PMC/WO/2026/114", [
    { code: "1.1", description: "Excavation in all soils, up to 1.5 m", unit: "cum", qty: 420, rate: 32000 },
    { code: "2.1", description: "PCC 1:4:8 below foundations", unit: "cum", qty: 95, rate: 520000 },
    { code: "3.2", description: "RCC M25 in columns and beams", unit: "cum", qty: 180, rate: 865000 },
    { code: "4.1", description: "Steel reinforcement Fe500D", unit: "MT", qty: 32, rate: 7250000 },
    { code: "5.3", description: "Brickwork in CM 1:6", unit: "cum", qty: 240, rate: 640000 },
    { code: "6.4", description: "Internal plaster 12 mm, CM 1:6", unit: "sqm", qty: 2600, rate: 31000 },
  ]);
  await make("Riverside housing — tower C", "Kumar Urbanspace", "KU/C/0921", [
    { code: "1.1", description: "Excavation with disposal", unit: "cum", qty: 1800, rate: 28000 },
    { code: "3.1", description: "RCC M30 raft foundation", unit: "cum", qty: 640, rate: 905000 },
    { code: "4.1", description: "Steel reinforcement Fe550D", unit: "MT", qty: 96, rate: 7400000 },
  ]);
  await make("Metro station canopy works", "MahaMetro", "MM/CW/77", [
    { code: "7.2", description: "Structural steel fabrication & erection", unit: "MT", qty: 48, rate: 11500000 },
    { code: "8.1", description: "Polycarbonate roofing sheets", unit: "sqm", qty: 1450, rate: 185000 },
  ]);
  const c = school.c;
  await api("POST", `construction/contracts/${c}/payments`, { kind: "advance", amount: 1800000000 / 100, date: iso(-40), reference: "MOB-ADV-114" });
  for (const [code, d, m] of [["1.1", -30, { location: "Grid A–D, full plinth", nos: 1, length: 40, breadth: 9, depth: 1 }], ["2.1", -26, { location: "Footings F1–F12", nos: 12, length: 2, breadth: 2, depth: 0.25 }], ["3.2", -18, { location: "Ground floor columns C1–C24", nos: 24, length: 0.5, breadth: 0.25, depth: 4 }], ["4.1", -18, { location: "GF columns", qty: 6.5 }], ["5.3", -8, { location: "GF external walls", nos: 1, qty: 58 }]] as const) {
    await api("POST", `construction/contracts/${c}/measurements`, { itemId: school.item(code), date: iso(d), ...m });
  }
  const b1 = (await api<{ bill: { id: string; gross?: number } }>("POST", `construction/contracts/${c}/bills`, { upTo: iso(-15) })).bill.id;
  await api("POST", `construction/bills/${b1}/status`, { to: "submitted" });
  const cert = (await api<{ bill: { id: string; certifiedGross: number } }>("POST", `construction/bills/${b1}/status`, { to: "certified", clientRef: "PMC/CERT/88" })).bill;
  void cert;
  await api("POST", `construction/contracts/${c}/measurements`, { itemId: school.item("6.4"), date: iso(-2), location: "GF classrooms 1–4", qty: 410 });
  const b2 = (await api<{ bill: { id: string } }>("POST", `construction/contracts/${c}/bills`, { upTo: today })).bill.id;
  await api("POST", `construction/bills/${b2}/status`, { to: "submitted" });
  for (const [d, weather, labour, work] of [[-2, "Clear", [{ trade: "Mason", count: 8 }, { trade: "Helper", count: 12 }, { trade: "Carpenter", count: 3 }], "Brickwork first floor, grid B–C. Shuttering for FF slab started."], [-1, "Light rain after 3 pm", [{ trade: "Mason", count: 6 }, { trade: "Helper", count: 10 }, { trade: "Bar bender", count: 4 }], "Reinforcement for FF slab, bays 1–3. Plastering GF classrooms 1–2."], [0, "Clear", [{ trade: "Mason", count: 9 }, { trade: "Helper", count: 14 }], "FF slab concreting, bays 1–2 (34 cum, M25). Cubes cast for testing."]] as const) {
    await api("POST", `construction/contracts/${c}/diary`, { date: iso(d), weather, labour, work });
  }
  await open(page, "/construction");
  await shoot(page, "construction", "home");
  await open(page, `/construction/contracts/${c}`);
  await shoot(page, "construction", "contract");
  for (const [tab, name] of [["Measurements", "measurements"], ["RA bills", "bills"], ["Site diary", "diary"]] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await shoot(page, "construction", name);
  }
  await phoneShots(page, [["/construction", "construction"]]);
});

test("Little Oaks Academy — education", async ({ page }) => {
  const { api, userId } = await business(page, "Shalini Rao", `shalini.${T}@littleoaks-demo.in`, "Little Oaks Academy");
  await api("GET", "education/meta");
  const cls: string[] = [];
  for (const [name, section] of [["Class 5", "A"], ["Class 5", "B"], ["Class 6", "A"]]) cls.push((await api<{ class: { id: string } }>("POST", "education/classes", { name, section, year: "2026-27", teacherId: userId })).class.id);
  const names = ["Aarav Sharma", "Ishita Patel", "Vihaan Reddy", "Ananya Iyer", "Kabir Singh", "Myra Nair", "Reyansh Gupta", "Saanvi Joshi", "Arjun Menon", "Diya Kapoor", "Advik Rao", "Kiara Desai"];
  const stu: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const [first, last] = names[i]!.split(" ");
    stu.push((await api<{ student: { id: string } }>("POST", "education/students", { name: names[i], classId: cls[i < 8 ? 0 : i < 10 ? 1 : 2], rollNo: (i % 8) + 1, guardianName: `${["Rajesh", "Sunil", "Meena", "Kiran", "Amit", "Lata"][i % 6]} ${last}`, guardianEmail: `${first!.toLowerCase()}.parent@gmail.com`, ...(i === 3 ? { concessionPct: 25, concessionNote: "Sibling" } : {}) })).student.id);
  }
  const plan = (await api<{ plan: { id: string } }>("POST", "education/plans", { name: "Annual fees 2026-27", year: "2026-27", classIds: cls, heads: [{ name: "Tuition", amount: 6000000 }, { name: "Transport", amount: 1200000, concession: false }, { name: "Activities", amount: 450000 }], installments: [{ label: "Term 1", dueDate: iso(-30), pct: 40 }, { label: "Term 2", dueDate: iso(20), pct: 30 }, { label: "Term 3", dueDate: iso(120), pct: 30 }] })).plan.id;
  await api("POST", `education/plans/${plan}/raise`);
  for (let i = 0; i < 9; i++) {
    const fees = (await api<{ fees: { id: string; amount: number; due?: number; balance?: number }[] }>("GET", `education/students/${stu[i]}`)).fees;
    const t1 = fees[0]!;
    const amt = Number(t1.balance ?? t1.due ?? t1.amount);
    if (amt > 0) await api("POST", `education/fees/${t1.id}/payments`, { amount: i === 5 ? Math.round(amt / 2) : amt, method: ["upi", "cash", "bank", "upi"][i % 4], paidOn: iso(-(i + 2)), reference: `UPI-${4100 + i}` }).catch((e) => console.log(String(e).slice(0, 160)));
  }
  await api("POST", `education/attendance/${cls[0]}`, { date: today, marks: stu.slice(0, 8).map((id, i) => ({ studentId: id, status: i === 2 ? "absent" : i === 6 ? "late" : "present" })) });
  const ex = (await api<{ exam: { id: string } }>("POST", "education/exams", { name: "Half-yearly 2026", classId: cls[0], date: iso(-10), subjects: [{ name: "Maths", max: 100 }, { name: "English", max: 100 }, { name: "Science", max: 100 }, { name: "Hindi", max: 80 }] })).exam.id;
  const scores = [[92, 85, 88, 70], [78, 91, 82, 74], [65, 70, 72, 60], [95, 89, 93, 76], [58, 64, 61, 55], [88, 94, 90, 78], [72, 68, 75, 66], [84, 80, 86, 72]];
  await api("POST", `education/exams/${ex}/marks`, { marks: stu.slice(0, 8).flatMap((id, i) => ["Maths", "English", "Science", "Hindi"].map((subject, j) => ({ studentId: id, subject, marks: scores[i]![j] }))) });
  await open(page, "/school/students");
  await shoot(page, "education", "students");
  await open(page, "/school/fees");
  await shoot(page, "education", "fees");
  await open(page, "/school/attendance");
  await shoot(page, "education", "attendance");
  await open(page, `/school/exams/${ex}`);
  await shoot(page, "education", "exam");
  await phoneShots(page, [["/school", "education"]]);
});
