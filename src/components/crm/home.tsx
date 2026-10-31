"use client";

// CRM home: what to do today, how the pipeline looks, who just came in — and,
// for a new CRM, the three steps to get going.
import { ArrowRight, Briefcase, CalendarClock, Check, DownloadCloud, Link2, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Skeleton, cx } from "@/components/ui/primitives";
import { SOURCE_LABEL } from "@/lib/crm/model";
import { useSession } from "@/components/shell/session-context";
import { Avatar, LifecycleBadge, Score, Section, Stat, ago, timeLabel, useCrm, useCrmAction, useCrmParts, useCrmQuery, useShortMoney, type Activity } from "./shared";
import { TaskList } from "./tasks";

type T = Activity & { contact: string; deal: string; company: string };
type Home = {
  kpis: { contacts: number; newWeek: number; newPrev: number; customers: number; hot: number; untouched: number; openDeals: number; pipeline: number; weighted: number; wonMonth: number; wonMonthCount: number; rotting: number };
  tasks: { overdue: T[]; today: T[]; upcoming: T[] };
  meetings: (Activity & { contact: string })[];
  recent: { id: string; name: string; email: string; phone: string; source: string; score: number; lifecycle: string; createdAt: string }[];
  funnel: { pipeline: string; stages: { id: string; name: string; count: number; value: number }[] } | null;
};

