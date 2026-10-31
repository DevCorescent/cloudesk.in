"use client";

// The calculator page: the calculator and the business formulas, with your
// history beside them (search, pin, note, open again, export).
import clsx from "clsx";
import { Calculator as CalcIcon, Download, History as HistoryIcon, Pencil, Pin, PinOff, Search, Sigma, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Button, Skeleton } from "@/components/ui/primitives";
import { formulaById } from "@/lib/calculator/formulas";
import { Calculator, type CalculatorHandle } from "./calculator";
import { Formulas, type FormulasHandle } from "./formulas";
import { useHistory, useHistoryActions, type Entry } from "./shared";

type Tab = "calc" | "formulas" | "history";

export function CalculatorApp() {
  const [tab, setTab] = useState<Tab>("calc");
  const calc = useRef<CalculatorHandle>(null);
  const formulas = useRef<FormulasHandle>(null);
  const open = (e: Entry) => {
    if (e.kind === "expr") {
      setTab("calc");
      requestAnimationFrame(() => calc.current?.load(e.input));
    } else {
      setTab("formulas");
      requestAnimationFrame(() => formulas.current?.open(e.input, e.values));
    }
  };
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Calculator</h1>
          <p className="text-[14px] text-muted">Quick sums, GST and business formulas — every answer kept in your history.</p>
        </div>
        <div role="tablist" aria-label="Calculator" className="inline-flex rounded-full bg-surface-2 p-1">
          {([["calc", "Calculator", CalcIcon], ["formulas", "Business formulas", Sigma], ["history", "History", HistoryIcon]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={clsx("inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-colors", tab === v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg", v === "history" && "lg:hidden")}>
              <Icon className="size-4" /> {v === "formulas" ? <><span className="sm:hidden">Formulas</span><span className="hidden sm:inline">{label}</span></> : label}
            </button>
          ))}
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className={clsx(tab === "history" && "hidden lg:block")}>
          {/* One calculator, kept mounted so its session survives switching tabs. */}
          <div className={clsx(tab === "formulas" && "hidden")}><div className="mx-auto max-w-[560px]"><Calculator ref={calc} /></div></div>
          <div className={clsx(tab !== "formulas" && "hidden")}><Formulas ref={formulas} /></div>
        </div>
        <div className={clsx(tab !== "history" && "hidden lg:block")}>
          <HistoryPanel onOpen={open} />
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({ onOpen }: { onOpen: (e: Entry) => void }) {
  const [q, setQ] = useState("");
  const [pinned, setPinned] = useState(false);
  const h = useHistory(q.trim(), pinned);
  const { update, remove, clear, csvUrl } = useHistoryActions();
  const [note, setNote] = useState<Entry | null>(null);
  const [ask, setAsk] = useState(false);
  const rows = h.data?.entries ?? [];
  return (
    <aside className="rounded-[22px] bg-surface p-4 ring-1 ring-border lg:sticky lg:top-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">History{h.data && <span className="ml-1.5 text-[12.5px] font-normal text-muted">{h.data.counts.total}</span>}</h2>
        <div className="flex gap-1">
          <a href={csvUrl} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg" aria-label="Download history as CSV" title="Download as CSV"><Download className="size-4" /></a>
          <button type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg" aria-label="Clear history" title="Clear history" onClick={() => setAsk(true)}><Trash2 className="size-4" /></button>
        </div>
      </div>
      <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" /><input aria-label="Search history" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search calculations and notes" className="h-9 w-full rounded-full bg-surface-2 pl-9 pr-3 text-[13.5px] outline-none focus:ring-2 focus:ring-accent" /></div>
      <div className="mt-2 flex gap-1.5">
        {[[false, "All"], [true, `Pinned${h.data?.counts.pinned ? ` · ${h.data.counts.pinned}` : ""}`]].map(([v, l]) => <button key={String(v)} type="button" onClick={() => setPinned(v as boolean)} className={clsx("rounded-full px-3 py-1 text-[12.5px] font-medium", pinned === v ? "bg-fg text-bg" : "bg-surface-2 text-muted hover:text-fg")}>{l as string}</button>)}
      </div>
      <ul className="mt-3 max-h-[calc(100vh-260px)] min-h-[200px] space-y-1.5 overflow-y-auto">
        {h.isLoading && <Skeleton className="h-40" />}
        {!h.isLoading && rows.length === 0 && <li className="px-2 py-8 text-center text-[13px] text-muted">{q || pinned ? "Nothing matches." : "Your calculations appear here. Press = or Enter to keep one."}</li>}
        {rows.map((e) => {
          const f = e.kind === "formula" ? formulaById(e.input) : null;
          return (
            <li key={e.id} className="group relative rounded-[14px] p-2.5 ring-1 ring-transparent transition-colors hover:bg-surface-2 hover:ring-border">
              <button type="button" className="w-full text-left" onClick={() => onOpen(e)} title="Open again">
                <p className="flex items-center gap-1.5 text-[12px] text-muted">
                  {e.kind === "formula" ? <Sigma className="size-3.5" /> : <CalcIcon className="size-3.5" />}
                  <span className="truncate">{f ? f.name : e.input}</span>{e.pinned && <Pin className="size-3 shrink-0 text-accent" aria-label="Pinned" />}
                  <span className="ml-auto shrink-0">{new Date(e.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </p>
                <p className="mt-0.5 truncate font-mono text-[15px] font-medium tabular-nums">{e.kind === "expr" ? `= ${e.result}` : e.result}</p>
                {e.note && <p className="mt-0.5 text-[12.5px] text-accent">{e.note}</p>}
              </button>
              <div className="mt-1 flex gap-1 transition-opacity lg:absolute lg:right-2 lg:bottom-1.5 lg:mt-0 lg:rounded-full lg:bg-surface lg:px-1 lg:opacity-0 lg:shadow-sm lg:ring-1 lg:ring-border lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                <SmallBtn label={e.pinned ? "Unpin" : "Pin"} onClick={() => update.mutate({ id: e.id, pinned: !e.pinned })}>{e.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</SmallBtn>
                <SmallBtn label="Add a note" onClick={() => setNote(e)}><Pencil className="size-3.5" /></SmallBtn>
                <SmallBtn label="Delete" onClick={() => remove.mutate(e.id)}><Trash2 className="size-3.5" /></SmallBtn>
                
              </div>
            </li>
          );
        })}
      </ul>
      {note && <NoteDialog entry={note} onClose={() => setNote(null)} onSave={(v) => { update.mutate({ id: note.id, note: v }); setNote(null); }} />}
      {ask && (
        <Dialog open onClose={() => setAsk(false)} size="sm" title="Clear your history?" description="Pinned calculations are kept unless you clear everything." footer={<><Button onClick={() => setAsk(false)}>Cancel</Button><Button onClick={() => { clear.mutate(true); setAsk(false); }}>Everything</Button><Button variant="primary" onClick={() => { clear.mutate(false); setAsk(false); }}>Keep pinned</Button></>} />
      )}
    </aside>
  );
}

function SmallBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-fg">{children}</button>;
}

function NoteDialog({ entry, onClose, onSave }: { entry: Entry; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(entry.note);
  return (
    <Dialog open onClose={onClose} size="sm" title="Note" description={entry.result} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(v.trim())}>Save</Button></>}>
      <input autoFocus aria-label="Note" value={v} maxLength={200} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSave(v.trim())} placeholder="e.g. Q3 rent split, quote for Mehta & Co" className="h-10 w-full rounded-[12px] bg-surface-2 px-3 text-[14px] outline-none focus:ring-2 focus:ring-accent" />
    </Dialog>
  );
}
