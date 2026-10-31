"use client";

// Contacts: ready-made and saved views, filters, a sortable table, actions on
// many at once (or on everything matching), import from a spreadsheet, export
// and merging duplicates.
import { ArrowDown, ArrowUp, Bookmark, Copy, Download, FileUp, Plus, Repeat, Tag as TagIcon, Trash2, UserRound, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog, Dialog, Menu } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { SmartImport } from "@/components/import/smart-import";
import type { Field as ImportField, Target } from "@/lib/import/engine";
import { target } from "@/lib/import/targets";
import { LEAD_STATUS, LEAD_STATUS_LABEL, LIFECYCLE, LIFECYCLE_LABEL, SOURCE_LABEL, type ContactQuery } from "@/lib/crm/model";
import { ContactDialog } from "./dialogs";
import { Avatar, LifecycleBadge, OwnerSelect, Score, ago, crmApi, ownerName, useCrm, useCrmAction, useCrmParts, useCrmQuery, type Contact, LabeledSwitch } from "./shared";

type Q = Partial<Record<keyof ContactQuery, string | number>>;
type View = { id: string; name: string; query: Q; userId?: string | null };

const PRESETS: View[] = [
  { id: "all", name: "All contacts", query: {} },
  { id: "mine", name: "Mine", query: { owner: "me" } },
  { id: "new", name: "New leads", query: { lifecycle: "lead", leadStatus: "new" } },
  { id: "hot", name: "Hot leads", query: { lifecycle: "lead,qualified,opportunity", minScore: 60, sort: "score" } },
  { id: "customers", name: "Customers", query: { lifecycle: "customer,evangelist" } },
  { id: "stale", name: "Gone quiet", query: { activity: "stale30", lifecycle: "lead,qualified,opportunity" } },
];

function qs(q: Q) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== "" && v !== undefined && v !== 0) p.set(k, String(v));
  return p.toString();
}

