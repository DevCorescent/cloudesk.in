"use client";

// Tasks: the project board (drag cards between columns, or use the card's
// menu), the task page (checklist, subtasks, comments, time), the add/edit
// dialog, and "My tasks" across every project.
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, Clock, MessageSquare, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type DragEvent } from "react";
import { ConfirmDialog, Dialog, Menu, Segmented } from "@/components/ui/overlays";
import { Button, Field, Input, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { PRIORITIES, PRIORITY_LABEL, TASK_STATUSES, type TaskStatus } from "@/lib/work/model";
import { LogTimeDialog } from "./timesheet";
import { Avatar, Empty, PriorityFlag, Section, fmt, hrs, personName, tint, todayIst, useWork, useWorkAction, useWorkQuery, when, type Milestone, type Task } from "./shared";

export function columnName(settings: { columns: Record<TaskStatus, string> }, s: TaskStatus) {
  return settings.columns[s];
}

/** The four-column board for one project. */
export function Board({ projectId, tasks, milestones, queryPath }: { projectId: string; tasks: Task[]; milestones: Milestone[]; queryPath: string }) {
  const { meta, orgId } = useWork();
  const qc = useQueryClient();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: TaskStatus; before: string | null } | null>(null);
  const [adding, setAdding] = useState<TaskStatus | null>(null);
  const move = useWorkAction<{ id: string; status: TaskStatus; before: string | null; after: string | null }>((b) => ({ path: `tasks/${b.id}/move`, body: b }));
  const key = ["work", orgId, queryPath];
  const cols = TASK_STATUSES.map((s) => ({ status: s, tasks: tasks.filter((t) => t.status === s).sort((a, b) => a.position - b.position) }));
  const drop = (status: TaskStatus, before: string | null) => {
    const id = drag;
    setDrag(null);
    setOver(null);
    if (!id || id === before) return;
    const col = cols.find((c) => c.status === status)!.tasks.filter((t) => t.id !== id);
    const at = before ? col.findIndex((t) => t.id === before) : col.length;
    const after = at > 0 ? col[at - 1].id : null;
    // Move the card on screen straight away; the server's answer replaces it.
    qc.setQueryData<{ tasks: Task[] }>(key, (d) => (d ? { tasks: d.tasks.map((t) => (t.id === id ? { ...t, status, position: before ? (col[at]?.position ?? 0) - 0.5 : Number.MAX_SAFE_INTEGER } : t)) } : d));
    move.mutate({ id, status, before, after });
  };
  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-0 sm:px-0">
        <div className="grid min-w-[880px] grid-cols-4 gap-3">
          {cols.map((col) => (
            <section
              key={col.status}
              aria-label={columnName(meta.settings, col.status)}
              onDragOver={(e: DragEvent) => {
                if (!drag || !meta.me.write) return;
                e.preventDefault();
                if (over?.status !== col.status) setOver({ status: col.status, before: null });
              }}
              onDrop={(e) => (e.preventDefault(), drop(col.status, over?.status === col.status ? over.before : null))}
              className={cx("flex min-w-0 flex-col rounded-[20px] p-2 transition-colors", col.status === "done" ? "bg-success-soft/40" : "bg-surface-2/70", over?.status === col.status && "ring-2 ring-accent/50")}
            >
              <header className="flex items-center justify-between px-2 pt-1 pb-2">
                <p className="text-[13px] font-semibold">{columnName(meta.settings, col.status)}</p>
                <span className="flex items-center gap-1">
                  <span className="rounded-full bg-surface px-2 text-[11.5px] tabular-nums text-muted">{col.tasks.length}</span>
                  {meta.me.write && (
                    <button type="button" aria-label={`Add a task to ${columnName(meta.settings, col.status)}`} onClick={() => setAdding(col.status)} className="grid size-6 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg">
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </span>
              </header>
              <ol className="grid min-h-[90px] content-start gap-2">
                {col.tasks.map((t) => (
                  <li
                    key={t.id}
                    draggable={meta.me.write}
                    onDragStart={(e) => {
                      setDrag(t.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", t.id);
                    }}
                    onDragEnd={() => (setDrag(null), setOver(null))}
                    onDragOver={(e) => {
                      if (!drag || drag === t.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (over?.before !== t.id) setOver({ status: col.status, before: t.id });
                    }}
                    onDrop={(e) => (e.preventDefault(), e.stopPropagation(), drop(col.status, t.id))}
                    className={cx("relative", drag === t.id && "opacity-40")}
                  >
                    {over?.before === t.id && <span aria-hidden className="absolute -top-1.5 right-2 left-2 h-0.5 rounded-full bg-accent" />}
                    <TaskCard t={t} milestones={milestones} onMove={(status) => move.mutate({ id: t.id, status, before: null, after: null })} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
      {adding && <TaskDialog projectId={projectId} status={adding} milestones={milestones} onClose={() => setAdding(null)} />}
    </>
  );
}

function TaskCard({ t, milestones, onMove }: { t: Task; milestones: Milestone[]; onMove: (s: TaskStatus) => void }) {
  const { meta } = useWork();
  const ms = milestones.find((m) => m.id === t.milestoneId);
  const items = t.checklist.length;
  return (
    <div className="group rounded-[14px] border border-border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-1.5">
        <Link href={`/work/tasks/${t.id}`} className="min-w-0 flex-1 text-[13.5px] leading-snug font-semibold hover:underline">
          <span className="mr-1 text-[11.5px] font-medium text-subtle">#{t.number}</span>
          {t.title}
        </Link>
        {meta.me.write && (
          <Menu
            label={`Move ${t.title}`}
            trigger={(p) => (
              <button {...p} type="button" aria-label="Move to column" className="-mt-0.5 -mr-1 grid size-6 place-items-center rounded-full text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 focus:opacity-100">
                <MoreHorizontal className="size-4" />
              </button>
            )}
            items={TASK_STATUSES.filter((s) => s !== t.status).map((s) => ({ label: `Move to ${columnName(meta.settings, s)}`, onSelect: () => onMove(s) }))}
          />
        )}
      </div>
      {ms && <p className="mt-1 truncate text-[11.5px] text-muted">◆ {ms.name}</p>}
      {t.tags.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {t.tags.map((g) => (
            <span key={g} className="rounded-full bg-surface-2 px-1.5 text-[10.5px] text-muted">
              {g}
            </span>
          ))}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] whitespace-nowrap text-muted">
        <Avatar name={t.assigneeId ? personName(meta, t.assigneeId) : null} size={22} />
        <PriorityFlag priority={t.priority} />
        {t.dueDate && <span className={cx("inline-flex items-center gap-0.5", t.overdue && "font-semibold text-danger")}><CalendarDays className="size-3" />{fmt(t.dueDate, { day: "numeric", month: "short" })}</span>}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
          {items > 0 && <span className="inline-flex items-center gap-0.5"><CheckSquare className="size-3" />{t.checklistDone}/{items}</span>}
          {t.subtasks > 0 && <span title="Subtasks">{t.subtasksDone}/{t.subtasks} sub</span>}
          {t.comments > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" />{t.comments}</span>}
          {(t.logged > 0 || t.estimateHours > 0) && <span className={cx("inline-flex items-center gap-0.5 tabular-nums", t.estimateHours && t.logged / 60 > t.estimateHours && "text-danger")}><Clock className="size-3" />{hrs(t.logged)}{t.estimateHours ? `/${t.estimateHours}h` : ""}</span>}
        </span>
      </div>
    </div>
  );
}

type TaskForm = { title: string; description: string; status: TaskStatus; priority: string; assigneeId: string; milestoneId: string; startDate: string; dueDate: string; estimateHours: string; billable: boolean; tags: string };
export function TaskDialog({ projectId, task, status = "todo", parentId, milestones, onClose, onSaved }: { projectId: string; task?: Task; status?: TaskStatus; parentId?: string; milestones: Milestone[]; onClose: () => void; onSaved?: (id: string) => void }) {
  const { meta } = useWork();
  const [f, setF] = useState<TaskForm>({
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? status,
    priority: task?.priority ?? "normal",
    assigneeId: task?.assigneeId ?? "",
    milestoneId: task?.milestoneId ?? "",
    startDate: task?.startDate ?? "",
    dueDate: task?.dueDate ?? "",
    estimateHours: task?.estimateHours ? String(task.estimateHours) : "",
    billable: task?.billable ?? true,
    tags: task?.tags.join(", ") ?? "",
  });
  const set = (p: Partial<TaskForm>) => setF((x) => ({ ...x, ...p }));
  const save = useWorkAction<void, { task: { id: string } }>(
    () => ({
      path: task ? `tasks/${task.id}` : "tasks",
      method: task ? "PUT" : "POST",
      body: { projectId, parentId: task?.parentId ?? parentId ?? null, checklist: task?.checklist ?? [], title: f.title, description: f.description, status: f.status, priority: f.priority, assigneeId: f.assigneeId || null, milestoneId: f.milestoneId || null, startDate: f.startDate || null, dueDate: f.dueDate || null, estimateHours: Number(f.estimateHours) || 0, billable: f.billable, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) },
    }),
    { success: task ? "Task saved" : "Task added", onDone: (r) => (onSaved?.(r.task.id), onClose()) },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={task ? `Edit #${task.number}` : parentId ? "New subtask" : "New task"}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>
            {task ? "Save" : "Add task"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="What needs doing?" />}</Field>
        <Field label="Details" className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
        <Field label="Assignee">
          {(p) => (
            <Select {...p} value={f.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
              <option value="">Nobody yet</option>
              {meta.people.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Column">
          {(p) => (
            <Select {...p} value={f.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{columnName(meta.settings, s)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority">
          {(p) => (
            <Select {...p} value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
              {PRIORITIES.map((s) => (
                <option key={s} value={s}>{PRIORITY_LABEL[s]}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Milestone">
          {(p) => (
            <Select {...p} value={f.milestoneId} onChange={(e) => set({ milestoneId: e.target.value })}>
              <option value="">None</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Start">{(p) => <Input {...p} type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />}</Field>
        <Field label="Due">{(p) => <Input {...p} type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />}</Field>
        <Field label="Estimate (hours)">{(p) => <Input {...p} inputMode="decimal" value={f.estimateHours} onChange={(e) => set({ estimateHours: e.target.value })} placeholder="e.g. 6" />}</Field>
        <Field label="Tags" hint="Separate with commas">{(p) => <Input {...p} value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="design, copy" />}</Field>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <input type="checkbox" checked={f.billable} onChange={(e) => set({ billable: e.target.checked })} className="accent-[var(--accent)]" />
          Time on this task can be billed to the client
        </label>
      </div>
    </Dialog>
  );
}

type Detail = {
  task: Task & { project: { code: string; name: string; tint: string } };
  parent: { id: string; number: number; title: string } | null;
  subtasks: Task[];
  comments: { id: string; body: string; createdAt: string; userId: string | null; name: string | null }[];
  time: { id: string; date: string; minutes: number; note: string; userId: string; name: string }[];
};

export function TaskPage({ id }: { id: string }) {
  const { meta, go } = useWork();
  const q = useWorkQuery<Detail>(`tasks/${id}`);
  const ms = useWorkQuery<{ milestones: Milestone[] }>(q.data ? `projects/${q.data.task.projectId}` : null);
  const [editing, setEditing] = useState(false);
  const [sub, setSub] = useState(false);
  const [logging, setLogging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [comment, setComment] = useState("");
  const [item, setItem] = useState("");
  const tick = useWorkAction<{ item: string; done: boolean }>((b) => ({ path: `tasks/${id}/tick`, body: b }));
  const save = useWorkAction<Partial<Task>>((b) => ({ path: `tasks/${id}`, method: "PUT", body: b }));
  const post = useWorkAction<void>(() => ({ path: `tasks/${id}/comments`, body: { body: comment } }), { onDone: () => setComment("") });
  const del = useWorkAction<void>(() => ({ path: `tasks/${id}`, method: "DELETE" }), { success: "Task deleted", onDone: () => go(`projects/${q.data!.task.projectId}`) });
  const move = useWorkAction<TaskStatus>((status) => ({ path: `tasks/${id}/move`, body: { status } }));
  const subMove = useWorkAction(subMoveFn);
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { task: t, subtasks, comments, time, parent } = q.data;
  const milestones = ms.data?.milestones ?? [];
  const canTick = meta.me.write || t.assigneeId === meta.me.id;
  return (
    <div>
      <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
        <Link href={`/work/projects/${t.projectId}`} className={cx("rounded-full px-2 py-0.5 font-medium", tint(t.project.tint))}>{t.project.code} · {t.project.name}</Link>
        {parent && (
          <>
            <span>›</span>
            <Link href={`/work/tasks/${parent.id}`} className="hover:underline">#{parent.number} {parent.title}</Link>
          </>
        )}
      </p>
      <PageHeader
        title={`#${t.number} ${t.title}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.parts.timesheets && <Button size="sm" icon={<Clock className="size-3.5" />} onClick={() => setLogging(true)}>Log time</Button>}
            {meta.me.write && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            {meta.me.write && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Delete task" onClick={() => setDeleting(true)} />}
          </div>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="grid content-start gap-5">
          {meta.me.write && (
            <Segmented label="Column" value={t.status} onChange={(s) => move.mutate(s)} options={TASK_STATUSES.map((s) => ({ value: s, label: columnName(meta.settings, s) }))} />
          )}
          <Section title="Details">
            {t.description ? <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{t.description}</p> : <p className="text-[13px] text-muted">No details yet.</p>}
          </Section>
          <Section title={`Checklist${t.checklist.length ? ` · ${t.checklistDone}/${t.checklist.length}` : ""}`}>
            <ul className="grid gap-1.5">
              {t.checklist.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-[13.5px]">
                  <input type="checkbox" aria-label={c.text} checked={c.done} disabled={!canTick} onChange={(e) => tick.mutate({ item: c.id, done: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                  <span className={cx(c.done && "text-muted line-through")}>{c.text}</span>
                  {meta.me.write && (
                    <button type="button" aria-label={`Remove ${c.text}`} onClick={() => save.mutate({ checklist: t.checklist.filter((x) => x.id !== c.id) })} className="ml-auto text-subtle hover:text-danger">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {meta.me.write && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!item.trim()) return;
                  save.mutate({ checklist: [...t.checklist, { id: Math.random().toString(36).slice(2, 10), text: item.trim(), done: false }] });
                  setItem("");
                }}
              >
                <Input aria-label="New checklist item" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add an item" />
                <Button type="submit" size="sm">Add</Button>
              </form>
            )}
          </Section>
          {!t.parentId && (
            <Section title="Subtasks" action={meta.me.write ? <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setSub(true)}>Add</Button> : undefined}>
              {!subtasks.length ? (
                <Empty>Break the work down into smaller pieces.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {subtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-2 text-[13px]">
                      <input type="checkbox" aria-label={`Done: ${s.title}`} checked={s.status === "done"} disabled={!meta.me.write} onChange={(e) => subMove.mutate({ id: s.id, status: e.target.checked ? "done" : "todo" })} className="size-4 accent-[var(--accent)]" />
                      <Link href={`/work/tasks/${s.id}`} className={cx("min-w-0 flex-1 truncate hover:underline", s.status === "done" && "text-muted line-through")}>#{s.number} {s.title}</Link>
                      <Avatar name={s.assigneeId ? personName(meta, s.assigneeId) : null} size={20} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          <Section title="Comments">
            <ul className="grid gap-3">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <Avatar name={c.name} size={26} />
                  <div className="min-w-0">
                    <p className="text-[12px] text-muted"><b className="font-semibold text-fg">{c.name ?? "Someone"}</b> · {when(c.createdAt)}</p>
                    <p className="text-[13.5px] whitespace-pre-wrap">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <form className="mt-3 grid gap-2" onSubmit={(e) => (e.preventDefault(), comment.trim() && post.mutate())}>
              <Textarea aria-label="Write a comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" />
              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={post.isPending} disabled={!comment.trim()}>Comment</Button>
              </div>
            </form>
          </Section>
        </div>
        <div className="grid content-start gap-5">
          <Section title="About">
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
              <dt className="text-muted">Assignee</dt>
              <dd className="flex items-center gap-1.5"><Avatar name={t.assigneeId ? personName(meta, t.assigneeId) : null} size={20} />{personName(meta, t.assigneeId)}</dd>
              <dt className="text-muted">Priority</dt>
              <dd>{PRIORITY_LABEL[t.priority]}</dd>
              <dt className="text-muted">Due</dt>
              <dd className={cx(t.overdue && "font-semibold text-danger")}>{fmt(t.dueDate)}</dd>
              <dt className="text-muted">Estimate</dt>
              <dd>{t.estimateHours ? `${t.estimateHours}h` : "—"}</dd>
              <dt className="text-muted">Logged</dt>
              <dd className="tabular-nums">{hrs(t.logged)}</dd>
              <dt className="text-muted">Billable</dt>
              <dd>{t.billable ? "Yes" : "No"}</dd>
              {milestones.find((m) => m.id === t.milestoneId) && (
                <>
                  <dt className="text-muted">Milestone</dt>
                  <dd>{milestones.find((m) => m.id === t.milestoneId)!.name}</dd>
                </>
              )}
            </dl>
          </Section>
          {meta.parts.timesheets && (
            <Section title={meta.me.manage ? "Time logged" : "Your time"}>
              {!time.length ? (
                <Empty>No time logged on this task yet.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {time.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                      <span className="min-w-0">
                        <span className="block font-medium">{e.name} · {fmt(e.date, { day: "numeric", month: "short" })}</span>
                        {e.note && <span className="block truncate text-[12px] text-muted">{e.note}</span>}
                      </span>
                      <b className="tabular-nums">{hrs(e.minutes)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      </div>
      {editing && <TaskDialog projectId={t.projectId} task={t} milestones={milestones} onClose={() => setEditing(false)} />}
      {sub && <TaskDialog projectId={t.projectId} parentId={t.id} milestones={milestones} onClose={() => setSub(false)} />}
      {logging && <LogTimeDialog projectId={t.projectId} taskId={t.id} onClose={() => setLogging(false)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title={`Delete #${t.number}?`} description="Its subtasks and comments go too. Time logged on it stays on the project." confirmLabel="Delete" destructive loading={del.isPending} onConfirm={() => del.mutate()} />
    </div>
  );
}

const subMoveFn = (b: { id: string; status: TaskStatus }) => ({ path: `tasks/${b.id}/move`, body: { status: b.status } });

/** Everything assigned to you, by when it's due. */
export function MyTasksView() {
  const { meta } = useWork();
  const [who, setWho] = useState("me");
  const q = useWorkQuery<{ tasks: Task[] }>(`tasks?assignee=${who}&status=open`, { keepPrevious: true });
  const subMove = useWorkAction(subMoveFn, { success: "Done" });
  const today = todayIst();
  const in7 = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const groups: [string, (t: Task) => boolean][] = [
    ["Overdue", (t) => !!t.dueDate && t.dueDate < today],
    ["Today", (t) => t.dueDate === today],
    ["This week", (t) => !!t.dueDate && t.dueDate > today && t.dueDate <= in7],
    ["Later", (t) => !!t.dueDate && t.dueDate > in7],
    ["No date", (t) => !t.dueDate],
  ];
  const tasks = (q.data?.tasks ?? []).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  return (
    <div>
      <PageHeader
        title={who === "me" ? "My tasks" : "Tasks"}
        description="Open tasks across every project, by when they're due."
        actions={
          <Select aria-label="Whose tasks" value={who} onChange={(e) => setWho(e.target.value)} className="h-9 !w-44">
            <option value="me">Mine</option>
            <option value="none">Nobody&apos;s yet</option>
            {meta.people.filter((p) => p.id !== meta.me.id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        }
      />
      {!q.data ? (
        <Skeleton className="h-[50vh] rounded-[24px]" />
      ) : !tasks.length ? (
        <Empty>Nothing open here. Tasks given to {who === "me" ? "you" : "them"} on any project show up here.</Empty>
      ) : (
        <div className="grid gap-5">
          {groups.map(([label, test]) => {
            const list = tasks.filter(test);
            if (!list.length) return null;
            return (
              <Section key={label} title={<span className={cx(label === "Overdue" && "text-danger")}>{label} · {list.length}</span>}>
                <ul className="divide-y divide-border">
                  {list.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                      <input type="checkbox" aria-label={`Done: ${t.title}`} disabled={!meta.me.write} onChange={() => subMove.mutate({ id: t.id, status: "done" })} className="size-4 accent-[var(--accent)]" />
                      <Link href={`/work/tasks/${t.id}`} className="min-w-0 flex-1">
                        <span className="block truncate font-medium hover:underline">{t.title}</span>
                        <span className="text-[12px] text-muted">{t.project?.code} · {t.project?.name} · {columnName(meta.settings, t.status)}</span>
                      </Link>
                      <PriorityFlag priority={t.priority} />
                      {t.dueDate && <span className={cx("w-16 text-right text-[12px] tabular-nums", t.overdue ? "font-semibold text-danger" : "text-muted")}>{fmt(t.dueDate, { day: "numeric", month: "short" })}</span>}
                    </li>
                  ))}
                </ul>
              </Section>
            );
          })}
        </div>
      )}
    </div>
  );
}
