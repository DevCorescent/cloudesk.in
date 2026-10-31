"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Braces, ChevronLeft, ChevronRight, Database, Download, FileUp, Filter as FilterIcon, Globe, Lock, Plus, Search, Send, Settings2, Table2, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field as FormField, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { ApiClientError, api, errorMessage } from "@/lib/client/api";
import { useProject } from "@/lib/client/use-project";
import { FIELD_INFO, FIELD_TYPES, FILTER_OPS, newFieldId, slugKey, type Field, type FieldType, type FilterOp } from "@/lib/data/model";

type TableInfo = { id: string; slug: string; name: string; description: string; rowCount: number; publicRead: boolean; publicInsert: boolean; fields: Field[]; updatedAt: string };
type Overview = { tables: TableInfo[]; apiBase: string; publicBase: string };
type Row = Record<string, unknown> & { id: string; created_at: string; updated_at: string };
type Page = { data: Row[]; total: number; limit: number; offset: number; next: number | null };
type Flt = { field: string; op: FilterOp; value: string };

const OP_LABEL: Record<FilterOp, string> = { eq: "is", neq: "is not", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: "contains", starts: "starts with", in: "is any of", empty: "is empty", not_empty: "is not empty" };
const PAGE = 50;

export function DataStudio({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const perms = project.data?.permissions ?? [];
  const canSchema = perms.includes("data:schema");
  const canWrite = perms.includes("data:write");
  const q = useQuery({ queryKey: ["data", projectId], queryFn: () => api<Overview>(`/api/v1/projects/${projectId}/data`) });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"rows" | "fields" | "api">("rows");
  const table = q.data?.tables.find((t) => t.id === selected) ?? q.data?.tables[0] ?? null;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-xl">Data</h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">Typed tables for your site and apps, with a REST API generated from their fields. Show rows on your site with the “Data list” section.</p>
        </div>
        {canSchema && (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            New table
          </Button>
        )}
      </div>
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-96" />
      ) : !q.data.tables.length ? (
        <Card>
          <EmptyState icon={<Database className="size-5" />} title="No tables yet" description="Create a table for team members, listings, events, a waitlist — anything your site should show or collect." action={canSchema ? <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>New table</Button> : undefined} />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Tables" className="grid content-start gap-1">
            {q.data.tables.map((t) => (
              <button key={t.id} type="button" onClick={() => setSelected(t.id)} className={cx("flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] transition-colors", table?.id === t.id ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2/60 hover:text-fg")}>
                <Table2 className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-[11px] text-subtle tabular-nums">{t.rowCount.toLocaleString()}</span>
              </button>
            ))}
          </nav>
          {table && (
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h2 className="text-[17px] font-semibold">{table.name}</h2>
                <code className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">/data/{table.slug}</code>
                {table.publicRead && <Badge tone="warning"><Globe className="size-3" /> Public read</Badge>}
                {table.publicInsert && <Badge tone="warning"><Globe className="size-3" /> Public insert</Badge>}
              </div>
              <Tabs
                value={tab}
                onChange={setTab}
                className="mb-4"
                tabs={[
                  { value: "rows", label: <><Table2 className="size-3.5" /> Rows</> },
                  { value: "fields", label: <><Settings2 className="size-3.5" /> Fields & access</> },
                  { value: "api", label: <><Braces className="size-3.5" /> API</> },
                ]}
              />
              {tab === "rows" ? (
                <RowsTab key={table.id + table.updatedAt} projectId={projectId} table={table} tables={q.data.tables} canWrite={canWrite} />
              ) : tab === "fields" ? (
                <FieldsTab key={table.id + table.updatedAt} projectId={projectId} table={table} tables={q.data.tables} canSchema={canSchema} onDeleted={() => setSelected(null)} />
              ) : (
                <ApiTab projectId={projectId} table={table} overview={q.data} canWrite={canWrite} />
              )}
            </div>
          )}
        </div>
      )}
      <NewTableDialog
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setSelected(id);
          setTab("fields");
        }}
      />
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function RowsTab({ projectId, table, tables, canWrite }: { projectId: string; table: TableInfo; tables: TableInfo[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Flt[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importing, setImporting] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (term) p.set("q", term);
    if (sort) p.set("sort", `${sort.dir === "desc" ? "-" : ""}${sort.key}`);
    for (const f of filters) p.append(`filter[${f.field}][${f.op}]`, f.value);
    const rel = table.fields.filter((f) => f.type === "relation").map((f) => f.key);
    if (rel.length) p.set("expand", rel.join(","));
    return p.toString();
  }, [offset, term, sort, filters, table.fields]);
  const rows = useQuery({ queryKey: ["data-rows", projectId, table.id, qs], queryFn: () => api<Page>(`/api/v1/projects/${projectId}/data/api/${table.slug}?${qs}`), placeholderData: (prev) => prev });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["data-rows", projectId, table.id] });
    qc.invalidateQueries({ queryKey: ["data", projectId] });
  };
  const del = useMutation({
    mutationFn: async () => {
      for (const id of picked) await api(`/api/v1/projects/${projectId}/data/api/${table.slug}/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ tone: "success", title: `Deleted ${picked.size} row${picked.size === 1 ? "" : "s"}` });
      setPicked(new Set());
      setConfirmDelete(false);
      refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't delete", description: errorMessage(e) }),
  });
  const page = rows.data;
  const cols = table.fields.slice(0, 12);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setTerm(search.trim());
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows" className="w-56 pl-8" aria-label="Search rows" />
        </form>
        <FilterButton fields={table.fields} onAdd={(f) => (setFilters((x) => [...x, f]), setOffset(0))} />
        {filters.map((f, i) => (
          <span key={i} className="glass-card inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px]">
            <b className="font-medium">{table.fields.find((x) => x.key === f.field)?.name ?? f.field}</b> {OP_LABEL[f.op]} {f.op !== "empty" && f.op !== "not_empty" && <i className="not-italic text-muted">{f.value}</i>}
            <button type="button" aria-label="Remove filter" onClick={() => (setFilters((x) => x.filter((_, j) => j !== i)), setOffset(0))} className="text-subtle hover:text-fg">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          {picked.size > 0 && canWrite && (
            <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
              Delete {picked.size}
            </Button>
          )}
          <a className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[13px] text-muted hover:bg-surface-2 hover:text-fg" href={`/api/v1/projects/${projectId}/data/tables/${table.id}/export`} download>
            <Download className="size-3.5" /> CSV
          </a>
          {canWrite && (
            <>
              <Button icon={<FileUp className="size-3.5" />} onClick={() => setImporting(true)}>Import</Button>
              <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Add row</Button>
            </>
          )}
        </div>
      </div>

      {rows.isError ? (
        <ErrorState message={errorMessage(rows.error)} onRetry={() => rows.refetch()} />
      ) : !page ? (
        <Skeleton className="h-80" />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-left">
                  <th className="w-9 px-3 py-2">
                    <input type="checkbox" aria-label="Select all" checked={page.data.length > 0 && page.data.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(page.data.map((r) => r.id)) : new Set())} />
                  </th>
                  {cols.map((f) => (
                    <th key={f.id} className="px-3 py-2 font-medium whitespace-nowrap">
                      <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-fg" onClick={() => setSort((s) => (s?.key === f.key ? (s.dir === "asc" ? { key: f.key, dir: "desc" } : null) : { key: f.key, dir: "asc" }))}>
                        {f.name}
                        {sort?.key === f.key ? sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-30" />}
                      </button>
                      <span className="ml-1.5 text-[10px] font-normal text-subtle">{FIELD_INFO[f.type].label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.data.map((r) => (
                  <tr key={r.id} className="group border-b border-border last:border-0 hover:bg-surface-2/40">
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label="Select row" checked={picked.has(r.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                    </td>
                    {cols.map((f, i) => (
                      <td key={f.id} className="max-w-[260px] px-3 py-2 align-top">
                        {i === 0 ? (
                          <button type="button" onClick={() => setEditing(r)} className="truncate text-left font-medium hover:underline">
                            <Cell v={r[f.key]} f={f} />
                          </button>
                        ) : (
                          <Cell v={r[f.key]} f={f} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!page.data.length && <p className="p-8 text-center text-[13px] text-muted">{term || filters.length ? "No rows match." : "No rows yet."}</p>}
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px] text-muted">
            <span>
              {page.total ? `${offset + 1}–${offset + page.data.length} of ${page.total.toLocaleString()}` : "0 rows"}
              {table.fields.length > cols.length ? ` · ${table.fields.length - cols.length} more fields in the row editor` : ""}
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<ChevronLeft className="size-3.5" />} aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))} />
              <Button size="sm" variant="ghost" icon={<ChevronRight className="size-3.5" />} aria-label="Next page" disabled={page.next === null} onClick={() => setOffset(page.next ?? offset)} />
            </span>
          </div>
        </Card>
      )}
      <RowDialog projectId={projectId} table={table} tables={tables} row={editing} canWrite={canWrite} onClose={() => setEditing(null)} onSaved={refresh} />
      <ImportDialog projectId={projectId} table={table} open={importing} onClose={() => setImporting(false)} onDone={refresh} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive confirmLabel="Delete" title={`Delete ${picked.size} row${picked.size === 1 ? "" : "s"}?`} description="This can't be undone. Links from other tables to these rows are cleared." />
    </div>
  );
}

function Cell({ v, f }: { v: unknown; f: Field }) {
  if (v === null || v === undefined || v === "") return <span className="text-subtle">—</span>;
  if (f.type === "boolean") return v ? <span aria-label="Yes">✓</span> : <span className="text-subtle">—</span>;
  if (Array.isArray(v)) return <span className="flex flex-wrap gap-1">{v.map((x) => <Badge key={String(x)}>{String(x)}</Badge>)}</span>;
  if (f.type === "relation" && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return <Badge tone="accent">{String(Object.entries(o).find(([k, x]) => k !== "id" && typeof x === "string" && !k.endsWith("_at"))?.[1] ?? o.id)}</Badge>;
  }
  if (f.type === "url") return <a href={String(v)} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">{String(v).replace(/^https?:\/\//, "")}</a>;
  if (typeof v === "object") return <code className="truncate text-[12px] text-muted">{JSON.stringify(v)}</code>;
  if (f.type === "datetime") return <>{new Date(String(v)).toLocaleString()}</>;
  return <span className="line-clamp-2 break-words">{String(v)}</span>;
}

function FilterButton({ fields, onAdd }: { fields: Field[]; onAdd: (f: Flt) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Flt>({ field: fields[0]?.key ?? "", op: "eq", value: "" });
  return (
    <>
      <Button icon={<FilterIcon className="size-3.5" />} onClick={() => setOpen(true)}>Filter</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a filter"
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!f.field || (!f.value && f.op !== "empty" && f.op !== "not_empty")}
              onClick={() => {
                onAdd(f);
                setOpen(false);
                setF((x) => ({ ...x, value: "" }));
              }}
            >
              Add
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Select value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })} aria-label="Field">
            {fields.map((x) => <option key={x.id} value={x.key}>{x.name}</option>)}
          </Select>
          <Select value={f.op} onChange={(e) => setF({ ...f, op: e.target.value as FilterOp })} aria-label="Condition">
            {FILTER_OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
          </Select>
          {f.op !== "empty" && f.op !== "not_empty" && <Input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={f.op === "in" ? "a, b, c" : "Value"} aria-label="Value" />}
        </div>
      </Dialog>
    </>
  );
}

function RowDialog({ projectId, table, tables, row, canWrite, onClose, onSaved }: { projectId: string; table: TableInfo; tables: TableInfo[]; row: Row | "new" | null; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  return row ? <RowForm key={row === "new" ? "new" : row.id} projectId={projectId} table={table} tables={tables} row={row} canWrite={canWrite} onClose={onClose} onSaved={onSaved} /> : null;
}

function RowForm({ projectId, table, tables, row, canWrite, onClose, onSaved }: { projectId: string; table: TableInfo; tables: TableInfo[]; row: Row | "new"; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const initial = Object.fromEntries(table.fields.map((f) => {
    const v = row === "new" ? undefined : row[f.key];
    const flat = f.type === "relation" && v && typeof v === "object" ? (v as { id: string }).id : v;
    return [f.key, flat === null || flat === undefined ? (f.type === "multiselect" ? [] : f.type === "boolean" ? false : "") : f.type === "json" ? JSON.stringify(flat, null, 2) : flat];
  }));
  const [vals, setVals] = useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(vals).filter(([k, v]) => row === "new" || JSON.stringify(v) !== JSON.stringify(initial[k])));
      return row === "new" ? api(`/api/v1/projects/${projectId}/data/api/${table.slug}`, { method: "POST", body }) : api(`/api/v1/projects/${projectId}/data/api/${table.slug}/${row.id}`, { method: "PATCH", body });
    },
    onSuccess: () => {
      toast({ tone: "success", title: row === "new" ? "Row added" : "Row saved" });
      onSaved();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) });
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={row === "new" ? `New ${table.name} row` : "Edit row"}
      description={row === "new" ? undefined : <code className="text-[12px]">{row.id}</code>}
      footer={
        <>
          <Button onClick={onClose}>{canWrite ? "Cancel" : "Close"}</Button>
          {canWrite && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{row === "new" ? "Add row" : "Save"}</Button>}
        </>
      }
    >
      <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
        {table.fields.map((f) => (
          <div key={f.id} className={cx((f.type === "longtext" || f.type === "json" || f.type === "multiselect") && "sm:col-span-2")}>
            <FormField label={`${f.name}${f.required ? " *" : ""}`} hint={f.description} error={errors[f.key]?.[0]}>
              {(p) => <ValueInput {...p} f={f} tables={tables} projectId={projectId} value={vals[f.key]} disabled={!canWrite} onChange={(v) => setVals((x) => ({ ...x, [f.key]: v }))} />}
            </FormField>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function ValueInput({ f, value, onChange, disabled, tables, projectId, ...a11y }: { f: Field; value: unknown; onChange: (v: unknown) => void; disabled: boolean; tables: TableInfo[]; projectId: string; id: string }) {
  const s = value === null || value === undefined ? "" : String(value);
  switch (f.type) {
    case "longtext":
    case "json":
      return <Textarea {...a11y} rows={f.type === "json" ? 6 : 4} className={f.type === "json" ? "font-mono text-[12px]" : undefined} value={s} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "boolean":
      return <div className="pt-1"><Switch checked={!!value} onChange={onChange} label={f.name} disabled={disabled} /></div>;
    case "select":
      return (
        <Select {...a11y} value={s} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">—</option>
          {f.options?.map((o) => <option key={o}>{o}</option>)}
        </Select>
      );
    case "multiselect": {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5 pt-1" id={a11y.id}>
          {f.options?.map((o) => (
            <button key={o} type="button" disabled={disabled} onClick={() => onChange(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o])} className={cx("h-7 rounded-full border px-3 text-[12px] transition-colors", cur.includes(o) ? "border-transparent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg")}>
              {o}
            </button>
          ))}
        </div>
      );
    }
    case "relation":
      return <RelationPicker {...a11y} projectId={projectId} target={tables.find((t) => t.id === f.relationTable)} value={s} onChange={onChange} disabled={disabled} />;
    case "number":
      return <Input {...a11y} type="number" step="any" value={s} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} disabled={disabled} />;
    case "date":
      return <Input {...a11y} type="date" value={s} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "datetime":
      return <Input {...a11y} type="datetime-local" value={s ? toLocalInput(s) : ""} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")} disabled={disabled} />;
    default:
      return <Input {...a11y} type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"} value={s} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
  }
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function RelationPicker({ projectId, target, value, onChange, disabled, id }: { projectId: string; target?: TableInfo; value: string; onChange: (v: unknown) => void; disabled: boolean; id: string }) {
  const q = useQuery({ queryKey: ["data-rel", projectId, target?.id], queryFn: () => api<Page>(`/api/v1/projects/${projectId}/data/api/${target!.slug}?limit=100`), enabled: !!target });
  if (!target) return <p className="text-[12px] text-danger">Linked table not found</p>;
  const label = (r: Row) => String(target.fields.map((f) => r[f.key]).find((v) => typeof v === "string" && v) ?? r.id);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">—</option>
      {q.data?.data.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
    </Select>
  );
}

function ImportDialog({ projectId, table, open, onClose, onDone }: { projectId: string; table: TableInfo; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ inserted: number; skipped: number; problems: { line: number; errors: string[] }[]; matched: string[]; ignored: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = useMutation({
    mutationFn: (skipInvalid: boolean) => api<NonNullable<typeof result>>(`/api/v1/projects/${projectId}/data/tables/${table.id}/import`, { method: "POST", body: { csv, skipInvalid } }),
    onSuccess: (r) => {
      setResult(r);
      if (r.inserted) {
        toast({ tone: "success", title: `Imported ${r.inserted} row${r.inserted === 1 ? "" : "s"}` });
        onDone();
      }
    },
    onError: (e) => toast({ tone: "error", title: "Import failed", description: errorMessage(e) }),
  });
  const close = () => {
    setCsv("");
    setName("");
    setResult(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Import CSV into ${table.name}`}
      description="The first row names the columns; they're matched to field names or keys. Nothing is imported if any row is invalid, unless you choose to skip those rows."
      footer={
        result?.inserted ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            {result && result.problems.length > 0 && <Button loading={run.isPending} onClick={() => run.mutate(true)}>Skip invalid rows</Button>}
            <Button variant="primary" disabled={!csv} loading={run.isPending} onClick={() => run.mutate(false)}>Import</Button>
          </>
        )
      }
    >
      <div className="grid gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 5_000_000) return toast({ tone: "error", title: "Files up to 5 MB" });
            setName(f.name);
            setResult(null);
            setCsv(await f.text());
          }}
        />
        <Button icon={<FileUp className="size-3.5" />} onClick={() => fileRef.current?.click()}>{name || "Choose a .csv file"}</Button>
        {csv && !result && <p className="text-[12px] text-muted">{csv.split(/\r?\n/).filter(Boolean).length - 1} rows · columns: {csv.split(/\r?\n/)[0].slice(0, 200)}</p>}
        {result && (
          <div className="grid gap-2 text-[13px]">
            <p>Matched: {result.matched.join(", ") || "none"}{result.ignored.length ? ` · ignored: ${result.ignored.join(", ")}` : ""}</p>
            {result.inserted > 0 && <Notice tone="success">Imported {result.inserted} rows{result.skipped ? `, skipped ${result.skipped}` : ""}.</Notice>}
            {result.problems.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-[10px] border border-border p-3 text-[12px]">
                {result.problems.map((p) => (
                  <p key={p.line}><b>Line {p.line}:</b> {p.errors.join("; ")}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ── Fields & access ──────────────────────────────────────────────────────────

function FieldsTab({ projectId, table, tables, canSchema, onDeleted }: { projectId: string; table: TableInfo; tables: TableInfo[]; canSchema: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fields, setFields] = useState<Field[]>(table.fields);
  const [meta, setMeta] = useState({ name: table.name, slug: table.slug, description: table.description });
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [access, setAccess] = useState<null | { publicRead?: boolean; publicInsert?: boolean }>(null);
  const [deleting, setDeleting] = useState(false);
  const dirty = JSON.stringify(fields) !== JSON.stringify(table.fields) || meta.name !== table.name || meta.slug !== table.slug || meta.description !== table.description;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["data", projectId] });
    qc.invalidateQueries({ queryKey: ["data-rows", projectId, table.id] });
  };
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/v1/projects/${projectId}/data/tables/${table.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setConflict(null);
      setAccess(null);
      refresh();
      toast({ tone: "success", title: "Table saved" });
    },
    onError: (e) => {
      const d = e instanceof ApiClientError ? (e.details as { conversions?: string[] } | null) : null;
      if (d?.conversions) setConflict(d.conversions);
      else toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) });
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/data/tables/${table.id}`, { method: "DELETE" }),
    onSuccess: () => {
      onDeleted();
      refresh();
      toast({ tone: "success", title: `Deleted ${table.name}` });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't delete", description: errorMessage(e) }),
  });
  const set = (i: number, patch: Partial<Field>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => setFields((fs) => {
    const n = [...fs];
    const j = i + d;
    if (j < 0 || j >= n.length) return fs;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid content-start gap-4">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <FormField label="Name">{(p) => <Input {...p} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} disabled={!canSchema} />}</FormField>
          <FormField label="API name" hint="Changing it changes the API path.">{(p) => <Input {...p} value={meta.slug} onChange={(e) => setMeta({ ...meta, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} disabled={!canSchema} />}</FormField>
          <div className="sm:col-span-2">
            <FormField label="Description">{(p) => <Input {...p} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} disabled={!canSchema} maxLength={300} />}</FormField>
          </div>
        </Card>
        <Card className="divide-y divide-border p-0">
          {fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_160px_auto]">
              <Input value={f.name} aria-label="Field name" onChange={(e) => set(i, { name: e.target.value, ...(table.fields.some((x) => x.id === f.id) ? {} : { key: slugKey(e.target.value) }) })} disabled={!canSchema} />
              <Input value={f.key} aria-label="Field key" className="font-mono text-[12px]" onChange={(e) => set(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} disabled={!canSchema} />
              <Select value={f.type} aria-label="Field type" onChange={(e) => set(i, { type: e.target.value as FieldType, ...(e.target.value === "select" || e.target.value === "multiselect" ? { options: f.options?.length ? f.options : ["Option 1"] } : {}), ...(e.target.value === "relation" ? { relationTable: tables.find((t) => t.id !== table.id)?.id ?? table.id } : {}) })} disabled={!canSchema}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_INFO[t].label}</option>)}
              </Select>
              <div className="flex items-center gap-1">
                <label className="mr-2 flex items-center gap-1.5 text-[12px] text-muted">
                  <input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} disabled={!canSchema} /> Required
                </label>
                <Button size="sm" variant="ghost" aria-label="Move up" icon={<ArrowUp className="size-3.5" />} disabled={!canSchema || i === 0} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" aria-label="Move down" icon={<ArrowDown className="size-3.5" />} disabled={!canSchema || i === fields.length - 1} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" aria-label={`Remove ${f.name}`} icon={<Trash2 className="size-3.5" />} disabled={!canSchema || fields.length === 1} onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} />
              </div>
              {(f.type === "select" || f.type === "multiselect") && (
                <div className="sm:col-span-2 2xl:col-span-4">
                  <Input value={(f.options ?? []).join(", ")} aria-label="Options" placeholder="Options, separated by commas" onChange={(e) => set(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} disabled={!canSchema} />
                </div>
              )}
              {f.type === "relation" && (
                <div className="sm:col-span-2 2xl:col-span-4">
                  <Select value={f.relationTable ?? ""} aria-label="Linked table" onChange={(e) => set(i, { relationTable: e.target.value })} disabled={!canSchema}>
                    {tables.map((t) => <option key={t.id} value={t.id}>Links to: {t.name}</option>)}
                  </Select>
                </div>
              )}
            </div>
          ))}
          {canSchema && (
            <div className="p-3">
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setFields((fs) => [...fs, { id: newFieldId(), key: `field_${fs.length + 1}`, name: `Field ${fs.length + 1}`, type: "text", required: false }])}>
                Add field
              </Button>
            </div>
          )}
        </Card>
        {conflict && (
          <Notice tone="warning" title="Some values can't be converted" action={<Button size="sm" loading={save.isPending} onClick={() => save.mutate({ ...meta, fields, clearInvalid: true })}>Clear those values and save</Button>}>
            {conflict.map((c) => <span key={c} className="block">{c}</span>)}
          </Notice>
        )}
        {canSchema && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={!dirty} onClick={() => { setFields(table.fields); setMeta({ name: table.name, slug: table.slug, description: table.description }); setConflict(null); }}>Reset</Button>
            <Button variant="primary" disabled={!dirty} loading={save.isPending && !access} onClick={() => save.mutate({ ...meta, fields })}>Save changes</Button>
          </div>
        )}
      </div>
      <div className="grid content-start gap-4">
        <Card className="grid gap-4 p-5">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Lock className="size-4" /> Access</h3>
          <p className="text-[12px] text-muted">API keys with data scopes and your team can always use this table. These switches open it to anyone, without a key.</p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px]">Anyone can read rows</span>
            <Switch checked={table.publicRead} onChange={(v) => setAccess({ publicRead: v })} label="Public read" disabled={!canSchema} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px]">Anyone can add rows</span>
            <Switch checked={table.publicInsert} onChange={(v) => setAccess({ publicInsert: v })} label="Public insert" disabled={!canSchema} />
          </div>
        </Card>
        {canSchema && (
          <Card className="grid gap-3 p-5">
            <h3 className="text-[14px] font-semibold">Delete table</h3>
            <p className="text-[12px] text-muted">Deletes the table and all {table.rowCount.toLocaleString()} rows. Export a CSV first if you may need them.</p>
            <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>Delete {table.name}</Button>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={!!access}
        onClose={() => setAccess(null)}
        onConfirm={() => access && save.mutate(access)}
        loading={save.isPending}
        destructive={!!(access?.publicRead || access?.publicInsert)}
        confirmLabel={access?.publicRead || access?.publicInsert ? "Make public" : "Make private"}
        title={access?.publicRead ? "Let anyone read this table?" : access?.publicInsert ? "Let anyone add rows?" : "Turn off public access?"}
        description={
          access?.publicRead
            ? "Every row and field becomes readable by anyone who knows the project's API address — don't use this for emails or private notes."
            : access?.publicInsert
              ? "Anyone can add rows (rate-limited per visitor). Useful for waitlists and sign-ups; they can't read or change other rows."
              : "Requests without an API key will stop working."
        }
      />
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive confirmLabel="Delete table" title={`Delete ${table.name}?`} description={`This permanently deletes the table and its ${table.rowCount.toLocaleString()} rows. API calls and data lists using “${table.slug}” will stop working.`} />
    </div>
  );
}

function NewTableDialog({ projectId, open, onClose, onCreated }: { projectId: string; open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ table: { id: string } }>(`/api/v1/projects/${projectId}/data/tables`, { method: "POST", body: { name } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["data", projectId] });
      onCreated(r.table.id);
      setName("");
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title="New table" description="Start with a Name field; add more fields next." size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create</Button></>}>
      <div className="grid gap-2">
        <FormField label="Table name" error={create.isError ? errorMessage(create.error) : undefined}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Team members" autoFocus />}</FormField>
      </div>
    </Dialog>
  );
}

// ── API ──────────────────────────────────────────────────────────────────────

function ApiTab({ projectId, table, overview, canWrite }: { projectId: string; table: TableInfo; overview: Overview; canWrite: boolean }) {
  const sample = Object.fromEntries(table.fields.slice(0, 4).map((f) => [f.key, f.type === "number" ? 1 : f.type === "boolean" ? true : f.type === "select" ? f.options?.[0] : f.type === "multiselect" ? f.options?.slice(0, 1) : f.type === "date" ? "2026-10-21" : f.type === "email" ? "name@example.com" : f.type === "url" ? "https://example.com" : "Text"]));
  const [method, setMethod] = useState<"GET" | "POST" | "PATCH" | "DELETE">("GET");
  const [path, setPath] = useState(`/data/${table.slug}?limit=5`);
  const [body, setBody] = useState(JSON.stringify(sample, null, 2));
  const [as, setAs] = useState<"key" | "anonymous">("key");
  const [scopes, setScopes] = useState<string[]>(["data:read"]);
  const send = useMutation({ mutationFn: () => api<{ status: number; body: unknown; durationMs: number }>(`/api/v1/projects/${projectId}/data/console`, { method: "POST", body: { method, path, body: method === "POST" || method === "PATCH" ? body : undefined, as, scopes } }) });
  const base = table.publicRead || table.publicInsert ? overview.publicBase : overview.apiBase;
  const curl = [
    `curl ${method !== "GET" ? `-X ${method} ` : ""}"${(as === "anonymous" ? overview.publicBase : overview.apiBase) + path}"`,
    as === "key" ? `  -H "Authorization: Bearer $CC_API_KEY"` : "",
    method === "POST" || method === "PATCH" ? `  -H "Content-Type: application/json" -d '${body.replace(/\s*\n\s*/g, " ")}'` : "",
  ].filter(Boolean).join(" \\\n");
  const endpoints: [string, string, string][] = [
    ["GET", `/data/${table.slug}`, "List rows · filter[key][op]=, sort=-key, q=, limit, offset, expand"],
    ["POST", `/data/${table.slug}`, "Add a row, or { rows: [...] } (up to 500)"],
    ["GET", `/data/${table.slug}/{id}`, "One row"],
    ["PATCH", `/data/${table.slug}/{id}`, "Change some fields"],
    ["DELETE", `/data/${table.slug}/{id}`, "Delete a row"],
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Card className="divide-y divide-border p-0">
          {endpoints.map(([m, p, d]) => (
            <button key={m + p} type="button" onClick={() => { setMethod(m as typeof method); setPath(p.replace("{id}", "ROW_ID")); }} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2/50">
              <span className={cx("w-14 shrink-0 font-mono text-[11px] font-semibold", m === "GET" ? "text-success" : m === "DELETE" ? "text-danger" : "text-accent")}>{m}</span>
              <span className="min-w-0">
                <code className="block truncate text-[12px]">{p}</code>
                <span className="text-[12px] text-muted">{d}</span>
              </span>
            </button>
          ))}
        </Card>
        <Notice title="Authentication">
          Send <code>Authorization: Bearer cc_live_…</code> with a key that has <b>data:read</b> or <b>data:write</b> (Integrations → API keys). {table.publicRead || table.publicInsert ? <>Public access without a key uses <code className="break-all">{overview.publicBase}</code>.</> : null}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 text-[13px] hover:bg-surface-2" href={`/api/v1/projects/${projectId}/data/openapi`} target="_blank" rel="noreferrer">
            <Braces className="size-3.5" /> OpenAPI document
          </a>
          <code className="flex h-9 items-center rounded-[var(--radius-md)] bg-surface-2 px-3 text-[12px] text-muted">{base}</code>
        </div>
      </div>
      <Card className="grid content-start gap-3 p-4">
        <h3 className="text-[14px] font-semibold">Try it</h3>
        <div className="flex gap-2">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} aria-label="Method" className="!w-28 shrink-0 font-mono text-[12px]">
            {(["GET", "POST", "PATCH", "DELETE"] as const).map((m) => <option key={m} disabled={m !== "GET" && !canWrite}>{m}</option>)}
          </Select>
          <Input value={path} onChange={(e) => setPath(e.target.value)} className="font-mono text-[12px]" aria-label="Path" />
        </div>
        {(method === "POST" || method === "PATCH") && <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-[12px]" aria-label="JSON body" />}
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <Select value={as} onChange={(e) => setAs(e.target.value as typeof as)} aria-label="Send as" className="!w-44">
            <option value="key">As an API key</option>
            <option value="anonymous">Without a key</option>
          </Select>
          {as === "key" &&
            ["data:read", "data:write"].map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} /> {s}
              </label>
            ))}
          <Button variant="primary" className="ml-auto" icon={<Send className="size-3.5" />} loading={send.isPending} onClick={() => send.mutate()}>Send</Button>
        </div>
        {method !== "GET" && <p className="text-[11px] text-muted">Writes from the console change real data.</p>}
        {send.data && (
          <div className="grid gap-1.5">
            <p className="text-[12px]">
              <Badge tone={send.data.status < 300 ? "success" : send.data.status < 500 ? "warning" : "danger"}>{send.data.status}</Badge> <span className="text-muted">{send.data.durationMs} ms</span>
            </p>
            <pre className="max-h-80 overflow-auto rounded-[10px] bg-[#0b0b0c] p-3 font-mono text-[12px] leading-relaxed text-[#e5e5ea]">{JSON.stringify(send.data.body, null, 2)}</pre>
          </div>
        )}
        {send.isError && <p className="text-[12px] text-danger">{errorMessage(send.error)}</p>}
        <details className="text-[12px]">
          <summary className="cursor-pointer text-muted">cURL</summary>
          <pre className="mt-2 overflow-x-auto rounded-[10px] bg-surface-2 p-3 font-mono text-[11px]">{curl}</pre>
        </details>
      </Card>
    </div>
  );
}
