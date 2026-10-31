"use client";

// Custom objects: the workspace's own kinds of records. Each object has its
// fields and rules, numbered records with search, import, export and bulk
// changes, links to other records (shown on both ends) and its settings.
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Shapes, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BulkDeleteDialog, BulkSetDialog } from "@/components/custom/bulk";
import { FieldsEditor, RulesEditor } from "@/components/custom/editors";
import { CustomInput, display, fieldErrors, plain, type Def } from "@/components/custom/inputs";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { sendOrQueue } from "@/lib/client/outbox";
import { dateTime } from "@/lib/client/format";
import { importTarget, type Value, type Values } from "@/lib/custom/model";

type Obj = { id: string; name: string; plural: string; description: string; prefix: string; titleField: string | null; editRoles: string[]; count: number; canEdit: boolean };
type Meta = { me: { manage: boolean; write: boolean; objects: boolean }; objects: Obj[]; roles: string[] };
type Rec = { id: string; number: string; title: string; values: Values; createdAt: string; updatedAt: string };

const useObj = () => useModule<Meta>();

export function ObjectsApp({ path }: { path: string[] }) {
  const [objId, sub] = path;
  return (
    <ModuleFrame<Meta>
      api="custom"
      base="objects"
      title="Custom objects"
      icon={<Shapes />}
      section={objId ?? ""}
      nav={(m) => [{ id: "", label: "All objects", icon: <Shapes /> }, ...m.objects.map((o) => ({ id: o.id, label: o.plural, icon: <Shapes /> }))]}
      render={() => (isId(objId) ? (isId(sub) ? <RecordPage key={sub} objId={objId!} id={sub!} /> : <ObjectPage key={objId} id={objId!} tab={sub} />) : <Home />)}
    />
  );
}

