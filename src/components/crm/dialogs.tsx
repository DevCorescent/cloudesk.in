"use client";

// Adding and editing: contacts, companies, deals and tasks. Short by default —
// the rest is a click away under "More details".
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Button, Field, Input, Select, Textarea, cx } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/client/api";
import { LIFECYCLE, LIFECYCLE_LABEL, PRIORITIES, SOURCE_LABEL } from "@/lib/crm/model";
import { Avatar, crmApi, CustomInput, OwnerSelect, TagInput, toMajor, toMinor, useCrm, useCrmAction, type Contact, type Deal } from "./shared";

type Ref = { id: string; label: string; sub?: string };

/** Search-as-you-type for a contact, company or deal. */
export function RecordPicker({ kind, value, onChange, placeholder }: { kind: "contacts" | "companies" | "deals"; value: Ref | null; onChange: (v: Ref | null) => void; placeholder?: string }) {
  const { orgId } = useCrm();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useQuery({ queryKey: ["crm", orgId, "search", q], queryFn: () => api<{ contacts: { id: string; name: string; email: string; phone: string }[]; companies: { id: string; name: string; domain: string }[]; deals: { id: string; title: string }[] }>(crmApi(orgId, `search?q=${encodeURIComponent(q)}`)), enabled: q.trim().length >= 1 });
  const list: Ref[] =
    kind === "contacts" ? (hits.data?.contacts ?? []).map((c) => ({ id: c.id, label: c.name || c.email || c.phone, sub: c.email || c.phone })) : kind === "companies" ? (hits.data?.companies ?? []).map((c) => ({ id: c.id, label: c.name, sub: c.domain })) : (hits.data?.deals ?? []).map((d) => ({ id: d.id, label: d.title }));
  if (value)
    return (
      <div className="flex h-9 items-center gap-2 rounded-[12px] border border-border bg-surface px-2.5">
        <Avatar name={value.label} size={22} square={kind !== "contacts"} />
        <span className="min-w-0 flex-1 truncate text-[13.5px]">{value.label}</span>
        <button type="button" aria-label="Clear" onClick={() => onChange(null)} className="text-subtle hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
    );
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => (setQ(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder ?? "Search…"} aria-label={placeholder ?? `Find a ${kind.slice(0, -1)}`} />
      {open && q.trim() && (
        <ul className="absolute inset-x-0 top-10 z-50 max-h-56 overflow-y-auto rounded-[14px] border border-border bg-surface-solid p-1 shadow-lg">
          {!list.length ? (
            <li className="px-3 py-2 text-[12.5px] text-muted">{hits.isFetching ? "Searching…" : "No match"}</li>
          ) : (
            list.map((r) => (
              <li key={r.id}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (onChange(r), setQ(""), setOpen(false))} className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-surface-2">
                  <Avatar name={r.label} size={22} square={kind !== "contacts"} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{r.label}</span>
                    {r.sub && <span className="block truncate text-[11.5px] text-muted">{r.sub}</span>}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function More({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-1 justify-self-start text-[13px] font-medium text-muted hover:text-fg sm:col-span-2">
      <ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} />
      {open ? "Fewer details" : "More details"}
    </button>
  );
}

export function ContactDialog({ init, onClose, onSaved }: { init?: Partial<Contact> & { company?: string }; onClose: () => void; onSaved?: (c: Contact) => void }) {
  const { meta, go } = useCrm();
  const editing = !!init?.id;
  const fields = meta.fields.filter((f) => f.entity === "contact");
  const [f, setF] = useState({
    name: init?.name ?? "",
    email: init?.email ?? "",
    phone: init?.phone ?? "",
    title: init?.title ?? "",
    companyName: init?.company ?? "",
    lifecycle: init?.lifecycle ?? "lead",
    leadStatus: init?.leadStatus ?? "new",
    source: init?.source ?? "manual",
    ownerId: init?.ownerId ?? meta.me.id,
    tags: init?.tags ?? [],
    city: init?.city ?? "",
    country: init?.country ?? "",
    marketing: init?.marketing ?? false,
    doNotContact: init?.doNotContact ?? false,
    custom: (init?.custom ?? {}) as Record<string, string | number | boolean | null>,
  });
  const [more, setMore] = useState(editing);
  const [dupe, setDupe] = useState<{ id: string; message: string } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useCrmAction<void, { contact: Contact }>(
    () => ({ path: editing ? `contacts/${init!.id}` : "contacts", method: editing ? "PUT" : "POST", body: { ...f, ...(editing && f.companyName === (init?.company ?? "") ? { companyName: undefined } : {}) } }),
    {
      success: editing ? "Saved" : "Contact added",
      onDone: (r) => {
        onClose();
        onSaved?.(r.contact);
      },
      onError: (e) => {
        if (e instanceof ApiClientError && e.status === 409 && (e.details as { existingId?: string } | null)?.existingId) {
          setDupe({ id: (e.details as { existingId: string }).existingId, message: e.message });
          return true;
        }
        return false;
      },
    },
  );
  const sources = [...new Set(["manual", ...meta.settings.settings.sources, f.source])];
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${init?.name || init?.email || "contact"}` : "New contact"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() && !f.email.trim() && !f.phone.trim()} onClick={() => save.mutate()}>
            {editing ? "Save" : "Add contact"}
          </Button>
        </>
      }
    >
      {dupe && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[14px] bg-warning-soft px-3 py-2.5 text-[13px]">
          <span>{dupe.message}.</span>
          <Button size="sm" onClick={() => (onClose(), go(`contacts/${dupe.id}`))}>
            Open them
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoFocus placeholder="Asha Kapoor" />}</Field>
        <Field label="Company" hint="Type a name — it's created if new.">{(a) => <Input {...a} value={f.companyName} onChange={(e) => set("companyName", e.target.value)} maxLength={160} placeholder="Acme Foods" />}</Field>
        <Field label="Email">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => (set("email", e.target.value), setDupe(null))} maxLength={200} placeholder="asha@acme.in" />}</Field>
        <Field label="Phone">{(a) => <Input {...a} type="tel" value={f.phone} onChange={(e) => (set("phone", e.target.value), setDupe(null))} maxLength={30} placeholder="+91 98200 00000" />}</Field>
        <Field label="Stage">
          {(a) => (
            <Select {...a} value={f.lifecycle} onChange={(e) => set("lifecycle", e.target.value as typeof f.lifecycle)}>
              {LIFECYCLE.map((l) => (
                <option key={l} value={l}>
                  {LIFECYCLE_LABEL[l]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Owner">{() => <OwnerSelect value={f.ownerId} onChange={(v) => set("ownerId", v ?? "")} />}</Field>
        <More open={more} onToggle={() => setMore(!more)} />
        {more && (
          <>
            <Field label="Job title">{(a) => <Input {...a} value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder="Head of Operations" />}</Field>
            <Field label="Source">
              {(a) => (
                <Select {...a} value={f.source} onChange={(e) => set("source", e.target.value)}>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABEL[s] ?? s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="City">{(a) => <Input {...a} value={f.city} onChange={(e) => set("city", e.target.value)} maxLength={80} />}</Field>
            <Field label="Country">{(a) => <Input {...a} value={f.country} onChange={(e) => set("country", e.target.value)} maxLength={80} />}</Field>
            <Field label="Tags" className="sm:col-span-2">{() => <TagInput value={f.tags} onChange={(v) => set("tags", v)} />}</Field>
            {fields.map((fd) => (
              <Field key={fd.id} label={fd.label}>
                {() => <CustomInput field={fd} value={f.custom[fd.key]} onChange={(v) => set("custom", { ...f.custom, [fd.key]: v })} />}
              </Field>
            ))}
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" checked={f.marketing} onChange={(e) => set("marketing", e.target.checked)} /> Agreed to marketing email
            </label>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" checked={f.doNotContact} onChange={(e) => set("doNotContact", e.target.checked)} /> Do not contact (no emails or sequences)
            </label>
          </>
        )}
      </div>
    </Dialog>
  );
}

export type CompanyRow = { id: string; name: string; domain: string; industry: string; size: string; phone: string; website: string; address: string; city: string; country: string; gstin: string; ownerId: string | null; tags: string[]; custom: Record<string, unknown>; notes: string };

export function CompanyDialog({ init, onClose, onSaved }: { init?: Partial<CompanyRow>; onClose: () => void; onSaved?: (c: CompanyRow) => void }) {
  const { meta } = useCrm();
  const editing = !!init?.id;
  const fields = meta.fields.filter((f) => f.entity === "company");
  const [f, setF] = useState({ name: init?.name ?? "", domain: init?.domain ?? "", industry: init?.industry ?? "", size: init?.size ?? "", phone: init?.phone ?? "", website: init?.website ?? "", address: init?.address ?? "", city: init?.city ?? "", country: init?.country ?? "", gstin: init?.gstin ?? "", ownerId: init?.ownerId ?? meta.me.id, tags: init?.tags ?? [], notes: init?.notes ?? "", custom: (init?.custom ?? {}) as Record<string, string | number | boolean | null> });
  const [more, setMore] = useState(editing);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useCrmAction<void, { company: CompanyRow }>(() => ({ path: editing ? `companies/${init!.id}` : "companies", method: editing ? "PUT" : "POST", body: f }), { success: editing ? "Saved" : "Company added", onDone: (r) => (onClose(), onSaved?.(r.company)) });
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${init?.name}` : "New company"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
            {editing ? "Save" : "Add company"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name">{(a) => <Input {...a} value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={160} autoFocus />}</Field>
        <Field label="Website domain" hint="People with emails here join this company.">{(a) => <Input {...a} value={f.domain} onChange={(e) => set("domain", e.target.value)} maxLength={120} placeholder="acme.in" />}</Field>
        <Field label="Industry">{(a) => <Input {...a} value={f.industry} onChange={(e) => set("industry", e.target.value)} maxLength={80} placeholder="Food & beverage" />}</Field>
        <Field label="Owner">{() => <OwnerSelect value={f.ownerId} onChange={(v) => set("ownerId", v ?? "")} />}</Field>
        <More open={more} onToggle={() => setMore(!more)} />
        {more && (
          <>
            <Field label="Size">
              {(a) => (
                <Select {...a} value={f.size} onChange={(e) => set("size", e.target.value)}>
                  <option value="">—</option>
                  {["1–10", "11–50", "51–200", "201–1,000", "1,000+"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Phone">{(a) => <Input {...a} value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} />}</Field>
            <Field label="City">{(a) => <Input {...a} value={f.city} onChange={(e) => set("city", e.target.value)} maxLength={80} />}</Field>
            <Field label="GSTIN">{(a) => <Input {...a} value={f.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} />}</Field>
            <Field label="Address" className="sm:col-span-2">{(a) => <Input {...a} value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={300} />}</Field>
            <Field label="Tags" className="sm:col-span-2">{() => <TagInput value={f.tags} onChange={(v) => set("tags", v)} />}</Field>
            {fields.map((fd) => (
              <Field key={fd.id} label={fd.label}>
                {() => <CustomInput field={fd} value={f.custom[fd.key]} onChange={(v) => set("custom", { ...f.custom, [fd.key]: v })} />}
              </Field>
            ))}
            <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={4000} />}</Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function DealDialog({ init, contact, company, onClose, onSaved }: { init?: Partial<Deal>; contact?: Ref | null; company?: Ref | null; onClose: () => void; onSaved?: (d: Deal) => void }) {
  const { meta } = useCrm();
  const editing = !!init?.id;
  const fields = meta.fields.filter((f) => f.entity === "deal");
  const p0 = meta.pipelines.find((p) => p.id === init?.pipelineId) ?? meta.pipelines[0];
  const [f, setF] = useState({
    title: init?.title ?? "",
    value: toMajor(init?.value ?? 0),
    pipelineId: p0.id,
    stageId: init?.stageId ?? p0.stages.find((s) => s.kind === "open")!.id,
    ownerId: init?.ownerId ?? meta.me.id,
    expectedClose: init?.expectedClose ?? "",
    priority: init?.priority ?? "normal",
    source: init?.source ?? "",
    tags: init?.tags ?? [],
    custom: (init?.custom ?? {}) as Record<string, string | number | boolean | null>,
  });
  const [who, setWho] = useState<Ref | null>(contact ?? (init?.contactId ? { id: init.contactId, label: init.contact || "Contact" } : null));
  const [co, setCo] = useState<Ref | null>(company ?? (init?.companyId ? { id: init.companyId, label: init.company || "Company" } : null));
  const [more, setMore] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const pipeline = meta.pipelines.find((p) => p.id === f.pipelineId)!;
  const save = useCrmAction<void, { deal: Deal }>(
    () => ({ path: editing ? `deals/${init!.id}` : "deals", method: editing ? "PUT" : "POST", body: { ...f, value: toMinor(f.value), expectedClose: f.expectedClose || null, contactId: who?.id ?? null, companyId: co?.id ?? null } }),
    { success: editing ? "Saved" : "Deal created", onDone: (r) => (onClose(), onSaved?.(r.deal)) },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${init?.title}` : "New deal"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>
            {editing ? "Save" : "Create deal"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Deal name" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={160} autoFocus placeholder="Acme — annual catering contract" />}</Field>
        <Field label={`Value (${meta.settings.currency})`}>{(a) => <Input {...a} inputMode="decimal" value={f.value} onChange={(e) => set("value", e.target.value)} placeholder="250000" />}</Field>
        <Field label="Expected close">{(a) => <Input {...a} type="date" value={f.expectedClose} onChange={(e) => set("expectedClose", e.target.value)} />}</Field>
        <Field label="Contact">{() => <RecordPicker kind="contacts" value={who} onChange={setWho} placeholder="Find a person" />}</Field>
        <Field label="Company">{() => <RecordPicker kind="companies" value={co} onChange={setCo} placeholder="Find a company" />}</Field>
        {!editing && (
          <>
            {meta.pipelines.length > 1 && (
              <Field label="Pipeline">
                {(a) => (
                  <Select
                    {...a}
                    value={f.pipelineId}
                    onChange={(e) => {
                      const p = meta.pipelines.find((x) => x.id === e.target.value)!;
                      setF((x) => ({ ...x, pipelineId: p.id, stageId: p.stages.find((s) => s.kind === "open")!.id }));
                    }}
                  >
                    {meta.pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Stage">
              {(a) => (
                <Select {...a} value={f.stageId} onChange={(e) => set("stageId", e.target.value)}>
                  {pipeline.stages
                    .filter((s) => s.kind === "open")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.probability}%
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </>
        )}
        <Field label="Owner">{() => <OwnerSelect value={f.ownerId} onChange={(v) => set("ownerId", v ?? "")} />}</Field>
        <More open={more} onToggle={() => setMore(!more)} />
        {more && (
          <>
            <Field label="Priority">
              {(a) => (
                <Select {...a} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p[0].toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Source">{(a) => <Input {...a} value={f.source} onChange={(e) => set("source", e.target.value)} maxLength={40} placeholder="Referral" />}</Field>
            <Field label="Tags" className="sm:col-span-2">{() => <TagInput value={f.tags} onChange={(v) => set("tags", v)} />}</Field>
            {fields.map((fd) => (
              <Field key={fd.id} label={fd.label}>
                {() => <CustomInput field={fd} value={f.custom[fd.key]} onChange={(v) => set("custom", { ...f.custom, [fd.key]: v })} />}
              </Field>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function quickDue(which: "today" | "tomorrow" | "week" | "2h") {
  const d = new Date();
  if (which === "2h") d.setHours(d.getHours() + 2, 0, 0, 0);
  else {
    d.setDate(d.getDate() + (which === "today" ? 0 : which === "tomorrow" ? 1 : 7));
    d.setHours(which === "today" ? Math.max(d.getHours() + 1, 17) : 10, 0, 0, 0);
  }
  return localInput(d);
}

export function TaskDialog({ contact, deal, company, onClose }: { contact?: Ref | null; deal?: Ref | null; company?: Ref | null; onClose: () => void }) {
  const { meta } = useCrm();
  const [subject, setSubject] = useState("");
  const [due, setDue] = useState(quickDue("tomorrow"));
  const [ownerId, setOwner] = useState<string | null>(meta.me.id);
  const [priority, setPriority] = useState("normal");
  const [who, setWho] = useState<Ref | null>(contact ?? null);
  const [dl, setDl] = useState<Ref | null>(deal ?? null);
  const save = useCrmAction(() => ({ path: "activities", body: { kind: "task", subject, dueAt: due ? new Date(due).toISOString() : null, ownerId, priority, contactId: who?.id ?? null, dealId: dl?.id ?? null, companyId: company?.id ?? null } }), { success: "Task added", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title="New task"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!subject.trim() || (!who && !dl && !company)} onClick={() => save.mutate()}>
            Add task
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="What needs doing?">{(a) => <Input {...a} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} autoFocus placeholder="Call back about the quote" />}</Field>
        <div>
          <Field label="Due">{(a) => <Input {...a} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(
              [
                ["2h", "In 2 hours"],
                ["today", "Today"],
                ["tomorrow", "Tomorrow"],
                ["week", "Next week"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setDue(quickDue(k))} className="h-7 rounded-full border border-border px-2.5 text-[12px] font-medium hover:bg-surface-2">
                {l}
              </button>
            ))}
          </div>
        </div>
        {!contact && !deal && !company && (
          <>
            <Field label="About (contact)">{() => <RecordPicker kind="contacts" value={who} onChange={setWho} placeholder="Find a person" />}</Field>
            <Field label="Or a deal">{() => <RecordPicker kind="deals" value={dl} onChange={setDl} placeholder="Find a deal" />}</Field>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assigned to">{() => <OwnerSelect value={ownerId} onChange={setOwner} allowNone={false} />}</Field>
          <Field label="Priority">
            {(a) => (
              <Select {...a} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
