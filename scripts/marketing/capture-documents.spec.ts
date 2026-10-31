// Real screenshots of Documents for the homepage and its feature page: an
// interior-design studio's drive made through the app's own API (coloured
// folders, written documents from templates with their fields filled in, a
// survey PDF, photos and a budget sheet), a second person editing live, a
// comment, then each screen captured into public/marketing/documents/ and
// public/marketing/phones/.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-documents
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import { db, schema } from "../../src/db";
import { DOC_TEMPLATES, fillFields, type PMNode } from "../../src/lib/documents/write";
import { asVisitor, clean, ip, phoneShots, shoot } from "./shoot";

const PW = "correct-horse-42";
const T = Date.now().toString(36);
const O = { origin: "http://localhost:3000" };

async function signup(req: APIRequestContext, name: string, email: string, orgName?: string) {
  const r = await req.post("/api/v1/auth/signup", { data: { name, email, password: PW, ...(orgName ? { orgName } : {}) }, headers: { ...O, "x-forwarded-for": ip() } });
  expect(r.status(), await r.text()).toBe(201);
  await req.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: O });
  const me = await (await req.get("/api/v1/auth/me")).json();
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, me.user.id));
  return { userId: me.user.id as string, orgId: me.organizations[0].id as string };
}

/** Fills a template's empty list items and table cells, in order, with real content. */
function fillBlanks(doc: PMNode, texts: string[]): PMNode {
  const q = [...texts];
  const walk = (n: PMNode, inBlank: boolean): PMNode => {
    const blank = (n.type === "listItem" || n.type === "tableCell") && !(n.content ?? []).some((c) => (c.content ?? []).length);
    if (blank && q.length) return { ...n, content: [{ type: "paragraph", content: [{ type: "text", text: q.shift()! }] }] };
    return n.content ? { ...n, content: n.content.map((c) => walk(c, inBlank)) } : n;
  };
  return walk(doc, false);
}

async function open(page: Page, path: string, settle = 2200) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await clean(page);
  await page.waitForTimeout(settle);
}

/** A four-page site survey, laid out like a real one. */
async function surveyPdf() {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.13, 0.14, 0.2);
  const pages: [string, string[]][] = [
    ["Site survey — Rao residence", ["Bandra West, Mumbai · 3 BHK · 1,450 sq ft", "Surveyed 4 November by Asha Rao and Bilal Khan", "Scope: living room, kitchen and two bedrooms"]],
    ["Living room", ["North-facing, 18 ft × 14 ft, ceiling 10 ft", "Existing false ceiling to be removed", "Add cove lighting and a feature wall"]],
    ["Kitchen", ["L-shaped, 11 ft × 9 ft, granite counters", "Move the sink under the window", "Tall unit for the refrigerator and oven"]],
    ["Budget and timeline", ["Design and drawings: ₹1,20,000", "Kitchen and storage: ₹2,40,000", "Lighting: ₹1,20,000 · 10 weeks from approval"]],
  ];
  pages.forEach(([title, lines], i) => {
    const p = pdf.addPage([595, 842]);
    p.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: rgb(0.36, 0.3, 0.66) });
    p.drawText("ASHA STUDIO · INTERIORS", { x: 48, y: 806, size: 10, font: bold, color: rgb(0.86, 0.84, 0.98) });
    p.drawText(title.replace("₹", "Rs "), { x: 48, y: 770, size: 24, font: bold, color: rgb(1, 1, 1) });
    p.drawRectangle({ x: 48, y: 470, width: 499, height: 230, color: rgb(0.95, 0.94, 0.98) });
    p.drawText(i === 0 ? "Floor plan" : "Reference photos", { x: 64, y: 676, size: 11, font: bold, color: rgb(0.36, 0.3, 0.66) });
    for (let k = 0; k < 4; k++) p.drawRectangle({ x: 64 + k * 120, y: 490, width: 108, height: 170, color: rgb(0.84 - k * 0.04, 0.82, 0.92 - k * 0.03) });
    lines.forEach((l, j) => p.drawText(`•  ${l.replace(/₹/g, "Rs ")}`, { x: 48, y: 420 - j * 26, size: 13, font: reg, color: ink }));
    p.drawText(`${i + 1} / ${pages.length}`, { x: 520, y: 30, size: 9, font: reg, color: rgb(0.5, 0.5, 0.55) });
  });
  return Buffer.from(await pdf.save());
}

