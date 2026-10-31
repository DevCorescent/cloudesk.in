"use client";

// CRM settings: how it runs (privacy, assignment, currency), pipelines and
// stages, extra fields, where leads come from, lead scoring, email templates,
// the lists people pick from, and bringing data in.
import { ArrowUp, Copy, DownloadCloud, Plus, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, PageHeader, Select, Switch, Textarea, cx } from "@/components/ui/primitives";
import { DEFAULT_SCORING, FIELD_TYPES, LIFECYCLE, LIFECYCLE_LABEL, SCORE_SIGNALS, SIGNAL_LABEL, SOURCE_LABEL, type CrmSettings, type ScoreRule } from "@/lib/crm/model";
import { OwnerSelect, Section, useCrm, useCrmAction, type Pipeline, type Stage, LabeledSwitch } from "./shared";

const TABS = [
  { value: "general", label: "General" },
  { value: "pipelines", label: "Pipelines" },
  { value: "fields", label: "Fields" },
  { value: "capture", label: "Lead capture" },
  { value: "scoring", label: "Scoring" },
  { value: "templates", label: "Email templates" },
  { value: "lists", label: "Lists" },
  { value: "data", label: "Data" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function SettingsView({ tab }: { tab?: string }) {
  const { meta, go } = useCrm();
  const t = (TABS.some((x) => x.value === tab) ? tab : "general") as Tab;
  return (
    <div>
      <PageHeader title="CRM settings" description={meta.me.manage ? "How the CRM works for your whole team." : "Only workspace owners and admins can change these."} />
      <Tabs value={t} onChange={(v) => go(`settings/${v}`)} tabs={TABS.map((x) => ({ value: x.value, label: x.label }))} className="mb-5" />
      {t === "general" && <General />}
      {t === "pipelines" && <Pipelines />}
      {t === "fields" && <Fields />}
      {t === "capture" && <Capture />}
      {t === "scoring" && <Scoring />}
      {t === "templates" && <Templates />}
      {t === "lists" && <Lists />}
      {t === "data" && <Data />}
    </div>
  );
}

/** Saves a change to settings, merged over what's saved. */
function useSaveSettings(success = "Saved") {
  const { meta } = useCrm();
  return useCrmAction<Partial<Omit<CrmSettings, "settings">> & { settings?: Partial<CrmSettings["settings"]> }>(
    (p) => ({
      path: "settings",
      method: "PUT",
      body: { currency: meta.settings.currency, visibility: meta.settings.visibility, assignment: meta.settings.assignment, defaultOwnerId: meta.settings.defaultOwnerId, ...p, settings: { ...meta.settings.settings, ...(p.settings ?? {}) } },
    }),
    { success },
  );
}

function General() {
  const { meta } = useCrm();
  const save = useSaveSettings();
  const s = meta.settings;
  const off = !meta.me.manage;
  return (
    <div className="grid max-w-3xl gap-4">
      <Section title="Who sees what">
        <div className="grid gap-2">
          {(
            [
              ["all", "Everyone sees everything", "Good for small teams who share every customer."],
              ["own", "People see their own records", "Members see contacts and deals they own (and unassigned ones). Owners and admins still see all."],
            ] as const
          ).map(([v, l, d]) => (
            <label key={v} className={cx("flex cursor-pointer gap-3 rounded-[14px] border p-3", s.visibility === v ? "border-fg/40 bg-surface-2" : "border-border")}>
              <input type="radio" name="visibility" disabled={off} checked={s.visibility === v} onChange={() => save.mutate({ visibility: v })} className="mt-1" />
              <span>
                <b className="block text-[13.5px]">{l}</b>
                <span className="text-[12.5px] text-muted">{d}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>
      <Section title="New leads that arrive by themselves">
        <p className="mb-3 text-[12.5px] text-muted">From website forms, the lead link, orders and bookings. People you add by hand are yours.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assign to">
            {(a) => (
              <Select {...a} disabled={off} value={s.assignment} onChange={(e) => save.mutate({ assignment: e.target.value as CrmSettings["assignment"] })}>
                <option value="none">Nobody (unassigned)</option>
                <option value="round_robin">Take turns (round-robin)</option>
                <option value="default">One person</option>
              </Select>
            )}
          </Field>
          {s.assignment === "default" && <Field label="Person">{() => <OwnerSelect value={s.defaultOwnerId} onChange={(v) => save.mutate({ defaultOwnerId: v })} allowNone={false} />}</Field>}
        </div>
        <div className="mt-3">
          <LabeledSwitch checked={s.settings.notify} disabled={off} onChange={(v) => save.mutate({ settings: { notify: v } })} label="Email the owner when a new lead fills in a form" />
        </div>
      </Section>
      <Section title="Currency">
        <Select aria-label="Currency" disabled={off} value={s.currency} onChange={(e) => save.mutate({ currency: e.target.value })} className="max-w-xs">
          {["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <p className="mt-2 text-[12px] text-muted">New deals use this. Existing deals keep theirs.</p>
      </Section>
    </div>
  );
}

function Pipelines() {
  const { meta } = useCrm();
  const [editing, setEditing] = useState<Pipeline | "new" | null>(null);
  const [deleting, setDeleting] = useState<Pipeline | null>(null);
  const del = useCrmAction<string>((id) => ({ path: `pipelines/${id}`, method: "DELETE" }), { success: "Pipeline deleted", onDone: () => setDeleting(null) });
  return (
    <div className="grid max-w-3xl gap-4">
      {meta.pipelines.map((p) => (
        <Section key={p.id} title={p.name} action={meta.me.manage ? <span className="flex gap-1"><Button size="sm" onClick={() => setEditing(p)}>Edit</Button>{meta.pipelines.length > 1 && <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} icon={<Trash2 className="size-4" />} onClick={() => setDeleting(p)} />}</span> : undefined}>
          <ol className="flex flex-wrap gap-1.5">
            {p.stages.map((s) => (
              <li key={s.id} className={cx("rounded-full px-3 py-1 text-[12.5px] font-medium", s.kind === "won" ? "bg-success-soft text-success" : s.kind === "lost" ? "bg-danger-soft text-danger" : "bg-surface-2")}>
                {s.name} {s.kind === "open" && <span className="text-subtle">· {s.probability}%</span>}
              </li>
            ))}
          </ol>
        </Section>
      ))}
      {meta.me.manage && (
        <Button size="sm" icon={<Plus className="size-4" />} className="justify-self-start" onClick={() => setEditing("new")}>
          Add a pipeline
        </Button>
      )}
      <p className="text-[12.5px] text-muted">Use more than one pipeline for different kinds of selling — say, new business and renewals, or events and catering.</p>
      {editing && <PipelineEditor init={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => del.mutate(deleting!.id)} loading={del.isPending} destructive title={`Delete ${deleting?.name}?`} description="Only an empty pipeline can be deleted — move or delete its deals first." confirmLabel="Delete" />
    </div>
  );
}

type EditStage = { id?: string; name: string; probability: number; kind: Stage["kind"]; rotDays: number };
function PipelineEditor({ init, onClose }: { init: Pipeline | null; onClose: () => void }) {
  const [name, setName] = useState(init?.name ?? "");
  const [stages, setStages] = useState<EditStage[]>(
    init?.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, kind: s.kind, rotDays: s.rotDays })) ?? [
      { name: "New", probability: 10, kind: "open", rotDays: 7 },
      { name: "In discussion", probability: 40, kind: "open", rotDays: 14 },
      { name: "Proposal", probability: 70, kind: "open", rotDays: 14 },
      { name: "Won", probability: 100, kind: "won", rotDays: 0 },
      { name: "Lost", probability: 0, kind: "lost", rotDays: 0 },
    ],
  );
  const save = useCrmAction(() => ({ path: init ? `pipelines/${init.id}` : "pipelines", method: init ? "PUT" : "POST", body: { name, stages: [...stages.filter((s) => s.kind === "open"), ...stages.filter((s) => s.kind !== "open")] } }), { success: "Pipeline saved", onDone: onClose });
  const open = stages.filter((s) => s.kind === "open");
  const closed = stages.filter((s) => s.kind !== "open");
  const setOpen = (list: EditStage[]) => setStages([...list, ...closed]);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={init ? `Edit ${init.name}` : "New pipeline"}
      description="Stages in the order deals move through them. The chance of winning drives the weighted forecast; “flag after” marks deals that sit too long."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !open.length || stages.some((s) => !s.name.trim())} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Pipeline name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="Sales" />}</Field>
        <div>
          <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_88px_96px_72px] gap-2 px-1 text-[11.5px] font-medium text-muted">
            <span>Stage</span>
            <span>Chance %</span>
            <span>Flag after (days)</span>
            <span />
          </div>
          <ol className="grid gap-1.5">
            {open.map((s, i) => (
              <li key={s.id ?? `n${i}`} className="grid grid-cols-[minmax(0,1fr)_88px_96px_72px] items-center gap-2">
                <Input aria-label="Stage name" value={s.name} onChange={(e) => setOpen(open.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={60} />
                <Input aria-label="Chance of winning" inputMode="numeric" value={String(s.probability)} onChange={(e) => setOpen(open.map((x, j) => (j === i ? { ...x, probability: Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0) } : x)))} />
                <Input aria-label="Flag after days" inputMode="numeric" value={String(s.rotDays)} onChange={(e) => setOpen(open.map((x, j) => (j === i ? { ...x, rotDays: Math.min(365, Number(e.target.value.replace(/\D/g, "")) || 0) } : x)))} />
                <span className="flex">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => setOpen(open.map((x, j) => (j === i - 1 ? open[i] : j === i ? open[i - 1] : x)))} />
                  <Button size="sm" variant="ghost" aria-label="Remove" disabled={open.length === 1} icon={<X className="size-3.5" />} onClick={() => setOpen(open.filter((_, j) => j !== i))} />
                </span>
              </li>
            ))}
          </ol>
          <Button size="sm" variant="ghost" className="mt-1.5" icon={<Plus className="size-3.5" />} onClick={() => setOpen([...open, { name: "", probability: 50, kind: "open", rotDays: 14 }])}>
            Add a stage
          </Button>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {closed.map((s) => (
              <Field key={s.kind} label={s.kind === "won" ? "Won stage name" : "Lost stage name"}>
                {(a) => <Input {...a} value={s.name} onChange={(e) => setStages([...open, ...closed.map((x) => (x.kind === s.kind ? { ...x, name: e.target.value } : x))])} maxLength={60} />}
              </Field>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Fields() {
  const { meta } = useCrm();
  const [entity, setEntity] = useState<"contact" | "company" | "deal">("contact");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<(typeof FIELD_TYPES)[number]>("text");
  const [options, setOptions] = useState("");
  const add = useCrmAction(() => ({ path: "fields", body: { entity, label, type, options: options.split(",").map((o) => o.trim()).filter(Boolean) } }), { success: "Field added", onDone: () => (setLabel(""), setOptions("")) });
  const del = useCrmAction<string>((id) => ({ path: `fields/${id}`, method: "DELETE" }), { success: "Field removed" });
  const list = meta.fields.filter((f) => f.entity === entity);
  const TYPE_LABEL: Record<string, string> = { text: "Text", number: "Number", date: "Date", select: "Choice list", checkbox: "Yes / no", url: "Link" };
  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex gap-1">
        {(["contact", "company", "deal"] as const).map((e) => (
          <button key={e} type="button" onClick={() => setEntity(e)} aria-pressed={entity === e} className={cx("h-8 rounded-full px-3 text-[13px] font-medium", entity === e ? "bg-fg text-bg" : "border border-border text-muted")}>
            {e === "contact" ? "Contacts" : e === "company" ? "Companies" : "Deals"}
          </button>
        ))}
      </div>
      <Section title="Extra fields">
        {!list.length ? (
          <p className="text-[13px] text-muted">None yet. Add things you need to know — budget, GST number, preferred language, anniversary.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2 text-[13.5px]">
                <b className="flex-1 font-medium">{f.label}</b>
                <span className="text-[12px] text-muted">
                  {TYPE_LABEL[f.type]}
                  {f.options.length ? `: ${f.options.join(", ")}` : ""}
                </span>
                {meta.me.manage && <Button size="sm" variant="ghost" aria-label={`Remove ${f.label}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(f.id)} />}
              </li>
            ))}
          </ul>
        )}
        {meta.me.manage && (
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]">
            <Input aria-label="Field name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Field name, e.g. Annual budget" maxLength={60} />
            <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            <Button variant="primary" loading={add.isPending} disabled={!label.trim()} onClick={() => add.mutate()}>
              Add field
            </Button>
            {type === "select" && <Input aria-label="Choices" className="sm:col-span-3" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Choices, separated by commas: Hindi, English, Marathi" />}
          </div>
        )}
      </Section>
    </div>
  );
}

function Capture() {
  const { meta } = useCrm();
  const toast = useToast();
  const save = useSaveSettings();
  const [url, setUrl] = useState(meta.settings.captureUrl);
  const rotate = useCrmAction<void, { url: string }>(() => ({ path: "settings/token" }), { success: "New link made — the old one stops working", onDone: (r) => setUrl(r.url) });
  const c = meta.settings.settings.capture;
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast({ tone: "success", title: "Copied" }));
  const snippet = `<form action="${url}" method="post">\n  <input name="name" placeholder="Your name" required>\n  <input name="email" type="email" placeholder="Email" required>\n  <input name="phone" placeholder="Phone">\n  <input name="company" placeholder="Company">\n  <textarea name="message" placeholder="How can we help?"></textarea>\n  <input name="website" style="display:none" tabindex="-1" autocomplete="off">\n  <input type="hidden" name="redirect" value="https://your-site.com/thank-you">\n  <button>Send</button>\n</form>`;
  const ROWS: [keyof typeof c, string, string][] = [
    ["forms", "Website forms", "Contact forms on sites built with Cloudesk."],
    ["orders", "Store & counter sales", "Online orders and shop-counter sales with an email."],
    ["bookings", "Bookings", "Appointments and classes booked online."],
    ["horeca", "Restaurant & hotel guests", "Guests whose phone is taken at the till."],
    ["invoicing", "Invoicing clients", "Clients added to invoices and quotes."],
  ];
  return (
    <div className="grid max-w-3xl gap-4">
      <Section title="From the rest of Cloudesk">
        <p className="mb-3 text-[12.5px] text-muted">New people are added and people already here are updated — matched by email or phone, never duplicated.</p>
        <ul className="divide-y divide-border">
          {ROWS.map(([k, l, d]) => (
            <li key={k} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <b className="block text-[13.5px] font-medium">{l}</b>
                <span className="text-[12px] text-muted">{d}</span>
              </span>
              <Switch checked={c[k]} disabled={!meta.me.manage} onChange={(v) => save.mutate({ settings: { capture: { ...c, [k]: v } } })} label={l} />
            </li>
          ))}
        </ul>
      </Section>
      {meta.me.manage && url && (
        <Section title="Lead link — for any other form, landing page or ad">
          <p className="mb-2 text-[12.5px] text-muted">Point a form here (POST, as a normal form or JSON). Fields named name, email, phone, company and message are understood; first/last name, mobile and similar work too.</p>
          <div className="flex gap-2">
            <Input readOnly aria-label="Lead link" value={url} className="font-mono !text-[12px]" onFocus={(e) => e.currentTarget.select()} />
            <Button icon={<Copy className="size-4" />} onClick={() => copy(url)}>
              Copy
            </Button>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-medium">Show a ready-to-paste HTML form</summary>
            <pre className="mt-2 overflow-x-auto rounded-[12px] bg-surface-2 p-3 text-[11.5px] leading-relaxed">{snippet}</pre>
            <Button size="sm" className="mt-2" icon={<Copy className="size-3.5" />} onClick={() => copy(snippet)}>
              Copy the form
            </Button>
          </details>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={rotate.isPending} onClick={() => rotate.mutate()}>
              Make a new link
            </Button>
            <span className="text-[12px] text-muted">If the link is being abused. Forms using the old one stop working.</span>
          </div>
        </Section>
      )}
    </div>
  );
}

function Scoring() {
  const { meta } = useCrm();
  const save = useSaveSettings("Scoring saved — everyone's score is updated");
  const [rules, setRules] = useState<ScoreRule[]>(meta.settings.settings.scoring);
  const needsValue = (s: string) => ["source", "tag", "lifecycle"].includes(s);
  const sources = [...new Set(["manual", "web_form", "web_to_lead", "store", "pos", "booking", "horeca", "invoicing", "import", ...meta.settings.settings.sources])];
  return (
    <div className="grid max-w-3xl gap-4">
      <Section title="Lead score rules">
        <p className="mb-3 text-[12.5px] text-muted">Each rule that applies adds (or takes away) points. Scores run from 0 to 100 and update by themselves as people are contacted. Hot leads score 60 or more.</p>
        <ul className="grid gap-2">
          {rules.map((r, i) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_84px_32px] items-center gap-2">
              <Select aria-label="When" value={r.signal} disabled={!meta.me.manage} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, signal: e.target.value as ScoreRule["signal"], value: "" } : x)))}>
                {SCORE_SIGNALS.map((s) => (
                  <option key={s} value={s}>
                    {SIGNAL_LABEL[s]}
                  </option>
                ))}
              </Select>
              {needsValue(r.signal) ? (
                r.signal === "lifecycle" ? (
                  <Select aria-label="Stage" value={r.value} disabled={!meta.me.manage} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                    <option value="">Choose…</option>
                    {LIFECYCLE.map((l) => (
                      <option key={l} value={l}>
                        {LIFECYCLE_LABEL[l]}
                      </option>
                    ))}
                  </Select>
                ) : r.signal === "source" ? (
                  <Select aria-label="Source" value={r.value} disabled={!meta.me.manage} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                    <option value="">Choose…</option>
                    {sources.map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_LABEL[s] ?? s}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input aria-label="Tag" value={r.value} disabled={!meta.me.manage} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="Tag" />
                )
              ) : (
                <span className="text-[12px] text-subtle">{r.signal === "activities" ? "up to 10 count" : ""}</span>
              )}
              <Input aria-label="Points" inputMode="numeric" value={String(r.points)} disabled={!meta.me.manage} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, points: Math.max(-100, Math.min(100, Number(e.target.value.replace(/[^\d-]/g, "")) || 0)) } : x)))} />
              {meta.me.manage && <Button size="sm" variant="ghost" aria-label="Remove rule" icon={<X className="size-3.5" />} onClick={() => setRules(rules.filter((_, j) => j !== i))} />}
            </li>
          ))}
        </ul>
        {meta.me.manage && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRules([...rules, { id: `r${Date.now()}`, signal: "tag", value: "", points: 10 }])}>
              Add a rule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRules(DEFAULT_SCORING)}>
              Back to the defaults
            </Button>
            <Button size="sm" variant="primary" className="ml-auto" loading={save.isPending} onClick={() => save.mutate({ settings: { scoring: rules.filter((r) => !needsValue(r.signal) || r.value) } })}>
              Save and rescore
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}

function Templates() {
  const { meta } = useCrm();
  const save = useSaveSettings();
  const list = meta.settings.settings.templates;
  const [edit, setEdit] = useState<{ id: string; name: string; subject: string; body: string } | null>(null);
  const put = (t: NonNullable<typeof edit>) => save.mutate({ settings: { templates: list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t] } }, { onSuccess: () => setEdit(null) });
  return (
    <div className="grid max-w-3xl gap-4">
      <Section title="Email templates" action={meta.me.manage ? <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ id: `t${Date.now()}`, name: "", subject: "", body: "" })}>Template</Button> : undefined}>
        <p className="mb-3 text-[12.5px] text-muted">Ready-made emails your team can pick when writing to someone. Merge fields: {"{{first_name}}"}, {"{{name}}"}, {"{{company}}"}, {"{{title}}"}, {"{{owner_name}}"}.</p>
        {!list.length ? (
          <p className="text-[13px] text-muted">No templates yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <b className="block text-[13.5px] font-medium">{t.name}</b>
                  <span className="block truncate text-[12px] text-muted">{t.subject}</span>
                </span>
                {meta.me.manage && (
                  <>
                    <Button size="sm" onClick={() => setEdit(t)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => save.mutate({ settings: { templates: list.filter((x) => x.id !== t.id) } })} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} size="lg" title={edit.name ? `Edit ${edit.name}` : "New template"} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!edit.name.trim() || !edit.subject.trim() || !edit.body.trim()} onClick={() => put(edit)}>Save</Button></>}>
          <div className="grid gap-3">
            <Field label="Name">{(a) => <Input {...a} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} autoFocus placeholder="Quote follow-up" />}</Field>
            <Field label="Subject">{(a) => <Input {...a} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} maxLength={200} />}</Field>
            <Field label="Message">{(a) => <Textarea {...a} rows={8} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} maxLength={10000} />}</Field>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ChipList({ title, hint, value, onSave, label = (s: string) => s }: { title: string; hint: string; value: string[]; onSave: (v: string[]) => void; label?: (s: string) => string }) {
  const { meta } = useCrm();
  const [t, setT] = useState("");
  return (
    <Section title={title}>
      <p className="mb-3 text-[12.5px] text-muted">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 px-3 text-[13px]">
            {label(v)}
            {meta.me.manage && (
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onSave(value.filter((x) => x !== v))} className="text-subtle hover:text-fg">
                <X className="size-3.5" />
              </button>
            )}
          </span>
        ))}
      </div>
      {meta.me.manage && (
        <form
          className="mt-3 flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (t.trim() && !value.includes(t.trim())) onSave([...value, t.trim()]);
            setT("");
          }}
        >
          <Input aria-label={`Add to ${title}`} value={t} onChange={(e) => setT(e.target.value)} maxLength={60} placeholder="Add one" />
          <Button type="submit" disabled={!t.trim()}>
            Add
          </Button>
        </form>
      )}
    </Section>
  );
}

function Lists() {
  const { meta } = useCrm();
  const save = useSaveSettings();
  const s = meta.settings.settings;
  return (
    <div className="grid max-w-3xl gap-4">
      <ChipList title="Reasons deals are lost" hint="Offered when someone marks a deal as lost; Reports counts them." value={s.lostReasons} onSave={(v) => save.mutate({ settings: { lostReasons: v } })} />
      <ChipList title="Lead sources" hint="Where people come from, for contacts added by hand. Captured leads set their own (website form, store, booking…)." value={s.sources} label={(x) => SOURCE_LABEL[x] ?? x} onSave={(v) => save.mutate({ settings: { sources: v.map((x) => x.toLowerCase().replace(/\s+/g, "_").slice(0, 40)) } })} />
    </div>
  );
}

function Data() {
  const { meta, orgId } = useCrm();
  const [result, setResult] = useState<{ created: number; updated: number; sources: Record<string, number> } | null>(null);
  const sync = useCrmAction<void, { created: number; updated: number; sources: Record<string, number> }>(() => ({ path: "sync" }), { onDone: setResult });
  return (
    <div className="grid max-w-3xl gap-4">
      <Section title="Bring in everyone already in Cloudesk">
        <p className="mb-3 text-[12.5px] text-muted">Store and counter customers, bookings, restaurant guests, invoicing clients and website form entries from every project in this workspace. Safe to run again — people are matched by email or phone.</p>
        {result && (
          <div className="mb-3">
            <Notice tone="success" title={`${result.created} added · ${result.updated} updated`}>
              {Object.entries(result.sources)
                .map(([k, n]) => `${SOURCE_LABEL[k] ?? k}: ${n}`)
                .join(" · ") || "Nothing new to bring in."}
            </Notice>
          </div>
        )}
        {meta.me.write && (
          <Button variant="primary" icon={<DownloadCloud className="size-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>
            Bring them in
          </Button>
        )}
      </Section>
      <Section title="Import & export">
        <ul className="grid gap-2 text-[13.5px]">
          <li>
            <Link href="/crm/contacts" className="font-medium underline">
              Import a spreadsheet
            </Link>{" "}
            <span className="text-muted">— on Contacts, under “Import & export”.</span>
          </li>
          <li>
            <a href={`/api/v1/orgs/${orgId}/crm/contacts/export`} className="font-medium underline">
              Download all contacts (CSV)
            </a>
          </li>
          <li>
            <a href={`/api/v1/orgs/${orgId}/crm/deals/export`} className="font-medium underline">
              Download all deals (CSV)
            </a>
          </li>
        </ul>
      </Section>
    </div>
  );
}

