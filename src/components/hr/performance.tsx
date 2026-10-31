"use client";

// Performance (goals and review cycles) and company assets.
import { Laptop, Plus, Star, Target, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { ASSET_CATEGORIES } from "@/lib/hr/model";
import { Avatar, Empty, Section, fmt, fromPaise, inr, toPaise, useHr, useHrAction, useHrQuery } from "./shared";

type Goal = { id: string; employeeId: string; name: string; title: string; detail: string; progress: number; dueDate: string | null; status: string; weight: number };
type Review = { id: string; employeeId: string; name: string; designation: string; cycle: string; selfRating: number | null; selfNote: string; managerRating: number | null; managerNote: string; status: string; mine: boolean; canManage: boolean };
const GOAL_STATUS: Record<string, [string, string]> = { on_track: ["On track", "bg-success-soft text-success"], at_risk: ["At risk", "bg-warning-soft text-warning"], behind: ["Behind", "bg-danger-soft text-danger"], done: ["Done", "bg-accent-soft text-accent"] };

export function PerformanceView() {
  const [tab, setTab] = useState<"goals" | "reviews">("goals");
  return (
    <div>
      <PageHeader title="Performance" description="Goals with progress, and review cycles: a self review first, then the manager's." />
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[{ value: "goals", label: "Goals" }, { value: "reviews", label: "Reviews" }]} />
      {tab === "goals" ? <Goals /> : <Reviews />}
    </div>
  );
}

