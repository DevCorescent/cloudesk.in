"use client";

// Editing the fields and rules of one kind of record — used in Settings →
// Customise for built-in records and on each custom object's settings.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, Field, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { ENTITIES, ENTITY_IDS, type BuiltinField } from "@/lib/custom/entities";
import { CF_TYPES, CF_TYPE_LABEL, describeCond, NO_VALUE, OP_LABEL, OPS, slugKey, type Cond, type Op } from "@/lib/custom/model";
import type { Def } from "./inputs";

type Rule = { id: string; name: string; when: Cond[]; then: Cond[]; message: string; active: boolean };
type ObjRef = { id: string; plural: string };

function useCustomAction() {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  return async (path: string, method: string, body?: unknown, ok?: string) => {
    try {
      const r = await api(`/api/v1/orgs/${org.id}/custom/${path}`, { method, body });
      qc.invalidateQueries({ queryKey: ["custom", org.id] });
      qc.invalidateQueries({ queryKey: ["objects", org.id] });
      if (ok) toast({ tone: "success", title: ok });
      return r;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      throw e;
    }
  };
}

export function useFields(entity: string) {
  const { org } = useSession();
  return useQuery({ queryKey: ["custom", org.id, "fields", entity], queryFn: () => api<{ fields: Def[] }>(`/api/v1/orgs/${org.id}/custom/fields?entity=${encodeURIComponent(entity)}`) });
}

