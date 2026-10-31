"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronRight, CircleDashed, Clock, Copy, Filter, Globe, KeyRound, Link2, Mail, MessageSquare, Play, Plus, RotateCcw, Square, Trash2, Workflow as WorkflowIcon, XCircle, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, Dialog, Menu, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { CRON_PRESETS } from "@/lib/automation/cron";
import { STEP_INFO, STEP_TYPES, TRIGGER_INFO, TRIGGER_TYPES, type Step, type StepType, type Trigger, type TriggerType } from "@/lib/automation/model";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { useProject } from "@/lib/client/use-project";

type Workflow = { id: string; name: string; enabled: boolean; trigger: Trigger; steps: Step[]; secretNames: string[]; hasWebhook: boolean; runs7d: number; failed7d: number; lastRunAt: string | null; updatedAt: string };
type Limits = { MAX_WORKFLOWS: number; MAX_STEPS: number; MAX_RUNS_PER_DAY: number; MAX_EMAILS_PER_DAY: number };
type StepLog = { id: string; type: string; status: string; output?: unknown; error?: string; attempts: number; finishedAt?: string };
type Run = { id: string; status: string; triggerType: string; input: unknown; log: StepLog[]; error: string | null; startedAt: string; finishedAt: string | null };
type Job = { id: string; kind: string; status: string; attempts: number; maxAttempts: number; runAt: string; lastError: string | null; createdAt: string; finishedAt: string | null };
type Draft = { id?: string; name: string; trigger: Trigger; steps: Step[]; secrets: { name: string; value: string; stored: boolean }[] };

const STEP_ICON: Record<StepType, React.ReactNode> = {
  send_email: <Mail className="size-4" />,
  http_request: <Globe className="size-4" />,
  slack: <MessageSquare className="size-4" />,
  delay: <Clock className="size-4" />,
  condition: <Filter className="size-4" />,
};

const newId = (type: string, steps: Step[]) => {
  let i = 1;
  const base = type.split("_")[0];
  while (steps.some((s) => s.id === `${base}${i}`)) i++;
  return `${base}${i}`;
};

function blankStep(type: StepType, steps: Step[]): Step {
  const id = newId(type, steps);
  switch (type) {
    case "send_email":
      return { id, type, config: { to: "", subject: "", body: "" } };
    case "http_request":
      return { id, type, config: { method: "POST", url: "https://", headers: { "Content-Type": "application/json" }, body: "{}", failOn4xx: true } };
    case "slack":
      return { id, type, config: { text: "" } };
    case "delay":
      return { id, type, config: { amount: 1, unit: "days" } };
    case "condition":
      return { id, type, config: { left: "", op: "equals", right: "" } };
  }
}

function blankTrigger(type: TriggerType): Trigger {
  if (type === "schedule") return { type, config: { cron: "0 9 * * mon-fri", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } };
  if (type === "form_submitted") return { type, config: { formId: "" } };
  return { type, config: {} } as Trigger;
}

