"use client";

// Customise: the workspace's own fields on built-in records (items,
// employees, tickets…), rules checked when they're saved, the records with
// those fields for import, export and bulk changes, and the history of bulk
// changes with undo.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { BulkHistory, BulkSetDialog } from "@/components/custom/bulk";
import { FieldsEditor, RulesEditor, useFields } from "@/components/custom/editors";
import { display, plain } from "@/components/custom/inputs";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { useSession } from "@/components/shell/session-context";
import { Tabs } from "@/components/ui/overlays";
import { Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { ENTITIES, type BuiltinField, type EntityId } from "@/lib/custom/entities";
import { importTarget, type Values } from "@/lib/custom/model";

type Meta = { me: { manage: boolean; write: boolean; objects: boolean }; entities: { id: EntityId; label: string; noun: string; builtin: BuiltinField[]; match: string; canEdit: boolean }[]; objects: { id: string; plural: string }[]; fieldCounts: Record<string, number> };

export function CustomiseView() {
  const { org } = useSession();
  const params = useSearchParams();
  const meta = useQuery({ queryKey: ["custom", org.id, "meta"], queryFn: () => api<Meta>(`/api/v1/orgs/${org.id}/custom/meta`) });
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<"fields" | "rules" | "records" | "history">("fields");
  if (meta.isError) return <ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} />;
  if (!meta.data) return <Skeleton className="h-60" />;
  const m = meta.data;
  const fromUrl = params.get("entity");
  const entity = (picked ?? (fromUrl && m.entities.some((e) => e.id === fromUrl) ? fromUrl : m.entities[0]?.id)) as EntityId | undefined;
  if (!entity) return <Notice>None of the records you can see can have fields added yet — switch on a module like Inventory or HR first.</Notice>;
  const info = m.entities.find((e) => e.id === entity)!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Records" className="w-72">{(a) => <Select {...a} value={entity} onChange={(e) => setPicked(e.target.value)}>{m.entities.map((e) => <option key={e.id} value={e.id}>{e.label}{m.fieldCounts[e.id] ? ` (${m.fieldCounts[e.id]})` : ""}</option>)}</Select>}</Field>
        {m.me.objects && <p className="pb-2 text-[13px] text-muted">Need a whole new kind of record? <Link href="/objects" className="underline underline-offset-2">Make a custom object</Link>.</p>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "fields", label: "Fields" }, { value: "rules", label: "Rules" }, { value: "records", label: "Records & bulk changes" }, { value: "history", label: "Bulk history" }]} />
      {tab === "fields" && <FieldsEditor key={entity} entity={entity} objects={m.objects} manage={m.me.manage} />}
      {tab === "rules" && <RulesEditor key={entity} entity={entity} builtin={info.builtin} manage={m.me.manage} />}
      {tab === "records" && <RecordsTab key={entity} entity={entity} canEdit={info.canEdit} />}
      {tab === "history" && <BulkHistory />}
    </div>
  );
}

type Row = { id: string; title: string; match: string; values: Values };

function RecordsTab({ entity, canEdit }: { entity: EntityId; canEdit: boolean }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const info = ENTITIES[entity];
  const fields = useFields(entity);
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["custom", org.id, "records", entity], queryFn: () => api<{ records: Row[]; titles: Record<string, string> }>(`/api/v1/orgs/${org.id}/custom/records?entity=${entity}`) });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const rows = useMemo(() => (list.data?.records ?? []).filter((r) => !q || `${r.title} ${r.match}`.toLowerCase().includes(q.toLowerCase())), [list.data, q]);
  if (!fields.data || !list.data) return <Skeleton className="h-40" />;
  const defs = fields.data.fields;
  const titles = list.data.titles;
  const matchLabel = info.builtin.find((b) => b.key === info.match)!.label;
  if (!defs.length) return <Card className="p-6 text-center text-[13px] text-muted">Add a field first — then you can fill it in here for many {info.label.toLowerCase()} at once, or import it.</Card>;
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const names = Object.fromEntries(list.data.records.map((r) => [r.id, r.title || r.match]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search" placeholder={`Search ${info.label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
        {canEdit && <ImportButton target={importTarget(`custom.${entity}`, `${info.label}: your fields`, info.noun, defs, { key: "__match", label: matchLabel })} onImport={(rows, mode) => api(`/api/v1/orgs/${org.id}/custom/values/import?entity=${entity}`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["custom", org.id] })} />}
        <ExportMenu name={`${info.label.toLowerCase()}-fields`} rows={rows.map((r) => ({ __match: r.match, __title: r.title, ...Object.fromEntries(defs.map((d) => [d.key, plain(d, r.values[d.key], titles)])) }))} columns={[{ key: "__match", label: matchLabel }, ...(info.match !== "name" ? [{ key: "__title", label: "Name" }] : []), ...defs.map((d) => ({ key: d.key, label: d.label }))]} />
        {canEdit && sel.size > 0 && <Button size="sm" variant="primary" onClick={() => setBulk(true)}>Change {sel.size} selected</Button>}
      </div>
      {!rows.length ? <Card className="p-6 text-center text-[13px] text-muted">No {info.label.toLowerCase()} found.</Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle">
              <tr>
                {canEdit && <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
                <th className="px-3 py-2.5 font-medium">{info.noun[0]!.toUpperCase() + info.noun.slice(1)}</th>
                {defs.map((d) => <th key={d.key} className="px-3 py-2.5 font-medium">{d.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  {canEdit && <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${r.title || r.match}`} checked={sel.has(r.id)} onChange={() => { const n = new Set(sel); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setSel(n); }} /></td>}
                  <td className="px-3 py-2"><Link href={info.href(r.id)} className="font-medium hover:underline">{r.title || r.match}</Link>{r.match && r.match !== r.title && <span className="block text-[12px] text-muted">{r.match}</span>}</td>
                  {defs.map((d) => <td key={d.key} className="px-3 py-2">{display(d, r.values[d.key], titles)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {bulk && <BulkSetDialog entity={entity} fields={defs} ids={[...sel]} names={names} onClose={() => (setBulk(false), setSel(new Set()))} />}
    </div>
  );
}