export function FieldsEditor({ entity, objects, manage }: { entity: string; objects: ObjRef[]; manage: boolean }) {
  const q = useFields(entity);
  const act = useCustomAction();
  const [edit, setEdit] = useState<Partial<Def> | null>(null);
  const [del, setDel] = useState<Def | null>(null);
  const [typed, setTyped] = useState("");
  if (!q.data) return <Skeleton className="h-32" />;
  const list = q.data.fields;
  const move = async (i: number, d: -1 | 1) => {
    const a = list[i]!;
    const b = list[i + d]!;
    await act(`fields/${a.id}?entity=${encodeURIComponent(entity)}`, "PUT", { ...a, sort: i + d });
    await act(`fields/${b.id}?entity=${encodeURIComponent(entity)}`, "PUT", { ...b, sort: i });
  };
  return (
    <div className="space-y-3">
      {manage && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ type: "text", options: [], required: false, help: "" })}>Add a field</Button>}
      {!list.length ? <Card className="p-6 text-center text-[13px] text-muted">No fields yet.</Card> : (
        <Card className="divide-y divide-border">
          {list.map((f, i) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
              <div>
                <b className="font-medium">{f.label}</b> {f.required && <Badge>Needed</Badge>}
                <span className="block text-[12px] text-muted">{f.key} · {CF_TYPE_LABEL[f.type]}{f.options.length ? ` · ${f.options.join(", ")}` : ""}{f.type === "link" && f.linkTo ? ` → ${f.linkTo.startsWith("obj:") ? (objects.find((o) => `obj:${o.id}` === f.linkTo)?.plural ?? "an object") : ENTITIES[f.linkTo as keyof typeof ENTITIES]?.label}` : ""}</span>
              </div>
              {manage && (
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Move ${f.label} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(f)}>Edit</Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${f.label}`} onClick={() => (setDel(f), setTyped(""))}><Trash2 className="size-3.5" /></Button>
                </span>
              )}
            </div>
          ))}
        </Card>
      )}
      {edit && <FieldDialog entity={entity} init={edit} count={list.length} objects={objects} onClose={() => setEdit(null)} />}
      {del && (
        <Dialog open onClose={() => setDel(null)} size="sm" title={`Delete “${del.label}”?`} description={`Its value is removed from every record, and that can't be undone. Type ${del.key} to confirm.`} footer={<><Button onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" disabled={typed !== del.key} onClick={() => act(`fields/${del.id}?entity=${encodeURIComponent(entity)}&confirm=${encodeURIComponent(typed)}`, "DELETE", undefined, "Field deleted").then(() => setDel(null), () => {})}>Delete</Button></>}>
          <Field label="Field key">{(a) => <Input {...a} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
        </Dialog>
      )}
    </div>
  );
}

function FieldDialog({ entity, init, count, objects, onClose }: { entity: string; init: Partial<Def>; count: number; objects: ObjRef[]; onClose: () => void }) {
  const act = useCustomAction();
  const [f, setF] = useState({ label: init.label ?? "", key: init.key ?? "", type: init.type ?? "text", options: (init.options ?? []).join("\n"), required: init.required ?? false, help: init.help ?? "", linkTo: init.linkTo ?? "" });
  const [keyTouched, setKeyTouched] = useState(!!init.id);
  const [busy, setBusy] = useState(false);
  const listy = f.type === "select" || f.type === "multiselect";
  const save = async () => {
    setBusy(true);
    const body = { label: f.label, key: f.key, type: f.type, options: listy ? f.options.split("\n").map((x) => x.trim()).filter(Boolean) : [], required: f.required, help: f.help, linkTo: f.type === "link" ? f.linkTo || null : null, sort: init.sort ?? count };
    try {
      await act(init.id ? `fields/${init.id}?entity=${encodeURIComponent(entity)}` : `fields?entity=${encodeURIComponent(entity)}`, init.id ? "PUT" : "POST", body, "Field saved");
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={init.id ? "Edit field" : "Add a field"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.label.trim() || !f.key} onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value, key: keyTouched ? f.key : slugKey(e.target.value) })} />}</Field>
        <Field label="Key" hint={init.id ? "Can't change — values are saved under it" : "Used in imports, rules and the API"}>{(a) => <Input {...a} value={f.key} disabled={!!init.id} onChange={(e) => (setKeyTouched(true), setF({ ...f, key: e.target.value }))} />}</Field>
        <Field label="Type">{(a) => <Select {...a} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Def["type"] })}>{CF_TYPES.map((t) => <option key={t} value={t}>{CF_TYPE_LABEL[t]}</option>)}</Select>}</Field>
        {f.type === "link" && (
          <Field label="Links to">{(a) => (
            <Select {...a} value={f.linkTo} onChange={(e) => setF({ ...f, linkTo: e.target.value })}>
              <option value="">Pick…</option>
              <optgroup label="Your records">{ENTITY_IDS.map((e) => <option key={e} value={e}>{ENTITIES[e].label}</option>)}</optgroup>
              {objects.length > 0 && <optgroup label="Your objects">{objects.map((o) => <option key={o.id} value={`obj:${o.id}`}>{o.plural}</option>)}</optgroup>}
            </Select>
          )}</Field>
        )}
        {listy && <Field label="Choices" hint="One per line" className="sm:col-span-2">{(a) => <Textarea {...a} rows={4} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />}</Field>}
        <Field label="Help text" className="sm:col-span-2">{(a) => <Input {...a} value={f.help} maxLength={200} onChange={(e) => setF({ ...f, help: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.required} onChange={(v) => setF({ ...f, required: v })} label="Needed on every save" /> Needed on every save</label>
      </div>
      {entity.startsWith("obj:") ? null : <p className="mt-3 text-[12px] text-muted">A needed field is asked for whenever someone saves this record&apos;s fields; records saved before keep working.</p>}
    </Dialog>
  );
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export function RulesEditor({ entity, builtin, manage }: { entity: string; builtin: BuiltinField[]; manage: boolean }) {
  const { org } = useSession();
  const fields = useFields(entity);
  const q = useQuery({ queryKey: ["custom", org.id, "rules", entity], queryFn: () => api<{ rules: Rule[] }>(`/api/v1/orgs/${org.id}/custom/rules?entity=${encodeURIComponent(entity)}`) });
  const act = useCustomAction();
  const [edit, setEdit] = useState<Partial<Rule> | null>(null);
  if (!q.data || !fields.data) return <Skeleton className="h-32" />;
  const keys = [...fields.data.fields.map((f) => ({ key: f.key, label: f.label })), ...builtin.map((b) => ({ key: b.key, label: `${b.label} (built in)` })), ...(entity.startsWith("obj:") ? [{ key: "number", label: "Number" }] : [])];
  const label = (k: string) => keys.find((x) => x.key === k)?.label ?? k;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">A rule stops a save when its conditions are met but what must be true isn&apos;t — for edits here, in bulk changes and in imports. Rules don&apos;t run when the {entity.startsWith("obj:") ? "record" : "module's own form"} is saved{entity.startsWith("obj:") ? " through another route" : ""}.</p>
      {manage && <Button size="sm" icon={<Plus className="size-3.5" />} disabled={!keys.length} onClick={() => setEdit({ when: [], then: [{ field: keys[0]!.key, op: "filled", value: null }], message: "", active: true, name: "" })}>Add a rule</Button>}
      {!q.data.rules.length ? <Card className="p-6 text-center text-[13px] text-muted">No rules yet.</Card> : (
        <Card className="divide-y divide-border">
          {q.data.rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-[13px]">
              <div className="min-w-0">
                <b className="font-medium">{r.name}</b> {!r.active && <Badge>Off</Badge>}
                <p className="text-muted">{r.when.length ? `When ${r.when.map((c) => describeCond(c, label)).join(" and ")}, ` : "Always: "}{r.then.map((c) => describeCond(c, label)).join(" and ")}.</p>
                <p className="text-[12px] text-subtle">Otherwise: “{r.message}”</p>
              </div>
              {manage && <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button><Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => act(`rules/${r.id}`, "DELETE", undefined, "Rule deleted").catch(() => {})}><Trash2 className="size-3.5" /></Button></span>}
            </div>
          ))}
        </Card>
      )}
      {edit && <RuleDialog entity={entity} init={edit} keys={keys} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CondRows({ title, rows, keys, onChange, min }: { title: string; rows: Cond[]; keys: { key: string; label: string }[]; onChange: (r: Cond[]) => void; min: number }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-[12.5px] font-medium">{title}</legend>
      {rows.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_130px_1fr_auto] items-center gap-2">
          <Select aria-label={`${title} field ${i + 1}`} value={c.field} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>{keys.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select>
          <Select aria-label={`${title} test ${i + 1}`} value={c.op} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)))}>{OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</Select>
          {NO_VALUE.includes(c.op) ? <span /> : <Input aria-label={`${title} value ${i + 1}`} value={Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "")} placeholder={c.op === "in" ? "A, B, C" : "value, today or @field"} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />}
          <Button size="sm" variant="ghost" aria-label="Remove" disabled={rows.length <= min} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...rows, { field: keys[0]!.key, op: "eq", value: "" }])}>Add a condition</Button>
    </fieldset>
  );
}

