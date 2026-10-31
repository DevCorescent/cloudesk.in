// Reading a supplier's bill with Claude: the PDF or photo goes to the model
// with the workspace's expense accounts, it answers in a fixed JSON shape, and
// that is checked and turned into a draft for the bill form. Nothing is saved:
// the person reviews the draft and saves it like any other bill.
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { EXTRACT_JSON_SCHEMA, extractedSchema, toDraft } from "@/lib/accounting/extract";
import { sniffFile } from "@/lib/documents/model";
import { anthropicFor, COPILOT_MODEL, providerError, recordUsage } from "../ai/gateway";
import { ApiError } from "../http/errors";
import { requirePart, requireWrite, type Scope } from "./access";

export const MAX_BILL_BYTES = 10 * 1024 * 1024;
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export async function extractBill(s: Scope, file: { name: string; bytes: Buffer }) {
  requireWrite(s);
  requirePart(s, "bills");
  if (file.bytes.length > MAX_BILL_BYTES) throw new ApiError("payload_too_large", "Bills to read are limited to 10 MB");
  const kind = sniffFile(file.bytes, file.name);
  if (!kind || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(kind.mime)) throw new ApiError("validation_failed", "Upload the bill as a PDF, JPG, PNG or WebP", { file: ["Unsupported file"] });
  const client = await anthropicFor(s.orgId);

  // What a bill is usually for: expenses, plus equipment (fixed assets) and things paid ahead.
  const accounts = (await db.select({ id: schema.accAccounts.id, code: schema.accAccounts.code, name: schema.accAccounts.name, type: schema.accAccounts.type, key: schema.accAccounts.systemKey }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.active, true), inArray(schema.accAccounts.type, ["expense", "asset"])))).filter((a) => (a.type === "expense" && !["cogs", "depreciation", "stock_adjust", "production_absorbed", "salaries", "employer_contrib"].includes(a.key ?? "")) || a.key === "fixed_assets" || a.key === "prepaid");
  const data = file.bytes.toString("base64");
  const doc: Anthropic.Beta.BetaContentBlockParam = kind.mime === "application/pdf" ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } } : { type: "image", source: { type: "base64", media_type: kind.mime as "image/png" | "image/jpeg" | "image/webp", data } };
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages
      .stream({
        model: COPILOT_MODEL,
        max_tokens: 8_000,
        system: "You read supplier bills and invoices for an Indian business's accounts. Copy what is printed; never guess a GSTIN, number or date that isn't there (leave it empty). Lines are taxable values before GST. If the bill only shows a total, make one line for the taxable value.",
        messages: [{ role: "user", content: [doc, { type: "text", text: `Read this bill. For each line, pick the closest account from this chart (code — name), or leave accountCode empty:\n${accounts.map((a) => `${a.code} — ${a.name}`).join("\n")}` }] }],
        output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_JSON_SCHEMA as unknown as Record<string, unknown> } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as Anthropic.Beta.MessageCreateParamsStreaming)
      .finalMessage();
  } catch (err) {
    throw providerError(err);
  }
  await recordUsage(s.orgId, s.userId, "bill_extract", msg.usage, msg.model ?? COPILOT_MODEL, { file: file.name.slice(0, 200) });
  if (msg.stop_reason === "refusal") throw new ApiError("provider_error", "The model declined to read this file.");
  if (msg.stop_reason === "max_tokens") throw new ApiError("provider_error", "This bill has too many lines to read in one go. Enter it by hand or split it.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("provider_error", "The bill couldn't be read. Enter it by hand.");
  }
  const x = extractedSchema.safeParse(parsed);
  if (!x.success) throw new ApiError("provider_error", "The bill couldn't be read. Enter it by hand.");

  const suppliers = await db.select({ id: schema.invSuppliers.id, name: schema.invSuppliers.name, gstin: schema.invSuppliers.gstin, state: schema.invSuppliers.state }).from(schema.invSuppliers).where(eq(schema.invSuppliers.orgId, s.orgId));
  // The account this supplier's last bill went to, for lines the model couldn't place.
  const last = new Map<string, string>();
  const supId = suppliers.find((p) => p.gstin && p.gstin.toUpperCase() === x.data.supplierGstin.trim().toUpperCase())?.id;
  if (supId) {
    const [b] = await db.select({ lines: schema.accBills.lines }).from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), eq(schema.accBills.supplierId, supId))).orderBy(desc(schema.accBills.createdAt)).limit(1);
    if (b?.lines[0]) last.set(supId, b.lines[0].accountId);
  }
  return toDraft(x.data, { suppliers: suppliers.map((p) => ({ ...p, gstin: p.gstin ?? "", state: p.state ?? "" })), accounts, homeState: s.settings.state, today: todayIst(), fallbackAccountId: (id) => last.get(id) ?? null });
}