/** Ready-made starting points. Addresses are left for the person to fill in. */
const RECIPES: { title: string; description: string; draft: (email: string) => Omit<Draft, "id"> }[] = [
  {
    title: "Email me new leads",
    description: "When the contact form is submitted, email the details to you.",
    draft: (email) => ({ name: "Email me new leads", trigger: { type: "form_submitted", config: { formId: "contact" } }, steps: [{ id: "email1", type: "send_email", config: { to: email, subject: "New enquiry from {{trigger.data.name}}", body: "{{trigger.data.name}} <{{trigger.data.email}}> wrote:\n\n{{trigger.data.message}}\n\nPage: {{trigger.page}}" } }], secrets: [] }),
  },
  {
    title: "Thank customers after they order",
    description: "A personal note, two days after payment.",
    draft: () => ({ name: "Thank-you note", trigger: { type: "order_paid", config: {} }, steps: [{ id: "delay1", type: "delay", config: { amount: 2, unit: "days" } }, { id: "email1", type: "send_email", config: { to: "{{trigger.email}}", subject: "Thank you for your order, {{trigger.customerName}}", body: "Hi {{trigger.customerName}},\n\nThank you for order {{trigger.label}}. We hope you love it — just reply if anything isn't right.\n\n— {{project.name}}" } }], secrets: [] }),
  },
  {
    title: "Post big orders to Slack",
    description: "Only orders above an amount you choose.",
    draft: () => ({ name: "Big orders to Slack", trigger: { type: "order_paid", config: {} }, steps: [{ id: "condition1", type: "condition", config: { left: "{{trigger.total}}", op: "gt", right: "5000" } }, { id: "slack1", type: "slack", config: { text: ":tada: {{trigger.customerName}} paid {{trigger.currency}} {{trigger.total}} for {{trigger.label}}" } }], secrets: [{ name: "slackWebhookUrl", value: "", stored: false }] }),
  },
  {
    title: "Send orders to another system",
    description: "POST each paid order as JSON to your CRM or ERP.",
    draft: () => ({ name: "Orders to CRM", trigger: { type: "order_paid", config: {} }, steps: [{ id: "http1", type: "http_request", config: { method: "POST", url: "https://", headers: { "Content-Type": "application/json", Authorization: "Bearer {{secrets.apiToken}}" }, body: '{\n  "order": "{{trigger.label}}",\n  "email": "{{trigger.email}}",\n  "total": "{{trigger.total}}",\n  "currency": "{{trigger.currency}}"\n}', failOn4xx: true } }], secrets: [{ name: "apiToken", value: "", stored: false }] }),
  },
  {
    title: "Monday morning reminder",
    description: "A scheduled email to the team every week.",
    draft: (email) => ({ name: "Monday reminder", trigger: { type: "schedule", config: { cron: "0 9 * * mon", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } }, steps: [{ id: "email1", type: "send_email", config: { to: email, subject: "Weekly check-in for {{project.name}}", body: "Good morning! Time to review last week's orders and enquiries." } }], secrets: [] }),
  },
];

function StatusBadge({ status }: { status: string }) {
  const tone = status === "succeeded" ? "success" : status === "failed" || status === "dead" ? "danger" : status === "running" || status === "waiting" || status === "queued" ? "accent" : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}

function Placeholders({ trigger, steps, secrets, onPick }: { trigger: TriggerType; steps: Step[]; secrets: string[]; onPick: (p: string) => void }) {
  const items = [...TRIGGER_INFO[trigger].fields.map((f) => `trigger.${f}`), ...steps.filter((s) => s.type === "http_request").map((s) => `steps.${s.id}.body`), ...secrets.map((s) => `secrets.${s}`), "project.name", "workflow.name"];
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((p) => (
        <button key={p} type="button" onClick={() => onPick(`{{${p}}}`)} className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted hover:bg-surface-3 hover:text-fg" title="Copy placeholder">
          {`{{${p}}}`}
        </button>
      ))}
    </div>
  );
}

function SchedulePreview({ projectId, cron, tz }: { projectId: string; cron: string; tz: string }) {
  const [q, setQ] = useState({ cron, tz });
  useEffect(() => {
    const t = setTimeout(() => setQ({ cron, tz }), 400);
    return () => clearTimeout(t);
  }, [cron, tz]);
  const r = useQuery({ queryKey: ["cron", q], queryFn: () => api<{ next: string[]; error?: string }>(`/api/v1/projects/${projectId}/automations/cron?cron=${encodeURIComponent(q.cron)}&tz=${encodeURIComponent(q.tz)}`) });
  if (!r.data) return null;
  return r.data.error ? <p className="text-xs text-danger">{r.data.error}</p> : <p className="text-xs text-muted">Next: {r.data.next.length ? r.data.next.map((d) => dateTime(d)).join(" · ") : "not in the next 14 days"}</p>;
}