export function HomeView({ onNew }: { onNew: (k: "contact" | "deal" | "task") => void }) {
  const { meta, go } = useCrm();
  const { user } = useSession();
  const short = useShortMoney();
  const part = useCrmParts();
  const q = useCrmQuery<Home>("home", { refetchInterval: 60_000 });
  const [synced, setSynced] = useState<{ created: number; updated: number } | null>(null);
  const sync = useCrmAction<void, { created: number; updated: number }>(() => ({ path: "sync" }), { onDone: (r) => setSynced(r) });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { kpis: k, tasks, meetings, recent, funnel } = q.data;
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const todo = tasks.overdue.length + tasks.today.length;
  const fresh = k.contacts === 0 || k.openDeals + k.wonMonthCount === 0;
  const maxValue = Math.max(1, ...(funnel?.stages.map((s) => s.value) ?? [1]));
  const trend = k.newPrev ? Math.round(((k.newWeek - k.newPrev) / k.newPrev) * 100) : null;
  return (
    <div>
      <section className="crm-hero mb-5 overflow-hidden rounded-[28px] p-6 sm:p-8">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">CRM</p>
        <h1 className="mt-1 text-[clamp(1.7rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.03em]">
          {hello}, {user.name.split(" ")[0]}.
        </h1>
        <p className="mt-1 text-[14.5px] text-muted">
          {todo ? (
            <>
              You have <b className="text-fg">{todo} task{todo === 1 ? "" : "s"}</b> for today{tasks.overdue.length ? <>, <b className="text-danger">{tasks.overdue.length} overdue</b></> : ""}.
            </>
          ) : (
            "Nothing due today."
          )}
          {k.untouched > 0 && (
            <>
              {" "}
              <button type="button" onClick={() => go("contacts")} className="underline">
                {k.untouched} new lead{k.untouched === 1 ? "" : "s"}
              </button>{" "}
              haven&apos;t been contacted yet.
            </>
          )}
        </p>
      </section>

      {fresh && meta.me.write && (
        <Section title="Get going in three steps" className="mb-5">
          <ol className="grid gap-3 md:grid-cols-3">
            <Step n={1} done={k.contacts > 0} icon={<DownloadCloud />} title="Bring in your customers" body="Everyone from your store, counter sales, bookings, restaurant guests, invoicing clients and website forms.">
              {synced ? (
                <p className="text-[12.5px] font-medium text-success">
                  {synced.created} added · {synced.updated} updated
                </p>
              ) : (
                <Button size="sm" variant="primary" loading={sync.isPending} onClick={() => sync.mutate()}>
                  Bring them in
                </Button>
              )}
            </Step>
            <Step n={2} done={k.openDeals + k.wonMonthCount > 0} icon={<Briefcase />} title="Add a deal" body="Something you hope to sell — then drag it along the board as it moves.">
              <Button size="sm" onClick={() => onNew("deal")}>
                Add a deal
              </Button>
            </Step>
            <Step n={3} done={false} icon={<Link2 />} title="Catch new leads" body="Website forms already flow in. Add the lead link to any other form or ad.">
              <Button size="sm" onClick={() => go("settings/capture")}>
                Set up capture
              </Button>
            </Step>
          </ol>
        </Section>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {part("deals") ? (
          <>
            <Stat label="Open pipeline" value={short(k.pipeline)} sub={`${k.openDeals} deal${k.openDeals === 1 ? "" : "s"} · ${short(k.weighted)} weighted`} onClick={() => go("deals")} />
            <Stat label="Won this month" value={short(k.wonMonth)} sub={`${k.wonMonthCount} deal${k.wonMonthCount === 1 ? "" : "s"}`} tone={k.wonMonth ? "good" : undefined} onClick={() => go("reports")} />
          </>
        ) : (
          <>
            <Stat label="Contacts" value={k.contacts} sub="in your CRM" onClick={() => go("contacts")} />
            <Stat label="Customers" value={k.customers} sub="lifecycle stage" onClick={() => go("contacts")} />
          </>
        )}
        <Stat label="New contacts" value={k.newWeek} sub={trend === null ? "this week" : `this week · ${trend >= 0 ? "+" : ""}${trend}% vs last`} onClick={() => go("contacts")} />
        <Stat label="Hot leads" value={k.hot} sub={k.rotting ? `${k.rotting} deal${k.rotting === 1 ? "" : "s"} stuck too long` : "score 60 or more"} tone={k.rotting ? "warn" : undefined} onClick={() => go("contacts")} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Section title="Your day" action={<Link href="/crm/tasks" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">All tasks <ArrowRight className="size-3.5" /></Link>}>
            {!tasks.overdue.length && !tasks.today.length && !tasks.upcoming.length ? (
              <div className="grid place-items-center rounded-[16px] border border-dashed border-border px-4 py-8 text-center">
                <Check className="size-5 text-success" />
                <p className="mt-2 text-[13.5px] font-medium">You&apos;re all caught up</p>
                {meta.me.write && (
                  <Button size="sm" className="mt-3" onClick={() => onNew("task")}>
                    Add a task
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                {tasks.overdue.length > 0 && <TaskList items={tasks.overdue} compact />}
                {tasks.today.length > 0 && <TaskList items={tasks.today} compact />}
                {tasks.upcoming.length > 0 && (
                  <>
                    <p className="text-[11.5px] font-semibold tracking-[0.1em] text-subtle uppercase">Coming up</p>
                    <TaskList items={tasks.upcoming.slice(0, 5)} compact />
                  </>
                )}
              </div>
            )}
          </Section>
          {funnel && part("deals") && (
            <Section title={`Pipeline · ${funnel.pipeline}`} action={<Link href="/crm/deals" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">Open the board <ArrowRight className="size-3.5" /></Link>}>
              <ul className="grid gap-2.5">
                {funnel.stages.map((s) => (
                  <li key={s.id} className="grid grid-cols-[130px_minmax(0,1fr)_88px] items-center gap-3 text-[13px]">
                    <span className="truncate text-muted">{s.name}</span>
                    <span className="h-6 overflow-hidden rounded-[8px] bg-surface-2">
                      <span className="block h-full rounded-[8px] bg-[var(--chart)]" style={{ width: `${s.value ? Math.max(3, (s.value / maxValue) * 100) : 0}%` }} />
                    </span>
                    <span className="text-right tabular-nums">
                      <b>{short(s.value)}</b> <span className="text-subtle">· {s.count}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <div className="grid content-start gap-5">
          <Section title="Meetings">
            {!meetings.length ? (
              <p className="text-[13px] text-muted">No meetings scheduled. Schedule one from a contact&apos;s timeline.</p>
            ) : (
              <ul className="grid gap-2">
                {meetings.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    <Link href={m.contactId ? `/crm/contacts/${m.contactId}` : m.dealId ? `/crm/deals/${m.dealId}` : "/crm"} className="flex items-center gap-3 rounded-[14px] p-1.5 hover:bg-surface-2">
                      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[#ede9fe] text-[#5b21b6]">
                        <CalendarClock className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <b className="block truncate text-[13px]">{m.subject || "Meeting"}</b>
                        <span className="block truncate text-[12px] text-muted">
                          {m.dueAt ? timeLabel(m.dueAt) : ""} {m.contact && `· ${m.contact}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Newest contacts" action={<Link href="/crm/contacts" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">All <ArrowRight className="size-3.5" /></Link>}>
            {!recent.length ? (
              <div className="grid place-items-center px-4 py-6 text-center">
                <Users className="size-5 text-muted" />
                <p className="mt-2 text-[13px] text-muted">No contacts yet.</p>
              </div>
            ) : (
              <ul className="grid gap-1">
                {recent.map((c) => (
                  <li key={c.id}>
                    <Link href={`/crm/contacts/${c.id}`} className="flex items-center gap-2.5 rounded-[12px] p-1.5 hover:bg-surface-2">
                      <Avatar name={c.name || c.email || c.phone} size={30} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[13px]">{c.name || c.email || c.phone}</b>
                        <span className="block truncate text-[11.5px] text-muted">
                          {SOURCE_LABEL[c.source] ?? c.source} · {ago(c.createdAt)}
                        </span>
                      </span>
                      <span className="hidden sm:block">
                        <Score value={c.score} />
                      </span>
                      <LifecycleBadge value={c.lifecycle} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Step({ n, done, icon, title, body, children }: { n: number; done: boolean; icon: React.ReactNode; title: string; body: string; children: React.ReactNode }) {
  return (
    <li className={cx("flex flex-col rounded-[18px] border p-4", done ? "border-success/30 bg-success-soft/40" : "border-border bg-surface")}>
      <span className={cx("grid size-9 place-items-center rounded-[12px] [&_svg]:size-4", done ? "bg-success text-white" : "bg-accent-soft text-accent")}>{done ? <Check /> : icon}</span>
      <p className="mt-3 text-[11.5px] font-semibold tracking-[0.1em] text-subtle uppercase">Step {n}</p>
      <p className="text-[14.5px] font-semibold">{title}</p>
      <p className="mt-1 mb-3 flex-1 text-[12.5px] text-muted">{body}</p>
      {done ? (
        <p className="flex items-center gap-1 text-[12.5px] font-medium text-success">
          <Sparkles className="size-3.5" /> Done
        </p>
      ) : (
        children
      )}
    </li>
  );
}
