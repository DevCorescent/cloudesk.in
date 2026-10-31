"use client";

// Sequences: follow-ups that run by themselves — an email today, a call task
// in two days, another email after a week. Stops when they unsubscribe, are
// marked do-not-contact or a deal is won.
import { ArrowDown, ArrowLeft, ArrowUp, CheckSquare, Mail, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog, Dialog } from "@/components/ui/overlays";
import { Button, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { Avatar, Section, Stat, ago, useCrm, useCrmAction, useCrmQuery, LabeledSwitch } from "./shared";

type Step = { kind: "email" | "task"; delayDays: number; subject: string; body: string };
type Seq = { id: string; name: string; steps: Step[]; active: boolean; createdAt: string; counts?: { active: number; finished: number; stopped: number; sent: number } };

export function SequencesView() {
  const { meta, go } = useCrm();
  const q = useCrmQuery<{ sequences: Seq[] }>("sequences");
  const [editing, setEditing] = useState<Partial<Seq> | null>(null);
  return (
    <div>
      <PageHeader
        title="Sequences"
        description="Follow-ups that go out by themselves, spaced over days. Add people from a contact or a whole list at once."
        actions={meta.me.manage ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>Sequence</Button> : undefined}
      />
      {meta.mail === "outbox" && (
        <div className="mb-4">
          <Notice tone="warning" title="Email isn't connected yet">
            Sequence emails are saved on each contact&apos;s timeline but not delivered until a mail service is set up for this workspace. Task steps work as normal.
          </Notice>
        </div>
      )}
      {!q.data ? (
        <Skeleton className="h-48 rounded-[20px]" />
      ) : !q.data.sequences.length ? (
        <EmptyState icon={<Repeat />} title="No sequences yet" description="For example: a welcome email now, a call task in 2 days, a check-in email after a week." action={meta.me.manage ? <Button size="sm" variant="primary" onClick={() => setEditing({ name: "New lead follow-up", steps: STARTER })}>Start from an example</Button> : undefined} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.sequences.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => go(`sequences/${s.id}`)} className="block w-full rounded-[20px] border border-border bg-surface p-4 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md">
                <p className="flex items-center justify-between gap-2">
                  <b className="text-[15px]">{s.name}</b>
                  <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", s.active ? "bg-success-soft text-success" : "bg-surface-2 text-muted")}>{s.active ? "On" : "Off"}</span>
                </p>
                <p className="mt-1 text-[12.5px] text-muted">
                  {s.steps.length} steps over {s.steps.reduce((a, x) => a + x.delayDays, 0)} days · {s.steps.filter((x) => x.kind === "email").length} emails, {s.steps.filter((x) => x.kind === "task").length} tasks
                </p>
                <div className="mt-3 flex gap-4 text-[12.5px]">
                  <span>
                    <b className="tabular-nums">{s.counts?.active ?? 0}</b> <span className="text-muted">in progress</span>
                  </span>
                  <span>
                    <b className="tabular-nums">{s.counts?.finished ?? 0}</b> <span className="text-muted">finished</span>
                  </span>
                  <span>
                    <b className="tabular-nums">{s.counts?.sent ?? 0}</b> <span className="text-muted">emails</span>
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <SequenceEditor init={editing} onClose={() => setEditing(null)} onSaved={(s) => go(`sequences/${s.id}`)} />}
    </div>
  );
}

const STARTER: Step[] = [
  { kind: "email", delayDays: 0, subject: "Thanks for getting in touch, {{first_name}}", body: "Hi {{first_name}},\n\nThanks for reaching out — I'll be your point of contact. What's the best time for a quick call this week?\n\n{{owner_name}}" },
  { kind: "task", delayDays: 2, subject: "Call them about their enquiry", body: "" },
  { kind: "email", delayDays: 5, subject: "Still interested?", body: "Hi {{first_name}},\n\nJust following up — happy to answer any questions or send over a quote.\n\n{{owner_name}}" },
];

function SequenceEditor({ init, onClose, onSaved }: { init: Partial<Seq>; onClose: () => void; onSaved?: (s: Seq) => void }) {
  const [name, setName] = useState(init.name ?? "");
  const [active, setActive] = useState(init.active ?? true);
  const [steps, setSteps] = useState<Step[]>(init.steps?.length ? init.steps : [{ kind: "email", delayDays: 0, subject: "", body: "" }]);
  const save = useCrmAction<void, { sequence: Seq }>(() => ({ path: init.id ? `sequences/${init.id}` : "sequences", method: init.id ? "PUT" : "POST", body: { name, active, steps } }), { success: "Saved", onDone: (r) => (onClose(), onSaved?.(r.sequence)) });
  const set = (i: number, p: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => {
    const n = [...steps];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setSteps(n);
  };
  const dayOf = steps.map((_, i) => steps.slice(0, i + 1).reduce((a, x) => a + x.delayDays, 0));
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={init.id ? `Edit ${init.name}` : "New sequence"}
      description="Merge fields work in emails: {{first_name}}, {{name}}, {{company}}, {{owner_name}}. Every email has an unsubscribe link."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Save sequence
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="New lead follow-up" />}</Field>
          <LabeledSwitch checked={active} onChange={setActive} label="On" />
        </div>
        <ol className="grid gap-3">
          {steps.map((s, i) => {
            const day = dayOf[i];
            return (
              <li key={i} className="rounded-[18px] border border-border bg-surface p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-fg text-[12px] font-bold text-bg">{i + 1}</span>
                  <div className="flex rounded-full bg-surface-2 p-0.5">
                    {(["email", "task"] as const).map((k) => (
                      <button key={k} type="button" onClick={() => set(i, { kind: k })} aria-pressed={s.kind === k} className={cx("flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium [&_svg]:size-3.5", s.kind === k ? "bg-surface-solid shadow-sm" : "text-muted")}>
                        {k === "email" ? <Mail /> : <CheckSquare />}
                        {k === "email" ? "Email" : "Task"}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                    {i === 0 ? "Send" : "Wait"}
                    <Input aria-label="Days" inputMode="numeric" value={String(s.delayDays)} onChange={(e) => set(i, { delayDays: Math.min(90, Number(e.target.value.replace(/\D/g, "")) || 0) })} className="!h-7 !w-14 text-center" />
                    {i === 0 ? "days after they're added" : "days"} <span className="text-subtle">· day {day}</span>
                  </label>
                  <span className="ml-auto flex gap-0.5">
                    <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" aria-label="Remove step" disabled={steps.length === 1} icon={<Trash2 className="size-3.5" />} onClick={() => setSteps(steps.filter((_, j) => j !== i))} />
                  </span>
                </div>
                <Input aria-label={s.kind === "email" ? "Subject" : "Task"} value={s.subject} onChange={(e) => set(i, { subject: e.target.value })} placeholder={s.kind === "email" ? "Subject" : "What should the owner do?"} maxLength={200} />
                {s.kind === "email" && <Textarea aria-label="Message" className="mt-2" rows={4} value={s.body} onChange={(e) => set(i, { body: e.target.value })} placeholder="Hi {{first_name}}, …" maxLength={10000} />}
              </li>
            );
          })}
        </ol>
        {steps.length < 15 && (
          <Button size="sm" icon={<Plus className="size-4" />} className="justify-self-start" onClick={() => setSteps([...steps, { kind: "email", delayDays: 3, subject: "", body: "" }])}>
            Add a step
          </Button>
        )}
      </div>
    </Dialog>
  );
}

type Enrolled = { id: string; contactId: string; name: string; email: string; status: string; step: number; nextAt: string | null; stopReason: string; createdAt: string };

export function SequencePage({ id }: { id: string }) {
  const { meta, go } = useCrm();
  const q = useCrmQuery<{ sequence: Seq; enrolled: Enrolled[] }>(`sequences/${id}`);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toggle = useCrmAction<boolean>((on) => ({ path: `sequences/${id}`, method: "PUT", body: { ...q.data!.sequence, active: on } }), { success: (r) => ((r as { sequence: Seq }).sequence.active ? "Turned on" : "Turned off") });
  const stop = useCrmAction<string>((eid) => ({ path: `enrollments/${eid}/stop` }), { success: "Stopped" });
  const del = useCrmAction(() => ({ path: `sequences/${id}`, method: "DELETE" }), { success: "Sequence deleted", onDone: () => go("sequences") });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { sequence: s, enrolled } = q.data;
  const count = (st: string) => enrolled.filter((e) => e.status === st).length;
  const dayOf = s.steps.map((_, i) => s.steps.slice(0, i + 1).reduce((a, x) => a + x.delayDays, 0));
  return (
    <div>
      <Link href="/crm/sequences" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> Sequences
      </Link>
      <PageHeader
        title={s.name}
        description={`${s.steps.length} steps over ${s.steps.reduce((a, x) => a + x.delayDays, 0)} days`}
        actions={
          meta.me.manage ? (
            <div className="flex items-center gap-2">
              <LabeledSwitch checked={s.active} onChange={(v) => toggle.mutate(v)} label={s.active ? "On" : "Off"} />
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" aria-label="Delete sequence" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />
            </div>
          ) : undefined
        }
      />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="In progress" value={count("active")} />
        <Stat label="Finished" value={count("finished")} tone={count("finished") ? "good" : undefined} />
        <Stat label="Stopped" value={count("stopped")} sub="unsubscribed, won or by hand" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Section title="Steps">
          <ol className="grid gap-2">
            {s.steps.map((st, i) => {
              const day = dayOf[i];
              return (
                <li key={i} className="flex gap-3 rounded-[14px] bg-surface-2 p-3">
                  <span className={cx("grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4", st.kind === "email" ? "bg-[#e0f2fe] text-[#075985]" : "bg-[#ffedd5] text-[#9a3412]")}>{st.kind === "email" ? <Mail /> : <CheckSquare />}</span>
                  <span className="min-w-0">
                    <span className="block text-[11.5px] font-semibold text-subtle">Day {day}</span>
                    <b className="block truncate text-[13px]">{st.subject}</b>
                    {st.body && <span className="line-clamp-2 text-[12px] text-muted">{st.body}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </Section>
        <Section title={`People · ${enrolled.length}`}>
          {!enrolled.length ? (
            <p className="text-[13px] text-muted">No one yet. Add people from the Contacts list (select, then “Sequence”) or from a contact&apos;s page.</p>
          ) : (
            <ul className="divide-y divide-border">
              {enrolled.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={e.name || e.email} size={30} />
                  <Link href={`/crm/contacts/${e.contactId}`} className="min-w-0 flex-1 hover:underline">
                    <b className="block truncate text-[13px]">{e.name || e.email}</b>
                    <span className="block truncate text-[12px] text-muted">{e.status === "active" ? `Step ${e.step + 1} of ${s.steps.length}${e.nextAt ? ` · next ${ago(e.nextAt)}` : ""}` : e.status === "finished" ? "Finished" : `Stopped — ${e.stopReason}`}</span>
                  </Link>
                  {e.status === "active" && meta.me.write && (
                    <Button size="sm" variant="ghost" onClick={() => stop.mutate(e.id)}>
                      Stop
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {editing && <SequenceEditor init={s} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title={`Delete “${s.name}”?`} description="Everyone in it stops getting its follow-ups. Emails already sent stay on their timelines." confirmLabel="Delete" />
    </div>
  );
}
