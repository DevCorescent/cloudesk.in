"use client";

// Projects: the list, the add/edit dialog (client from your invoicing books,
// the team and their rates, a CRM deal to start from), and a project's page —
// board, list, schedule, milestones, time, expenses, billing, risks and
// changes, and team.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, ExternalLink, FolderKanban, Handshake, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ConfirmDialog, Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { BILLING, BILLING_LABEL, PROJECT_STATUSES, PROJECT_STATUS_LABEL, TINTS, type ProjectStatus } from "@/lib/work/model";
import { ControlView, ExpensesView, ScheduleView } from "./plus";
import { Board, TaskDialog, columnName } from "./tasks";
import { LogTimeDialog } from "./timesheet";
import { Avatar, Bar, Empty, PriorityFlag, Section, Stat, StatusPill, fmt, fromPaise, hrs, inr, pct, personName, short, tint, toPaise, useWork, useWorkAction, useWorkQuery, workApi, type Milestone, type Project, type ProjectRow, type Stats, type Task } from "./shared";
import { LinkedDocuments } from "@/components/documents/linked";
import { CustomFieldsCard } from "@/components/custom/fields-card";

const PROJECT_COLUMNS = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "client", label: "Client" },
  { key: "status", label: "Status" },
  { key: "billing", label: "Billing" },
  { key: "rate", label: "Rate per hour", money: true },
  { key: "fee", label: "Fixed fee", money: true },
  { key: "budgetHours", label: "Budget (hours)" },
  { key: "hours", label: "Hours logged" },
  { key: "tasks", label: "Tasks" },
  { key: "done", label: "Tasks done" },
  { key: "startDate", label: "Start" },
  { key: "dueDate", label: "Due" },
  { key: "lead", label: "Lead" },
];

