// Importing into the books: the chart of accounts (from Tally, Zoho or a
// sheet), opening balances as one balanced journal, supplier bills, and bank
// statements through the smart importer. Accounts in a file are found by code,
// then by name.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { target } from "@/lib/import/targets";
import { ApiError } from "../http/errors";
import { audit } from "../services/audit";
import { runImport, str, type ImportResult } from "../import/run";
import { check, requireManage, requirePart, requireWrite, type Scope } from "./access";
import { addStatementLines } from "./bank";
import { saveBill } from "./bills";
import { accountKeys, assertOpen, postJournal } from "./ledger";

async function accountFinder(orgId: string) {
  const all = await db.select({ id: schema.accAccounts.id, code: schema.accAccounts.code, name: schema.accAccounts.name, type: schema.accAccounts.type }).from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId));
  return (ref: string) => {
    const k = ref.trim().toLowerCase();
    return all.find((a) => a.code.toLowerCase() === k) ?? all.find((a) => a.name.toLowerCase() === k) ?? all.find((a) => k.startsWith(`${a.code.toLowerCase()} `) || k.endsWith(` ${a.name.toLowerCase()}`));
  };
}

export async function importAccounts(s: Scope, raw: unknown) {
  requireManage(s);
  const r = await runImport(target("accounts.accounts"), raw, async (v, mode) => {
    const code = str(v.code);
    const name = str(v.name);
    const [found] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), sql`(lower(${schema.accAccounts.code}) = lower(${code}) or lower(${schema.accAccounts.name}) = lower(${name}))`)).limit(1);
    if (found) {
      if (mode === "skip") return "skipped";
      if (found.type !== v.type) {
        const [used] = await db.select({ id: schema.accLines.id }).from(schema.accLines).where(eq(schema.accLines.accountId, found.id)).limit(1);
        if (used) throw new ApiError("conflict", `${found.name} has entries, so its type can't change`);
      }
      await db.update(schema.accAccounts).set({ name, type: String(v.type), ...(str(v.description) ? { description: str(v.description) } : {}) }).where(eq(schema.accAccounts.id, found.id));
      return "updated";
    }
    const bank = /bank|a\/c|current account|savings/i.test(name) && v.type === "asset";
    const cash = /^cash/i.test(name) && v.type === "asset";
    await db.insert(schema.accAccounts).values({ orgId: s.orgId, code, name, type: String(v.type), subtype: bank ? "bank" : cash ? "cash" : "other", description: str(v.description) });
    return "created";
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.chart_imported", targetType: "organization", targetId: s.orgId, metadata: { created: r.created, updated: r.updated } });
  return r;
}