function Home() {
  const { meta, go } = useObj();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader title="Custom objects" description="Your own kinds of records — site visits, licences, warranties, samples — with the fields you need." actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>New object</Button>} />
      {!meta.objects.length ? (
        <Card className="p-8 text-center text-[13.5px] text-muted">No objects yet.{meta.me.manage ? " Make one, add its fields, and start adding records." : " Ask an owner or admin to make one."}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {meta.objects.map((o) => (
            <button key={o.id} type="button" onClick={() => go(o.id)} className="rounded-[18px] border border-border bg-surface p-4 text-left hover:bg-surface-2">
              <b className="font-medium">{o.plural}</b>
              <p className="text-[12.5px] text-muted">{o.count} record{o.count === 1 ? "" : "s"} · {o.prefix}-0001…</p>
              {o.description && <p className="mt-1 line-clamp-2 text-[13px]">{o.description}</p>}
            </button>
          ))}
        </div>
      )}
      <p className="text-[13px] text-muted">Add fields to items, employees, tickets and other built-in records in <Link href="/settings/customise" className="underline underline-offset-2">Settings → Customise</Link>.</p>
      {adding && <ObjectDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function ObjectDialog({ init, fields, onClose }: { init?: Obj; fields?: Def[]; onClose: () => void }) {
  const { meta, go } = useObj();
  const [f, setF] = useState({ name: init?.name ?? "", plural: init?.plural ?? "", description: init?.description ?? "", prefix: init?.prefix ?? "", titleField: init?.titleField ?? "", editRoles: init?.editRoles ?? [] });
  const save = useModuleAction<void, { object: Obj }>(() => ({ path: init ? `objects/${init.id}` : "objects", method: init ? "PUT" : "POST", body: { ...f, prefix: f.prefix || f.plural.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "REC", titleField: f.titleField || null } }), { success: "Saved", onDone: (r) => (onClose(), !init && go(`${r.object.id}/fields`)) });
  const titleable = (fields ?? []).filter((x) => ["text", "number", "date", "select", "email", "phone"].includes(x.type));
  return (
    <Dialog open onClose={onClose} title={init ? "Object settings" : "New object"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !f.plural.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="One is called" hint="Like: Site visit">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Several are called" hint="Like: Site visits">{(a) => <Input {...a} value={f.plural} onChange={(e) => setF({ ...f, plural: e.target.value })} />}</Field>
        <Field label="Numbering prefix" hint="Records are numbered like VIS-0001">{(a) => <Input {...a} value={f.prefix} maxLength={6} placeholder={f.plural.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "REC"} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase() })} />}</Field>
        {init && <Field label="Records are named by">{(a) => <Select {...a} value={f.titleField} onChange={(e) => setF({ ...f, titleField: e.target.value })}><option value="">Their number</option>{titleable.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select>}</Field>}
        <Field label="Description" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-[12.5px] font-medium">Who can add and change records</legend>
          <p className="mb-1.5 text-[12px] text-muted">None ticked: everyone who can edit in the workspace. Owners and admins always can.</p>
          <div className="flex flex-wrap gap-1.5">
            {meta.roles.filter((r) => !["admin", "viewer", "employee"].includes(r)).map((r) => (
              <label key={r} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12.5px]"><input type="checkbox" checked={f.editRoles.includes(r)} onChange={(e) => setF({ ...f, editRoles: e.target.checked ? [...f.editRoles, r] : f.editRoles.filter((x) => x !== r) })} />{r}</label>
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

function ObjectPage({ id, tab: initial }: { id: string; tab?: string }) {
  const { meta } = useObj();
  const q = useModuleQuery<{ object: Obj; fields: Def[] }>(`objects/${id}`);
  const [tab, setTab] = useState<"records" | "fields" | "rules">(initial === "fields" ? "fields" : initial === "rules" ? "rules" : "records");
  const [settings, setSettings] = useState(false);
  const [del, setDel] = useState(false);
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const { object: o, fields } = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title={o.plural} description={o.description || undefined} actions={meta.me.manage && <div className="flex gap-2"><Button size="sm" onClick={() => setSettings(true)}>Settings</Button><Button size="sm" variant="ghost" aria-label={`Delete ${o.plural}`} onClick={() => setDel(true)}><Trash2 className="size-3.5" /></Button></div>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "records", label: `Records (${o.count})` }, { value: "fields", label: `Fields (${fields.length})` }, { value: "rules", label: "Rules" }]} />
      {tab === "records" && <RecordsTab o={o} fields={fields} />}
      {tab === "fields" && <FieldsEditor entity={`obj:${o.id}`} objects={meta.objects} manage={meta.me.manage} />}
      {tab === "rules" && <RulesEditor entity={`obj:${o.id}`} builtin={[]} manage={meta.me.manage} />}
      {settings && <ObjectDialog init={o} fields={fields} onClose={() => setSettings(false)} />}
      {del && <DeleteObject o={o} onClose={() => setDel(false)} />}
    </div>
  );
}

function DeleteObject({ o, onClose }: { o: Obj; onClose: () => void }) {
  const { go } = useObj();
  const [typed, setTyped] = useState("");
  const del = useModuleAction<void>(() => ({ path: `objects/${o.id}?confirm=${encodeURIComponent(typed)}`, method: "DELETE" }), { success: `${o.plural} deleted`, onDone: () => go("") });
  return (
    <Dialog open onClose={onClose} size="sm" title={`Delete ${o.plural}?`} description={o.count ? `Its ${o.count} record${o.count === 1 ? "" : "s"}, fields and rules go too, and that can't be undone. Type “${o.plural}” to confirm.` : "Its fields and rules go too."} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={del.isPending} disabled={!!o.count && typed !== o.plural} onClick={() => del.mutate()}>Delete</Button></>}>
      {o.count > 0 && <Field label="Name">{(a) => <Input {...a} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>}
    </Dialog>
  );
}

function RecordsTab({ o, fields }: { o: Obj; fields: Def[] }) {
  const { meta, go, orgId } = useObj();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const list = useModuleQuery<{ records: Rec[]; titles: Record<string, string> }>(`objects/${o.id}/records${q ? `?q=${encodeURIComponent(q)}` : ""}`, { keepPrevious: true });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState<"set" | "delete" | null>(null);
  const shown = fields.slice(0, 5);
  const rows = useMemo(() => list.data?.records ?? [], [list.data]);
  if (!fields.length) return <Card className="p-6 text-center text-[13px] text-muted">{meta.me.manage ? "Add fields first (the Fields tab) — then records." : "This object has no fields yet."}</Card>;
  const titles = list.data?.titles ?? {};
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const names = Object.fromEntries(rows.map((r) => [r.id, `${r.number} ${r.title !== r.number ? r.title : ""}`.trim()]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
        {o.canEdit && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>New {o.name.toLowerCase()}</Button>}
        {o.canEdit && <ImportButton target={importTarget("custom.obj", o.plural, o.name.toLowerCase(), fields)} onImport={(r, mode) => api(`/api/v1/orgs/${orgId}/custom/objects/${o.id}/import`, { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["custom", orgId] })} />}
        <ExportMenu name={o.plural.toLowerCase()} rows={rows.map((r) => ({ number: r.number, ...Object.fromEntries(fields.map((d) => [d.key, plain(d, r.values[d.key], titles)])) }))} columns={[{ key: "number", label: "Number" }, ...fields.map((d) => ({ key: d.key, label: d.label }))]} />
        {o.canEdit && sel.size > 0 && <Button size="sm" onClick={() => setBulk("set")}>Change {sel.size} selected</Button>}
        {meta.me.manage && sel.size > 0 && <Button size="sm" variant="danger" onClick={() => setBulk("delete")}>Delete {sel.size}</Button>}
      </div>
      {!list.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Card className="p-6 text-center text-[13px] text-muted">{q ? "Nothing matches." : `No ${o.plural.toLowerCase()} yet.`}</Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle">
              <tr>
                <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                <th className="px-3 py-2.5 font-medium">{o.name}</th>
                {shown.filter((d) => d.key !== o.titleField).map((d) => <th key={d.key} className="px-3 py-2.5 font-medium">{d.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${r.number}`} checked={sel.has(r.id)} onChange={() => { const n = new Set(sel); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setSel(n); }} /></td>
                  <td className="px-3 py-2"><button type="button" className="text-left font-medium hover:underline" onClick={() => go(`${o.id}/${r.id}`)}>{r.title}</button>{r.title !== r.number && <span className="block text-[12px] text-muted">{r.number}</span>}</td>
                  {shown.filter((d) => d.key !== o.titleField).map((d) => <td key={d.key} className="px-3 py-2">{display(d, r.values[d.key], titles)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {adding && <RecordDialog o={o} fields={fields} onClose={() => setAdding(false)} onSaved={(r) => go(`${o.id}/${r.id}`)} />}
      {bulk === "set" && <BulkSetDialog entity={`obj:${o.id}`} fields={fields} ids={[...sel]} names={names} onClose={() => (setBulk(null), setSel(new Set()))} />}
      {bulk === "delete" && <BulkDeleteDialog objectId={o.id} ids={[...sel]} plural={o.plural} onClose={() => setBulk(null)} onDone={() => (setBulk(null), setSel(new Set()))} />}
    </div>
  );
}

function RecordDialog({ o, fields, init, titles: known, onClose, onSaved }: { o: Obj; fields: Def[]; init?: Rec; titles?: Record<string, string>; onClose: () => void; onSaved?: (r: Rec) => void }) {
  const { orgId } = useObj();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<Values>(init?.values ?? {});
  const [titles, setTitles] = useState<Record<string, string>>(known ?? {});
  const [errs, setErrs] = useState<{ fields: Record<string, string>; rules: string[] }>({ fields: {}, rules: [] });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, Value> = {};
      for (const f of fields) if (!init || JSON.stringify(v[f.key] ?? null) !== JSON.stringify(init.values[f.key] ?? null)) body[f.key] = v[f.key] ?? null;
      const url = `/api/v1/orgs/${orgId}/custom/objects/${o.id}/records${init ? `/${init.id}` : ""}`;
      // New records can be added offline (kept and sent later); edits need a connection.
      const sent = init ? await api<{ record: Rec }>(url, { method: "PUT", body }) : await sendOrQueue<{ record: Rec }>(url, { method: "POST", body, label: `New ${o.name.toLowerCase()}` });
      if ("queued" in sent) {
        toast({ tone: "info", title: "No connection — kept on this device and added when you're back online" });
        onClose();
        return;
      }
      const r = sent;
      qc.invalidateQueries({ queryKey: ["custom", orgId] });
      toast({ tone: "success", title: init ? "Saved" : `${r.record.number} added` });
      onClose();
      onSaved?.(r.record);
    } catch (e) {
      const fe = fieldErrors(e);
      setErrs(fe);
      if (!Object.keys(fe.fields).length && !fe.rules.length) toast({ tone: "error", title: errorMessage(e) });
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={init ? `Edit ${init.number}` : `New ${o.name.toLowerCase()}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      {errs.rules.length > 0 && <div className="mb-3"><Notice tone="danger">{errs.rules.join(" · ")}</Notice></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.id} label={`${f.label}${f.required ? " *" : ""}`} hint={f.help || undefined} error={errs.fields[f.key]} className={f.type === "longtext" || f.type === "multiselect" ? "sm:col-span-2" : undefined}>
            {(a) => <CustomInput def={f} a={a} value={v[f.key]} titles={titles} onChange={(x, t) => (setV({ ...v, [f.key]: x }), t && typeof x === "string" && setTitles({ ...titles, [x]: t }))} />}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

function RecordPage({ objId, id }: { objId: string; id: string }) {
  const { go } = useObj();
  const obj = useModuleQuery<{ object: Obj; fields: Def[] }>(`objects/${objId}`);
  const q = useModuleQuery<{ record: Rec & { by: string | null }; titles: Record<string, string>; backlinks: { objectId: string; object: string; field: string; id: string; title: string }[] }>(`objects/${objId}/records/${id}`);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const remove = useModuleAction<void>(() => ({ path: `objects/${objId}/records/${id}`, method: "DELETE" }), { success: "Deleted", onDone: () => go(objId) });
  if (!obj.data || !q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const { object: o, fields } = obj.data;
  const r = q.data.record;
  return (
    <div className="space-y-4">
      <Link href={`/objects/${o.id}`} className="text-[13px] text-muted hover:text-fg">← {o.plural}</Link>
      <PageHeader title={r.title} description={`${r.number} · updated ${dateTime(r.updatedAt)}${r.by ? ` by ${r.by}` : ""}`} actions={o.canEdit && <div className="flex gap-2"><Button size="sm" onClick={() => setEdit(true)}>Edit</Button><Button size="sm" variant="ghost" aria-label="Delete" onClick={() => setDel(true)}><Trash2 className="size-3.5" /></Button></div>} />
      <Card className="p-4">
        <dl className="grid gap-x-4 gap-y-3 text-[13.5px] sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.id} className={f.type === "longtext" ? "sm:col-span-2" : undefined}>
              <dt className="text-[12px] text-muted">{f.label}</dt>
              <dd>{display(f, r.values[f.key], q.data!.titles)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {q.data.backlinks.length > 0 && (
        <Card className="p-4 text-[13px]">
          <p className="mb-1 text-[12px] text-muted">Linked from</p>
          <ul className="space-y-0.5">{q.data.backlinks.map((b) => <li key={`${b.id}-${b.field}`}><Link href={`/objects/${b.objectId}/${b.id}`} className="underline underline-offset-2">{b.object}: {b.title}</Link> <Badge>{b.field}</Badge></li>)}</ul>
        </Card>
      )}
      {edit && <RecordDialog o={o} fields={fields} init={r} titles={q.data.titles} onClose={() => setEdit(false)} />}
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} destructive title={`Delete ${r.number}?`} description="It's removed for good (what it held is kept in the audit log)." confirmLabel="Delete" />
    </div>
  );
}
