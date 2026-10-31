"use client";

// Till & cash: open a session with a float, record cash paid in and out, and
// close it by counting the drawer — the Z report shows takings by method, the
// expected cash and the difference. Past sessions stay listed.
import { ArrowDownLeft, ArrowUpRight, LockKeyhole, Printer, Wallet } from "lucide-react";
import { useState } from "react";
import { Dialog, Segmented } from "@/components/ui/overlays";
import { Badge, Button, cx, EmptyState, Field, Input, PageHeader, Skeleton } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/store/money";
import { METHOD_LABEL } from "./bill";
import { Stat, toMinor, useH, useHAction, useHQuery, useMoney, type Venue } from "./shared";

type Report = {
  shift: { id: string; status: string; openedBy: string; openedAt: string; openingFloat: number; closedAt: string | null; closedBy: string; note: string };
  methods: Record<string, number>;
  takings: number;
  bills: number;
  payIn: number;
  payOut: number;
  moves: { id: string; kind: string; amount: number; reason: string; staffName: string; createdAt: string }[];
  voids: { count: number; amount: number };
  discounts: { count: number; amount: number };
  comps: { count: number; amount: number };
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
};

export function TillView() {
  const { venue } = useH();
  const money = useMoney();
  const cur = useHQuery<{ shift: Report | null }>("shift", { refetchInterval: 15000 });
  const history = useHQuery<{ shifts: { id: string; status: string; openedAt: string; closedAt: string | null; openedBy: string; closedBy: string; expectedCash: number | null; countedCash: number | null; variance: number | null }[] }>("shifts");
  const [opening, setOpening] = useState(false);
  const [moving, setMoving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [view, setView] = useState<string | null>(null);
  if (!cur.data) return <Skeleton className="h-[60vh] rounded-[22px]" />;
  const r = cur.data.shift;
  return (
    <div>
      <PageHeader
        title="Till & cash"
        description={venue.settings.pos.requireShift ? "Cash can only be taken while a till session is open." : "Open a session with the float in the drawer; close it by counting the cash."}
        actions={
          r ? (
            <>
              <Button size="sm" icon={<Wallet className="size-4" />} onClick={() => setMoving(true)}>
                Cash in / out
              </Button>
              <Button size="sm" variant="primary" icon={<LockKeyhole className="size-4" />} onClick={() => setClosing(true)}>
                Close the till
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={() => setOpening(true)}>
              Open the till
            </Button>
          )
        }
      />
      {!r ? (
        <EmptyState icon={<Wallet />} title="The till is closed" description="Open a session with the cash float in the drawer. Payments taken while it's open are counted in its report." action={<Button variant="primary" onClick={() => setOpening(true)}>Open the till</Button>} />
      ) : (
        <ReportBody r={r} live />
      )}
      <h2 className="mt-8 mb-3 text-[15px] font-semibold">Past sessions</h2>
      {!history.data?.shifts.filter((s) => s.status === "closed").length ? (
        <p className="text-[13px] text-muted">Closed sessions show here.</p>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm">
          <ul className="divide-y divide-border">
            {history.data.shifts
              .filter((s) => s.status === "closed")
              .map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setView(s.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-[13.5px] hover:bg-surface-2">
                    <span className="flex-1">
                      <b>{new Date(s.openedAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</b>
                      <span className="text-muted"> → {s.closedAt ? new Date(s.closedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""}</span>
                      <span className="block text-[12px] text-muted">{[s.openedBy, s.closedBy].filter(Boolean).join(" → ") || "—"}</span>
                    </span>
                    <span className="tabular-nums">counted {money(s.countedCash ?? 0)}</span>
                    {s.variance !== null && <Badge tone={s.variance === 0 ? "success" : s.variance < 0 ? "danger" : "warning"}>{s.variance === 0 ? "Exact" : `${s.variance < 0 ? "Short" : "Over"} ${money(Math.abs(s.variance))}`}</Badge>}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
      {opening && <OpenDialog onClose={() => setOpening(false)} />}
      {moving && <MoveDialog onClose={() => setMoving(false)} />}
      {closing && r && <CloseDialog r={r} onClose={() => setClosing(false)} />}
      {view && <PastDialog id={view} onClose={() => setView(null)} />}
    </div>
  );
}

function ReportBody({ r, live }: { r: Report; live?: boolean }) {
  const { venue } = useH();
  const money = useMoney();
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Taken this session" value={money(r.takings)} sub={`${r.bills} bills settled`} />
        <Stat label="Cash expected" value={money(r.expectedCash)} sub={`float ${money(r.shift.openingFloat)}`} />
        <Stat label="Cash in / out" value={`${money(r.payIn)} / ${money(r.payOut)}`} />
        {live ? <Stat label="Open since" value={new Date(r.shift.openedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} sub={r.shift.openedBy ? `by ${r.shift.openedBy}` : undefined} /> : <Stat label="Difference" value={r.variance === null ? "—" : `${r.variance < 0 ? "−" : r.variance > 0 ? "+" : ""}${money(Math.abs(r.variance))}`} tone={r.variance && r.variance < 0 ? "warn" : r.variance === 0 ? "good" : undefined} sub={r.countedCash !== null ? `counted ${money(r.countedCash)}` : undefined} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[20px] border border-border bg-surface p-4 shadow-sm">
          <h3 className="mb-2 text-[14px] font-semibold">By payment method</h3>
          {!Object.keys(r.methods).length ? (
            <p className="text-[13px] text-muted">No payments yet.</p>
          ) : (
            <ul className="grid gap-1.5 text-[13.5px]">
              {Object.entries(r.methods).map(([m, v]) => (
                <li key={m} className="flex justify-between">
                  <span>{METHOD_LABEL[m] ?? m}</span>
                  <b className="tabular-nums">{money(v)}</b>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-1 border-t border-border pt-3 text-[12.5px] text-muted">
            <p>
              {r.voids.count} cancelled ({money(r.voids.amount)}) · {r.discounts.count} discounts ({money(r.discounts.amount)}) · {r.comps.count} on the house ({money(r.comps.amount)})
            </p>
          </div>
        </section>
        <section className="rounded-[20px] border border-border bg-surface p-4 shadow-sm">
          <h3 className="mb-2 text-[14px] font-semibold">Cash in and out</h3>
          {!r.moves.length ? (
            <p className="text-[13px] text-muted">Nothing paid in or out.</p>
          ) : (
            <ul className="grid gap-1.5 text-[13.5px]">
              {r.moves.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  {m.kind === "pay_in" ? <ArrowDownLeft className="size-4 text-success" /> : <ArrowUpRight className="size-4 text-danger" />}
                  <span className="flex-1 truncate">
                    {m.reason}
                    {m.staffName && <span className="text-muted"> · {m.staffName}</span>}
                  </span>
                  <b className={cx("tabular-nums", m.kind === "pay_out" && "text-danger")}>
                    {m.kind === "pay_out" ? "−" : "+"}
                    {money(m.amount)}
                  </b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {!live && (
        <Button className="justify-self-start" icon={<Printer className="size-4" />} onClick={() => printZ(venue, r)}>
          Print Z report
        </Button>
      )}
    </div>
  );
}

function printZ(venue: Venue, r: Report) {
  const money = (n: number) => formatPrice(n, venue.currency);
  const w = window.open("", "_blank", "width=420,height=760");
  if (!w) return;
  const row = (k: string, v: string, b = false) => `<tr${b ? ' style="font-weight:700"' : ""}><td>${k}</td><td style="text-align:right">${v}</td></tr>`;
  w.document.write(`<!doctype html><title>Z report</title><style>body{font:13px/1.5 ui-monospace,Menlo,monospace;width:72mm;margin:0 auto;padding:10px}h1{font-size:16px;text-align:center;margin:0}p{text-align:center;margin:2px 0}table{width:100%;border-collapse:collapse}hr{border:0;border-top:1px dashed #000}</style><h1>${venue.name}</h1><p>Z REPORT</p><p>${new Date(r.shift.openedAt).toLocaleString("en-IN")} → ${r.shift.closedAt ? new Date(r.shift.closedAt).toLocaleString("en-IN") : ""}</p><hr><table>${Object.entries(r.methods).map(([m, v]) => row(METHOD_LABEL[m] ?? m, money(v))).join("")}${row("Takings", money(r.takings), true)}${row("Bills", String(r.bills))}</table><hr><table>${row("Opening float", money(r.shift.openingFloat))}${row("Cash sales", money(r.methods.cash ?? 0))}${row("Paid in", money(r.payIn))}${row("Paid out", `−${money(r.payOut)}`)}${row("Expected cash", money(r.expectedCash), true)}${row("Counted", money(r.countedCash ?? 0))}${row("Difference", r.variance === null ? "—" : money(r.variance), true)}</table><hr><table>${row("Cancelled", `${r.voids.count} · ${money(r.voids.amount)}`)}${row("Discounts", `${r.discounts.count} · ${money(r.discounts.amount)}`)}${row("On the house", `${r.comps.count} · ${money(r.comps.amount)}`)}</table>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

function OpenDialog({ onClose }: { onClose: () => void }) {
  const [float, setFloat] = useState("");
  const open = useHAction<void>(() => ({ path: "shift/open", body: { openingFloat: toMinor(float) } }), { success: "Till open", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Open the till"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={open.isPending} onClick={() => open.mutate()}>
            Open
          </Button>
        </>
      }
    >
      <Field label="Cash float in the drawer">{(a) => <Input {...a} inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="2000" autoFocus />}</Field>
    </Dialog>
  );
}

function MoveDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<"pay_in" | "pay_out">("pay_out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const move = useHAction<void>(() => ({ path: "shift/cash", body: { kind, amount: toMinor(amount), reason } }), { success: kind === "pay_in" ? "Cash added" : "Cash paid out", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Cash in or out"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={move.isPending} disabled={toMinor(amount) <= 0 || !reason.trim()} onClick={() => move.mutate()}>
            Record
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: "pay_out", label: "Paid out" }, { value: "pay_in", label: "Paid in" }]} />
        <Field label="Amount">{(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
        <Field label="Reason" hint={kind === "pay_out" ? "Paying out may need a manager's PIN." : undefined}>{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={kind === "pay_out" ? "Vegetables from the market" : "Change from the bank"} />}</Field>
      </div>
    </Dialog>
  );
}

const NOTES = [50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100];

function CloseDialog({ r, onClose }: { r: Report; onClose: () => void }) {
  const money = useMoney();
  const [mode, setMode] = useState<"total" | "notes">("total");
  const [total, setTotal] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const counted = mode === "total" ? toMinor(total) : NOTES.reduce((a, n) => a + n * (Number(notes[n]) || 0), 0);
  const diff = counted - r.expectedCash;
  const close = useHAction<void>(() => ({ path: "shift/close", body: { countedCash: counted, note } }), { success: "Till closed", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Close the till"
      description={`Expected in the drawer: ${money(r.expectedCash)}`}
      footer={
        <>
          <span className={cx("mr-auto text-[13.5px] font-semibold tabular-nums", diff < 0 ? "text-danger" : diff > 0 ? "text-warning" : "text-success")}>{counted ? (diff === 0 ? "Exact" : `${diff < 0 ? "Short" : "Over"} ${money(Math.abs(diff))}`) : ""}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={close.isPending} onClick={() => close.mutate()}>
            Close · counted {money(counted)}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Segmented label="Count by" value={mode} onChange={setMode} options={[{ value: "total", label: "Total" }, { value: "notes", label: "Notes & coins" }]} />
        {mode === "total" ? (
          <Field label="Cash counted">{(a) => <Input {...a} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} autoFocus />}</Field>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {NOTES.map((n) => (
              <Field key={n} label={`${money(n)} ×`}>{(a) => <Input {...a} inputMode="numeric" value={notes[n] ?? ""} onChange={(e) => setNotes({ ...notes, [n]: e.target.value })} />}</Field>
            ))}
          </div>
        )}
        <Field label="Note">{(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}</Field>
      </div>
    </Dialog>
  );
}

function PastDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useHQuery<Report>(`shifts/${id}`);
  return (
    <Dialog open onClose={onClose} size="xl" title="Till session">
      {q.data ? <ReportBody r={q.data} /> : <Skeleton className="h-64" />}
    </Dialog>
  );
}