function StepEditor({ step, onChange }: { step: Step; onChange: (s: Step) => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...step, config: { ...step.config, ...patch } } as Step);
  switch (step.type) {
    case "send_email":
      return (
        <div className="grid gap-3">
          <Field label="To" hint="A teammate's address, or {{trigger.email}} for the customer.">{(p) => <Input {...p} value={step.config.to} onChange={(e) => set({ to: e.target.value })} placeholder="you@company.com" />}</Field>
          <Field label="Subject">{(p) => <Input {...p} value={step.config.subject} onChange={(e) => set({ subject: e.target.value })} />}</Field>
          <Field label="Message">{(p) => <Textarea {...p} rows={5} value={step.config.body} onChange={(e) => set({ body: e.target.value })} />}</Field>
        </div>
      );
    case "http_request":
      return (
        <div className="grid gap-3">
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <Field label="Method">
              {(p) => (
                <Select {...p} value={step.config.method} onChange={(e) => set({ method: e.target.value })}>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="URL" hint="Public addresses only; private networks are blocked.">{(p) => <Input {...p} value={step.config.url} onChange={(e) => set({ url: e.target.value })} className="font-mono text-xs" />}</Field>
          </div>
          <Field label="Headers (one per line, Name: value)">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                className="font-mono text-xs"
                value={Object.entries(step.config.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
                onChange={(e) => set({ headers: Object.fromEntries(e.target.value.split("\n").map((l) => l.split(/:([\s\S]*)/)).filter(([k]) => k?.trim()).map(([k, v]) => [k.trim(), (v ?? "").trim()])) })}
              />
            )}
          </Field>
          {step.config.method !== "GET" && <Field label="Body" hint="Values filled into JSON are escaped automatically.">{(p) => <Textarea {...p} rows={6} className="font-mono text-xs" value={step.config.body} onChange={(e) => set({ body: e.target.value })} />}</Field>}
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={step.config.failOn4xx} onChange={(e) => set({ failOn4xx: e.target.checked })} /> Stop on 4xx answers (5xx and timeouts are always retried)
          </label>
        </div>
      );
    case "slack":
      return <Field label="Message" hint="Needs the secret slackWebhookUrl (an incoming-webhook URL from Slack).">{(p) => <Textarea {...p} rows={3} value={step.config.text} onChange={(e) => set({ text: e.target.value })} />}</Field>;
    case "delay":
      return (
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <Field label="Wait">{(p) => <Input {...p} type="number" min={1} value={step.config.amount} onChange={(e) => set({ amount: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
          <Field label="Unit">
            {(p) => (
              <Select {...p} value={step.config.unit} onChange={(e) => set({ unit: e.target.value })}>
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </Select>
            )}
          </Field>
        </div>
      );
    case "condition":
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_150px_1fr]">
          <Field label="Value">{(p) => <Input {...p} value={step.config.left} onChange={(e) => set({ left: e.target.value })} placeholder="{{trigger.total}}" className="font-mono text-xs" />}</Field>
          <Field label="Is">
            {(p) => (
              <Select {...p} value={step.config.op} onChange={(e) => set({ op: e.target.value })}>
                <option value="equals">equal to</option>
                <option value="not_equals">not equal to</option>
                <option value="contains">containing</option>
                <option value="not_contains">not containing</option>
                <option value="gt">greater than</option>
                <option value="lt">less than</option>
                <option value="exists">not empty</option>
                <option value="not_exists">empty</option>
              </Select>
            )}
          </Field>
          {!["exists", "not_exists"].includes(step.config.op) && <Field label="Compared with">{(p) => <Input {...p} value={step.config.right} onChange={(e) => set({ right: e.target.value })} />}</Field>}
        </div>
      );
  }
}

function Editor({ projectId, initial, onClose, limits }: { projectId: string; initial: Draft; onClose: () => void; limits: Limits }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial);
  const [open, setOpen] = useState<string | null>(initial.steps[0]?.id ?? null);
  const save = useMutation({
    mutationFn: () =>
      api<{ workflow: Workflow }>(`/api/v1/projects/${projectId}/automations${d.id ? `/${d.id}` : ""}`, {
        method: d.id ? "PUT" : "POST",
        body: { name: d.name, trigger: d.trigger, steps: d.steps, secrets: Object.fromEntries(d.secrets.filter((s) => s.name).map((s) => [s.name, s.value])) },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["automations", projectId] });
      toast({ tone: "success", title: d.id ? "Automation saved" : "Automation created", description: r.workflow.enabled ? undefined : "Switch it on when you're ready." });
      onClose();
    },
    onError: (e) => toast({ tone: "error", title: "Could not save", description: errorMessage(e) }),
  });
  const setStep = (i: number, s: Step) => setD({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, dir: -1 | 1) => {
    const steps = [...d.steps];
    [steps[i], steps[i + dir]] = [steps[i + dir], steps[i]];
    setD({ ...d, steps });
  };
  const copy = (p: string) => navigator.clipboard.writeText(p).then(() => toast({ tone: "info", title: `Copied ${p}` }));
  const t = d.trigger;

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={d.id ? `Edit “${initial.name}”` : "New automation"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!d.name.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label="Name">{(p) => <Input {...p} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={120} />}</Field>

        <section className="rounded-[var(--radius-lg)] border border-border p-4">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <Zap className="size-4" aria-hidden /> When
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Trigger">
              {(p) => (
                <Select {...p} value={t.type} onChange={(e) => setD({ ...d, trigger: blankTrigger(e.target.value as TriggerType) })}>
                  {TRIGGER_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {TRIGGER_INFO[x].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {t.type === "form_submitted" && (
              <Field label="Which form">
                {(p) => (
                  <Select {...p} value={t.config.formId} onChange={(e) => setD({ ...d, trigger: { type: "form_submitted", config: { formId: e.target.value } } })}>
                    <option value="">Any form</option>
                    <option value="contact">Contact form</option>
                    <option value="booking">Booking request form</option>
                    <option value="newsletter">Newsletter sign-up</option>
                  </Select>
                )}
              </Field>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">{TRIGGER_INFO[t.type].description}</p>
          {t.type === "schedule" && (
            <div className="mt-3 grid gap-2">
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((c) => (
                  <button key={c.cron} type="button" onClick={() => setD({ ...d, trigger: { type: "schedule", config: { ...t.config, cron: c.cron } } })} className={cx("rounded-full px-2.5 py-1 text-xs", t.config.cron === c.cron ? "bg-fg text-bg" : "bg-surface-2 text-muted hover:text-fg")}>
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Cron (minute hour day month weekday)">{(p) => <Input {...p} className="font-mono" value={t.config.cron} onChange={(e) => setD({ ...d, trigger: { type: "schedule", config: { ...t.config, cron: e.target.value } } })} />}</Field>
                <Field label="Time zone">{(p) => <Input {...p} value={t.config.timezone} onChange={(e) => setD({ ...d, trigger: { type: "schedule", config: { ...t.config, timezone: e.target.value } } })} />}</Field>
              </div>
              <SchedulePreview projectId={projectId} cron={t.config.cron} tz={t.config.timezone} />
            </div>
          )}
          {t.type === "webhook" && <p className="mt-2 text-xs text-muted">After saving, create the secret URL from the automation&apos;s menu. Send JSON with POST; it is available as {"{{trigger.body…}}"}.</p>}
        </section>

        <section className="grid gap-2">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <WorkflowIcon className="size-4" aria-hidden /> Then
          </p>
          {d.steps.length === 0 && <p className="text-[13px] text-muted">Add the first step.</p>}
          <ol className="grid gap-2">
            {d.steps.map((s, i) => (
              <li key={s.id} className="rounded-[var(--radius-lg)] border border-border">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-muted">{STEP_ICON[s.type]}</span>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                    <span className="font-medium">{STEP_INFO[s.type].label}</span>
                    <span className="truncate font-mono text-[11px] text-subtle">{s.id}</span>
                  </button>
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => move(i, -1)} />
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === d.steps.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => move(i, 1)} />
                  <Button size="sm" variant="ghost" aria-label="Remove step" icon={<Trash2 className="size-3.5" />} onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })} />
                </div>
                {open === s.id && (
                  <div className="border-t border-border p-3">
                    <StepEditor step={s} onChange={(x) => setStep(i, x)} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <Menu
            label="Add step"
            align="start"
            trigger={(p) => (
              <Button {...p} size="sm" icon={<Plus className="size-3.5" />} disabled={d.steps.length >= limits.MAX_STEPS} className="justify-self-start">
                Add step
              </Button>
            )}
            items={STEP_TYPES.map((type) => ({
              label: STEP_INFO[type].label,
              icon: STEP_ICON[type],
              onSelect: () => {
                const s = blankStep(type, d.steps);
                setD({ ...d, steps: [...d.steps, s], secrets: type === "slack" && !d.secrets.some((x) => x.name === "slackWebhookUrl") ? [...d.secrets, { name: "slackWebhookUrl", value: "", stored: false }] : d.secrets });
                setOpen(s.id);
              },
            }))}
          />
        </section>

        <section className="grid gap-2 rounded-[var(--radius-lg)] bg-surface-2 p-3">
          <p className="flex items-center gap-2 text-[12px] font-semibold">
            <KeyRound className="size-3.5" aria-hidden /> Secrets
            <span className="font-normal text-muted">— encrypted, never shown again; use as {"{{secrets.name}}"}</span>
          </p>
          {d.secrets.map((s, i) => (
            <div key={i} className="grid grid-cols-[160px_1fr_auto] items-center gap-2">
              <Input aria-label="Secret name" value={s.name} placeholder="apiToken" className="font-mono text-xs" onChange={(e) => setD({ ...d, secrets: d.secrets.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^\w]/g, "") } : x)) })} />
              <Input aria-label={`Value of ${s.name || "secret"}`} type="password" value={s.value} placeholder={s.stored ? "•••••• stored — leave empty to keep" : "Value"} onChange={(e) => setD({ ...d, secrets: d.secrets.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <Button size="sm" variant="ghost" aria-label="Remove secret" icon={<Trash2 className="size-3.5" />} onClick={() => setD({ ...d, secrets: d.secrets.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} className="justify-self-start" onClick={() => setD({ ...d, secrets: [...d.secrets, { name: "", value: "", stored: false }] })}>
            Add secret
          </Button>
        </section>

        <section className="grid gap-1.5">
          <p className="text-xs font-medium text-muted">Placeholders (click to copy)</p>
          <Placeholders trigger={t.type} steps={d.steps} secrets={d.secrets.map((s) => s.name).filter(Boolean)} onPick={copy} />
        </section>
      </div>
    </Dialog>
  );
}

function RunsPanel({ projectId, w }: { projectId: string; w: Workflow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [input, setInput] = useState('{\n  "email": "test@example.com"\n}');
  const [openRun, setOpenRun] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["automation-runs", w.id], queryFn: () => api<{ runs: Run[] }>(`/api/v1/projects/${projectId}/automations/${w.id}/runs`), refetchInterval: 4000 });
  const run = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/automations/${w.id}/run`, { method: "POST", body: { input: JSON.parse(input) } }),
    onSuccess: () => {
      toast({ tone: "success", title: "Run started", description: "Steps run in the background; this list updates live." });
      qc.invalidateQueries({ queryKey: ["automation-runs", w.id] });
    },
    onError: (e) => toast({ tone: "error", title: "Could not start", description: e instanceof SyntaxError ? "The test data is not valid JSON" : errorMessage(e) }),
  });
  const stop = useMutation({ mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/automations/${w.id}/runs/${id}/stop`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["automation-runs", w.id] }) });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="min-w-0">
        {!runs.data ? (
          <Skeleton className="h-32" />
        ) : runs.data.runs.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
            {runs.data.runs.map((r) => (
              <li key={r.id}>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2" onClick={() => setOpenRun(openRun === r.id ? null : r.id)} aria-expanded={openRun === r.id}>
                  <ChevronRight className={cx("size-3.5 text-subtle transition-transform", openRun === r.id && "rotate-90")} aria-hidden />
                  <StatusBadge status={r.status} />
                  <span className="text-muted">{TRIGGER_INFO[r.triggerType as TriggerType]?.label ?? r.triggerType}</span>
                  <span className="ml-auto text-xs text-subtle" title={dateTime(r.startedAt)}>
                    {timeAgo(r.startedAt)}
                  </span>
                </button>
                {openRun === r.id && (
                  <div className="grid gap-2 border-t border-border bg-surface-2/50 p-3 text-xs">
                    {r.error && <Notice tone="danger">{r.error}</Notice>}
                    <ol className="grid gap-1.5">
                      {r.log.map((l, i) => (
                        <li key={i} className="flex items-start gap-2">
                          {l.status === "succeeded" ? <CheckCircle2 className="mt-0.5 size-3.5 text-success" /> : l.status === "failed" ? <XCircle className="mt-0.5 size-3.5 text-danger" /> : <CircleDashed className="mt-0.5 size-3.5 text-muted" />}
                          <span className="min-w-0">
                            <span className="font-medium">{STEP_INFO[l.type as StepType]?.label ?? l.type}</span> <span className="text-subtle">· {l.status}{l.attempts > 1 ? ` after ${l.attempts} attempts` : ""}</span>
                            {l.error && <span className="block text-danger">{l.error}</span>}
                            {l.output !== undefined && <code className="mt-0.5 block max-h-24 overflow-auto rounded bg-surface p-1.5 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(l.output, null, 1)}</code>}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <details>
                      <summary className="cursor-pointer text-muted">Trigger data</summary>
                      <code className="mt-1 block max-h-40 overflow-auto rounded bg-surface p-1.5 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(r.input, null, 2)}</code>
                    </details>
                    {["running", "waiting"].includes(r.status) && (
                      <Button size="sm" variant="ghost" icon={<Square className="size-3" />} className="justify-self-start" onClick={() => stop.mutate(r.id)}>
                        Stop this run
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid content-start gap-2">
        <Field label="Test data (JSON)" hint="Becomes {{trigger.…}} for a manual run.">{(p) => <Textarea {...p} rows={6} className="font-mono text-xs" value={input} onChange={(e) => setInput(e.target.value)} />}</Field>
        <Button icon={<Play className="size-3.5" />} loading={run.isPending} onClick={() => run.mutate()} disabled={!w.steps.length}>
          Run now
        </Button>
      </div>
    </div>
  );
}

function JobsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["jobs", projectId], queryFn: () => api<{ jobs: Job[] }>(`/api/v1/projects/${projectId}/automations/jobs`), refetchInterval: 5000 });
  const act = useMutation({ mutationFn: ({ id, a }: { id: string; a: "retry" | "cancel" }) => api(`/api/v1/projects/${projectId}/automations/jobs/${id}/${a}`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs", projectId] }) });
  if (!q.data) return <Skeleton className="h-40" />;
  if (!q.data.jobs.length) return <EmptyState title="The queue is empty" description="Background work for this project (automation steps and retries) shows up here." />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-border">
            <th className="px-4 py-2 font-medium">Job</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Attempts</th>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {q.data.jobs.map((j) => (
            <tr key={j.id}>
              <td className="px-4 py-2 font-mono text-xs">{j.kind}</td>
              <td className="px-4 py-2">
                <StatusBadge status={j.status} />
                {j.lastError && <span className="block max-w-xs truncate text-xs text-danger" title={j.lastError}>{j.lastError}</span>}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {j.attempts}/{j.maxAttempts}
              </td>
              <td className="px-4 py-2 text-xs text-muted">{["queued", "failed"].includes(j.status) ? `runs ${timeAgo(j.runAt)}` : timeAgo(j.finishedAt ?? j.createdAt)}</td>
              <td className="px-4 py-2 text-right">
                {["dead", "failed"].includes(j.status) && (
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => act.mutate({ id: j.id, a: "retry" })}>
                    Retry now
                  </Button>
                )}
                {["queued", "failed"].includes(j.status) && (
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: j.id, a: "cancel" })}>
                    Cancel
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function AutomationsView({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const project = useProject(projectId);
  const can = project.data?.permissions.includes("automations:manage");
  const q = useQuery({ queryKey: ["automations", projectId], queryFn: () => api<{ workflows: Workflow[]; limits: Limits }>(`/api/v1/projects/${projectId}/automations`), enabled: !!can });
  const [tab, setTab] = useState<"automations" | "queue">("automations");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [hookUrl, setHookUrl] = useState<string | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: { email: string } }>("/api/v1/auth/me") });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api(`/api/v1/projects/${projectId}/automations/${id}/${on ? "enable" : "disable"}`, { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations", projectId] }),
    onError: (e) => toast({ tone: "error", title: "Could not switch it", description: errorMessage(e) }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/automations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["automations", projectId] });
    },
  });
  const webhook = useMutation({ mutationFn: (id: string) => api<{ url: string }>(`/api/v1/projects/${projectId}/automations/${id}/webhook`, { method: "POST", body: {} }), onSuccess: (r) => setHookUrl(r.url) });
  const sel = useMemo(() => q.data?.workflows.find((w) => w.id === selected) ?? null, [q.data, selected]);

  if (project.data && !can) return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8"><EmptyState icon={<WorkflowIcon className="size-5" />} title="Automations are managed by owners, admins and developers" /></div>;
  const edit = (w: Workflow) => setEditing({ id: w.id, name: w.name, trigger: w.trigger, steps: w.steps, secrets: w.secretNames.map((n) => ({ name: n, value: "", stored: true })) });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-xl">Automations</h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">When something happens — a form, an order, a booking, a schedule or a webhook — run steps automatically. Every step retries on failure and keeps a log.</p>
        </div>
        <Menu
          label="New automation"
          trigger={(p) => (
            <Button {...p} variant="primary" icon={<Plus className="size-3.5" />}>
              New automation
            </Button>
          )}
          items={[
            { label: "Start from scratch", icon: <Plus />, onSelect: () => setEditing({ name: "New automation", trigger: blankTrigger("form_submitted"), steps: [], secrets: [] }) },
            "separator" as const,
            ...RECIPES.map((r) => ({ label: r.title, icon: <Zap />, onSelect: () => setEditing(r.draft(me.data?.user.email ?? "")) })),
          ]}
        />
      </div>
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[{ value: "automations", label: "Automations" }, { value: "queue", label: "Job queue" }]} />
      {tab === "queue" ? (
        <JobsPanel projectId={projectId} />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-48" />
      ) : q.data.workflows.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RECIPES.map((r) => (
            <button key={r.title} onClick={() => setEditing(r.draft(me.data?.user.email ?? ""))} className="glass-card flex flex-col items-start gap-2 rounded-[var(--radius-xl)] p-5 text-left transition-transform duration-[var(--dur)] hover:-translate-y-0.5">
              <span className="flex size-9 items-center justify-center rounded-[11px] bg-fg text-bg">
                <Zap className="size-4" />
              </span>
              <span className="text-[14px] font-semibold">{r.title}</span>
              <span className="text-[13px] text-muted">{r.description}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {q.data.workflows.map((w) => (
            <Card key={w.id} className={cx("p-4", selected === w.id && "ring-2 ring-fg/15")}>
              <div className="flex flex-wrap items-center gap-3">
                <Switch label={`${w.enabled ? "Turn off" : "Turn on"} ${w.name}`} checked={w.enabled} onChange={(on) => toggle.mutate({ id: w.id, on })} />
                <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(selected === w.id ? null : w.id)}>
                  <p className="text-[14px] font-semibold">{w.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Zap className="size-3" aria-hidden /> {TRIGGER_INFO[w.trigger.type].label}
                    {w.steps.map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1">
                        <ChevronRight className="size-3 text-subtle" aria-hidden />
                        {STEP_INFO[s.type].label}
                      </span>
                    ))}
                  </p>
                </button>
                <span className="text-xs text-muted tabular-nums">
                  {w.runs7d} {w.runs7d === 1 ? "run" : "runs"} this week{w.failed7d ? <span className="text-danger"> · {w.failed7d} failed</span> : null}
                  {w.lastRunAt && <span className="block text-subtle">last {timeAgo(w.lastRunAt)}</span>}
                </span>
                <Button size="sm" onClick={() => edit(w)}>
                  Edit
                </Button>
                <Menu
                  label="More"
                  trigger={(p) => (
                    <Button {...p} size="sm" variant="ghost" aria-label="More">
                      •••
                    </Button>
                  )}
                  items={[
                    ...(w.trigger.type === "webhook" ? [{ label: w.hasWebhook ? "New webhook URL" : "Create webhook URL", icon: <Link2 />, onSelect: () => webhook.mutate(w.id) }] : []),
                    { label: "Runs and test", icon: <Play />, onSelect: () => setSelected(w.id) },
                    { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => setDeleting(w) },
                  ]}
                />
              </div>
              {sel?.id === w.id && (
                <div className="mt-4 border-t border-border pt-4">
                  <RunsPanel projectId={projectId} w={w} />
                </div>
              )}
            </Card>
          ))}
          <p className="text-xs text-subtle">
            Limits: {q.data.limits.MAX_WORKFLOWS} automations per project, {q.data.limits.MAX_STEPS} steps each, {q.data.limits.MAX_RUNS_PER_DAY.toLocaleString()} runs per automation per day, {q.data.limits.MAX_EMAILS_PER_DAY} automated emails per project per day.
          </p>
        </div>
      )}
      {editing && q.data && <Editor projectId={projectId} initial={editing} onClose={() => setEditing(null)} limits={q.data.limits} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.id)} loading={del.isPending} destructive title={`Delete “${deleting?.name}”?`} description="Its run history is deleted too. Runs in progress stop." confirmLabel="Delete" />
      <Dialog open={!!hookUrl} onClose={() => setHookUrl(null)} title="Webhook URL" description="Anyone with this URL can start the automation, so keep it secret. It's shown once; creating a new one disables the old one." footer={<Button variant="primary" onClick={() => setHookUrl(null)}>Done</Button>}>
        <div className="flex gap-2">
          <Input readOnly value={hookUrl ?? ""} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Webhook URL" />
          <Button icon={<Copy className="size-3.5" />} onClick={() => hookUrl && navigator.clipboard.writeText(hookUrl).then(() => toast({ tone: "success", title: "Copied" }))}>
            Copy
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Example: <code className="font-mono">curl -X POST -H &quot;Content-Type: application/json&quot; -d &apos;{"{"}&quot;event&quot;:&quot;signup&quot;{"}"}&apos; &lt;url&gt;</code>
        </p>
      </Dialog>
    </div>
  );
}