/** Opening balances: one journal on the date given. Any difference goes to “Opening balance adjustments”. */
export async function importOpening(s: Scope, raw: unknown) {
  requireWrite(s);
  const { date } = check(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date the balances are as of") }), raw);
  assertOpen(s, date, "These opening balances");
  const find = await accountFinder(s.orgId);
  const lines: { accountId: string; debit: number; credit: number; description: string }[] = [];
  const r: ImportResult = await runImport(target("accounts.opening"), raw, async (v) => {
    const a = find(str(v.account));
    if (!a) throw new ApiError("validation_failed", `There's no account “${str(v.account)}” — import or add it to the chart first`);
    const net = Number(v.debit ?? 0) - Number(v.credit ?? 0);
    if (!net) return "skipped";
    lines.push({ accountId: a.id, debit: Math.max(0, net), credit: Math.max(0, -net), description: "Opening balance" });
    return "created";
  });
  if (lines.length) {
    const dr = lines.reduce((x, l) => x + l.debit, 0);
    const cr = lines.reduce((x, l) => x + l.credit, 0);
    const keys = await accountKeys(s.orgId);
    if (dr !== cr) lines.push({ accountId: keys.get("opening")!, debit: Math.max(0, cr - dr), credit: Math.max(0, dr - cr), description: "Difference in opening balances" });
    await db.transaction((tx) => postJournal(tx, s, { date, narration: "Opening balances (imported)", sourceType: "opening", lines }));
  }
  return { ...r, difference: lines.length ? Math.abs(lines.filter((l) => l.description !== "Difference in opening balances").reduce((x, l) => x + l.debit - l.credit, 0)) : 0 };
}

export async function importBills(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "bills");
  const find = await accountFinder(s.orgId);
  const sups = await db.select({ id: schema.invSuppliers.id, name: schema.invSuppliers.name }).from(schema.invSuppliers).where(eq(schema.invSuppliers.orgId, s.orgId));
  return runImport(target("accounts.bills"), raw, async (v) => {
    const a = find(str(v.account));
    if (!a) throw new ApiError("validation_failed", `There's no account “${str(v.account)}” — use one from your chart, like Rent`);
    const sup = sups.find((x) => x.name.toLowerCase() === str(v.supplier).toLowerCase());
    // A bill with the same supplier and number is already here.
    if (str(v.billNo)) {
      const [dup] = await db.select({ id: schema.accBills.id }).from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), sql`lower(${schema.accBills.supplierName}) = lower(${str(v.supplier)})`, eq(schema.accBills.billNo, str(v.billNo))));
      if (dup) return "skipped";
    }
    await saveBill(s, null, { supplierId: sup?.id ?? null, supplierName: str(v.supplier), billNo: str(v.billNo), date: str(v.date), dueDate: v.dueDate ? str(v.dueDate) : null, lines: [{ accountId: a.id, description: str(v.description), amount: Number(v.amount), gstRate: Number(v.gstRate ?? 0) }], itc: v.itc !== false, interState: v.interState === true });
    return "created";
  });
}

export async function importBankRows(s: Scope, accountId: string, raw: unknown) {
  const lines: { date: string; description: string; reference: string; amount: number }[] = [];
  const r = await runImport(target("accounts.bank"), raw, async (v) => {
    const amount = v.amount !== null ? Number(v.amount) : Number(v.deposit ?? 0) - Number(v.withdrawal ?? 0);
    if (!amount) return "skipped";
    lines.push({ date: str(v.date), description: str(v.description).slice(0, 300), reference: str(v.reference).slice(0, 80), amount });
    return "created";
  });
  const added = lines.length ? await addStatementLines(s, accountId, lines) : { added: 0, skipped: 0, matched: 0 };
  return { ...r, created: added.added, skipped: r.skipped + added.skipped, matched: added.matched };
}

export async function importAssets(s: Scope, raw: unknown) {
  requireWrite(s);
  const find = await accountFinder(s.orgId);
  const { saveAsset } = await import("./finance");
  return runImport(target("accounts.assets"), raw, async (v, mode) => {
    const code = str(v.code).trim();
    const [found] = code ? await db.select().from(schema.accAssets).where(and(eq(schema.accAssets.orgId, s.orgId), eq(schema.accAssets.code, code))) : [];
    if (found && mode === "skip") return "skipped";
    const acc = find(str(v.account) || "Fixed assets");
    if (!acc) throw new ApiError("validation_failed", `There's no account “${str(v.account)}” — use a fixed-asset account from your chart`);
    const life = v.lifeYears !== null ? Math.round(Number(v.lifeYears) * 12) : null;
    await saveAsset(s, found?.id ?? null, {
      code,
      name: str(v.name),
      category: str(v.category) || found?.category || "",
      assetAccountId: acc.id,
      purchaseDate: str(v.purchaseDate),
      inUseDate: str(v.inUseDate) || str(v.purchaseDate),
      cost: Number(v.cost),
      residual: v.residual !== null ? Number(v.residual) : (found?.residual ?? 0),
      method: str(v.method) || found?.method || "slm",
      lifeMonths: life ?? found?.lifeMonths ?? 60,
      rate: v.rate !== null ? Number(v.rate) : (found?.rate ?? 0),
      serial: str(v.serial),
      location: str(v.location),
    });
    return found ? "updated" : "created";
  });
}
