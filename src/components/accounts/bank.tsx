"use client";

// Banking: bank and cash accounts with their balances, and reconciliation —
// import a statement, match each line to the books, or post or ignore it.
import { Check, EyeOff, Landmark, Link2, Upload, Wand2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { SmartImport } from "@/components/import/smart-import";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { useState } from "react";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { AccountOptions, Empty, StatusPill, accApi, fmt, inr, useAcc, useAccAction, useAccQuery } from "./shared";
import { CashCountDialog } from "./payables";

type BankAcc = { id: string; code: string; name: string; subtype: string; bank: { bankName?: string; last4?: string } | null; balance: number; unmatched: number };

export function BankView() {
  const { meta, go } = useAcc();
  const q = useAccQuery<{ accounts: BankAcc[] }>("bank");
  const [counting, setCounting] = useState<BankAcc | null>(null);
  return (
    <div>
      <PageHeader title="Banking" description="Your bank and cash accounts. Import a statement to check your books against the bank." actions={meta.me.manage && <Button size="sm" onClick={() => go("accounts")}>Add a bank account</Button>} />
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !q.data.accounts.length ? (
        <EmptyState icon={<Landmark />} title="No bank accounts" description="Add one in the chart of accounts with the kind “Bank account”." />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {q.data.accounts.map((a) => (
            <li key={a.id} className="rounded-[20px] border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span>
                  <b className="text-[15px] font-semibold">{a.name}</b>
                  <span className="block text-[12.5px] text-muted">{a.subtype === "cash" ? "Cash" : [a.bank?.bankName, a.bank?.last4 && `••${a.bank.last4}`].filter(Boolean).join(" ") || "Bank account"}</span>
                </span>
                <span className="text-right">
                  <b className="block text-[20px] tabular-nums">{inr(a.balance)}</b>
                  <span className="text-[11.5px] text-muted">in your books</span>
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <Link href={`/accounts/accounts/${a.id}`} className="text-[12.5px] text-muted hover:text-fg">
                  Ledger
                </Link>
                {a.subtype === "cash" && meta.me.write && <Button size="sm" onClick={() => setCounting(a)}>Count cash</Button>}
                {a.subtype === "bank" && (
                  <Button size="sm" variant={a.unmatched ? "primary" : "secondary"} icon={a.unmatched ? <Link2 className="size-3.5" /> : <Upload className="size-3.5" />} onClick={() => go(`bank/${a.id}`)}>
                    {a.unmatched ? `Match ${a.unmatched} line${a.unmatched === 1 ? "" : "s"}` : "Reconcile"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {counting && <CashCountDialog account={counting} onClose={() => setCounting(null)} />}
    </div>
  );
}

type View = {
  account: { id: string; name: string };
  lines: { id: string; date: string; description: string; reference: string; amount: number; status: string; matchedTo: { number: string; narration: string } | null; suggestions: { lineId: string; date: string; amount: number; number: string; narration: string; party: string }[] }[];
  unmatchedBook: number;
  statementTotal: number;
};

export function ReconcileView({ id }: { id: string }) {
  const { meta, orgId } = useAcc();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"unmatched" | "matched" | "ignored">("unmatched");
  const q = useAccQuery<View>(`bank/${id}?status=${tab}`, { keepPrevious: true });
  const [importing, setImporting] = useState(false);
  const [posting, setPosting] = useState<View["lines"][number] | null>(null);
  const match = useAccAction<{ bankLineId: string; lineId: string }>((b) => ({ path: `bank/${id}/match`, body: b }), { success: "Matched" });
  const unmatch = useAccAction<string>((bankLineId) => ({ path: `bank/${id}/unmatch`, body: { bankLineId } }), { success: "Unmatched" });
  const ignore = useAccAction<{ bankLineId: string; ignore: boolean }>((b) => ({ path: `bank/${id}/ignore`, body: b }));
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const d = q.data;
  return (
    <div>
      <Link href="/accounts/bank" className="mb-2 inline-flex text-[13px] text-muted hover:text-fg">
        ← Banking
      </Link>
      <PageHeader title={`Reconcile ${d.account.name}`} description={`${d.unmatchedBook} book entr${d.unmatchedBook === 1 ? "y" : "ies"} on this account not yet matched to the bank.`} actions={meta.me.write && <Button size="sm" variant="primary" icon={<Upload className="size-3.5" />} onClick={() => setImporting(true)}>Import a statement</Button>} />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: "unmatched", label: "To match" }, { value: "matched", label: "Matched" }, { value: "ignored", label: "Ignored" }]} />
      {!d.lines.length ? (
        <Empty>{tab === "unmatched" ? "Nothing to match. Import a statement from your bank (CSV) to start." : "Nothing here."}</Empty>
      ) : (
        <ul className={cx("grid gap-2", q.isFetching && "opacity-80")}>
          {d.lines.map((l) => (
            <li key={l.id} className="rounded-[16px] border border-border bg-surface p-3.5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="min-w-0">
                  <b className="block truncate text-[13.5px] font-medium">{l.description || "—"}</b>
                  <span className="text-[12px] text-muted">
                    {fmt(l.date)}
                    {l.reference ? ` · ${l.reference}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <b className={cx("text-[14px] tabular-nums", l.amount > 0 ? "text-success" : "")}>
                    {l.amount > 0 ? "+" : "−"}
                    {inr(Math.abs(l.amount))}
                  </b>
                  <StatusPill status={l.status} />
                </span>
              </div>
              {l.status === "matched" && l.matchedTo && (
                <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <Check className="size-3.5 text-success" /> {l.matchedTo.narration} · {l.matchedTo.number}
                  </span>
                  {meta.me.write && <button type="button" className="font-medium hover:text-fg" onClick={() => unmatch.mutate(l.id)}>Unmatch</button>}
                </div>
              )}
              {l.status === "unmatched" && meta.me.write && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {l.suggestions.map((s) => (
                    <button key={s.lineId} type="button" onClick={() => match.mutate({ bankLineId: l.id, lineId: s.lineId })} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12.5px] hover:bg-surface-2">
                      <Link2 className="size-3.5" /> {s.narration} · {fmt(s.date, { day: "numeric", month: "short" })}
                    </button>
                  ))}
                  <Button size="sm" variant="ghost" icon={<Wand2 className="size-3.5" />} onClick={() => setPosting(l)}>
                    Post it
                  </Button>
                  <Button size="sm" variant="ghost" icon={<EyeOff className="size-3.5" />} onClick={() => ignore.mutate({ bankLineId: l.id, ignore: true })}>
                    Ignore
                  </Button>
                </div>
              )}
              {l.status === "ignored" && meta.me.write && (
                <button type="button" className="mt-2 text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => ignore.mutate({ bankLineId: l.id, ignore: false })}>
                  Bring back
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {importing && <SmartImport target={target("accounts.bank")} onClose={() => setImporting(false)} onImport={(rows) => api(accApi(orgId, `bank/${id}/import-rows`), { method: "POST", body: { rows } })} onDone={() => qc.invalidateQueries({ queryKey: ["acc", orgId] })} />}
      {posting && <PostDialog id={id} line={posting} onClose={() => setPosting(null)} />}
    </div>
  );
}

function PostDialog({ id, line, onClose }: { id: string; line: View["lines"][number]; onClose: () => void }) {
  const { meta } = useAcc();
  const guess = /charge|fee|gst on|sms/i.test(line.description) ? meta.accounts.find((a) => a.systemKey === "bank_charges")?.id : /interest/i.test(line.description) ? meta.accounts.find((a) => a.systemKey === "other_income")?.id : "";
  const [accountId, setAccount] = useState(guess ?? "");
  const [narration, setNarration] = useState(line.description);
  const run = useAccAction(() => ({ path: `bank/${id}/create`, body: { bankLineId: line.id, accountId, narration } }), { success: "Posted and matched", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`${line.amount > 0 ? "Money in" : "Money out"}: ${inr(Math.abs(line.amount))}`} description="Post an entry for this line — for bank charges, interest or anything not yet in the books. It's matched straight away." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={run.isPending} disabled={!accountId} onClick={() => run.mutate(undefined)}>Post</Button></>}>
      <div className="grid gap-4">
        <Field label={line.amount > 0 ? "Where it came from" : "What it was for"}>
          {(a) => (
            <Select {...a} value={accountId} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Choose…</option>
              <AccountOptions accounts={meta.accounts} filter={(x) => x.id !== id} />
            </Select>
          )}
        </Field>
        <Field label="Narration">{(a) => <Textarea {...a} rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} maxLength={300} />}</Field>
      </div>
    </Dialog>
  );
}

