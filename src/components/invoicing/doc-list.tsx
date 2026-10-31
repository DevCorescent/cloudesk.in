"use client";

import { Download, FilePlus2, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ButtonLink, EmptyState, ErrorState, Input, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { DOC_LABEL, DOC_PLURAL, type DisplayStatus, type DocType } from "@/lib/invoicing/model";
import { SubHeader } from "../store/shared";
import { fmtDate, invApi, money, StatusBadge, TYPE_PATH, useInv, useInvQuery, type Doc } from "./shared";

const FILTERS: Record<DocType, { id: string; label: string; match: (s: DisplayStatus) => boolean }[]> = {
  invoice: [
    { id: "all", label: "All", match: () => true },
    { id: "unpaid", label: "Unpaid", match: (s) => s === "sent" || s === "viewed" || s === "partial" || s === "overdue" },
    { id: "overdue", label: "Overdue", match: (s) => s === "overdue" },
    { id: "paid", label: "Paid", match: (s) => s === "paid" },
    { id: "draft", label: "Drafts", match: (s) => s === "draft" },
    { id: "void", label: "Void", match: (s) => s === "void" },
  ],
  quote: [
    { id: "all", label: "All", match: () => true },
    { id: "open", label: "Awaiting answer", match: (s) => s === "sent" || s === "viewed" },
    { id: "won", label: "Accepted", match: (s) => s === "accepted" || s === "converted" },
    { id: "declined", label: "Declined", match: (s) => s === "declined" },
    { id: "expired", label: "Expired", match: (s) => s === "expired" },
    { id: "draft", label: "Drafts", match: (s) => s === "draft" },
  ],
  proforma: [
    { id: "all", label: "All", match: () => true },
    { id: "draft", label: "Drafts", match: (s) => s === "draft" },
  ],
  credit_note: [
    { id: "all", label: "All", match: () => true },
    { id: "draft", label: "Drafts", match: (s) => s === "draft" },
  ],
};

export function DocList({ type }: { type: DocType }) {
  const { apiBase, base, boot } = useInv();
  const router = useRouter();
  const q = useInvQuery<{ documents: Doc[] }>(`documents?type=${type}`);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const path = `${base}/${TYPE_PATH[type]}`;
  const filters = FILTERS[type];
  const rows = useMemo(() => {
    const f = filters.find((x) => x.id === filter) ?? filters[0];
    const s = search.trim().toLowerCase();
    return (q.data?.documents ?? []).filter((d) => f.match(d.displayStatus) && (!s || d.number.toLowerCase().includes(s) || d.client.name.toLowerCase().includes(s) || d.client.company.toLowerCase().includes(s)));
  }, [q.data, filter, search, filters]);
  const cur = boot.settings.currency;
  // Totals only add documents in the main currency; others are counted separately.
  const same = rows.filter((d) => d.currency === cur);
  const sum = same.filter((d) => d.status !== "void" && d.status !== "draft").reduce((a, d) => a + d.total, 0);
  const due = same.filter((d) => d.status !== "void" && d.status !== "draft").reduce((a, d) => a + d.balance, 0);
  const other = rows.length - same.length;
  const yearStart = `${boot.today.slice(0, 4)}-01-01`;

  return (
    <div>
      <SubHeader
        title={DOC_PLURAL[type]}
        description={type === "quote" ? "Send a quotation; your client can accept it online, then turn it into an invoice in one click." : type === "credit_note" ? "Reduce or cancel what a client owes on an issued invoice." : type === "proforma" ? "A priced offer before the final invoice — often for advance payments." : "Create, send and track invoices. Mark payments as they come in."}
        actions={
          <>
            <a href={`${invApi(apiBase, "export/documents")}?type=${type}&from=2000-01-01&to=${boot.today}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
              <Download className="size-3.5" /> CSV
            </a>
            <ButtonLink href={`${path}/new`} variant="primary" icon={<FilePlus2 className="size-3.5" />}>
              New {DOC_LABEL[type].toLowerCase()}
            </ButtonLink>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter">
          {filters.map((f) => {
            const n = (q.data?.documents ?? []).filter((d) => f.match(d.displayStatus)).length;
            return (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={cx("h-8 rounded-full px-3 text-[13px] transition-colors", filter === f.id ? "bg-fg font-medium text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                {f.label} {q.data && <span className="tabular-nums opacity-60">{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number or client" className="!h-8 pl-8 text-[13px]" aria-label="Search" />
        </div>
      </div>
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-72" />
      ) : !q.data.documents.length ? (
        <EmptyState
          icon={<FilePlus2 className="size-5" />}
          title={`No ${DOC_PLURAL[type].toLowerCase()} yet`}
          description={type === "invoice" ? "Your first invoice takes about a minute. Clients, items and your logo are saved for next time." : `Create your first ${DOC_LABEL[type].toLowerCase()}.`}
          action={<ButtonLink href={`${path}/new`} variant="primary">Create {DOC_LABEL[type].toLowerCase()}</ButtonLink>}
          className="py-16"
        />
      ) : (
        <div className="glass-card overflow-x-auto rounded-[var(--radius-xl)]">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted">
                <th className="px-4 py-2.5 font-medium">Number</th>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">{type === "quote" ? "Valid until" : "Due"}</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
                {type === "invoice" && <th className="px-4 py-2.5 text-right font-medium">Balance</th>}
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} onClick={() => router.push(`${path}/${d.id}`)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`${path}/${d.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{d.number || <span className="text-muted">Draft</span>}</Link>
                    {d.recurring && <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">Repeats {d.recurring.every}ly</span>}
                  </td>
                  <td className="max-w-56 truncate px-4 py-3">{d.client.company || d.client.name}</td>
                  <td className="px-4 py-3 text-muted tabular-nums">{fmtDate(d.issueDate)}</td>
                  <td className={cx("px-4 py-3 tabular-nums", d.displayStatus === "overdue" ? "text-danger" : "text-muted")}>{fmtDate(d.dueDate)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{money(d.total, d.currency)}</td>
                  {type === "invoice" && <td className="px-4 py-3 text-right tabular-nums">{d.balance ? money(d.balance, d.currency) : "—"}</td>}
                  <td className="px-4 py-3"><StatusBadge status={d.displayStatus} /></td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted">Nothing matches.</td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-border text-[12px] text-muted">
                  <td className="px-4 py-2.5" colSpan={4}>{rows.length} shown · totals of issued {cur} documents{other ? ` · ${other} in other currencies not added` : ""}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-fg tabular-nums">{money(sum, cur)}</td>
                  {type === "invoice" && <td className="px-4 py-2.5 text-right font-medium text-fg tabular-nums">{money(due, cur)}</td>}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted">
        Need everything this year in one file? <a className="underline" href={`${invApi(apiBase, "export/documents")}?from=${yearStart}&to=${boot.today}`}>Download all documents</a> or see <Link className="underline" href={`${base}/reports`}>Reports</Link>.
      </p>
    </div>
  );
}