/** Numbers typed into a rule are compared as numbers; "true"/"false" as yes/no. */
const typedValue = (c: Cond): Cond => {
  if (typeof c.value !== "string" || NO_VALUE.includes(c.op)) return NO_VALUE.includes(c.op) ? { ...c, value: null } : c;
  const v = c.value.trim();
  if (c.op === "in") return { ...c, value: v.split(",").map((x) => x.trim()).filter(Boolean) };
  if (/^-?\d+(\.\d+)?$/.test(v) && ["gt", "gte", "lt", "lte"].includes(c.op)) return { ...c, value: Number(v) };
  if (v === "true" || v === "false") return { ...c, value: v === "true" };
  return { ...c, value: v };
};

function RuleDialog({ entity, init, keys, onClose }: { entity: string; init: Partial<Rule>; keys: { key: string; label: string }[]; onClose: () => void }) {
  const act = useCustomAction();
  const [r, setR] = useState({ name: init.name ?? "", when: init.when ?? [], then: init.then ?? [], message: init.message ?? "", active: init.active ?? true });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await act(init.id ? `rules/${init.id}?entity=${encodeURIComponent(entity)}` : `rules?entity=${encodeURIComponent(entity)}`, init.id ? "PUT" : "POST", { ...r, when: r.when.map(typedValue), then: r.then.map(typedValue) }, "Rule saved");
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={init.id ? "Edit rule" : "Add a rule"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!r.name.trim() || !r.message.trim() || !r.then.length} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Rule name">{(a) => <Input {...a} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />}</Field>
        <CondRows title="When (all of these)" rows={r.when} keys={keys} min={0} onChange={(when) => setR({ ...r, when })} />
        <CondRows title="Then this must be true" rows={r.then} keys={keys} min={1} onChange={(then) => setR({ ...r, then })} />
        <Field label="Message when it isn't">{(a) => <Input {...a} value={r.message} maxLength={200} onChange={(e) => setR({ ...r, message: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-[13px]"><Switch checked={r.active} onChange={(v) => setR({ ...r, active: v })} label="Rule on" /> On</label>
        <Notice>Compare with another field by typing @ and its key (like @start_date), or with today&apos;s date by typing today.</Notice>
      </div>
    </Dialog>
  );
}
