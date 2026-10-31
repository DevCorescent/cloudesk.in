"use client";

// Deals: the board (drag between stages; Lost asks why), a list, and the deal
// page with its stage path, people and timeline.
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ArrowLeft, Briefcase, Check, Columns3, Flame, FolderKanban, List, MoreHorizontal, Pencil, Plus, Trash2, Trophy, X, ClipboardList } from "lucide-react";
import Link from "next/link";
import { useState, type DragEvent, type ReactNode } from "react";
import { ConfirmDialog, Dialog, Menu, Segmented } from "@/components/ui/overlays";
import { Button, ButtonLink, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { useSession } from "@/components/shell/session-context";
import { visibleTo } from "@/lib/workspace/modules";
import { errorMessage } from "@/lib/client/api";
import { DealDialog } from "./dialogs";
import { Avatar, Section, Tag, ago, customText, dateLabel, ownerName, useCrm, useCrmAction, useCrmQuery, useMoney, useShortMoney, type Activity, type Deal, type Stage } from "./shared";
import { Composer, Timeline } from "./timeline";
import { LinkedDocuments } from "@/components/documents/linked";

type Board = { pipeline: { id: string; name: string }; pipelines: { id: string; name: string }[]; columns: { stage: Stage; deals: Deal[]; total: number; weighted: number }[]; totals: { open: number; value: number; weighted: number } };

export function DealsView() {
  const { meta, orgId, go } = useCrm();
  const short = useShortMoney();
  const [pipelineId, setPipeline] = useState(meta.pipelines[0]?.id ?? "");
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"board" | "list">("board");
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({ pipelineId, ...(owner ? { owner } : {}), ...(q ? { q } : {}) }).toString();
  const board = useCrmQuery<Board>(mode === "board" ? `deals/board?${params}` : null, { keepPrevious: true });
  return (
    <div>
      <PageHeader
        title="Deals"
        description={board.data ? `${board.data.totals.open} open · ${short(board.data.totals.value)} in the pipeline · ${short(board.data.totals.weighted)} weighted` : "Every opportunity, stage by stage."}
        actions={
          <div className="flex flex-wrap gap-2">
            <Segmented
              label="View"
              value={mode}
              onChange={setMode}
              options={[
                { value: "board", label: <Columns3 className="size-4" />, title: "Board" },
                { value: "list", label: <List className="size-4" />, title: "List" },
              ]}
            />
            <a href={`/api/v1/orgs/${orgId}/crm/deals/export`} className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
              Export
            </a>
            {meta.me.write && (
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Deal
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {meta.pipelines.length > 1 && (
          <Select aria-label="Pipeline" value={pipelineId} onChange={(e) => setPipeline(e.target.value)} className="!w-auto">
            {meta.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="!w-auto">
          <option value="">Everyone&apos;s deals</option>
          <option value="me">My deals</option>
          {meta.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Input aria-label="Find a deal" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a deal" className="!w-56" />
      </div>
      {mode === "list" ? (
        <DealList pipelineId={pipelineId} owner={owner} q={q} />
      ) : board.isError ? (
        <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />
      ) : !board.data ? (
        <Skeleton className="h-[60vh] rounded-[20px]" />
      ) : (
        <BoardView data={board.data} queryPath={`deals/board?${params}`} onNew={() => setAdding(true)} />
      )}
      {adding && <DealDialog init={{ pipelineId }} onClose={() => setAdding(false)} onSaved={(d) => go(`deals/${d.id}`)} />}
    </div>
  );
}

function BoardView({ data, queryPath, onNew }: { data: Board; queryPath: string; onNew: () => void }) {
  const { meta, orgId } = useCrm();
  const short = useShortMoney();
  const qc = useQueryClient();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ stage: string; before: string | null } | null>(null);
  const [losing, setLosing] = useState<{ id: string; stageId: string } | null>(null);
  const move = useCrmAction<{ id: string; stageId: string; beforeId?: string | null; lostReason?: string }>((b) => ({ path: `deals/${b.id}/move`, body: b }), {
    onDone: () => setLosing(null),
  });
  const key = ["crm", orgId, queryPath];
  /** Moves the card on screen straight away; the server's answer replaces it. */
  const optimistic = (id: string, stageId: string, beforeId: string | null) => {
    qc.setQueryData<Board>(key, (b) => {
      if (!b) return b;
      const deal = b.columns.flatMap((c) => c.deals).find((d) => d.id === id);
      if (!deal) return b;
      const cols = b.columns.map((c) => ({ ...c, deals: c.deals.filter((d) => d.id !== id) }));
      const to = cols.find((c) => c.stage.id === stageId)!;
      const at = beforeId ? to.deals.findIndex((d) => d.id === beforeId) : -1;
      const moved = { ...deal, stageId, status: to.stage.kind === "open" ? ("open" as const) : to.stage.kind, daysInStage: deal.stageId === stageId ? deal.daysInStage : 0, rotting: deal.stageId === stageId ? deal.rotting : false };
      to.deals.splice(at < 0 ? to.deals.length : at, 0, moved);
      return { ...b, columns: cols.map((c) => ({ ...c, total: c.deals.reduce((a, d) => a + d.value, 0), weighted: Math.round((c.deals.reduce((a, d) => a + d.value, 0) * c.stage.probability) / 100) })) };
    });
  };
  const drop = (stage: Stage, before: string | null) => {
    const id = drag;
    setDrag(null);
    setOver(null);
    if (!id) return;
    const from = data.columns.find((c) => c.deals.some((d) => d.id === id));
    if (from?.stage.id === stage.id && !before) return;
    if (stage.kind === "lost") return setLosing({ id, stageId: stage.id });
    optimistic(id, stage.id, before);
    move.mutate({ id, stageId: stage.id, beforeId: before });
  };
  if (!data.columns.some((c) => c.deals.length))
    return <EmptyState icon={<Briefcase />} title="No deals here yet" description="A deal is something you hope to sell — a project, an order, a contract. Add one and drag it across as it moves along." action={meta.me.write ? <Button size="sm" variant="primary" onClick={onNew}>Add a deal</Button> : undefined} />;
  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-0 sm:px-0">
        <div className="flex min-w-max gap-3">
          {data.columns.map((col) => {
            const closed = col.stage.kind !== "open";
            const hot = over?.stage === col.stage.id;
            return (
              <section
                key={col.stage.id}
                aria-label={col.stage.name}
                onDragOver={(e: DragEvent) => {
                  if (!drag || !meta.me.write) return;
                  e.preventDefault();
                  if (over?.stage !== col.stage.id) setOver({ stage: col.stage.id, before: null });
                }}
                onDrop={(e) => (e.preventDefault(), drop(col.stage, over?.stage === col.stage.id ? over.before : null))}
                className={cx("flex w-[256px] shrink-0 flex-col rounded-[20px] p-2 transition-colors", closed ? (col.stage.kind === "won" ? "bg-success-soft/50" : "bg-danger-soft/40") : "bg-surface-2/70", hot && "ring-2 ring-accent/50")}
              >
                <header className="px-2 pt-1 pb-2">
                  <p className="flex items-center justify-between text-[13px] font-semibold">
                    <span className="flex items-center gap-1.5">
                      {col.stage.kind === "won" && <Trophy className="size-3.5 text-success" />}
                      {col.stage.kind === "lost" && <X className="size-3.5 text-danger" />}
                      {col.stage.name}
                    </span>
                    <span className="rounded-full bg-surface px-2 text-[11.5px] tabular-nums text-muted">{col.deals.length}</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted tabular-nums">
                    {short(col.total)}
                    {!closed && col.stage.probability < 100 && col.total > 0 && <span className="text-subtle"> · {short(col.weighted)} at {col.stage.probability}%</span>}
                    {closed && <span className="text-subtle"> · last 30 days</span>}
                  </p>
                </header>
                <ol className="grid min-h-[80px] gap-2">
                  {col.deals.map((d) => (
                    <li
                      key={d.id}
                      draggable={meta.me.write}
                      onDragStart={(e) => {
                        setDrag(d.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", d.id);
                      }}
                      onDragEnd={() => (setDrag(null), setOver(null))}
                      onDragOver={(e) => {
                        if (!drag || drag === d.id) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (over?.before !== d.id) setOver({ stage: col.stage.id, before: d.id });
                      }}
                      onDrop={(e) => (e.preventDefault(), e.stopPropagation(), drop(col.stage, d.id))}
                      className={cx("relative", drag === d.id && "opacity-40")}
                    >
                      {over?.before === d.id && <span aria-hidden className="absolute -top-1.5 right-2 left-2 h-0.5 rounded-full bg-accent" />}
                      <DealCard d={d} stages={data.columns.map((c) => c.stage)} onMove={(stageId) => (data.columns.find((c) => c.stage.id === stageId)?.stage.kind === "lost" ? setLosing({ id: d.id, stageId }) : (optimistic(d.id, stageId, null), move.mutate({ id: d.id, stageId })))} />
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
      {losing && <LostDialog busy={move.isPending} onClose={() => setLosing(null)} onConfirm={(reason) => move.mutate({ id: losing.id, stageId: losing.stageId, lostReason: reason })} />}
    </>
  );
}

function DealCard({ d, stages, onMove }: { d: Deal; stages: Stage[]; onMove: (stageId: string) => void }) {
  const { meta } = useCrm();
  const short = useShortMoney();
  const overdue = d.nextTask && new Date(d.nextTask) < new Date();
  return (
    <div className="group rounded-[14px] border border-border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-1.5">
        <Link href={`/crm/deals/${d.id}`} className="min-w-0 flex-1 text-[13.5px] leading-snug font-semibold hover:underline">
          {d.priority === "high" && <Flame className="mr-1 inline size-3.5 text-[#ea580c]" aria-label="High priority" />}
          {d.title}
        </Link>
        {meta.me.write && (
          <Menu
            label={`Move ${d.title}`}
            trigger={(p) => (
              <button {...p} type="button" aria-label="Move to stage" className="-mt-0.5 -mr-1 grid size-6 place-items-center rounded-full text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 focus:opacity-100">
                <MoreHorizontal className="size-4" />
              </button>
            )}
            items={stages.filter((s) => s.id !== d.stageId).map((s) => ({ label: `Move to ${s.name}`, onSelect: () => onMove(s.id) }))}
          />
        )}
      </div>
      {(d.contact || d.company) && <p className="mt-0.5 truncate text-[12px] text-muted">{[d.contact, d.company].filter(Boolean).join(" · ")}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <b className="text-[13px] tabular-nums">{short(d.value)}</b>
        {d.expectedClose && d.status === "open" && <span className={cx("text-[11.5px]", new Date(d.expectedClose) < new Date() ? "font-semibold text-danger" : "text-subtle")}>{dateLabel(d.expectedClose)}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {d.rotting && (
            <span title={`${d.daysInStage} days in this stage`} className="inline-flex items-center gap-0.5 rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning">
              <AlarmClock className="size-3" />
              {d.daysInStage}d
            </span>
          )}
          {d.nextTask && <span title={`Next task ${dateLabel(d.nextTask)}`} className={cx("size-2 rounded-full", overdue ? "bg-danger" : "bg-success")} />}
          <Avatar name={ownerName(meta, d.ownerId)} size={20} />
        </span>
      </div>
    </div>
  );
}

export function LostDialog({ onClose, onConfirm, busy }: { onClose: () => void; onConfirm: (reason: string) => void; busy?: boolean }) {
  const { meta } = useCrm();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onClose={onClose} size="sm" title="Why was it lost?" description="It helps you see patterns in Reports." footer={<><Button onClick={onClose}>Back</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>Mark as lost</Button></>}>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {meta.settings.settings.lostReasons.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} className={cx("h-8 rounded-full border px-3 text-[12.5px] font-medium", reason === r ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
              {r}
            </button>
          ))}
        </div>
        <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" maxLength={120} />
      </div>
    </Dialog>
  );
}

function DealList({ pipelineId, owner, q }: { pipelineId: string; owner: string; q: string }) {
  const { go } = useCrm();
  const money = useMoney();
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ pipelineId, status, page: String(page), ...(owner ? { owner } : {}), ...(q ? { q } : {}) }).toString();
  const list = useCrmQuery<{ total: number; deals: (Deal & { probability: number })[] }>(`deals?${params}`, { keepPrevious: true });
  const { meta } = useCrm();
  return (
    <div>
      <div className="mb-3 flex gap-1">
        {["open", "won", "lost", ""].map((s) => (
          <button key={s} type="button" onClick={() => (setStatus(s), setPage(1))} aria-pressed={status === s} className={cx("h-8 rounded-full px-3 text-[13px] font-medium", status === s ? "bg-fg text-bg" : "border border-border text-muted")}>
            {s === "" ? "All" : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {!list.data ? (
        <Skeleton className="h-64 rounded-[20px]" />
      ) : !list.data.deals.length ? (
        <EmptyState icon={<Briefcase />} title="No deals" description="Nothing matches these filters." />
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Deal</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Close</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.deals.map((d) => (
                <tr key={d.id} onClick={() => go(`deals/${d.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <b className="font-medium">{d.title}</b>
                    <span className="block text-[12px] text-muted">{[d.contact, d.company].filter(Boolean).join(" · ") || "—"}</span>
                  </td>
                  <td className={cx("px-4 py-2.5", d.status === "won" ? "text-success" : d.status === "lost" ? "text-danger" : "")}>
                    {d.stage}
                    {d.status === "open" && <span className="text-subtle"> · {d.probability}%</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(d.value, d.currency)}</td>
                  <td className="px-4 py-2.5 text-muted">{ownerName(meta, d.ownerId)}</td>
                  <td className="px-4 py-2.5 text-muted">{d.status === "open" ? dateLabel(d.expectedClose) : dateLabel(d.closedAt)}</td>
                  <td className="px-4 py-2.5 text-muted">{ago(d.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.total > 50 && (
            <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
              <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type DealView = { deal: Deal; stage: Stage; stages: Stage[]; pipeline: { id: string; name: string } | null; contact: { id: string; name: string; email: string; phone: string; title: string; doNotContact: boolean } | null; company: { id: string; name: string; domain: string } | null; activities: Activity[] };

export function DealPage({ id }: { id: string }) {
  const { meta, go } = useCrm();
  const { org } = useSession();
  const money = useMoney();
  const q = useCrmQuery<DealView>(`deals/${id}`);
  const [editing, setEditing] = useState(false);
  const [losing, setLosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [now] = useState(() => Date.now());
  const move = useCrmAction<{ stageId: string; lostReason?: string }>((b) => ({ path: `deals/${id}/move`, body: b }), { success: "Updated", onDone: () => setLosing(false) });
  const del = useCrmAction(() => ({ path: `deals/${id}`, method: "DELETE" }), { success: "Deal deleted", onDone: () => go("deals") });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { deal: d, stage, stages, pipeline, contact, company, activities } = q.data;
  const w = meta.me.write;
  const open = stages.filter((s) => s.kind === "open");
  const won = stages.find((s) => s.kind === "won")!;
  const lost = stages.find((s) => s.kind === "lost")!;
  const idx = open.findIndex((s) => s.id === d.stageId);
  const days = Math.max(0, Math.floor((now - Date.parse(d.stageEnteredAt)) / 86400000));
  const fields = meta.fields.filter((f) => f.entity === "deal");
  return (
    <div>
      <Link href="/crm/deals" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> Deals{pipeline ? ` · ${pipeline.name}` : ""}
      </Link>
      <header className="mb-5 rounded-[24px] border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em]">{d.title}</h1>
            <p className="mt-1 text-[28px] font-semibold tracking-[-0.02em] tabular-nums">{money(d.value, d.currency)}</p>
            <p className="mt-0.5 text-[13px] text-muted">
              {d.status === "open" ? `${stage.name} · ${stage.probability}% likely · ${days} day${days === 1 ? "" : "s"} in this stage` : d.status === "won" ? `Won ${dateLabel(d.closedAt, { day: "numeric", month: "short", year: "numeric" })}` : `Lost ${dateLabel(d.closedAt)} — ${d.lostReason}`}
            </p>
          </div>
          {contact?.email && !contact.doNotContact && <EmailButton to={[contact]} subject={d.title} title={`Email ${contact.name} about ${d.title}`} />}
          <ShareToChatButton card={{ kind: "deals", id: d.id, title: d.title, sub: money(d.value, d.currency), link: `/crm/deals/${d.id}`, module: "Deal", fields: [{ label: "Stage", value: stages.find((s) => s.id === d.stageId)?.name }, { label: "Status", value: d.status }, { label: "Contact", value: contact?.name }] }} />
          {w && (
            <div className="flex flex-wrap gap-2">
              {d.status === "open" ? (
                <>
                  <Button size="sm" variant="primary" icon={<Trophy className="size-3.5" />} loading={move.isPending} onClick={() => move.mutate({ stageId: won.id })} className="!bg-success !bg-none !text-white">
                    Won
                  </Button>
                  <Button size="sm" icon={<X className="size-3.5" />} onClick={() => setLosing(true)}>
                    Lost
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => move.mutate({ stageId: open[open.length - 1].id })}>
                  Reopen
                </Button>
              )}
              {d.status === "won" && visibleTo(org, "work") && (
                <ButtonLink size="sm" variant="primary" href={`/work/projects/new?deal=${d.id}`} icon={<FolderKanban className="size-3.5" />}>
                  Start a project
                </ButtonLink>
              )}
              {d.status === "won" && visibleTo(org, "sales") && (
                <ButtonLink size="sm" href={`/sales/orders/new?deal=${d.id}`} icon={<ClipboardList className="size-3.5" />}>
                  Sales order
                </ButtonLink>
              )}
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              {meta.me.manage && <Button size="sm" variant="ghost" aria-label="Delete deal" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />}
            </div>
          )}
        </div>
        <ol className="mt-5 flex gap-1" aria-label="Stage">
          {open.map((s, i) => {
            const on = s.id === d.stageId;
            const past = d.status === "won" || (idx >= 0 && i < idx);
            return (
              <li key={s.id} className="min-w-0 flex-1">
                <button type="button" disabled={!w || on} onClick={() => move.mutate({ stageId: s.id })} aria-current={on ? "step" : undefined} title={`${s.name} · ${s.probability}%`} className={cx("flex h-9 w-full items-center justify-center gap-1 truncate rounded-[10px] px-2 text-[12px] font-semibold transition-colors", on ? "bg-fg text-bg" : past ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted hover:text-fg")}>
                  {past && !on && <Check className="size-3 shrink-0" />}
                  <span className="truncate">{s.name}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-4">
          <Composer target={{ dealId: d.id, contactId: contact?.id ?? null, companyId: null, email: contact?.email, doNotContact: contact?.doNotContact }} />
          <Timeline items={activities} />
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <Section title="People">
            <div className="grid gap-2">
              {contact ? <Person href={`/crm/contacts/${contact.id}`} name={contact.name || contact.email} sub={[contact.title, contact.email || contact.phone].filter(Boolean).join(" · ")} /> : <p className="text-[13px] text-muted">No contact — edit to add one.</p>}
              {company && <Person href={`/crm/companies/${company.id}`} name={company.name} sub={company.domain} square />}
            </div>
          </Section>
          <Section title="Details">
            <dl className="grid gap-2 text-[13px]">
              <Row label="Owner">{ownerName(meta, d.ownerId)}</Row>
              <Row label="Expected close">{d.expectedClose ? dateLabel(d.expectedClose, { day: "numeric", month: "short", year: "numeric" }) : "—"}</Row>
              <Row label="Priority">{d.priority[0].toUpperCase() + d.priority.slice(1)}</Row>
              <Row label="Source">{d.source || "—"}</Row>
              {fields.map((f) => (
                <Row key={f.id} label={f.label}>
                  {customText(f, d.custom?.[f.key])}
                </Row>
              ))}
              <Row label="Created">{dateLabel(d.createdAt, { day: "numeric", month: "short", year: "numeric" })}</Row>
            </dl>
            {d.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {d.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            )}
          </Section>
          <LinkedDocuments type="crm_deal" id={d.id} name={d.title} />
        </div>
      </div>
      {editing && <DealDialog init={{ ...d, contact: contact?.name ?? "", company: company?.name ?? "" }} onClose={() => setEditing(false)} />}
      {losing && <LostDialog busy={move.isPending} onClose={() => setLosing(false)} onConfirm={(reason) => move.mutate({ stageId: lost.id, lostReason: reason })} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title={`Delete “${d.title}”?`} description="Its timeline goes too. Mark it as lost instead if you want to keep the history." confirmLabel="Delete" />
    </div>
  );
}

function Person({ href, name, sub, square }: { href: string; name: string; sub: string; square?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-[14px] p-1 hover:bg-surface-2">
      <Avatar name={name} size={34} square={square} />
      <span className="min-w-0">
        <b className="block truncate text-[13.5px]">{name}</b>
        <span className="block truncate text-[12px] text-muted">{sub || "—"}</span>
      </span>
    </Link>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}
