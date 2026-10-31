// Accounting & GST API for a workspace. Dispatches on "METHOD section :id sub".
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { extractBill, MAX_BILL_BYTES } from "@/server/accounting/extract";
import { hasLlm } from "@/server/ai/gateway";
import { requirePart, saveSettings, scope } from "@/server/accounting/access";
import { bankAccounts, createFromLine, ignoreLine, importStatement, matchLine, reconcileView, unmatchLine } from "@/server/accounting/bank";
import { billDetail, deletePayment, listBills, payBill, recordExpense, saveBill, voidBill } from "@/server/accounting/bills";
import { gstr1, gstr1Csv, gstr3b } from "@/server/accounting/gst";
import { accounts, createJournal, deleteAccount, deleteJournal, dimOf, journals, ledger, saveAccount } from "@/server/accounting/ledger";
import { aging, balanceSheet, home, profitAndLoss, trialBalance } from "@/server/accounting/reports";
import { closeMonth, closeYear, closedMonths, reopenMonth } from "@/server/accounting/periods";
import { assetDetail, assets, budgetVsActual, budgets, cashFlowReport, deleteAsset, deleteBudget, deleteSchedule, disposeAsset, forecast, saveAsset, saveBudget, saveSchedule, schedules, stopSchedule, undoDisposal } from "@/server/accounting/finance";
import { importAssets } from "@/server/accounting/import";
import { addDeposit, cancelRun, countCash, deleteDeposit, payRun, runBankFile, runDetail, runs, saveRun, submitRun, tdsReport, tdsSuggestion } from "@/server/accounting/payables";
import { advances, applyAdvance, deleteReceipt, openInvoices, receipts, receive } from "@/server/accounting/receivables";
import { invoiceBooks } from "@/server/org/org";
import { addIntercompany, consolidation, deleteIntercompany, intercompany } from "@/server/accounting/group";
import { einvoiceExport, einvoices, ewayExport, saveEinvoice } from "@/server/accounting/einvoice";
import { branches as orgBranches, companies, units as orgUnits } from "@/server/org/org";
import { sync, syncIfStale } from "@/server/accounting/sync";
import { importAccounts, importBankRows, importBills, importOpening } from "@/server/accounting/import";
import { rateLimit } from "@/server/security/rate-limit";
import { financialYear } from "@/lib/accounting/model";
import { isPartOn } from "@/lib/workspace/modules";
import { db, schema } from "@/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const csv = (name: string, text: string) => new Response("﻿" + text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
const json = (name: string, data: unknown) => new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub, x] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? " :id" : ""}${sub ? ` ${sub}` : ""}${x ? " :x" : ""}`;
  const s = await scope(ctx, orgId);
  // Reading screens keep the books current without a button.
  if (m === "GET" && ["home", "reports", "journals", "ledger", "bank", "gst", "assets", "budgets", "consolidation", "einvoice"].includes(section ?? "")) await syncIfStale(s);

  // Imports: POST <list>/import.
  if (m === "POST" && id === "import") {
    await rateLimit(`acc-import:${ctx.user.id}`, 60, 3600_000);
    const b = await readJson(ctx.req, z.unknown());
    if (section === "accounts") return importAccounts(s, b);
    if (section === "opening") return importOpening(s, b);
    if (section === "assets") return importAssets(s, b);
    if (section === "bills") return importBills(s, b);
    throw notFound("Route");
  }
  // A bill read by AI: multipart with the "file"; returns a draft, saves nothing.
  if (m === "POST" && section === "bills-extract" && !id) {
    await rateLimit(`bill-extract:${ctx.user.id}`, 60, 3_600_000);
    if (Number(ctx.req.headers.get("content-length") ?? 0) > MAX_BILL_BYTES + 256 * 1024) throw new ApiError("payload_too_large", "Bills to read are limited to 10 MB");
    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      throw new ApiError("bad_request", "Send the bill as multipart/form-data");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError("validation_failed", "Choose the bill to read", { file: ["Required"] });
    return extractBill(s, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  }
  if (m === "POST" && section === "bank" && sub === "import-rows") return importBankRows(s, id!, await readJson(ctx.req, z.unknown()));

  switch (key) {
    case "GET meta": {
      const [accs, sups, set] = await Promise.all([accounts(orgId), db.select({ id: schema.invSuppliers.id, name: schema.invSuppliers.name, state: schema.invSuppliers.state }).from(schema.invSuppliers).where(eq(schema.invSuppliers.orgId, orgId)), db.select({ syncedAt: schema.accSettings.syncedAt }).from(schema.accSettings).where(eq(schema.accSettings.orgId, orgId))]);
      const [cos, brs, us, curs] = await Promise.all([companies(orgId), orgBranches(orgId), orgUnits(orgId), db.select({ code: schema.orgCurrencies.code, name: schema.orgCurrencies.name }).from(schema.orgCurrencies).where(and(eq(schema.orgCurrencies.orgId, orgId), eq(schema.orgCurrencies.active, true)))]);
      const seeCo = (id: string) => !s.access?.companies?.length || s.access.companies.includes(id);
      return { me: { write: s.write, manage: s.manage }, companies: cos.filter((c) => seeCo(c.id)).map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault, gstin: c.gstin, active: c.active })), branches: brs.filter((b) => seeCo(b.companyId)).map((b) => ({ id: b.id, name: b.name, companyId: b.companyId, active: b.active })), units: us.map((u) => ({ id: u.id, code: u.code, name: u.name, kind: u.kind, active: u.active })), currencies: curs.filter((c) => c.code !== "INR"), settings: s.settings, accounts: accs, suppliers: sups, fy: financialYear(today(), s.settings.fyStartMonth), syncedAt: set[0]?.syncedAt ?? null, aiConnected: await hasLlm(orgId), parts: { bills: isPartOn(s.partsOff, "accounting", "bills"), banking: isPartOn(s.partsOff, "accounting", "banking"), gst: isPartOn(s.partsOff, "accounting", "gst") } };
    }
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET assets":
      return { assets: await assets(s) };
    case "POST assets":
      return { asset: await saveAsset(s, null, await body(ctx)) };
    case "GET assets :id":
      return assetDetail(s, id!);
    case "PUT assets :id":
      return { asset: await saveAsset(s, id!, await body(ctx)) };
    case "POST assets :id dispose":
      return disposeAsset(s, id!, await body(ctx));
    case "POST assets :id undispose":
      await undoDisposal(s, id!);
      return { ok: true };
    case "DELETE assets :id":
      await deleteAsset(s, id!);
      return { ok: true };
    case "GET schedules":
      return { schedules: await schedules(s) };
    case "POST schedules":
      return { schedule: await saveSchedule(s, null, await body(ctx)) };
    case "PUT schedules :id":
      return { schedule: await saveSchedule(s, id!, await body(ctx)) };
    case "POST schedules :id stop":
      return { schedule: await stopSchedule(s, id!) };
    case "DELETE schedules :id":
      await deleteSchedule(s, id!);
      return { ok: true };
    case "GET budgets":
      return { budgets: await budgets(s) };
    case "POST budgets":
      return { budget: await saveBudget(s, null, await body(ctx)) };
    case "GET budgets :id":
      return budgetVsActual(s, id!);
    case "PUT budgets :id":
      return { budget: await saveBudget(s, id!, await body(ctx)) };
    case "DELETE budgets :id":
      await deleteBudget(s, id!);
      return { ok: true };
    case "GET tds":
      return tdsReport(s, qs.quarter);
    case "GET tds-suggest":
      return tdsSuggestion(s, qs);
    case "GET tds-export": {
      const r = await tdsReport(s, qs.quarter);
      const cell = (v: unknown) => {
        const t = String(v ?? "");
        return /^[=+\-@]/.test(t) ? `'${t}` : /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const rows = [["Section", "Deductee", "PAN", "PAN valid", "Type", "Bill", "Date", "Amount paid/credited", "Rate %", "TDS"], ...r.entries.map((e) => [e.section, e.supplier, e.pan, e.panValid ? "yes" : "no", e.deductee === "company" ? "Company" : "Other", e.number, e.date, (e.base / 100).toFixed(2), e.rate, (e.tds / 100).toFixed(2)])];
      return new Response("\ufeff" + rows.map((x) => x.map(cell).join(",")).join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tds-${r.quarter.replace(/ /g, "-")}.csv"` } });
    }
    case "POST tds-deposits":
      return { deposit: await addDeposit(s, await body(ctx)) };
    case "DELETE tds-deposits :id":
      await deleteDeposit(s, id!);
      return { ok: true };
    case "GET receipts":
      return { receipts: await receipts(s), advances: await advances(s) };
    case "GET receipts-for":
      return { invoices: await openInvoices(s, String(qs.ownerId), String(qs.clientId)), advances: await advances(s, String(qs.ownerId), String(qs.clientId)) };
    case "GET receipt-meta": {
      const books = await invoiceBooks(orgId);
      const clients = books.length ? await db.select({ id: schema.invoiceClients.id, ownerId: schema.invoiceClients.projectId, name: schema.invoiceClients.name, company: schema.invoiceClients.company }).from(schema.invoiceClients).where(and(inArray(schema.invoiceClients.projectId, books.map((b) => b.id)), isNull(schema.invoiceClients.archivedAt))) : [];
      return { books, clients };
    }
    case "POST receipts":
      return { receipt: await receive(s, await body(ctx)) };
    case "POST receipts :id apply":
      return { receipt: await applyAdvance(s, id!, await body(ctx)) };
    case "DELETE receipts :id":
      await deleteReceipt(s, id!);
      return { ok: true };
    case "GET payments":
      return { runs: await runs(s) };
    case "POST payments":
      return { run: await saveRun(s, null, await body(ctx)) };
    case "GET payments :id":
      return runDetail(s, id!);
    case "PUT payments :id":
      return { run: await saveRun(s, id!, await body(ctx)) };
    case "POST payments :id submit":
      return submitRun(s, id!);
    case "POST payments :id pay":
      return { run: await payRun(s, id!) };
    case "POST payments :id cancel":
      await cancelRun(s, id!);
      return { ok: true };
    case "GET payments :id file":
      return new Response(await runBankFile(s, id!), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="payment-run.csv"` } });
    case "POST cash-count":
      return countCash(s, await body(ctx));
    case "GET periods":
      return { periods: await closedMonths(orgId) };
    case "POST periods :id":
      if (id === "close") return { period: await closeMonth(s, await body(ctx)) };
      if (id === "year") return closeYear(s, await body(ctx));
      throw notFound("Route");
    case "DELETE periods :id":
      await reopenMonth(s, id!);
      return { ok: true };
    case "POST sync":
      return sync(s);
    case "GET home":
      return home(s);

    case "GET accounts":
      return { accounts: await accounts(orgId) };
    case "POST accounts":
      return { account: await saveAccount(s, null, await body(ctx)) };
    case "PUT accounts :id":
      return { account: await saveAccount(s, id!, await body(ctx)) };
    case "DELETE accounts :id":
      await deleteAccount(s, id!);
      return { ok: true };
    case "GET ledger :id":
      return ledger(s, id!, qs);

    case "GET journals":
      return { journals: await journals(s, qs) };
    case "POST journals":
      return createJournal(s, await body(ctx));
    case "DELETE journals :id":
      await deleteJournal(s, id!);
      return { ok: true };

    case "GET bills":
      return { bills: await listBills(s, qs) };
    case "POST bills":
      return { bill: await saveBill(s, null, await body(ctx)) };
    case "GET bills :id":
      return billDetail(s, id!);
    case "PUT bills :id":
      return { bill: await saveBill(s, id!, await body(ctx)) };
    case "POST bills :id void":
      await voidBill(s, id!);
      return { ok: true };
    case "POST bills :id payments":
      return { payment: await payBill(s, id!, await body(ctx)) };
    case "DELETE bills :id payments :x":
      await deletePayment(s, id!, x!);
      return { ok: true };
    case "POST expenses":
      return { bill: await recordExpense(s, await body(ctx)) };

    case "GET bank":
      return { accounts: await bankAccounts(s) };
    case "GET bank :id":
      requirePart(s, "banking");
      return reconcileView(s, id!, qs.status);
    case "POST bank :id import":
      return importStatement(s, id!, z.object({ csv: z.string().max(2_100_000) }).parse(await body(ctx)).csv);
    case "POST bank :id match": {
      const b = z.object({ bankLineId: z.uuid(), lineId: z.uuid() }).parse(await body(ctx));
      await matchLine(s, b.bankLineId, b.lineId);
      return { ok: true };
    }
    case "POST bank :id unmatch":
      await unmatchLine(s, z.object({ bankLineId: z.uuid() }).parse(await body(ctx)).bankLineId);
      return { ok: true };
    case "POST bank :id ignore": {
      const b = z.object({ bankLineId: z.uuid(), ignore: z.boolean().default(true) }).parse(await body(ctx));
      await ignoreLine(s, b.bankLineId, b.ignore);
      return { ok: true };
    }
    case "POST bank :id create": {
      const b = await body(ctx);
      return { journal: await createFromLine(s, z.uuid().parse(b.bankLineId), b) };
    }

    case "GET reports trial-balance":
    case "GET reports :id": {
      const kind = id ?? "";
      const dim = dimOf(s, qs);
      if (kind === "trial-balance") return trialBalance(s, qs.asOf, dim);
      if (kind === "profit-loss") {
        const fy = financialYear(qs.to ?? today(), s.settings.fyStartMonth);
        return profitAndLoss(s, qs.from ?? fy.from, qs.to ?? today(), dim);
      }
      if (kind === "balance-sheet") return balanceSheet(s, qs.asOf, dim);
      if (kind === "aging") return aging(s);
      if (kind === "cash-flow") {
        const fy = financialYear(qs.to ?? today(), s.settings.fyStartMonth);
        return cashFlowReport(s, qs.from ?? fy.from, qs.to ?? today(), dim);
      }
      if (kind === "forecast") return forecast(s, Math.min(26, Math.max(4, Number(qs.weeks) || 13)));
      throw notFound("Report");
    }

    case "GET gst :id": {
      const month = qs.month ?? today().slice(0, 7);
      if (id === "gstr1") return gstr1(s, month);
      if (id === "gstr3b") return gstr3b(s, month);
      throw notFound("Return");
    }
    case "GET einvoice":
      return einvoices(s, qs.month);
    case "POST einvoice-export": {
      const { ids } = await readJson(ctx.req, z.object({ ids: z.array(z.uuid()).min(1).max(500) }));
      return json(`einvoices-${today()}.json`, await einvoiceExport(s, ids));
    }
    case "GET einvoice :id eway":
      return json(`eway-bill-${id}.json`, await ewayExport(s, id!));
    case "PUT einvoice :id":
      return { record: await saveEinvoice(s, id!, await body(ctx)) };
    case "GET intercompany":
      return { entries: await intercompany(s) };
    case "POST intercompany":
      return { entry: await addIntercompany(s, await body(ctx)) };
    case "DELETE intercompany :id":
      await deleteIntercompany(s, id!);
      return { ok: true };
    case "GET consolidation":
      return consolidation(s, qs);
    case "GET gst :id export": {
      if (id !== "gstr1") throw notFound("Export");
      // Both go into the file name, so only known values (the month is checked by gstr1).
      const section = ["b2b", "b2cl", "b2cs", "cdn", "hsn"].includes(qs.section ?? "b2b") ? (qs.section ?? "b2b") : "b2b";
      const month = qs.month ?? today().slice(0, 7);
      const r = await gstr1(s, month);
      return csv(`gstr1-${section}-${/^\d{4}-\d{2}$/.test(month) ? month : "export"}.csv`, gstr1Csv(r, section));
    }
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
