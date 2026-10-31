"use client";

// Business formulas: pick one, fill in the numbers, and the results, the
// working and (for some) a full schedule appear as you type. Save keeps the
// inputs and the answer in your history, to open again later.
import clsx from "clsx";
import { Check, Copy, Download, MessagesSquare, Save, Search } from "lucide-react";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useShareToChat } from "@/components/chat/share";
import { useToast } from "@/components/ui/overlays";
import { clean } from "@/lib/calculator/expr";
import { rupeesInWords } from "@/lib/calculator/format";
import { CATEGORIES, describe, FORMULAS, formulaById, FormulaError, type Formula, type Out, type Values } from "@/lib/calculator/formulas";
import { copy, fmt, fmtMoney, useCalcSettings, useHistoryActions } from "./shared";

export type FormulasHandle = { open: (id: string, values?: Values | null) => void };

const today = () => new Date().toISOString().slice(0, 10);
const defaults = (f: Formula): Values => Object.fromEntries(f.fields.map((x) => [x.id, x.kind === "date" ? (x.default || today()) : (x.default ?? "")]));

export const Formulas = forwardRef<FormulasHandle>(function Formulas(_, ref) {
  const [s] = useCalcSettings();
  const toast = useToast();
  const { save } = useHistoryActions();
  const { available: canShare, share } = useShareToChat();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [id, setId] = useState(FORMULAS[0]!.id);
  const [values, setValues] = useState<Values>(() => defaults(FORMULAS[0]!));
  const [saved, setSaved] = useState(false);
  const f = formulaById(id)!;

  const pick = (fid: string, v?: Values | null) => {
    const ff = formulaById(fid);
    if (!ff) return;
    setId(fid);
    setValues(v ? { ...defaults(ff), ...v } : defaults(ff));
    setSaved(false);
  };
  useImperativeHandle(ref, () => ({ open: pick }), []);  

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return FORMULAS.filter((x) => (cat === "all" || x.category === cat) && (!t || `${x.name} ${x.line} ${x.keywords}`.toLowerCase().includes(t)));
  }, [q, cat]);

  const outcome = useMemo(() => {
    try {
      return { r: f.compute(values), error: null };
    } catch (e) {
      return { r: null, error: e instanceof FormulaError ? e.message : "Check the numbers" };
    }
  }, [f, values]);

  const show = (o: Out) => (typeof o.value === "string" ? o.value : o.kind === "money" ? fmtMoney(o.value, s) : o.kind === "percent" ? `${fmt(clean(o.value), { ...s, decimals: 2 })}%` : o.kind === "units" ? `${fmt(o.value, s)} units` : o.kind === "days" ? `${fmt(o.value, s)} day${o.value === 1 ? "" : "s"}` : fmt(clean(o.value), s));
  const primary = outcome.r?.results.find((o) => o.primary) ?? outcome.r?.results[0];

  const saveIt = () => {
    if (!outcome.r || !primary) return;
    save.mutate({ kind: "formula", input: f.id, values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "")), result: `${primary.label}: ${show(primary)}`, resultValue: typeof primary.value === "number" ? primary.value : null }, { onSuccess: () => { setSaved(true); toast({ tone: "success", title: "Saved to history" }); } });
  };

  const downloadTable = () => {
    const t = outcome.r?.table;
    if (!t) return;
    const csv = [t.head.join(","), ...t.rows.map((r) => r.join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${f.id}-schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" /><input aria-label="Search formulas" value={q} onChange={(e) => setQ(e.target.value)} placeholder="GST, EMI, margin…" className="h-10 w-full rounded-full bg-surface pl-9 pr-3 text-[14px] ring-1 ring-border outline-none focus:ring-accent" /></div>
        <div className="flex flex-wrap gap-1.5">
          {[{ id: "all", label: "All" }, ...CATEGORIES].map((c) => <button key={c.id} type="button" onClick={() => setCat(c.id)} className={clsx("rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors", cat === c.id ? "bg-fg text-bg" : "bg-surface-2 text-muted hover:text-fg")}>{c.label}</button>)}
        </div>
        <ul className="max-h-[420px] space-y-0.5 overflow-y-auto lg:max-h-[640px]">
          {list.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => pick(x.id)} className={clsx("w-full rounded-[12px] px-3 py-2 text-left transition-colors", x.id === id ? "bg-surface ring-1 ring-border" : "hover:bg-surface-2")}>
                <span className="block text-[13.5px] font-medium">{x.name}</span>
                <span className="line-clamp-1 text-[12px] text-muted">{x.line}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-4 text-[13px] text-muted">No formula matches “{q}”.</li>}
        </ul>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="rounded-[22px] bg-surface p-5 ring-1 ring-border">
          <p className="text-[11.5px] font-semibold tracking-[0.12em] text-muted uppercase">{CATEGORIES.find((c) => c.id === f.category)?.label}</p>
          <h2 className="mt-1 text-[20px] font-semibold tracking-tight">{f.name}</h2>
          <p className="text-[13.5px] text-muted">{f.line}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {f.fields.map((fld) => (
              <label key={fld.id} className="grid gap-1 text-[13px]">
                <span className="font-medium">{fld.label}{fld.optional && <span className="font-normal text-muted"> · optional</span>}</span>
                {fld.kind === "select" ? (
                  <select className="h-10 rounded-[12px] bg-surface-2 px-3 text-[14px] outline-none focus:ring-2 focus:ring-accent" value={String(values[fld.id] ?? "")} onChange={(e) => { setValues({ ...values, [fld.id]: e.target.value }); setSaved(false); }}>
                    {fld.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <span className="relative">
                    {fld.kind === "money" && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">₹</span>}
                    <input
                      type={fld.kind === "date" ? "date" : "text"}
                      inputMode={fld.kind === "date" ? undefined : "decimal"}
                      className={clsx("h-10 w-full rounded-[12px] bg-surface-2 text-[14px] tabular-nums outline-none focus:ring-2 focus:ring-accent", fld.kind === "money" ? "pl-7 pr-3" : "px-3", ["percent", "months", "years", "days"].includes(fld.kind) && "pr-16")}
                      value={String(values[fld.id] ?? "")}
                      onChange={(e) => { setValues({ ...values, [fld.id]: fld.kind === "date" ? e.target.value : e.target.value.replace(/[^\d.,\-]/g, "") }); setSaved(false); }}
                    />
                    {fld.kind !== "money" && fld.kind !== "number" && fld.kind !== "date" && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12.5px] text-muted">{fld.kind === "percent" ? "%" : fld.kind}</span>}
                  </span>
                )}
                {fld.hint && <span className="text-[12px] text-muted">{fld.hint}</span>}
              </label>
            ))}
          </div>
        </div>

        {outcome.error ? (
          <div className="rounded-[18px] bg-warning/10 p-4 text-[14px] text-warning">{outcome.error}</div>
        ) : outcome.r && primary ? (
          <div className="rounded-[22px] bg-surface p-5 ring-1 ring-border">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13px] text-muted">{primary.label}</p>
                <p className="font-mono text-[34px] leading-tight font-semibold tracking-tight tabular-nums">{show(primary)}</p>
                {primary.kind === "money" && typeof primary.value === "number" && <p className="text-[12.5px] text-muted">{rupeesInWords(primary.value)}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ActionBtn onClick={saveIt} icon={saved ? <Check className="size-4" /> : <Save className="size-4" />}>{saved ? "Saved" : "Save"}</ActionBtn>
                <ActionBtn onClick={() => void copy(`${describe(f, outcome.r!)}\n\n${outcome.r!.steps.join("\n")}`, toast)} icon={<Copy className="size-4" />}>Copy</ActionBtn>
                {canShare && <ActionBtn onClick={() => share({ kind: "calculator", title: `${f.name}: ${show(primary)}`, sub: primary.label, module: "Calculator", fields: outcome.r!.results.slice(0, 6).map((o) => ({ label: o.label, value: show(o) })) })} icon={<MessagesSquare className="size-4" />}>Share</ActionBtn>}
              </div>
            </div>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {outcome.r.results.filter((o) => o !== primary).map((o) => (
                <div key={o.label} className="rounded-[14px] bg-surface-2 p-3">
                  <dt className="text-[12px] text-muted">{o.label}</dt>
                  <dd className="mt-0.5 font-mono text-[16px] font-medium tabular-nums">{show(o)}</dd>
                </div>
              ))}
            </dl>
            <details className="mt-4 rounded-[14px] bg-surface-2 p-3 text-[13px]" open>
              <summary className="cursor-pointer font-medium">How it&apos;s worked out</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">{outcome.r.steps.map((st) => <li key={st}>{st}</li>)}</ol>
            </details>
            {outcome.r.table && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between"><p className="text-[13px] font-medium">Schedule ({outcome.r.table.rows.length} rows)</p><ActionBtn onClick={downloadTable} icon={<Download className="size-4" />}>CSV</ActionBtn></div>
                <div className="max-h-[360px] overflow-auto rounded-[14px] ring-1 ring-border">
                  <table className="w-full text-[12.5px] tabular-nums">
                    <thead className="sticky top-0 bg-surface-2"><tr>{outcome.r.table.head.map((h) => <th key={h} className="px-3 py-2 text-right font-medium first:text-left">{h}</th>)}</tr></thead>
                    <tbody>{outcome.r.table.rows.map((row, i) => <tr key={i} className="border-t border-border">{row.map((c, j) => <td key={j} className="px-3 py-1.5 text-right font-mono first:text-left">{typeof c === "number" && outcome.r!.table!.money?.includes(j) ? fmtMoney(c, s) : String(c)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
});

function ActionBtn({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium ring-1 ring-border transition-colors hover:bg-surface-2">{icon}{children}</button>;
}
