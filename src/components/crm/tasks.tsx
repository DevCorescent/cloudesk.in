"use client";

// Tasks: your day — overdue first, then today, then what's coming. Managers can
// look at anyone's list.
import { Check, CheckSquare, Flag, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, EmptyState, PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { TaskDialog } from "./dialogs";
import { ago, timeLabel, useCrm, useCrmAction, useCrmQuery, type Activity } from "./shared";

type T = Activity & { contact: string; deal: string; company: string };

export function TasksView() {
  const { meta } = useCrm();
  const [who, setWho] = useState("");
  const [adding, setAdding] = useState(false);
  const q = useCrmQuery<{ open: T[]; done: T[] }>(`tasks${who ? `?who=${who}` : ""}`);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const now = new Date();
  const open = q.data?.open ?? [];
  const groups = [
    { id: "overdue", label: "Overdue", items: open.filter((t) => t.dueAt && new Date(t.dueAt) < now), tone: "text-danger" },
    { id: "today", label: "Today", items: open.filter((t) => t.dueAt && new Date(t.dueAt) >= now && new Date(t.dueAt) <= end) },
    { id: "later", label: "Coming up", items: open.filter((t) => !t.dueAt || new Date(t.dueAt) > end) },
  ];
  return (
    <div>
      <PageHeader
        title="Tasks"
        description={q.data ? `${groups[0].items.length} overdue · ${groups[1].items.length} today · ${groups[2].items.length} coming up` : "Calls to make, quotes to send, people to follow up."}
        actions={
          <div className="flex gap-2">
            {meta.me.manage && (
              <Select aria-label="Whose tasks" value={who} onChange={(e) => setWho(e.target.value)} className="!w-auto">
                <option value="">My tasks</option>
                <option value="all">Everyone</option>
                {meta.owners
                  .filter((o) => o.id !== meta.me.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </Select>
            )}
            {meta.me.write && (
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Task
              </Button>
            )}
          </div>
        }
      />
      {!q.data ? (
        <Skeleton className="h-64 rounded-[20px]" />
      ) : !open.length && !q.data.done.length ? (
        <EmptyState icon={<CheckSquare />} title="Nothing to do" description="Add a task from any contact or deal, or here — and sequences add them for you." />
      ) : (
        <div className="grid gap-5">
          {groups.map((g) =>
            g.items.length ? (
              <section key={g.id}>
                <h2 className={cx("mb-2 text-[12px] font-semibold tracking-[0.1em] uppercase", g.tone ?? "text-subtle")}>
                  {g.label} · {g.items.length}
                </h2>
                <TaskList items={g.items} showOwner={!!who} />
              </section>
            ) : null,
          )}
          {!open.length && <p className="rounded-[16px] bg-success-soft px-4 py-3 text-[13.5px] text-success">All caught up. 🎉</p>}
          {q.data.done.length > 0 && (
            <section>
              <h2 className="mb-2 text-[12px] font-semibold tracking-[0.1em] text-subtle uppercase">Done recently</h2>
              <TaskList items={q.data.done.slice(0, 10)} showOwner={!!who} />
            </section>
          )}
        </div>
      )}
      {adding && <TaskDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

export function TaskList({ items, showOwner, compact }: { items: T[]; showOwner?: boolean; compact?: boolean }) {
  const { meta } = useCrm();
  const toggle = useCrmAction<{ id: string; done: boolean }>((b) => ({ path: `activities/${b.id}`, method: "PUT", body: { done: b.done } }), { success: (r) => ((r as { activity: Activity }).activity.doneAt ? "Done ✓" : "Reopened") });
  const [now] = useState(() => Date.now());
  return (
    <ul className={cx("divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-surface shadow-sm", compact && "rounded-[14px]")}>
      {items.map((t) => {
        const late = !t.doneAt && t.dueAt && Date.parse(t.dueAt) < now;
        const href = t.dealId ? `/crm/deals/${t.dealId}` : t.contactId ? `/crm/contacts/${t.contactId}` : t.companyId ? `/crm/companies/${t.companyId}` : null;
        return (
          <li key={t.id} className="flex items-start gap-3 px-4 py-3">
            <button type="button" disabled={!meta.me.write} aria-label={t.doneAt ? "Mark not done" : "Mark done"} onClick={() => toggle.mutate({ id: t.id, done: !t.doneAt })} className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-[7px] border-[1.5px] transition-colors", t.doneAt ? "border-success bg-success text-white" : "border-border hover:border-fg/60")}>
              {t.doneAt && <Check className="size-3.5" strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cx("text-[13.5px] font-medium", t.doneAt && "text-subtle line-through")}>
                {t.priority === "high" && <Flag className="mr-1 inline size-3.5 text-danger" aria-label="High priority" />}
                {t.subject}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-muted">
                {href && (
                  <Link href={href} className="font-medium text-fg/80 hover:underline">
                    {t.deal || t.contact || t.company}
                  </Link>
                )}
                {t.dueAt && !t.doneAt && <span className={cx(late && "font-semibold text-danger")}>{timeLabel(t.dueAt)}</span>}
                {t.doneAt && <span>done {ago(t.doneAt)}</span>}
                {showOwner && <span>· {meta.owners.find((o) => o.id === t.ownerId)?.name ?? "Unassigned"}</span>}
                {typeof t.meta?.sequence === "string" && <span>· from a sequence</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