function Goals() {
  const { meta } = useHr();
  const q = useHrQuery<{ goals: Goal[] }>("goals");
  const [edit, setEdit] = useState<Partial<Goal> | null>(null);
  const canSet = meta.me.manage || meta.me.isManager;
  if (!q.data) return <Skeleton className="h-48 rounded-[20px]" />;
  const byPerson = [...new Map(q.data.goals.map((g) => [g.employeeId, g.name])).entries()];
  return (
    <div>
      {canSet && (
        <Button size="sm" variant="primary" className="mb-4" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>
          Set a goal
        </Button>
      )}
      {!byPerson.length ? (
        <EmptyState icon={<Target />} title="No goals yet" description={canSet ? "Set goals for your team — they update progress as they go." : "Your manager sets your goals here."} />
      ) : (
        <div className="grid gap-4">
          {byPerson.map(([id, name]) => {
            const mine = q.data!.goals.filter((g) => g.employeeId === id);
            const avg = Math.round(mine.reduce((a, g) => a + g.progress * g.weight, 0) / Math.max(1, mine.reduce((a, g) => a + g.weight, 0)));
            return (
              <Section key={id} title={<span className="flex items-center gap-2"><Avatar name={name} size={24} />{name}<span className="text-[12px] font-normal text-muted">· {avg}% overall</span></span>}>
                <ul className="grid gap-2">
                  {mine.map((g) => {
                    const [label, tone] = GOAL_STATUS[g.status] ?? ["", ""];
                    return (
                      <li key={g.id}>
                        <button type="button" onClick={() => setEdit(g)} className="w-full rounded-[14px] border border-border px-3 py-2.5 text-left hover:bg-surface-2">
                          <p className="flex items-center justify-between gap-2">
                            <b className="text-[13.5px] font-medium">{g.title}</b>
                            <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>{label}</span>
                          </p>
                          <div className="mt-2 flex items-center gap-3">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                              <span className="block h-full rounded-full bg-[var(--chart)]" style={{ width: `${g.progress}%` }} />
                            </span>
                            <span className="text-[12px] tabular-nums">{g.progress}%</span>
                            {g.dueDate && <span className="text-[12px] text-muted">by {fmt(g.dueDate, { day: "numeric", month: "short" })}</span>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            );
          })}
        </div>
      )}
      {edit && <GoalDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function GoalDialog({ init, onClose }: { init: Partial<Goal>; onClose: () => void }) {
  const { meta } = useHr();
  const canSet = meta.me.manage || meta.me.reports.includes(init.employeeId ?? "") || (!init.id && meta.me.isManager);
  const people = meta.people.filter((p) => p.status !== "exited" && (meta.me.manage || meta.me.reports.includes(p.id)));
  const [f, setF] = useState({ employeeId: init.employeeId ?? people[0]?.id ?? "", title: init.title ?? "", detail: init.detail ?? "", progress: init.progress ?? 0, dueDate: init.dueDate ?? "", status: init.status ?? "on_track", weight: init.weight ?? 1 });
  const save = useHrAction(() => ({ path: init.id ? `goals/${init.id}` : "goals", method: init.id ? "PUT" : "POST", body: { ...f, dueDate: f.dueDate || null } }), { success: "Saved", onDone: onClose });
  const del = useHrAction(() => ({ path: `goals/${init.id}`, method: "DELETE" }), { success: "Removed", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? init.title! : "Set a goal"}
      footer={
        <>
          {init.id && canSet && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => del.mutate()}>Remove</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.title.trim() || !f.employeeId} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!init.id && (
          <Field label="For">
            {(a) => (
              <Select {...a} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Goal">{(a) => <Input {...a} value={f.title} disabled={!!init.id && !canSet} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} placeholder="Close ₹50L in new business this quarter" />}</Field>
        <Field label="Details">{(a) => <Textarea {...a} rows={2} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} maxLength={2000} />}</Field>
        <Field label={`Progress · ${f.progress}%`}>{(a) => <input {...a} type="range" min={0} max={100} step={5} value={f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} className="w-full accent-[var(--chart)]" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            {(a) => (
              <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {Object.entries(GOAL_STATUS).map(([k, [l]]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Due">{(a) => <Input {...a} type="date" value={f.dueDate ?? ""} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

function Reviews() {
  const { meta } = useHr();
  const [cycle, setCycle] = useState("");
  const q = useHrQuery<{ cycles: string[]; reviews: Review[] }>(`reviews${cycle ? `?cycle=${encodeURIComponent(cycle)}` : ""}`);
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<Review | null>(null);
  if (!q.data) return <Skeleton className="h-48 rounded-[20px]" />;
  const list = q.data.reviews;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {q.data.cycles.length > 0 && (
          <Select aria-label="Cycle" value={cycle} onChange={(e) => setCycle(e.target.value)} className="!w-auto">
            <option value="">All cycles</option>
            {q.data.cycles.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        )}
        {meta.me.manage && (
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setStarting(true)}>
            Start a review cycle
          </Button>
        )}
      </div>
      {!list.length ? (
        <Empty>No reviews yet.{meta.me.manage ? " Start a cycle — everyone gets a self review, then their manager's." : ""}</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 shadow-sm">
          {list.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r)} className="flex w-full flex-wrap items-center gap-3 py-3 text-left">
                <Avatar name={r.name} size={32} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[13.5px]">{r.name}</b>
                  <span className="text-[12.5px] text-muted">
                    {r.cycle} · {r.designation || "—"}
                  </span>
                </span>
                <Stars n={r.selfRating} label="Self" />
                <Stars n={r.managerRating} label="Manager" />
                <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.status === "done" ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>{r.status === "self" ? "Waiting on self review" : r.status === "manager" ? "Waiting on manager" : "Done"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {starting && <StartCycle onClose={() => setStarting(false)} />}
      {open && <ReviewDialog r={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Stars({ n, label }: { n: number | null; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[11.5px] text-muted" title={`${label}: ${n ?? "—"}`}>
      {label}
      <span className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cx("size-3", n && i <= n ? "fill-[#f59e0b] text-[#f59e0b]" : "text-border")} />
        ))}
      </span>
    </span>
  );
}

function StartCycle({ onClose }: { onClose: () => void }) {
  const y = new Date().getFullYear();
  const [name, setName] = useState(`${y} ${new Date().getMonth() < 6 ? "H1" : "H2"}`);
  const save = useHrAction<void, { started: number }>(() => ({ path: "reviews", body: { cycle: name } }), { success: (r) => `Started for ${r.started} people`, onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="sm" title="Start a review cycle" description="Everyone active gets a review: their own first, then their manager's." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Start</Button></>}>
      <Input aria-label="Cycle name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
    </Dialog>
  );
}

function ReviewDialog({ r, onClose }: { r: Review; onClose: () => void }) {
  const myTurn = (r.mine && r.status === "self") || (r.canManage && r.status === "manager");
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const save = useHrAction(() => ({ path: `reviews/${r.id}/submit`, body: { rating, note } }), { success: "Review submitted", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={`${r.name} · ${r.cycle}`} footer={myTurn ? <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!rating} onClick={() => save.mutate()}>Submit</Button></> : <Button onClick={onClose}>Close</Button>}>
      <div className="grid gap-4">
        {r.selfRating !== null && (
          <div className="rounded-[14px] bg-surface-2 p-3">
            <p className="mb-1 flex items-center justify-between text-[12.5px] font-semibold">
              Self review <Stars n={r.selfRating} label="" />
            </p>
            <p className="text-[13.5px] whitespace-pre-wrap">{r.selfNote || "—"}</p>
          </div>
        )}
        {r.managerRating !== null && (
          <div className="rounded-[14px] bg-surface-2 p-3">
            <p className="mb-1 flex items-center justify-between text-[12.5px] font-semibold">
              Manager review <Stars n={r.managerRating} label="" />
            </p>
            <p className="text-[13.5px] whitespace-pre-wrap">{r.managerNote || "—"}</p>
          </div>
        )}
        {myTurn ? (
          <>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">{r.mine ? "How did the period go for you?" : "Your rating"}</p>
              <span className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-label={`${n} of 5`} onClick={() => setRating(n)}>
                    <Star className={cx("size-6", n <= rating ? "fill-[#f59e0b] text-[#f59e0b]" : "text-border")} />
                  </button>
                ))}
              </span>
            </div>
            <Textarea aria-label="Notes" rows={5} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} placeholder={r.mine ? "What went well, what you'd do differently, what you need…" : "Strengths, areas to grow, what's next…"} />
          </>
        ) : (
          r.status !== "done" && <p className="text-[13px] text-muted">{r.status === "self" ? "Waiting for their self review." : "Waiting for the manager's review."}</p>
        )}
      </div>
    </Dialog>
  );
}

// ─── Assets ───

type Asset = { id: string; name: string; tag: string; serial: string; category: string; value: number; employeeId: string | null; holder: string; assignedAt: string | null; status: string; notes: string };

export function AssetsView() {
  const { meta } = useHr();
  const q = useHrQuery<{ assets: Asset[] }>("assets");
  const [edit, setEdit] = useState<Partial<Asset> | null>(null);
  const [giving, setGiving] = useState<Asset | null>(null);
  const back = useHrAction<string>((id) => ({ path: `assets/${id}/assign`, body: { employeeId: null } }), { success: "Returned" });
  const list = q.data?.assets ?? [];
  return (
    <div>
      <PageHeader title="Assets" description={q.data ? `${list.length} items · ${list.filter((a) => a.employeeId).length} with people · ${inr(list.reduce((a, x) => a + x.value, 0))} in all` : "Laptops, phones, ID cards and more — and who has them."} actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>Asset</Button>} />
      {!q.data ? (
        <Skeleton className="h-48 rounded-[20px]" />
      ) : !list.length ? (
        <EmptyState icon={<Laptop />} title="No assets yet" description="Add laptops, phones and ID cards so you know who has what — and get them back when someone leaves." />
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium">Tag / serial</th>
                <th className="px-4 py-2.5 font-medium">With</th>
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => setEdit(a)} className="text-left hover:underline">
                      <b className="font-medium">{a.name}</b>
                      <span className="block text-[12px] text-muted capitalize">{a.category.replace("_", " ")}</span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{[a.tag, a.serial].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-2.5">{a.holder ? <span>{a.holder}<span className="block text-[11.5px] text-subtle">since {fmt(a.assignedAt?.slice(0, 10))}</span></span> : <span className="text-muted capitalize">{a.status}</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(a.value)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {a.employeeId ? (
                      <Button size="sm" variant="ghost" icon={<UserMinus className="size-3.5" />} onClick={() => back.mutate(a.id)}>
                        Take back
                      </Button>
                    ) : (
                      a.status === "available" && (
                        <Button size="sm" variant="ghost" icon={<UserPlus className="size-3.5" />} onClick={() => setGiving(a)}>
                          Give
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <AssetDialog init={edit} onClose={() => setEdit(null)} />}
      {giving && <GiveDialog a={giving} people={meta.people.filter((p) => p.status !== "exited")} onClose={() => setGiving(null)} />}
    </div>
  );
}

function AssetDialog({ init, onClose }: { init: Partial<Asset>; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", tag: init.tag ?? "", serial: init.serial ?? "", category: init.category ?? "laptop", value: fromPaise(init.value ?? 0), notes: init.notes ?? "", status: init.status ?? "available" });
  const save = useHrAction(() => ({ path: init.id ? `assets/${init.id}` : "assets", method: init.id ? "PUT" : "POST", body: { ...f, value: toPaise(f.value), status: init.employeeId ? "assigned" : f.status } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={init.id ? init.name! : "Add an asset"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="MacBook Air 13″ M3" maxLength={120} autoFocus />}</Field>
        <Field label="Kind">
          {(a) => (
            <Select {...a} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {ASSET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1).replace("_", " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Value (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>
        <Field label="Asset tag">{(a) => <Input {...a} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="LAP-014" />}</Field>
        <Field label="Serial number">{(a) => <Input {...a} value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} />}</Field>
        {!init.employeeId && (
          <Field label="Status">
            {(a) => (
              <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="available">Available</option>
                <option value="repair">In repair</option>
                <option value="retired">Retired</option>
              </Select>
            )}
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} />}</Field>
      </div>
    </Dialog>
  );
}

function GiveDialog({ a, people, onClose }: { a: Asset; people: { id: string; name: string }[]; onClose: () => void }) {
  const [id, setId] = useState("");
  const save = useHrAction(() => ({ path: `assets/${a.id}/assign`, body: { employeeId: id } }), { success: "Given — it's on their profile", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="sm" title={`Give ${a.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!id} onClick={() => save.mutate()}>Give</Button></>}>
      <Select aria-label="Person" value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">Choose…</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </Dialog>
  );
}