export function ProjectsView({ startNew }: { startNew?: boolean }) {
  const { meta, orgId, go } = useWork();
  const qc = useQueryClient();
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const sp = useSearchParams();
  const [adding, setAdding] = useState(!!startNew);
  const [deal, setDeal] = useState<string | null>(startNew ? sp.get("deal") : null);
  const q = useWorkQuery<{ projects: ProjectRow[] }>(`projects?status=${status}&q=${encodeURIComponent(search)}${mine ? "&mine=1" : ""}`, { keepPrevious: true });
  const rows = q.data?.projects ?? [];
  return (
    <div>
      <PageHeader
        title="Projects"
        description="Everything you're working on, for clients and in-house."
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportMenu name="projects" columns={PROJECT_COLUMNS} rows={rows.map((p) => ({ ...p, client: p.clientName, status: PROJECT_STATUS_LABEL[p.status], billing: BILLING_LABEL[p.billing], hours: Number((p.stats.minutes / 60).toFixed(2)), tasks: p.stats.tasks, done: p.stats.done, lead: personName(meta, p.leadId) }))} />
            {meta.me.write && <ImportButton target={target("work.projects")} onImport={(r, mode) => api(workApi(orgId, "projects/import"), { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["work", orgId] })} />}
            {meta.me.write && (
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
                New project
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input aria-label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, code or client" className="h-9 max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 !w-36">
          <option value="open">Open</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
          ))}
          <option value="all">All</option>
        </Select>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[var(--accent)]" />
          Only mine
        </label>
      </div>
      {!q.data ? (
        <Skeleton className="h-[50vh] rounded-[24px]" />
      ) : !rows.length ? (
        <EmptyState icon={<FolderKanban className="size-5" />} title={search || status !== "open" ? "No projects match" : "No projects yet"} description="A project holds its tasks, milestones and the time spent on it — and turns that time into invoices." action={meta.me.write ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>New project</Button> : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
      {adding && <ProjectDialog dealId={deal} onClose={() => (setAdding(false), setDeal(null))} onSaved={(id) => go(`projects/${id}`)} />}
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectRow }) {
  const { meta } = useWork();
  const progress = p.stats.tasks ? p.stats.done / p.stats.tasks : 0;
  return (
    <Link href={`/work/projects/${p.id}`} className="group grid gap-3 rounded-[20px] border border-border bg-surface p-4 shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", tint(p.tint))}>{p.code}</span>
          <b className="mt-1.5 block truncate text-[15px] font-semibold">{p.name}</b>
          <span className="block truncate text-[12.5px] text-muted">{p.clientName || "In-house"} · {BILLING_LABEL[p.billing]}</span>
        </span>
        <StatusPill status={p.status} />
      </div>
      <div className="grid gap-1.5 text-[12px]">
        <span className="flex justify-between text-muted"><span>{p.stats.done} of {p.stats.tasks} tasks done</span><span>{pct(progress)}</span></span>
        <Bar plain value={progress} />
        {p.burn !== null && (
          <>
            <span className="mt-1 flex justify-between text-muted"><span>Budget used</span><span className={cx(p.burn > 1 && "font-semibold text-danger")}>{pct(p.burn)}</span></span>
            <Bar value={p.burn} />
          </>
        )}
      </div>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span className="flex gap-1">{p.members.slice(0, 5).map((m) => <Avatar key={m} name={personName(meta, m)} size={24} />)}</span>
        <span className="ml-auto flex items-center gap-3">
          {p.stats.overdue > 0 && <span className="font-semibold text-danger">{p.stats.overdue} overdue</span>}
          {meta.parts.timesheets && <span className="tabular-nums">{hrs(p.stats.minutes)}</span>}
          {p.dueDate && <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" />{fmt(p.dueDate, { day: "numeric", month: "short" })}</span>}
        </span>
      </div>
    </Link>
  );
}

type Detail = { project: Project; stats: Stats; burn: number | null; members: { userId: string; name: string; email: string; rate: number | null; costRate: number | null }[]; milestones: Milestone[]; deal: { id: string; title: string; value: number } | null };
type Form = Omit<Project, "id" | "code" | "rate" | "fee" | "budgetAmount" | "budgetHours"> & { rate: string; fee: string; budgetAmount: string; budgetHours: string; members: { userId: string; rate: string; costRate: string }[] };

type FromDeal = { deal: { title: string; value: number; company: string }; existing: { id: string; code: string } | null; prefill: Partial<Project> };

export function ProjectDialog(props: { project?: Project; members?: Detail["members"]; dealId?: string | null; onClose: () => void; onSaved?: (id: string) => void }) {
  // A project from a CRM deal starts from the deal, so it waits for it.
  const fromDeal = useWorkQuery<FromDeal>(props.dealId ? `deals/${props.dealId}` : null);
  if (props.dealId && !fromDeal.data && !fromDeal.isError) return <Dialog open onClose={props.onClose} title="New project"><Skeleton className="h-40 rounded-[16px]" /></Dialog>;
  return <ProjectForm {...props} fromDeal={fromDeal.data} />;
}

function ProjectForm({ project, members, fromDeal, onClose, onSaved }: { project?: Project; members?: Detail["members"]; fromDeal?: FromDeal; onClose: () => void; onSaved?: (id: string) => void }) {
  const { meta } = useWork();
  const pre = fromDeal?.prefill;
  const [f, setF] = useState<Form>(() => ({
    name: project?.name ?? pre?.name ?? "",
    description: project?.description ?? "",
    ownerId: project?.ownerId ?? pre?.ownerId ?? meta.books[0]?.id ?? null,
    clientId: project?.clientId ?? pre?.clientId ?? null,
    clientName: project?.clientName ?? pre?.clientName ?? "",
    dealId: project?.dealId ?? pre?.dealId ?? null,
    status: project?.status ?? "active",
    billing: project?.billing ?? pre?.billing ?? "hourly",
    rate: fromPaise(project?.rate ?? meta.settings.defaultRate),
    fee: fromPaise(project?.fee ?? pre?.fee),
    budgetHours: project?.budgetHours ? String(project.budgetHours) : "",
    budgetAmount: fromPaise(project?.budgetAmount),
    startDate: project?.startDate ?? null,
    dueDate: project?.dueDate ?? null,
    leadId: project?.leadId ?? meta.me.id,
    tint: project?.tint ?? "sky",
    members: members?.map((m) => ({ userId: m.userId, rate: fromPaise(m.rate), costRate: fromPaise(m.costRate) })) ?? [{ userId: meta.me.id, rate: "", costRate: "" }],
  }));
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const clients = useWorkQuery<{ clients: { id: string; name: string; company: string }[] }>(f.ownerId && meta.me.write ? `clients?ownerId=${f.ownerId}` : null);
  const save = useWorkAction<void, { project: { id: string } }>(
    () => ({
      path: project ? `projects/${project.id}` : "projects",
      method: project ? "PUT" : "POST",
      body: { ...f, rate: toPaise(f.rate), fee: toPaise(f.fee), budgetAmount: toPaise(f.budgetAmount), budgetHours: Number(f.budgetHours) || 0, members: f.members.map((m) => ({ userId: m.userId, rate: m.rate ? toPaise(m.rate) : null, costRate: m.costRate ? toPaise(m.costRate) : null })) },
    }),
    { success: project ? "Project saved" : "Project created", onDone: (r) => (onSaved?.(r.project.id), onClose()) },
  );
  const notOn = meta.people.filter((p) => !f.members.some((m) => m.userId === p.id));
  return (
    <Dialog
      open
      onClose={onClose}
      title={project ? `Edit ${project.code}` : "New project"}
      description={fromDeal ? `From the CRM deal “${fromDeal.deal.title}”` : undefined}
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
            {project ? "Save" : "Create project"}
          </Button>
        </>
      }
    >
      {fromDeal?.existing && (
        <div className="mb-3">
          <Notice tone="warning" title="This deal already has a project">
            <Link href={`/work/projects/${fromDeal.existing.id}`} className="underline">Open {fromDeal.existing.code}</Link> instead, or make another.
          </Notice>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Website for Lumen Labs" />}</Field>
        <Field label="Description" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
        {meta.links.invoicing && meta.books.length > 0 ? (
          <>
            <Field label="Bills from" hint="The invoicing books its invoices go in">
              {(p) => (
                <Select {...p} value={f.ownerId ?? ""} onChange={(e) => set({ ownerId: e.target.value || null, clientId: null })}>
                  {meta.books.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Client" hint={f.clientId ? undefined : "Pick one to bill this project"}>
              {(p) => (
                <Select
                  {...p}
                  value={f.clientId ?? ""}
                  onChange={(e) => {
                    const c = clients.data?.clients.find((x) => x.id === e.target.value);
                    set({ clientId: c?.id ?? null, clientName: c ? c.company || c.name : f.clientName });
                  }}
                >
                  <option value="">{f.clientName ? `${f.clientName} (not linked)` : "In-house / no client"}</option>
                  {clients.data?.clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.company ? `${c.company} — ${c.name}` : c.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : (
          <Field label="Client" className="sm:col-span-2" hint="Switch on Invoices & finance to bill clients from here">{(p) => <Input {...p} value={f.clientName} onChange={(e) => set({ clientName: e.target.value })} />}</Field>
        )}
        <Field label="Billing">
          {(p) => (
            <Select {...p} value={f.billing} onChange={(e) => set({ billing: e.target.value as Form["billing"] })}>
              {BILLING.map((b) => (
                <option key={b} value={b}>{BILLING_LABEL[b]}</option>
              ))}
            </Select>
          )}
        </Field>
        {f.billing === "hourly" && <Field label="Rate per hour (₹)" hint="People can have their own rate below">{(p) => <Input {...p} inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} placeholder="2000" />}</Field>}
        {f.billing === "fixed" && <Field label="Fixed fee (₹)" hint="Bill it in parts with milestones">{(p) => <Input {...p} inputMode="decimal" value={f.fee} onChange={(e) => set({ fee: e.target.value })} />}</Field>}
        {f.billing === "none" && <div />}
        <Field label="Budget (hours)">{(p) => <Input {...p} inputMode="decimal" value={f.budgetHours} onChange={(e) => set({ budgetHours: e.target.value })} placeholder="e.g. 40" />}</Field>
        <Field label="Budget (₹)" hint="Billable time at its rates counts against it">{(p) => <Input {...p} inputMode="decimal" value={f.budgetAmount} onChange={(e) => set({ budgetAmount: e.target.value })} />}</Field>
        <Field label="Start">{(p) => <Input {...p} type="date" value={f.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} />}</Field>
        <Field label="Due">{(p) => <Input {...p} type="date" value={f.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value || null })} />}</Field>
        <Field label="Lead">
          {(p) => (
            <Select {...p} value={f.leadId ?? ""} onChange={(e) => set({ leadId: e.target.value || null, members: e.target.value && !f.members.some((m) => m.userId === e.target.value) ? [...f.members, { userId: e.target.value, rate: "", costRate: "" }] : f.members })}>
              {meta.people.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(p) => (
            <Select {...p} value={f.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium">Colour</p>
          <div role="radiogroup" aria-label="Colour" className="flex gap-2">
            {TINTS.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={f.tint === t} aria-label={t} onClick={() => set({ tint: t })} className={cx("size-7 rounded-full", tint(t), f.tint === t && "ring-2 ring-fg ring-offset-2 ring-offset-bg")} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5">
        <p className="mb-2 text-[13px] font-medium">Team</p>
        <div className="grid gap-2">
          {f.members.map((m, i) => (
            <div key={m.userId} className="grid grid-cols-[minmax(0,1fr)_110px_110px_32px] items-center gap-2 text-[13px]">
              <span className="flex min-w-0 items-center gap-2"><Avatar name={personName(meta, m.userId)} size={24} /><span className="truncate">{personName(meta, m.userId)}</span></span>
              <Input aria-label={`Rate for ${personName(meta, m.userId)}`} inputMode="decimal" value={m.rate} disabled={f.billing !== "hourly"} onChange={(e) => set({ members: f.members.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} placeholder="Rate ₹/h" />
              <Input aria-label={`Cost for ${personName(meta, m.userId)}`} inputMode="decimal" value={m.costRate} disabled={!meta.me.manage} onChange={(e) => set({ members: f.members.map((x, j) => (j === i ? { ...x, costRate: e.target.value } : x)) })} placeholder={meta.me.payroll ? "From HR" : "Cost ₹/h"} title="What an hour of their time costs you" />
              <button type="button" aria-label={`Take ${personName(meta, m.userId)} off`} disabled={m.userId === f.leadId} onClick={() => set({ members: f.members.filter((_, j) => j !== i) })} className="grid size-8 place-items-center rounded-full text-subtle hover:text-danger disabled:opacity-30">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {notOn.length > 0 && (
            <Select aria-label="Add someone to the team" value="" onChange={(e) => e.target.value && set({ members: [...f.members, { userId: e.target.value, rate: "", costRate: "" }] })} className="h-9 max-w-xs">
              <option value="">Add someone…</option>
              {notOn.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          )}
          <p className="text-[12px] text-subtle">Blank rates use the project&apos;s rate. {meta.me.payroll ? "Blank costs use their salary in HR." : "Costs are for owners and admins, for Cost & profit."}</p>
        </div>
      </div>
    </Dialog>
  );
}

type Tab = "board" | "list" | "schedule" | "milestones" | "time" | "expenses" | "billing" | "changes" | "team";

export function ProjectPage({ id, tab: initial }: { id: string; tab?: string }) {
  const { meta, go } = useWork();
  const q = useWorkQuery<Detail>(`projects/${id}`);
  const tasksPath = `tasks?projectId=${id}`;
  const tasks = useWorkQuery<{ tasks: Task[] }>(tasksPath);
  const [tab, setTab] = useState<Tab>((["board", "list", "schedule", "milestones", "time", "expenses", "billing", "changes", "team"] as Tab[]).find((t) => t === initial) ?? "board");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const status = useWorkAction<ProjectStatus>((s) => ({ path: `projects/${id}/status`, body: { status: s } }), { success: "Status changed" });
  const del = useWorkAction<void>(() => ({ path: `projects/${id}`, method: "DELETE" }), { success: "Project deleted", onDone: () => go("projects") });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { project: p, stats, burn, members, milestones, deal } = q.data;
  const tabs: { value: Tab; label: string }[] = [
    { value: "board", label: "Board" },
    { value: "list", label: "List" },
    ...(meta.parts.planning ? [{ value: "schedule" as Tab, label: "Schedule" }] : []),
    { value: "milestones", label: `Milestones${milestones.length ? ` · ${milestones.length}` : ""}` },
    ...(meta.parts.timesheets ? [{ value: "time" as Tab, label: "Time" }] : []),
    ...(meta.parts.expenses && meta.me.write ? [{ value: "expenses" as Tab, label: "Expenses" }] : []),
    ...(meta.parts.billing && meta.me.manage && p.billing !== "none" ? [{ value: "billing" as Tab, label: "Billing" }] : []),
    ...(meta.parts.control ? [{ value: "changes" as Tab, label: "Risks & changes" }] : []),
    { value: "team", label: `Team · ${members.length}` },
  ];
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-[12.5px] text-muted">
        <Link href="/work/projects" className="hover:underline">Projects</Link>
        <span>›</span>
        <span className={cx("rounded-full px-2 py-0.5 font-semibold", tint(p.tint))}>{p.code}</span>
      </p>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{p.clientName || "In-house"}</span>
            <span>{BILLING_LABEL[p.billing]}{p.billing === "hourly" && p.rate ? ` · ${inr(p.rate)}/h` : p.billing === "fixed" && p.fee ? ` · ${inr(p.fee)}` : ""}</span>
            {p.dueDate && <span>Due {fmt(p.dueDate)}</span>}
            {deal && <Link href={`/crm/deals/${deal.id}`} className="inline-flex items-center gap-1 underline"><Handshake className="size-3.5" />{deal.title}</Link>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.me.write && (
              <Select aria-label="Project status" value={p.status} onChange={(e) => status.mutate(e.target.value as ProjectStatus)} className="h-8 !w-32 text-[13px]">
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
                ))}
              </Select>
            )}
            {meta.parts.timesheets && <Button size="sm" onClick={() => setLogging(true)}>Log time</Button>}
            {meta.me.write && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Task</Button>}
          </div>
        }
      />
      <CustomFieldsCard entity="work.project" id={id} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tasks" value={`${stats.done}/${stats.tasks}`} sub={stats.overdue ? `${stats.overdue} overdue` : "done"} tone={stats.overdue ? "warn" : undefined} />
        {meta.parts.timesheets && <Stat label="Hours" value={hrs(stats.minutes)} sub={p.budgetHours ? `of ${p.budgetHours}h budget` : `${hrs(stats.billableMinutes)} billable`} />}
        {burn !== null && <Stat label="Budget used" value={pct(burn)} sub={p.budgetAmount ? `${short(stats.used)} of ${short(p.budgetAmount)}` : `${hrs(stats.minutes)} of ${p.budgetHours}h`} tone={burn > 1 ? "warn" : undefined} />}
        {meta.parts.billing && meta.me.manage && p.billing === "hourly" && <Stat label="Not billed yet" value={hrs(stats.unbilledMinutes)} sub="billable time" onClick={() => setTab("billing")} />}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={tabs} className="mb-4" />
      {tab === "board" && (tasks.data ? <Board projectId={id} tasks={tasks.data.tasks} milestones={milestones} queryPath={tasksPath} /> : <Skeleton className="h-[50vh] rounded-[24px]" />)}
      {tab === "list" && <TaskList projectId={id} tasks={tasks.data?.tasks} milestones={milestones} />}
      {tab === "schedule" && <ScheduleView projectId={id} />}
      {tab === "milestones" && <Milestones project={p} milestones={milestones} />}
      {tab === "expenses" && <ExpensesView project={p} />}
      {tab === "changes" && <ControlView project={p} />}
      {tab === "time" && <ProjectTime projectId={id} />}
      {tab === "billing" && <ProjectBilling project={p} />}
      {tab === "team" && (
        <Section title="Team">
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2.5 text-[13px]">
                <Avatar name={m.name} size={28} />
                <span className="min-w-0 flex-1">
                  <b className="block font-semibold">{m.name}{m.userId === p.leadId ? <span className="ml-1.5 text-[11.5px] font-medium text-muted">Lead</span> : null}</b>
                  <span className="text-[12px] text-muted">{m.email}</span>
                </span>
                {meta.me.write && p.billing === "hourly" && <span className="text-[12px] text-muted tabular-nums">{inr(m.rate ?? p.rate)}/h</span>}
                {meta.me.manage && <span className="w-28 text-right text-[12px] text-muted tabular-nums">{m.costRate ? `costs ${inr(m.costRate)}/h` : meta.me.payroll ? "cost from HR" : "no cost set"}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-4"><LinkedDocuments type="work_project" id={p.id} name={p.name} /></div>
          {meta.me.manage && (
            <div className="mt-4 border-t border-border pt-3">
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>Delete project</Button>
            </div>
          )}
        </Section>
      )}
      {editing && <ProjectDialog project={p} members={members} onClose={() => setEditing(false)} />}
      {adding && <TaskDialog projectId={id} milestones={milestones} onClose={() => setAdding(false)} />}
      {logging && <LogTimeDialog projectId={id} onClose={() => setLogging(false)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title={`Delete ${p.code}?`} description="Its tasks, milestones and logged time are deleted too. Projects with invoiced time can't be deleted — mark them done or cancelled instead." confirmLabel="Delete project" destructive loading={del.isPending} onConfirm={() => del.mutate()} />
    </div>
  );
}

function TaskList({ projectId, tasks, milestones }: { projectId: string; tasks?: Task[]; milestones: Milestone[] }) {
  const { meta, orgId } = useWork();
  const qc = useQueryClient();
  const [sort, setSort] = useState<"due" | "status" | "assignee">("status");
  const rows = useMemo(() => {
    const order = { todo: 0, doing: 1, review: 2, done: 3 };
    return [...(tasks ?? [])].sort((a, b) => (sort === "due" ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") : sort === "assignee" ? personName(meta, a.assigneeId).localeCompare(personName(meta, b.assigneeId)) : order[a.status] - order[b.status] || a.position - b.position));
  }, [tasks, sort, meta]);
  if (!tasks) return <Skeleton className="h-[40vh] rounded-[24px]" />;
  return (
    <Section
      title={`${tasks.length} tasks`}
      action={
        <div className="flex items-center gap-2">
          <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-8 !w-40 text-[12.5px]">
            <option value="status">By column</option>
            <option value="due">By due date</option>
            <option value="assignee">By assignee</option>
          </Select>
          <ExportMenu name="tasks" columns={[{ key: "number", label: "#" }, { key: "title", label: "Title" }, { key: "column", label: "Status" }, { key: "priority", label: "Priority" }, { key: "assignee", label: "Assignee" }, { key: "dueDate", label: "Due" }, { key: "estimateHours", label: "Estimate (hours)" }, { key: "hours", label: "Logged (hours)" }, { key: "milestone", label: "Milestone" }, { key: "tags", label: "Tags" }]} rows={rows.map((t) => ({ ...t, column: columnName(meta.settings, t.status), assignee: t.assigneeId ? personName(meta, t.assigneeId) : "", hours: Number((t.logged / 60).toFixed(2)), milestone: milestones.find((m) => m.id === t.milestoneId)?.name ?? "", tags: t.tags.join(", ") }))} />
          {meta.me.write && <ImportButton target={target("work.tasks")} onImport={(r, mode) => api(workApi(orgId, "tasks/import"), { method: "POST", body: { rows: r, mode, projectId } })} onDone={() => qc.invalidateQueries({ queryKey: ["work", orgId] })} />}
        </div>
      }
    >
      {!rows.length ? (
        <Empty>No tasks yet. Add them one by one, or import a sheet from another tool.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="py-2 pr-3 font-medium">Task</th>
                <th className="py-2 pr-3 font-medium">Column</th>
                <th className="py-2 pr-3 font-medium">Assignee</th>
                <th className="py-2 pr-3 font-medium">Due</th>
                <th className="py-2 text-right font-medium">Logged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 pr-3">
                    <Link href={`/work/tasks/${t.id}`} className="font-medium hover:underline"><span className="text-subtle">#{t.number}</span> {t.title}</Link> <PriorityFlag priority={t.priority} />
                  </td>
                  <td className="py-2 pr-3 text-muted">{columnName(meta.settings, t.status)}</td>
                  <td className="py-2 pr-3"><span className="flex items-center gap-1.5"><Avatar name={t.assigneeId ? personName(meta, t.assigneeId) : null} size={20} />{t.assigneeId ? personName(meta, t.assigneeId) : <span className="text-muted">—</span>}</span></td>
                  <td className={cx("py-2 pr-3 tabular-nums", t.overdue ? "font-semibold text-danger" : "text-muted")}>{fmt(t.dueDate, { day: "numeric", month: "short" })}</td>
                  <td className="py-2 text-right tabular-nums">{hrs(t.logged)}{t.estimateHours ? <span className="text-muted"> / {t.estimateHours}h</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Milestones({ project, milestones }: { project: Project; milestones: Milestone[] }) {
  const { meta } = useWork();
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const done = useWorkAction<{ id: string; done: boolean }>((b) => ({ path: `milestones/${b.id}/done`, body: { done: b.done } }));
  const del = useWorkAction<string>((mid) => ({ path: `milestones/${mid}`, method: "DELETE" }), { success: "Milestone removed" });
  return (
    <Section title="Milestones" action={meta.me.write ? <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Milestone</Button> : undefined}>
      {!milestones.length ? (
        <Empty>Milestones mark the big steps. On fixed-fee projects, each can carry part of the fee to invoice when it&apos;s reached.</Empty>
      ) : (
        <ol className="grid gap-2">
          {milestones.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border px-3 py-2.5 text-[13px]">
              <button type="button" aria-label={m.doneAt ? `Reopen ${m.name}` : `Mark ${m.name} reached`} disabled={!meta.me.write} onClick={() => done.mutate({ id: m.id, done: !m.doneAt })} className={cx("grid size-6 place-items-center rounded-full border", m.doneAt ? "border-success bg-success text-white" : "border-border")}>
                {m.doneAt && <Check className="size-3.5" />}
              </button>
              <span className="min-w-0 flex-1">
                <b className={cx("block font-semibold", m.doneAt && "text-muted")}>{m.name}</b>
                <span className="text-[12px] text-muted">{m.tasksDone}/{m.tasks} tasks{m.dueDate ? ` · due ${fmt(m.dueDate, { day: "numeric", month: "short" })}` : ""}</span>
              </span>
              {m.amount > 0 && meta.me.write && <b className="tabular-nums">{inr(m.amount)}</b>}
              {m.invoiceId ? <StatusPill status="billed" /> : m.doneAt ? <StatusPill status="done" label="Reached" /> : null}
              {meta.me.write && !m.invoiceId && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Edit</Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${m.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(m.id)} />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {project.billing === "fixed" && project.fee > 0 && meta.me.write && (
        <p className="mt-3 text-[12px] text-muted">Milestones carry {inr(milestones.reduce((n, m) => n + m.amount, 0))} of the {inr(project.fee)} fee.</p>
      )}
      {editing && <MilestoneDialog projectId={project.id} m={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function MilestoneDialog({ projectId, m, onClose }: { projectId: string; m?: Milestone; onClose: () => void }) {
  const [name, setName] = useState(m?.name ?? "");
  const [due, setDue] = useState(m?.dueDate ?? "");
  const [amount, setAmount] = useState(fromPaise(m?.amount));
  const save = useWorkAction<void>(() => ({ path: m ? `milestones/${m.id}` : "milestones", method: m ? "PUT" : "POST", body: { projectId, name, dueDate: due || null, amount: toPaise(amount) } }), { success: "Milestone saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={m ? "Edit milestone" : "New milestone"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Designs signed off" />}</Field>
        <Field label="Due">{(p) => <Input {...p} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        <Field label="Amount to bill (₹)" hint="When it's reached; leave blank if none">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

type Entry = { id: string; date: string; minutes: number; note: string; billable: boolean; status: string; invoiceId: string | null; person: string; task: string | null; code: string; project: string };
function ProjectTime({ projectId }: { projectId: string }) {
  const { meta } = useWork();
  const q = useWorkQuery<{ entries: Entry[] }>(`time?projectId=${projectId}`);
  const rows = q.data?.entries ?? [];
  return (
    <Section
      title={meta.me.manage ? "All time on this project" : "Your time on this project"}
      action={<ExportMenu name="project-time" columns={[{ key: "date", label: "Date" }, { key: "person", label: "Person" }, { key: "task", label: "Task" }, { key: "hours", label: "Hours" }, { key: "note", label: "Note" }, { key: "billable", label: "Billable" }, { key: "status", label: "Status" }, { key: "billed", label: "Invoiced" }]} rows={rows.map((e) => ({ ...e, task: e.task ?? "", hours: Number((e.minutes / 60).toFixed(2)), billable: e.billable ? "yes" : "no", billed: e.invoiceId ? "yes" : "no" }))} />}
    >
      {!q.data ? (
        <Skeleton className="h-40 rounded-[16px]" />
      ) : !rows.length ? (
        <Empty>No time logged yet.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Who</th>
                <th className="py-2 pr-3 font-medium">Task · note</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{fmt(e.date, { day: "numeric", month: "short" })}</td>
                  <td className="py-2 pr-3">{e.person}</td>
                  <td className="max-w-[320px] py-2 pr-3"><span className="block truncate">{e.task ?? "General"}</span>{e.note && <span className="block truncate text-[12px] text-muted">{e.note}</span>}</td>
                  <td className="py-2 pr-3">{e.invoiceId ? <StatusPill status="billed" /> : <StatusPill status={e.status} />}{!e.billable && <span className="ml-1.5 text-[11.5px] text-muted">not billable</span>}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{hrs(e.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

type Unbilled = { upTo: string; groupBy: string; lines: { name: string; hours: number; minutes: number; rate: number; amount: number; from: string; to: string }[]; noRate: boolean; entries: number; waitingMinutes: number; milestones: { id: string; name: string; amount: number }[]; expenses: { id: string; date: string; category: string; description: string; charge: number; markupPct: number }[]; invoices: { id: string; number: string; status: string; total: number; issue_date: string; href: string }[]; ready: boolean };
export function ProjectBilling({ project }: { project: Project }) {
  const [groupBy, setGroupBy] = useState("task");
  const [upTo, setUpTo] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [pickedEx, setPickedEx] = useState<string[] | null>(null);
  const q = useWorkQuery<Unbilled>(`billing/${project.id}?groupBy=${groupBy}${upTo ? `&upTo=${upTo}` : ""}`, { keepPrevious: true });
  const [made, setMade] = useState<{ href: string } | null>(null);
  const d = q.data;
  const ms = picked ?? d?.milestones.map((m) => m.id) ?? [];
  const ex = pickedEx ?? d?.expenses.map((e) => e.id) ?? [];
  const bill = useWorkAction<void, { invoice: { href: string } }>(() => ({ path: `billing/${project.id}`, body: { groupBy, upTo: upTo || undefined, milestoneIds: ms, expenseIds: ex } }), { success: "Draft invoice made", onDone: (r) => (setMade(r.invoice), setPicked(null), setPickedEx(null)) });
  if (!d) return <Skeleton className="h-60 rounded-[24px]" />;
  const total = d.lines.reduce((n, l) => n + l.amount, 0) + d.milestones.filter((m) => ms.includes(m.id)).reduce((n, m) => n + m.amount, 0) + d.expenses.filter((e) => ex.includes(e.id)).reduce((n, e) => n + e.charge, 0);
  return (
    <div className="grid gap-5">
      {!d.ready && <Notice tone="warning" title="Pick a client first">Edit the project and choose the books and the client it bills, then come back here.</Notice>}
      {made && (
        <Notice tone="success" title="Draft invoice ready" action={<Link href={made.href} className="inline-flex items-center gap-1 text-[13px] font-medium underline">Open it <ExternalLink className="size-3.5" /></Link>}>
          Check it, then issue and send it from your books. Voiding or deleting it frees this time to bill again.
        </Notice>
      )}
      <Section
        title="Ready to bill"
        action={
          project.billing === "hourly" && (
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="One line per" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="h-8 !w-44 text-[12.5px]">
                <option value="task">A line per task</option>
                <option value="person">A line per person</option>
                <option value="single">One line</option>
              </Select>
              <label className="flex items-center gap-1.5 text-[12.5px] text-muted">up to<Input aria-label="Time up to" type="date" value={upTo || d.upTo} onChange={(e) => setUpTo(e.target.value)} className="h-8 !w-40 text-[12.5px]" /></label>
            </div>
          )
        }
      >
        {d.waitingMinutes > 0 && <p className="mb-3 text-[12.5px] text-warning">{hrs(d.waitingMinutes)} more is logged but not approved yet, so it isn&apos;t here.</p>}
        {d.noRate && <p className="mb-3 text-[12.5px] text-danger">Some time has no rate. Set the project&apos;s rate per hour first.</p>}
        {!d.lines.length && !d.milestones.length && !d.expenses.length ? (
          <Empty>Nothing to bill right now. Approved, billable time, reached milestones and billable expenses appear here.</Empty>
        ) : (
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-border">
              {d.lines.map((l) => (
                <tr key={`${l.name}-${l.rate}`}>
                  <td className="py-2 pr-3"><b className="font-medium">{l.name}</b><span className="block text-[12px] text-muted">{fmt(l.from, { day: "numeric", month: "short" })}{l.to !== l.from ? ` – ${fmt(l.to, { day: "numeric", month: "short" })}` : ""}</span></td>
                  <td className="py-2 pr-3 text-right text-muted tabular-nums">{l.hours}h × {inr(l.rate)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{inr(l.amount)}</td>
                </tr>
              ))}
              {d.milestones.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={ms.includes(m.id)} onChange={(e) => setPicked(e.target.checked ? [...ms, m.id] : ms.filter((x) => x !== m.id))} className="accent-[var(--accent)]" />
                      <b className="font-medium">◆ {m.name}</b>
                    </label>
                  </td>
                  <td className="py-2 pr-3 text-right text-muted">Milestone</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{inr(m.amount)}</td>
                </tr>
              ))}
              {d.expenses.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={ex.includes(e.id)} onChange={(ev) => setPickedEx(ev.target.checked ? [...ex, e.id] : ex.filter((x) => x !== e.id))} className="accent-[var(--accent)]" />
                      <b className="font-medium">{e.category}{e.description ? `: ${e.description}` : ""}</b>
                    </label>
                  </td>
                  <td className="py-2 pr-3 text-right text-muted">Expense · {fmt(e.date, { day: "numeric", month: "short" })}{e.markupPct ? ` · +${e.markupPct}%` : ""}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{inr(e.charge)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={2} className="py-2 text-right text-muted">Before tax</td>
                <td className="py-2 text-right text-[15px] font-semibold tabular-nums">{inr(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <div className="mt-3 flex justify-end">
          <Button variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={!d.ready || total <= 0 || d.noRate} loading={bill.isPending} onClick={() => bill.mutate()}>
            Make a draft invoice
          </Button>
        </div>
      </Section>
      <Section title="Invoices from this project">
        {!d.invoices.length ? (
          <Empty>None yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {d.invoices.map((i) => (
              <li key={i.id}>
                <Link href={i.href} className="flex items-center justify-between gap-3 py-2.5 text-[13px] hover:opacity-80">
                  <span><b className="font-semibold">{i.number || "Draft"}</b> <span className="text-muted">· {fmt(i.issue_date)}</span></span>
                  <span className="flex items-center gap-2"><b className="tabular-nums">{inr(i.total)}</b><StatusPill status={i.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