test("documents — drive, editor, live editing, comments, PDF viewer and tools, convert, QR", async ({ page, browser }) => {
  await asVisitor(page);
  const { orgId } = await signup(page.request, "Asha Rao", `asha.docs.${T}@ashastudio-demo.in`, "Asha Studio");
  const api = async <R,>(method: string, path: string, body?: unknown): Promise<R> => {
    const res = await page.request.fetch(`/api/v1/orgs/${orgId}/documents/${path}`, { method, data: body, headers: O });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as R;
  };
  const upload = async (name: string, bytes: Buffer, mime: string, meta: Record<string, unknown>) => {
    const r = await page.request.post(`/api/v1/orgs/${orgId}/documents/files`, { headers: O, multipart: { file: { name, mimeType: mime, buffer: bytes }, meta: JSON.stringify(meta) } });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).file.id as string;
  };
  const folder = async (name: string, color: string, root: "mine" | "team" = "team", folderId: string | null = null) => (await api<{ folder: { id: string } }>("POST", "folder", { name, color, root, folderId })).folder.id;
  const tpl = (id: string) => DOC_TEMPLATES.find((t) => t.id === id)!.build();
  const fields = { "Client name": "Rao Interiors", "Your company": "Asha Studio", Date: "12 November 2026", Total: "₹4,80,000", "Other party": "Rao Interiors", Purpose: "the redesign of their Bandra residence", Term: "two years", City: "Mumbai", Services: "interior design, drawings and site supervision", Fee: "₹4,80,000", "Payment days": "15", "Start date": "1 December 2026", Notice: "30 days'", Meeting: "Site visit — Rao residence", Attendees: "Asha, Bilal, Mr Rao" };

  // ── The drive ──
  const clients = await folder("Clients", "violet");
  const rao = await folder("Rao residence", "sky", "team", clients);
  await folder("Contracts", "green");
  await folder("Studio policies", "amber");
  await folder("Templates", "pink");
  await folder("Drafts", "slate", "mine");

  const proposal = (await api<{ file: { id: string } }>("POST", "docs", { title: "Proposal — Rao Interiors", icon: "💼", folderId: rao, content: fillBlanks(fillFields(tpl("proposal"), fields), ["Living room: false ceiling, cove lighting and a feature wall", "Kitchen: modular units, tall storage and a new sink layout", "Two bedrooms: wardrobes, study nook and lighting", "Measure, mood boards and 3D views", "Weeks 1–2", "Civil, electrical, carpentry and finishes", "Weeks 3–9", "Snag list, styling and handover", "Week 10", "Design, kitchen, storage and lighting", "1"] ) })).file.id;
  await api("POST", "docs", { title: "NDA — Rao Interiors", icon: "🔒", folderId: rao, content: fillFields(tpl("nda"), fields), page: { font: "Georgia" } });
  await api("POST", "docs", { title: "Site visit notes", icon: "🗓️", folderId: rao, content: fillBlanks(fillFields(tpl("meeting"), fields), ["Walk through every room with Mr Rao", "Agree the kitchen layout", "Keep the existing flooring", "Send the proposal by Friday", "Asha", "14 Nov", "Share 3D views of the living room", "Bilal", "18 Nov"]) });
  await api("POST", "docs", { title: "Service agreement", icon: "📜", folderId: rao, content: fillFields(tpl("service-agreement"), fields) });
  const survey = await upload("Site survey.pdf", await surveyPdf(), "application/pdf", { folderId: rao, title: "Site survey" });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Room", "Qty", "Rate (₹)", "Amount (₹)"], ["Modular kitchen", "Kitchen", 1, 240000, 240000], ["Cove lighting", "Living", 12, 6500, 78000], ["Feature wall panels", "Living", 1, 42000, 42000], ["Wardrobes", "Bedroom 1", 2, 60000, 120000], ["Design & drawings", "—", 1, 120000, 120000]]), "Budget");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Week", "Work"], [1, "Demolition"], [2, "Electrical"], [3, "False ceiling"], [5, "Kitchen install"], [8, "Painting"], [10, "Handover"]]), "Timeline");
  const budget = await upload("Budget.xlsx", Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { folderId: rao, title: "Budget" });
  // Two mood boards, drawn in a page and saved as images: swatches of the finishes.
  const art = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  for (const [name, colors] of [["Living room palette", ["#e9e1d6", "#c8b8a2", "#8a7765", "#3f4a3c", "#d9c7a7", "#f4efe8"]], ["Kitchen finishes", ["#f2f0ec", "#b9c4c9", "#5d6d73", "#2e3437", "#c9a27a", "#e6dccd"]]] as const) {
    await art.setContent(`<body style="margin:0;font-family:Georgia,serif;background:#faf8f5"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:40px">${colors.map((c, i) => `<div style="height:${i % 2 ? 360 : 400}px;border-radius:18px;background:linear-gradient(160deg,${c},color-mix(in srgb,${c} 70%,#000));box-shadow:0 20px 40px -20px rgba(0,0,0,.4)"></div>`).join("")}</div><p style="position:absolute;left:44px;bottom:28px;margin:0;font-size:34px;color:#3a3530">${name}</p></body>`);
    await upload(`${name}.png`, await art.screenshot({ type: "png" }), "image/png", { folderId: rao, title: name });
  }
  await art.close();
  await api("POST", "star", { id: proposal, kind: "file", on: true });

  // A colleague, editing the proposal at the same time.
  const bilalCtx = await browser.newContext({ baseURL: "http://localhost:3000", viewport: { width: 1280, height: 860 } });
  const bilal = await bilalCtx.newPage();
  await asVisitor(bilal);
  const b = await signup(bilal.request, "Bilal Khan", `bilal.docs.${T}@ashastudio-demo.in`);
  await db.insert(schema.memberships).values({ orgId, userId: b.userId, role: "editor" });
  await bilalCtx.addCookies([{ name: "cc_org", value: orgId, url: "http://localhost:3000" }]);
  void b;

  // ── Drive ──
  await open(page, `/documents/folder/${rao}`, 3500);
  await shoot(page, "documents", "drive", { settle: 1500 });

  // ── Editor, with Bilal live and a comment ──
  await bilal.goto(`/documents/d/${proposal}`);
  await bilal.locator(".doc-content[contenteditable=true]").waitFor({ timeout: 90_000 });
  await bilal.waitForTimeout(1500);

  await open(page, `/documents/d/${proposal}`, 3500);
  const ed = page.locator(".doc-content[contenteditable=true]");
  await ed.waitFor();
  // A comment on the total.
  await ed.getByText("What Rao Interiors needs").click({ clickCount: 3, position: { x: 8, y: 8 } });
  await page.getByRole("button", { name: "Comment", exact: true }).first().click();
  await page.getByPlaceholder(/Add a comment/).fill("Can we add a line on GST and the payment schedule? @Bilal Khan");
  await page.getByRole("button", { name: "Comment", exact: true }).last().click();
  await page.waitForTimeout(1200);
  await ed.getByText("Reply to accept").click({ position: { x: 4, y: 6 } });
  // Bilal adds to the scope while Asha watches.
  await bilal.locator(".doc-content").getByText("Two bedrooms").click();
  await bilal.keyboard.press("Meta+ArrowRight");
  await bilal.keyboard.type(" and a reading corner", { delay: 40 });
  await page.waitForTimeout(2500);
  await shoot(page, "documents", "live", { settle: 1500 });

  // The "/" menu.
  await ed.getByText("Reply to accept").click({ position: { x: 4, y: 6 } });
  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await shoot(page, "documents", "slash", { settle: 700 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");

  // Version history.
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Version history" }).click();
  await page.waitForTimeout(600);
  await page.getByLabel("Version name").fill("Sent to Mr Rao");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await shoot(page, "documents", "versions", { settle: 4800 });
  await bilalCtx.close();

  // ── PDF viewer and tools ──
  await open(page, `/documents/folder/${rao}`, 3000);
  await page.locator(".drive-tile", { hasText: "Site survey" }).first().dblclick();
  await page.waitForSelector(".pdf-page canvas", { timeout: 60_000 });
  await page.getByRole("button", { name: "Pages" }).click();
  await shoot(page, "documents", "pdf", { settle: 2500 });
  await page.getByRole("button", { name: "PDF tools" }).click();
  await page.waitForSelector('[aria-label^="PDF tools"] canvas', { timeout: 60_000 });
  const cards = page.locator('[aria-label^="PDF tools"] .grid > div.group');
  await cards.nth(1).click();
  await cards.nth(3).click({ modifiers: ["Meta"] });
  await page.getByRole("button", { name: /Rotate right/ }).click();
  await shoot(page, "documents", "pdftools", { settle: 1500 });

  // ── A spreadsheet, and converting it ──
  await open(page, `/documents/folder/${rao}`, 2500);
  await page.locator(".drive-tile", { hasText: "Budget" }).first().dblclick();
  await page.waitForSelector(".viewer-sheet", { timeout: 30_000 });
  await shoot(page, "documents", "sheet", { settle: 1200 });
  await page.getByRole("dialog", { name: /Viewing Budget/ }).getByRole("button", { name: "Convert" }).click();
  await page.getByRole("button", { name: /^PDF/ }).first().click();
  await shoot(page, "documents", "convert", { settle: 900 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // ── QR ──
  await open(page, `/documents/file/${survey}`, 3000);
  await page.getByRole("button", { name: "QR" }).click();
  await shoot(page, "documents", "qr", { settle: 1500 });
  void budget;

  await phoneShots(page, [
    [`/documents/d/${proposal}`, "documents-editor"],
    [`/documents/folder/${rao}`, "documents-drive"],
  ]);
});
