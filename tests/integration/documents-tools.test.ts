import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/documents/[[...slug]]/route";
import { toDocx } from "@/server/documents/convert";
import { pageOf, h, p } from "@/lib/documents/write";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Previews of uploaded files, PDF tools (merge, extract, split, rotate,
// delete, reorder, watermark, page numbers, images to PDF) and conversions,
// each saved beside the original or as a new version — within the drive's rules.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
type H = Parameters<typeof call>[0];
const D = (method: string, path: string, body?: unknown, who = "owner") => call((api as unknown as Record<string, H>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/documents/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const upload = async (name: string, bytes: Buffer | Uint8Array, meta: unknown = { root: "team" }, who = "owner") => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  form.set("meta", JSON.stringify(meta));
  const req = new Request(`${ORIGIN}/api/v1/orgs/${orgId}/documents/files`, { method: "POST", headers: { cookie: C[who], origin: ORIGIN }, body: form });
  const res = await api.POST(req, { params: Promise.resolve({ orgId, slug: ["files"] }) });
  return (await res.json()).file.id as string;
};
async function pdfOf(pages: number, label = "Page") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) pdf.addPage([300, 400]).drawText(`${label} ${i}`, { x: 40, y: 200, size: 18, font });
  return Buffer.from(await pdf.save());
}
async function latest(fileId: string) {
  const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, fileId));
  const [v] = await db.select().from(schema.docVersions).where(and(eq(schema.docVersions.fileId, fileId), eq(schema.docVersions.version, f!.version)));
  return { f: f!, v: v!, pdf: v!.mime === "application/pdf" ? await PDFDocument.load(v!.data) : null };
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwnwECmBgYGBgAJZMDATmIZFYAAAAASUVORK5CYII=", "base64");

