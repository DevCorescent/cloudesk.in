"use client";

// HR home: your day (check in, your leave), what's waiting for your OK, the
// team today, and for HR the numbers, setup gaps, payroll and celebrations.
import { ArrowRight, Cake, Check, Megaphone, PartyPopper, Pin, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Button, Field, Input, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { useSession } from "@/components/shell/session-context";
import { Balances, CheckInCard, type Balance } from "./me";
import { Avatar, Section, Stat, StatusPill, fmt, inr, monthLabel, useHr, useHrAction, useHrParts, useHrQuery } from "./shared";

type Home = {
  date: string;
  me: { employee: { id: string; name: string; designation: string }; attendance: { checkIn: string | null; checkOut: string | null; minutes: number; status: string; late: boolean; source: string } | null; balances: Balance[] } | null;
  team: { off: boolean; total: number; in: number; late: number; leave: number; notIn: number; away: { id: string; name: string; leave: string | null }[] } | null;
  approvals: {
    leave: { id: string; name: string; type: string; fromDate: string; toDate: string; days: number; reason: string; color: string }[];
    corrections: { id: string; name: string; date: string; reason: string }[];
    claims: { id: string; name: string; category: string; amount: number; description: string }[];
  };
  stats: { headcount: number; joinedThisMonth: number; leftThisMonth: number; onNotice: { id: string; name: string; exitDate: string }[]; probation: { id: string; name: string; probationEnd: string }[]; noSalary: number; notLinked: number } | null;
  payroll: { id: string; month: string; status: string; totals: { net?: number; employees?: number } } | null;
  announcements: { id: string; title: string; body: string; pinned: boolean; createdAt: string }[];
  celebrations: { id: string; name: string; kind: "birthday" | "anniversary"; date: string; years?: number }[];
  holidays: { id: string; date: string; name: string; optional: boolean }[];
};

export function HomeView() {
  const { meta, go } = useHr();
  const { user } = useSession();
  const q = useHrQuery<Home>("home", { refetchInterval: 60_000 });
  const part = useHrParts();
  const [posting, setPosting] = useState(false);
  const leave = useHrAction<{ id: string; approve: boolean }>((b) => ({ path: `leave/${b.id}/decide`, body: { approve: b.approve } }), { success: "Done" });
  const corr = useHrAction<{ id: string; approve: boolean }>((b) => ({ path: `corrections/${b.id}/decide`, body: { approve: b.approve } }), { success: "Done" });
  const claim = useHrAction<{ id: string; approve: boolean }>((b) => ({ path: `claims/${b.id}/decide`, body: { action: b.approve ? "approve" : "reject" } }), { success: "Done" });
  const unpost = useHrAction<string>((id) => ({ path: `announcements/${id}`, method: "DELETE" }), { success: "Removed" });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const d = q.data;
  const hour = new Date().getHours();
  const waiting = d.approvals.leave.length + d.approvals.corrections.length + d.approvals.claims.length;
  return (
    <div>
      <section className="hr-hero mb-5 overflow-hidden rounded-[28px] p-6 sm:p-8">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">HR</p>
        <h1 className="mt-1 text-[clamp(1.7rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.03em]">
          {hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, {user.name.split(" ")[0]}.
        </h1>
        <p className="mt-1 text-[14.5px] text-muted">
          {d.team ? (d.team.off ? "It's a day off." : `${d.team.in} of ${d.team.total} in today${d.team.late ? `, ${d.team.late} late` : ""}${d.team.leave ? `, ${d.team.leave} on leave` : ""}.`) : "Your attendance, leave, payslips and claims — all here."} {waiting ? <b className="text-fg">{waiting} waiting for your OK.</b> : ""}
        </p>
      </section>

      {d.me && (
        <div className="mb-5 grid gap-5">
          {part("attendance") && <CheckInCard attendance={d.me.attendance} />}
        </div>
      )}

      {waiting > 0 && (
        <Section title={`Waiting for you · ${waiting}`} className="mb-5">
          <ul className="divide-y divide-border">
            {d.approvals.leave.map((l) => (
              <Approval key={l.id} who={l.name} what={`${l.days} day${l.days === 1 ? "" : "s"} of ${l.type} · ${fmt(l.fromDate, { day: "numeric", month: "short" })}${l.toDate !== l.fromDate ? ` – ${fmt(l.toDate, { day: "numeric", month: "short" })}` : ""}`} note={l.reason} dot={l.color} onYes={() => leave.mutate({ id: l.id, approve: true })} onNo={() => leave.mutate({ id: l.id, approve: false })} />
            ))}
            {d.approvals.corrections.map((c) => (
              <Approval key={c.id} who={c.name} what={`Attendance correction for ${fmt(c.date, { day: "numeric", month: "short" })}`} note={c.reason} onYes={() => corr.mutate({ id: c.id, approve: true })} onNo={() => corr.mutate({ id: c.id, approve: false })} />
            ))}
            {d.approvals.claims.map((c) => (
              <Approval key={c.id} who={c.name} what={`${c.category} claim · ${inr(c.amount)}`} note={c.description} onYes={() => claim.mutate({ id: c.id, approve: true })} onNo={() => claim.mutate({ id: c.id, approve: false })} />
            ))}
          </ul>
        </Section>
      )}

      {d.stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="People" value={d.stats.headcount} sub={`${d.stats.joinedThisMonth} joined · ${d.stats.leftThisMonth} left this month`} onClick={() => go("people")} />
          <Stat label="In today" value={d.team ? `${d.team.in}/${d.team.total}` : "—"} sub={d.team ? `${d.team.late} late · ${d.team.notIn} not in yet` : ""} onClick={() => go("attendance")} />
          <Stat label="On leave today" value={d.team?.leave ?? 0} sub={d.team?.away.map((a) => a.name.split(" ")[0]).join(", ") || "no one"} onClick={() => go("leave")} />
          <Stat label="Payroll" value={d.payroll ? inr(d.payroll.totals.net ?? 0) : "—"} sub={d.payroll ? `${monthLabel(d.payroll.month)} · ${d.payroll.status}` : meta.me.payroll ? "No run yet" : ""} onClick={meta.me.payroll ? () => go(d.payroll ? `payroll/${d.payroll.id}` : "payroll") : undefined} />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          {d.me && part("leave") && (
            <Section title="Your leave" action={<Link href="/hr/me" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">All of me <ArrowRight className="size-3.5" /></Link>}>
              <Balances items={d.me.balances} />
            </Section>
          )}
          {d.stats && (d.stats.onNotice.length > 0 || d.stats.probation.length > 0 || d.stats.noSalary > 0 || d.stats.notLinked > 0) && (
            <Section title="Needs attention">
              <ul className="grid gap-2 text-[13px]">
                {d.stats.onNotice.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-3 py-2">
                    <Link href={`/hr/people/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <span className="text-muted">On notice · last day {fmt(p.exitDate, { day: "numeric", month: "short" })}</span>
                  </li>
                ))}
                {d.stats.probation.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-3 py-2">
                    <Link href={`/hr/people/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <span className="text-muted">Probation ends {fmt(p.probationEnd, { day: "numeric", month: "short" })}</span>
                  </li>
                ))}
                {d.stats.noSalary > 0 && (
                  <li className="flex items-center justify-between gap-3 rounded-[12px] bg-warning-soft px-3 py-2">
                    <span>{d.stats.noSalary} {d.stats.noSalary === 1 ? "person has" : "people have"} no salary set — they won&apos;t be in payroll</span>
                    <Link href="/hr/people" className="font-medium underline">Fix</Link>
                  </li>
                )}
                {d.stats.notLinked > 0 && (
                  <li className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-3 py-2">
                    <span>{d.stats.notLinked} {d.stats.notLinked === 1 ? "person can't" : "people can't"} check in or see payslips yet — invite them</span>
                    <Link href="/hr/people" className="font-medium underline">People</Link>
                  </li>
                )}
              </ul>
            </Section>
          )}
          <Section title="Announcements" action={meta.me.manage ? <Button size="sm" variant="ghost" icon={<Megaphone className="size-3.5" />} onClick={() => setPosting(true)}>Post</Button> : undefined}>
            {!d.announcements.length ? (
              <p className="text-[13px] text-muted">Nothing posted yet.</p>
            ) : (
              <ul className="grid gap-3">
                {d.announcements.map((a) => (
                  <li key={a.id} className="rounded-[16px] border border-border p-3">
                    <p className="flex items-center gap-2 text-[14px] font-semibold">
                      {a.pinned && <Pin className="size-3.5 text-accent" />}
                      <span className="flex-1">{a.title}</span>
                      {meta.me.manage && (
                        <button type="button" aria-label="Remove" onClick={() => unpost.mutate(a.id)} className="text-subtle hover:text-danger">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </p>
                    {a.body && <p className="mt-1 text-[13px] whitespace-pre-wrap text-fg/80">{a.body}</p>}
                    <p className="mt-1.5 text-[11.5px] text-subtle">{fmt(a.createdAt.slice(0, 10))}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="grid content-start gap-5">
          <Section title="Coming up">
            {!d.celebrations.length && !d.holidays.length ? (
              <p className="text-[13px] text-muted">No birthdays, work anniversaries or holidays in the next two weeks.</p>
            ) : (
              <ul className="grid gap-2">
                {d.celebrations.map((c) => (
                  <li key={`${c.id}${c.kind}`} className="flex items-center gap-3">
                    <Avatar name={c.name} size={32} />
                    <span className="min-w-0 flex-1 text-[13px]">
                      <b className="font-medium">{c.name}</b>
                      <span className="block text-[12px] text-muted">{c.kind === "birthday" ? "Birthday" : `${c.years} year${c.years === 1 ? "" : "s"} with us`}</span>
                    </span>
                    <span className="flex items-center gap-1 text-[12px] text-muted">
                      {c.kind === "birthday" ? <Cake className="size-3.5" /> : <PartyPopper className="size-3.5" />}
                      {c.date === d.date ? "Today" : fmt(c.date, { day: "numeric", month: "short" })}
                    </span>
                  </li>
                ))}
                {d.holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-[#ede9fe]/60 px-3 py-2 text-[13px]">
                    <b className="font-medium">{h.name}{h.optional ? " (optional)" : ""}</b>
                    <span className="text-muted">{fmt(h.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {d.payroll && meta.me.payroll && part("payroll") && (
            <Section title="Latest payroll">
              <Link href={`/hr/payroll/${d.payroll.id}`} className="flex items-center justify-between gap-3 rounded-[14px] p-1 hover:bg-surface-2">
                <span>
                  <b className="block text-[14px]">{monthLabel(d.payroll.month)}</b>
                  <span className="text-[12.5px] text-muted">{d.payroll.totals.employees ?? 0} people · {inr(d.payroll.totals.net ?? 0)} net</span>
                </span>
                <StatusPill status={d.payroll.status} />
              </Link>
            </Section>
          )}
        </div>
      </div>
      {posting && <PostDialog onClose={() => setPosting(false)} />}
    </div>
  );
}

function Approval({ who, what, note, dot, onYes, onNo }: { who: string; what: string; note?: string; dot?: string; onYes: () => void; onNo: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <Avatar name={who} size={32} />
      <span className="min-w-0 flex-1">
        <b className="block text-[13.5px]">{who}</b>
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
          {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
          {what}
          {note ? ` · “${note}”` : ""}
        </span>
      </span>
      <span className="flex gap-1.5">
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={onYes}>
          Approve
        </Button>
        <Button size="sm" variant="ghost" aria-label="Decline" icon={<X className="size-4" />} onClick={onNo} />
      </span>
    </li>
  );
}

function PostDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ title: "", body: "", pinned: false });
  const post = useHrAction(() => ({ path: "announcements", body: f }), { success: "Posted", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Post an announcement" description="Everyone sees it on their HR home." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={post.isPending} disabled={!f.title.trim()} onClick={() => post.mutate()}>Post</Button></>}>
      <div className="grid gap-3">
        <Field label="Title">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} autoFocus />}</Field>
        <Field label="Message">{(a) => <Textarea {...a} rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={5000} />}</Field>
        <span className="flex items-center gap-2.5 text-[13px]">
          <Switch checked={f.pinned} onChange={(v) => setF({ ...f, pinned: v })} label="Pin to the top" />
          Pin to the top
        </span>
      </div>
    </Dialog>
  );
}