export function ContactsView() {
  const { meta, orgId, go } = useCrm();
  const [viewId, setViewId] = useState("all");
  const [q, setQ] = useState<Q>({});
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dupes, setDupes] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useCrmQuery<{ views: View[] }>("views?entity=contact");
  const query = { ...q, page, per: 50 };
  const list = useCrmQuery<{ total: number; contacts: Contact[] }>(`contacts?${qs(query)}`, { keepPrevious: true });
  const views = [...PRESETS, ...(saved.data?.views ?? [])];
  const pickView = (v: View) => {
    setViewId(v.id);
    setQ(v.query);
    setPage(1);
    setSel(new Set());
    setAllMatching(false);
  };
  const patch = (p: Q) => {
    setQ((x) => ({ ...x, ...p }));
    setPage(1);
    setSel(new Set());
    setAllMatching(false);
    setViewId("");
  };
  const rows = list.data?.contacts ?? [];
  const total = list.data?.total ?? 0;
  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const sort = (q.sort as string) || "updated";
  const dir = (q.dir as string) || "desc";
  const sortBy = (k: string) => patch({ sort: k, dir: sort === k && dir === "desc" ? "asc" : "desc" });
  const selCount = allMatching ? total : sel.size;
  const target = allMatching ? { query: q } : { ids: [...sel] };
  const lifecycleFilter = String(q.lifecycle ?? "");
  const exportHref = `${crmApi(orgId, "contacts/export")}?${qs(q)}`;
  const delView = useCrmAction<string>((id) => ({ path: `views/${id}`, method: "DELETE" }), { success: "View removed", onDone: () => pickView(PRESETS[0]) });

  return (
    <div>
      <PageHeader
        title="Contacts"
        description={list.data ? `${total.toLocaleString("en-IN")} ${total === 1 ? "person" : "people"}${viewId ? "" : " match"}` : "Everyone you sell to, in one list."}
        actions={
          <div className="flex flex-wrap gap-2">
            <Menu
              label="More"
              trigger={(p) => (
                <Button {...p} size="sm" icon={<FileUp className="size-4" />}>
                  Import & export
                </Button>
              )}
              items={[
                ...(meta.me.write ? [{ label: "Import a spreadsheet", icon: <FileUp className="size-4" />, onSelect: () => setImporting(true) }] : []),
                { label: "Export these to CSV", icon: <Download className="size-4" />, onSelect: () => window.open(exportHref, "_blank") },
                ...(meta.me.manage ? [{ label: "Find duplicates", icon: <Copy className="size-4" />, onSelect: () => setDupes(true) }] : []),
              ]}
            />
            {meta.me.write && (
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Contact
              </Button>
            )}
          </div>
        }
      />
      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1">
        {views.map((v) => (
          <span key={v.id} className={cx("group flex h-8 shrink-0 items-center rounded-full text-[13px] font-medium", viewId === v.id ? "bg-fg text-bg" : "border border-border text-muted hover:text-fg")}>
            <button type="button" onClick={() => pickView(v)} className="h-full px-3">
              {v.name}
            </button>
            {!PRESETS.includes(v) && viewId === v.id && (meta.me.manage || v.userId) && (
              <button type="button" aria-label={`Delete view ${v.name}`} onClick={() => delView.mutate(v.id)} className="-ml-1.5 pr-2 opacity-70 hover:opacity-100">
                <X className="size-3.5" />
              </button>
            )}
          </span>
        ))}
        {!viewId && Object.keys(q).length > 0 && (
          <button type="button" onClick={() => setSaving(true)} className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 text-[13px] font-medium text-muted hover:text-fg">
            <Bookmark className="size-3.5" /> Save view
          </button>
        )}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input aria-label="Filter contacts" className="col-span-2 sm:col-span-3 lg:col-span-2" value={String(q.q ?? "")} onChange={(e) => patch({ q: e.target.value })} placeholder="Name, email, phone or company" />
        <Select aria-label="Stage" value={LIFECYCLE.includes(lifecycleFilter as (typeof LIFECYCLE)[number]) || !lifecycleFilter ? lifecycleFilter : "__multi"} onChange={(e) => patch({ lifecycle: e.target.value === "__multi" ? lifecycleFilter : e.target.value })}>
          <option value="">Any stage</option>
          {LIFECYCLE.map((l) => (
            <option key={l} value={l}>
              {LIFECYCLE_LABEL[l]}
            </option>
          ))}
          {lifecycleFilter.includes(",") && <option value="__multi">Several stages</option>}
        </Select>
        <Select aria-label="Owner" value={String(q.owner ?? "")} onChange={(e) => patch({ owner: e.target.value })}>
          <option value="">Any owner</option>
          <option value="me">Mine</option>
          <option value="none">Unassigned</option>
          {meta.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Tag" value={String(q.tag ?? "")} onChange={(e) => patch({ tag: e.target.value })}>
          <option value="">Any tag</option>
          {meta.tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.n})
            </option>
          ))}
        </Select>
        <Select aria-label="Last activity" value={String(q.activity ?? "")} onChange={(e) => patch({ activity: e.target.value })}>
          <option value="">Any activity</option>
          <option value="7d">Active this week</option>
          <option value="30d">Active this month</option>
          <option value="stale30">Quiet for 30+ days</option>
          <option value="never">Never contacted</option>
        </Select>
      </div>

      {selCount > 0 && <BulkBar count={selCount} total={total} allMatching={allMatching} canSelectAll={allOnPage && !allMatching && total > rows.length} onSelectAll={() => setAllMatching(true)} onClear={() => (setSel(new Set()), setAllMatching(false))} target={target} ids={[...sel]} />}

      {!list.data ? (
        <Skeleton className="h-[60vh] rounded-[20px]" />
      ) : !rows.length ? (
        Object.keys(q).length ? (
          <EmptyState icon={<Users />} title="No one matches" description="Try fewer filters." action={<Button size="sm" onClick={() => pickView(PRESETS[0])}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={<Users />} title="No contacts yet" description="Add people by hand, import a spreadsheet, or bring in customers from your store, bookings and forms on the CRM home page." action={meta.me.write ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add a contact</Button> : undefined} />
        )
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[860px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={(e) => (setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set()), setAllMatching(false))} />
                </th>
                <SortTh label="Name" k="name" sort={sort} dir={dir} onSort={sortBy} />
                <th className="px-3 py-2.5 font-medium">Company</th>
                <th className="px-3 py-2.5 font-medium">Stage</th>
                <SortTh label="Score" k="score" sort={sort} dir={dir} onSort={sortBy} />
                <th className="px-3 py-2.5 font-medium">Owner</th>
                <SortTh label="Last activity" k="activity" sort={sort} dir={dir} onSort={sortBy} />
                <SortTh label="Added" k="created" sort={sort} dir={dir} onSort={sortBy} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id} className={cx("cursor-pointer hover:bg-surface-2", sel.has(c.id) && "bg-accent-soft/40")} onClick={() => go(`contacts/${c.id}`)}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.name || c.email}`}
                      checked={allMatching || sel.has(c.id)}
                      onChange={(e) => {
                        const n = new Set(sel);
                        if (e.target.checked) n.add(c.id);
                        else n.delete(c.id);
                        setSel(n);
                        setAllMatching(false);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={c.name || c.email || c.phone} size={30} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {c.name || <span className="text-muted">No name</span>}
                          {c.doNotContact && <span className="ml-1.5 text-[11px] font-normal text-danger">· do not contact</span>}
                        </p>
                        <p className="truncate text-[12px] text-muted">{c.email || c.phone || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-muted">{c.company || "—"}</td>
                  <td className="px-3 py-2">
                    <LifecycleBadge value={c.lifecycle} />
                  </td>
                  <td className="px-3 py-2">
                    <Score value={c.score} />
                  </td>
                  <td className="px-3 py-2 text-muted">{ownerName(meta, c.ownerId)}</td>
                  <td className="px-3 py-2 text-muted">{ago(c.lastActivityAt)}</td>
                  <td className="px-3 py-2 text-muted">{ago(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > 50 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12.5px] text-muted">
              <span>
                {(page - 1) * 50 + 1}–{Math.min(total, page * 50)} of {total.toLocaleString("en-IN")}
              </span>
              <span className="flex gap-2">
                <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button size="sm" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </span>
            </div>
          )}
        </div>
      )}
      {adding && <ContactDialog onClose={() => setAdding(false)} onSaved={(c) => go(`contacts/${c.id}`)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {dupes && <DuplicatesDialog onClose={() => setDupes(false)} />}
      {saving && <SaveViewDialog query={q} onClose={() => setSaving(false)} onSaved={(v) => (setViewId(v.id), setSaving(false))} />}
    </div>
  );
}

function SortTh({ label, k, sort, dir, onSort }: { label: string; k: string; sort: string; dir: string; onSort: (k: string) => void }) {
  return (
    <th className="px-3 py-2.5 font-medium" aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-fg">
        {label}
        {sort === k && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
}

function BulkBar({ count, total, allMatching, canSelectAll, onSelectAll, onClear, target, ids }: { count: number; total: number; allMatching: boolean; canSelectAll: boolean; onSelectAll: () => void; onClear: () => void; target: { ids?: string[]; query?: Q }; ids: string[] }) {
  const part = useCrmParts();
  const { meta, go } = useCrm();
  const [ask, setAsk] = useState<null | "owner" | "lifecycle" | "lead_status" | "tag_add" | "tag_remove" | "sequence" | "delete">(null);
  const run = useCrmAction<{ action: string; value: unknown }, { count: number }>((b) => ({ path: "contacts/bulk", body: { ...target, ...b } }), { success: (r) => `Updated ${r.count} contact${r.count === 1 ? "" : "s"}`, onDone: () => (setAsk(null), onClear()) });
  const merge = useCrmAction<void, { contact: Contact }>(() => ({ path: "contacts/merge", body: { keepId: ids[0], otherIds: ids.slice(1) } }), { success: "Merged", onDone: (r) => (onClear(), go(`contacts/${r.contact.id}`)) });
  if (!meta.me.write) return null;
  return (
    <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-[16px] border border-border bg-surface-solid px-3 py-2 shadow-lg">
      <b className="text-[13px]">{count.toLocaleString("en-IN")} selected</b>
      {canSelectAll && (
        <button type="button" onClick={onSelectAll} className="text-[12.5px] font-medium text-accent underline">
          Select all {total.toLocaleString("en-IN")} matching
        </button>
      )}
      {allMatching && <span className="text-[12px] text-muted">(every contact matching these filters)</span>}
      <span className="ml-auto flex flex-wrap gap-1.5">
        <Button size="sm" icon={<UserRound className="size-3.5" />} onClick={() => setAsk("owner")}>
          Assign
        </Button>
        <Button size="sm" onClick={() => setAsk("lifecycle")}>
          Stage
        </Button>
        <Button size="sm" icon={<TagIcon className="size-3.5" />} onClick={() => setAsk("tag_add")}>
          Tag
        </Button>
        {part("sequences") && (
          <Button size="sm" icon={<Repeat className="size-3.5" />} onClick={() => setAsk("sequence")}>
            Sequence
          </Button>
        )}
        <Menu
          label="More bulk actions"
          trigger={(p) => (
            <Button {...p} size="sm">
              More
            </Button>
          )}
          items={[
            { label: "Set lead status", onSelect: () => setAsk("lead_status") },
            { label: "Remove a tag", onSelect: () => setAsk("tag_remove") },
            { label: "Agreed to marketing", onSelect: () => run.mutate({ action: "marketing", value: true }) },
            ...(meta.me.manage && !allMatching && ids.length >= 2 && ids.length <= 10 ? [{ label: `Merge these ${ids.length}`, icon: <Copy className="size-4" />, onSelect: () => merge.mutate() }] : []),
            ...(meta.me.manage ? ["separator" as const, { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setAsk("delete") }] : []),
          ]}
        />
        <Button size="sm" variant="ghost" aria-label="Clear selection" icon={<X className="size-4" />} onClick={onClear} />
      </span>
      {ask && ask !== "delete" && ask !== "sequence" && <BulkValueDialog kind={ask} count={count} busy={run.isPending} onClose={() => setAsk(null)} onApply={(value) => run.mutate({ action: ask, value })} />}
      {ask === "sequence" && <EnrollDialog target={target} count={count} onClose={() => setAsk(null)} onDone={onClear} />}
      <ConfirmDialog open={ask === "delete"} onClose={() => setAsk(null)} onConfirm={() => run.mutate({ action: "delete", value: null })} loading={run.isPending} destructive title={`Delete ${count.toLocaleString("en-IN")} contact${count === 1 ? "" : "s"}?`} description="Their timeline and sequence enrolments go too. Deals stay, without a contact. This can't be undone." confirmLabel="Delete" />
    </div>
  );
}

function BulkValueDialog({ kind, count, busy, onClose, onApply }: { kind: "owner" | "lifecycle" | "lead_status" | "tag_add" | "tag_remove"; count: number; busy: boolean; onClose: () => void; onApply: (v: unknown) => void }) {
  const { meta } = useCrm();
  const [v, setV] = useState<string | null>(kind === "owner" ? meta.me.id : kind === "lifecycle" ? "qualified" : kind === "lead_status" ? "contacted" : "");
  const title = { owner: "Assign to", lifecycle: "Move to stage", lead_status: "Set lead status", tag_add: "Add a tag", tag_remove: "Remove a tag" }[kind];
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={title}
      description={`For ${count.toLocaleString("en-IN")} contact${count === 1 ? "" : "s"}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={(kind === "tag_add" || kind === "tag_remove") && !v} onClick={() => onApply(v)}>
            Apply
          </Button>
        </>
      }
    >
      {kind === "owner" ? (
        <OwnerSelect value={v} onChange={setV} />
      ) : kind === "lifecycle" ? (
        <Select aria-label="Stage" value={v ?? ""} onChange={(e) => setV(e.target.value)}>
          {LIFECYCLE.map((l) => (
            <option key={l} value={l}>
              {LIFECYCLE_LABEL[l]}
            </option>
          ))}
        </Select>
      ) : kind === "lead_status" ? (
        <Select aria-label="Lead status" value={v ?? ""} onChange={(e) => setV(e.target.value)}>
          {LEAD_STATUS.map((l) => (
            <option key={l} value={l}>
              {LEAD_STATUS_LABEL[l]}
            </option>
          ))}
        </Select>
      ) : (
        <>
          <Input aria-label="Tag" list="crm-tags-bulk" value={v ?? ""} onChange={(e) => setV(e.target.value)} placeholder="VIP" autoFocus />
          <datalist id="crm-tags-bulk">
            {meta.tags.map((t) => (
              <option key={t.tag} value={t.tag} />
            ))}
          </datalist>
        </>
      )}
    </Dialog>
  );
}