beforeAll(async () => {
  await resetDb();
  for (const [k, name, role] of [["owner", "Tara Tools", null], ["viewer", "Vin Viewer", "viewer"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email: `${k}.tools@example.com`, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
    if (k === "owner") orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
    else await db.insert(schema.memberships).values({ orgId, userId: U[k]!, role: role! });
  }
});
afterAll(closeDb);

describe("previews", () => {
  it("previews PDFs, Word, spreadsheets, slides, text and images", async () => {
    const pdf = await upload("Report.pdf", await pdfOf(3));
    expect((await D("GET", `files/${pdf}/preview`)).json.preview).toEqual({ type: "pdf", pages: 3 });
    const docx = await upload("Letter.docx", await toDocx({ type: "doc", content: [h(1, "Dear client"), p("Thanks for your order.")] }, { title: "Letter", page: pageOf({}) }));
    const w = (await D("GET", `files/${docx}/preview`)).json.preview;
    expect(w.type).toBe("html");
    expect(w.html).toContain("Dear client");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Qty"], ["Tea", 3], ["Coffee", 5]]), "Stock");
    const xlsx = await upload("Stock.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    expect((await D("GET", `files/${xlsx}/preview`)).json.preview.sheets[0]).toMatchObject({ name: "Stock", total: 3, rows: [["Item", "Qty"], ["Tea", "3"], ["Coffee", "5"]] });
    const md = await upload("Plan.md", Buffer.from("# Plan\n\n- one\n- two"));
    expect((await D("GET", `files/${md}/preview`)).json.preview.html).toContain("<h1");
    const txt = await upload("notes.txt", Buffer.from("hello\nworld"));
    expect((await D("GET", `files/${txt}/preview`)).json.preview).toMatchObject({ type: "text", text: "hello\nworld" });
    const png = await upload("dot.png", PNG);
    expect((await D("GET", `files/${png}/preview`)).json.preview.type).toBe("image");
    Object.assign(U, { pdf, docx, xlsx, md, png });
  });
});

describe("PDF tools", () => {
  it("merges PDFs into a new file beside the first", async () => {
    const b = await upload("Annex.pdf", await pdfOf(2, "Annex"));
    const r = await D("POST", "pdf", { op: "merge", fileIds: [U.pdf, b] });
    expect(r.status).toBe(200);
    expect((await latest(r.json.fileId)).pdf!.getPageCount()).toBe(5);
    expect((await latest(r.json.fileId)).f.title).toBe("Report (merged)");
  });

  it("extracts pages and splits a PDF", async () => {
    const r = await D("POST", "pdf", { op: "extract", fileId: U.pdf, pages: [3, 1] });
    expect((await latest(r.json.fileId)).pdf!.getPageCount()).toBe(2);
    expect((await D("POST", "pdf", { op: "extract", fileId: U.pdf, pages: [9] })).status).toBe(422);
    const sp = await D("POST", "pdf", { op: "split", fileId: U.pdf, every: 1 });
    expect(sp.json.fileIds).toHaveLength(3);
  });

  it("rotates, deletes and reorders as new versions, keeping the old ones", async () => {
    await D("POST", "pdf", { op: "rotate", fileId: U.pdf, pages: [2], angle: 90 });
    let l = await latest(U.pdf!);
    expect(l.f.version).toBe(2);
    expect(l.pdf!.getPage(1).getRotation().angle).toBe(90);
    await D("POST", "pdf", { op: "delete", fileId: U.pdf, pages: [1] });
    l = await latest(U.pdf!);
    expect(l.pdf!.getPageCount()).toBe(2);
    expect(l.v.note).toContain("Deleted page 1");
    await D("POST", "pdf", { op: "reorder", fileId: U.pdf, order: [2, 1] });
    expect((await latest(U.pdf!)).f.version).toBe(4);
    expect((await D("POST", "pdf", { op: "delete", fileId: U.pdf, pages: [1, 2] })).status).toBe(422);
    expect((await D("POST", "pdf", { op: "reorder", fileId: U.pdf, order: [1, 1] })).status).toBe(422);
  });

  it("adds a watermark and page numbers", async () => {
    const w = await D("POST", "pdf", { op: "watermark", fileId: U.pdf, text: "CONFIDENTIAL" });
    expect(w.json.created).toBe(true);
    expect((await latest(w.json.fileId)).v.size).toBeGreaterThan((await latest(U.pdf!)).v.size);
    const n = await D("POST", "pdf", { op: "number", fileId: U.pdf });
    expect(n.json.version).toBe(5);
  });

  it("turns images into a PDF", async () => {
    const r = await D("POST", "pdf", { op: "images", fileIds: [U.png, U.png], paper: "A4" });
    expect((await latest(r.json.fileId)).pdf!.getPageCount()).toBe(2);
    expect((await D("POST", "pdf", { op: "images", fileIds: [U.pdf] })).status).toBe(422);
  });

  it("lets a viewer make copies but not change the original", async () => {
    expect((await D("POST", "pdf", { op: "rotate", fileId: U.pdf, angle: 90 }, "viewer")).status).toBe(403);
    // Copies land in their own My documents, since they can't add to Team.
    const c = await D("POST", "pdf", { op: "rotate", fileId: U.pdf, angle: 90, saveAs: "copy" }, "viewer");
    expect(c.status).toBe(200);
    expect((await latest(c.json.fileId)).f).toMatchObject({ access: "private", createdBy: U.viewer });
  });
});

describe("conversions", () => {
  it("turns Word into a PDF and an editable document", async () => {
    const pdf = await D("POST", `files/${U.docx}/convert`, { to: "pdf" });
    expect((await latest(pdf.json.fileId)).v.mime).toBe("application/pdf");
    const doc = await D("POST", `files/${U.docx}/convert`, { to: "doc" });
    expect(doc.json.kind).toBe("doc");
    const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, doc.json.fileId));
    expect(f!.bodyText).toContain("Thanks for your order");
  });

  it("turns spreadsheets into CSV, JSON and a PDF table", async () => {
    const csv = await D("POST", `files/${U.xlsx}/convert`, { to: "csv" });
    expect((await latest(csv.json.fileId)).v.data.toString()).toContain("Tea,3");
    const json = await D("POST", `files/${U.xlsx}/convert`, { to: "json" });
    expect(JSON.parse((await latest(json.json.fileId)).v.data.toString())[0]).toEqual({ Item: "Tea", Qty: 3 });
    expect((await D("POST", `files/${U.xlsx}/convert`, { to: "pdf" })).status).toBe(200);
  });

  it("downloads a conversion without saving it, and refuses what can't convert", async () => {
    const req = new Request(`${ORIGIN}/api/v1/orgs/${orgId}/documents/files/${U.md}/convert`, { method: "POST", headers: { cookie: C.owner, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ to: "docx", mode: "download" }) });
    const res = await api.POST(req, { params: Promise.resolve({ orgId, slug: ["files", U.md!, "convert"] }) });
    expect(res.headers.get("content-disposition")).toContain("Plan.docx");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
    expect((await D("POST", `files/${U.png}/convert`, { to: "docx" })).status).toBe(422);
  });

  it("converts a written document and saves it to the drive", async () => {
    const d = await D("POST", "docs", { templateId: "nda", root: "mine" });
    const r = await D("POST", `files/${d.json.file.id}/convert`, { to: "docx" });
    expect((await latest(r.json.fileId)).v.filename).toMatch(/\.docx$/);
  });
});