export function EnrollDialog({ target, count, onClose, onDone }: { target: { ids?: string[]; query?: Q }; count: number; onClose: () => void; onDone?: () => void }) {
  const seqs = useCrmQuery<{ sequences: { id: string; name: string; active: boolean; steps: unknown[] }[] }>("sequences");
  const [id, setId] = useState("");
  const [result, setResult] = useState<{ added: number; skipped: { name: string; why: string }[] } | null>(null);
  const run = useCrmAction<void, { added: number; skipped: { name: string; why: string }[] }>(() => ({ path: `sequences/${id}/enroll`, body: target.ids ? { contactIds: target.ids } : { query: target.query } }), { onDone: (r) => (setResult(r), onDone?.()) });
  const active = (seqs.data?.sequences ?? []).filter((s) => s.active);
  return (
    <Dialog open onClose={onClose} size="sm" title="Add to a sequence" description={result ? undefined : `${count.toLocaleString("en-IN")} contact${count === 1 ? "" : "s"} will start getting its follow-ups.`} footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={run.isPending} disabled={!id} onClick={() => run.mutate()}>Add</Button></>}>
      {result ? (
        <div className="grid gap-2 text-[13.5px]">
          <p>
            <b>{result.added}</b> added.
          </p>
          {result.skipped.length > 0 && (
            <div className="rounded-[12px] bg-surface-2 p-3 text-[12.5px]">
              <p className="mb-1 font-medium">{result.skipped.length} skipped</p>
              <ul className="grid max-h-40 gap-0.5 overflow-y-auto text-muted">
                {result.skipped.slice(0, 50).map((s, i) => (
                  <li key={i}>
                    {s.name} — {s.why}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : !active.length ? (
        <p className="text-[13px] text-muted">No sequences are on yet. Create one under Sequences.</p>
      ) : (
        <Select aria-label="Sequence" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Choose a sequence…</option>
          {active.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.steps.length} steps
            </option>
          ))}
        </Select>
      )}
    </Dialog>
  );
}

function SaveViewDialog({ query, onClose, onSaved }: { query: Q; onClose: () => void; onSaved: (v: View) => void }) {
  const { meta } = useCrm();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const save = useCrmAction<void, { view: View }>(() => ({ path: "views", body: { entity: "contact", name, query, shared } }), { success: "View saved", onDone: (r) => onSaved(r.view) });
  return (
    <Dialog open onClose={onClose} size="sm" title="Save this view" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="Mumbai leads" />}</Field>
        {meta.me.manage && <LabeledSwitch checked={shared} onChange={setShared} label="Share with the whole team" />}
      </div>
    </Dialog>
  );
}

// ─── Import ───


function ImportDialog({ onClose }: { onClose: () => void }) {
  const { meta, orgId } = useCrm();
  const qc = useQueryClient();
  const [ownerId, setOwner] = useState<string | null>(meta.me.id);
  const [tag, setTag] = useState("");
  // Your own contact fields can be filled from the file too.
  const t: Target = useMemo(() => {
    const base = target("crm.contacts");
    const custom: ImportField[] = meta.fields
      .filter((f) => f.entity === "contact")
      .map((f) => ({ key: `custom.${f.key}`, label: f.label, type: f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "checkbox" ? "bool" : f.type === "url" ? "url" : f.type === "select" ? "enum" : "text", options: f.type === "select" ? f.options.map((o) => ({ value: o, label: o })) : undefined }));
    return { ...base, fields: [...base.fields, ...custom] };
  }, [meta.fields]);
  return (
    <SmartImport
      target={t}
      onClose={onClose}
      onDone={() => qc.invalidateQueries({ queryKey: ["crm", orgId] })}
      onImport={async (rows, mode) => {
        // A row needs a name, an email or a phone.
        const r = await api<{ created: number; updated: number; skipped: { row: number; reason: string }[] }>(crmApi(orgId, "contacts/import"), { method: "POST", body: { rows: rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === null ? "" : v]))), update: mode !== "skip", ownerId, tags: tag ? [tag] : [] } });
        return { created: r.created, updated: r.updated, skipped: 0, errors: r.skipped.map((x) => ({ row: x.row, message: x.reason })) };
      }}
      extra={
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-surface-2/60 px-3 py-2 text-[13px]">
          <OwnerSelect label="Owner for new contacts" value={ownerId} onChange={setOwner} className="!w-56" />
          <Input aria-label="Tag everyone with" className="!w-48" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag everyone with…" maxLength={40} />
        </div>
      }
    />
  );
}
function DuplicatesDialog({ onClose }: { onClose: () => void }) {
  const q = useCrmQuery<{ groups: { key: string; by: string; contacts: { id: string; name: string; email: string; phone: string; createdAt: string; source: string }[] }[] }>("contacts/duplicates");
  const [keep, setKeep] = useState<Record<string, string>>({});
  const merge = useCrmAction<{ keepId: string; otherIds: string[] }>((b) => ({ path: "contacts/merge", body: b }), { success: "Merged" });
  const groups = q.data?.groups ?? [];
  return (
    <Dialog open onClose={onClose} size="lg" title="Possible duplicates" description="People who share an email or phone number. Pick who to keep — the others' details, deals and timeline move onto them." footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {!q.data ? (
        <Skeleton className="h-40 rounded-[16px]" />
      ) : !groups.length ? (
        <p className="py-8 text-center text-[13.5px] text-muted">No duplicates found. 🎉</p>
      ) : (
        <ul className="grid gap-3">
          {groups.map((g) => {
            const k = keep[g.key] ?? g.contacts[0].id;
            return (
              <li key={g.key} className="rounded-[16px] border border-border p-3">
                <p className="mb-2 text-[12px] text-muted">Same {g.by}</p>
                <div className="grid gap-1.5">
                  {g.contacts.map((c) => (
                    <label key={c.id} className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-surface-2">
                      <input type="radio" name={g.key} checked={k === c.id} onChange={() => setKeep({ ...keep, [g.key]: c.id })} />
                      <Avatar name={c.name || c.email} size={24} />
                      <span className="min-w-0 flex-1 text-[13px]">
                        <b className="font-medium">{c.name || "No name"}</b> <span className="text-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="text-[11.5px] text-subtle">{SOURCE_LABEL[c.source] ?? c.source}</span>
                    </label>
                  ))}
                </div>
                <Button size="sm" className="mt-2" loading={merge.isPending} onClick={() => merge.mutate({ keepId: k, otherIds: g.contacts.map((c) => c.id).filter((x) => x !== k) })}>
                  Merge into the selected one
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

