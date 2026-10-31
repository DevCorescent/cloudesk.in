"use client";

// Settings → Organisation: companies (legal entities), branches and regions,
// cost centres / profit centres / business units, currencies and exchange
// rates, user groups, and what each member may see (with access reviews).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { ImportButton } from "@/components/import/buttons";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, EmptyState, Field, Input, Notice, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { BRANCH_KINDS, BRANCH_KIND_LABEL, UNIT_KINDS, UNIT_KIND_LABEL, type UnitKind } from "@/lib/org/model";

type Company = { id: string; name: string; legalName: string; gstin: string; pan: string; cin: string; state: string; address: string; baseCurrency: string; isDefault: boolean; parentId: string | null; active: boolean };
type Branch = { id: string; companyId: string; parentId: string | null; code: string; name: string; kind: (typeof BRANCH_KINDS)[number]; state: string; address: string; gstin: string; managerId: string | null; active: boolean };
type Unit = { id: string; kind: UnitKind; code: string; name: string; parentId: string | null; companyId: string | null; managerId: string | null; active: boolean };
type Currency = { code: string; name: string; symbol: string; decimals: number; active: boolean; latest: { date: string; rate: number } | null };
type Group = { id: string; name: string; description: string; members: string[] };
type Person = { id: string; name: string; email: string; role: string };
type Linkable = { id: string; name: string; branchId: string | null };
type Meta = { me: { id: string; admin: boolean }; companies: Company[]; branches: Branch[]; units: Unit[]; currencies: Currency[]; groups: Group[]; people: Person[]; common: { code: string; name: string; symbol: string; decimals: number }[]; links: { warehouses: Linkable[]; locations: Linkable[]; projects: Linkable[]; books: Linkable[] } | null };
type Tab = "companies" | "branches" | "units" | "currencies" | "groups" | "access";

function useOrg() {
  const { org } = useSession();
  return useQuery({ queryKey: ["org", org.id, "meta"], queryFn: () => api<Meta>(`/api/v1/orgs/${org.id}/org/meta`) });
}
function useOrgAction<B>(fn: (b: B) => { path: string; method?: string; body?: unknown }, success?: string, onDone?: () => void) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return api(`/api/v1/orgs/${org.id}/org/${r.path}`, { method: r.method ?? "POST", body: r.body ?? {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org", org.id] });
      if (success) toast({ tone: "success", title: success });
      onDone?.();
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
}

export function OrganisationSettings() {
  const q = useOrg();
  const [tab, setTab] = useState<Tab>("companies");
  if (!q.data) return <Skeleton className="h-80 rounded-[20px]" />;
  const m = q.data;
  if (!m.me.admin) return <Notice title="Only owners and admins change the organisation">Your companies, branches and cost centres appear in the screens that use them.</Notice>;
  return (
    <div>
      <p className="mb-4 max-w-2xl text-[13px] text-muted">How your business is set up: the legal entities that keep their own books, their branches, the cost centres expenses are charged to, the currencies you deal in, and who can see what.</p>
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-5"
        tabs={[
          { value: "companies", label: `Companies · ${m.companies.length}` },
          { value: "branches", label: `Branches · ${m.branches.length}` },
          { value: "units", label: `Cost centres · ${m.units.length}` },
          { value: "currencies", label: "Currencies" },
          { value: "groups", label: "Groups" },
          { value: "access", label: "Access" },
        ]}
      />
      {tab === "companies" && <Companies m={m} />}
      {tab === "branches" && <Branches m={m} />}
      {tab === "units" && <Units m={m} />}
      {tab === "currencies" && <Currencies m={m} />}
      {tab === "groups" && <Groups m={m} />}
      {tab === "access" && <AccessTab m={m} />}
    </div>
  );
}

const STATES = ["AN", "AP", "AR", "AS", "BR", "CH", "CG", "DN", "DL", "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL", "LA", "LD", "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PY", "PB", "RJ", "SK", "TN", "TS", "TR", "UP", "UK", "WB"];
function StateSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {STATES.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </Select>
  );
}

function Companies({ m }: { m: Meta }) {
  const [editing, setEditing] = useState<Company | "new" | null>(null);
  const makeDefault = useOrgAction<string>((id) => ({ path: `companies/${id}/default` }), "Default company changed");
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Companies</h2>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Company</Button>
      </div>
      <p className="mb-3 text-[12.5px] text-muted">Each company has its own books: its ledger entries, reports and GST. Anything not linked to a branch belongs to the default company.</p>
      <ul className="grid gap-2">
        {m.companies.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-surface p-3.5 shadow-sm">
            <Building2 className="size-5 text-muted" />
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-2 text-[14px] font-semibold">
                {c.name}
                {c.isDefault && <Badge tone="accent">Default</Badge>}
                {!c.active && <Badge>Off</Badge>}
              </b>
              <span className="text-[12px] text-muted">
                {[c.legalName, c.gstin && `GSTIN ${c.gstin}`, c.state, c.parentId && `part of ${m.companies.find((x) => x.id === c.parentId)?.name ?? ""}`].filter(Boolean).join(" · ") || "No details yet"} · {m.branches.filter((b) => b.companyId === c.id).length} branches
              </span>
            </span>
            {!c.isDefault && c.active && <Button size="sm" variant="ghost" icon={<Star className="size-3.5" />} onClick={() => makeDefault.mutate(c.id)}>Make default</Button>}
            <Button size="sm" onClick={() => setEditing(c)}>Edit</Button>
          </li>
        ))}
      </ul>
      {editing && <CompanyDialog m={m} c={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function CompanyDialog({ m, c, onClose }: { m: Meta; c?: Company; onClose: () => void }) {
  const [f, setF] = useState({ name: c?.name ?? "", legalName: c?.legalName ?? "", gstin: c?.gstin ?? "", pan: c?.pan ?? "", cin: c?.cin ?? "", state: c?.state ?? "", address: c?.address ?? "", baseCurrency: c?.baseCurrency ?? "INR", parentId: c?.parentId ?? null, active: c?.active ?? true });
  const [deleting, setDeleting] = useState(false);
  const save = useOrgAction<void>(() => ({ path: c ? `companies/${c.id}` : "companies", method: c ? "PUT" : "POST", body: f }), "Saved", onClose);
  const del = useOrgAction<void>(() => ({ path: `companies/${c!.id}`, method: "DELETE" }), "Deleted", onClose);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <Dialog open onClose={onClose} title={c ? `Edit ${c.name}` : "New company"} size="lg" footer={<>{c && !c.isDefault && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="Legal name">{(p) => <Input {...p} value={f.legalName} onChange={(e) => set({ legalName: e.target.value })} />}</Field>
        <Field label="GSTIN" hint="Its state is filled in from it">{(p) => <Input {...p} value={f.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />}</Field>
        <Field label="State">{(p) => <StateSelect id={p.id} value={f.state} onChange={(v) => set({ state: v })} />}</Field>
        <Field label="PAN">{(p) => <Input {...p} value={f.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />}</Field>
        <Field label="CIN">{(p) => <Input {...p} value={f.cin} onChange={(e) => set({ cin: e.target.value.toUpperCase() })} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.address} onChange={(e) => set({ address: e.target.value })} />}</Field>
        <Field label="Part of (group parent)">
          {(p) => (
            <Select {...p} value={f.parentId ?? ""} onChange={(e) => set({ parentId: e.target.value || null })}>
              <option value="">None</option>
              {m.companies.filter((x) => x.id !== c?.id).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-end gap-2.5 pb-1 text-[13px]"><Switch checked={f.active} onChange={(v) => set({ active: v })} label="Active" /> Active</label>
      </div>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title={`Delete ${c?.name}?`} description="Only a company with no branches, books or ledger entries can be deleted." confirmLabel="Delete" destructive loading={del.isPending} onConfirm={() => del.mutate()} />
    </Dialog>
  );
}

function Branches({ m }: { m: Meta }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const link = useOrgAction<{ kind: string; id: string; branchId: string | null }>((b) => ({ path: "links", body: b }), "Linked");
  // Regions first, then what sits under each.
  const tree = (parent: string | null, depth = 0): { b: Branch; depth: number }[] => m.branches.filter((b) => b.parentId === parent).flatMap((b) => [{ b, depth }, ...tree(b.id, depth + 1)]);
  const rows = tree(null);
  const orphan = m.branches.filter((b) => !rows.some((r) => r.b.id === b.id)).map((b) => ({ b, depth: 0 }));
  return (
    <div className="grid gap-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Branches</h2>
          <div className="flex gap-2">
            <ImportButton target={target("org.branches")} onImport={(rows, mode) => api(`/api/v1/orgs/${org.id}/org/branches/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["org", org.id] })} />
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Branch</Button>
          </div>
        </div>
        {!m.branches.length ? (
          <EmptyState title="No branches yet" description="Offices, stores, warehouses, plants and regions above them. Link your stock locations, HR work locations, stores and invoicing books to them so their numbers land in the right company." action={<Button size="sm" variant="primary" onClick={() => setEditing("new")}>Add a branch</Button>} />
        ) : (
          <ul className="divide-y divide-border rounded-[16px] border border-border bg-surface shadow-sm">
            {[...rows, ...orphan].map(({ b, depth }) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]" style={{ paddingLeft: 16 + depth * 22 }}>
                <span className="min-w-0 flex-1">
                  <b className="font-medium">{b.code ? `${b.code} · ` : ""}{b.name}</b>
                  <span className="block text-[12px] text-muted">{BRANCH_KIND_LABEL[b.kind]} · {m.companies.find((c) => c.id === b.companyId)?.name}{b.state ? ` · ${b.state}` : ""}{b.gstin ? ` · GSTIN ${b.gstin}` : ""}{!b.active ? " · off" : ""}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {m.links && m.branches.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold">What belongs where</h2>
          <p className="mt-1 mb-3 text-[12.5px] text-muted">Each linked thing takes its branch&apos;s company in the books. Unlinked ones belong to the default company.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {([["warehouses", "Stock locations"], ["locations", "HR work locations"], ["projects", "Stores, venues and project books"], ["books", "Finance books"]] as const).map(([k, label]) => (
              <div key={k} className="rounded-[16px] border border-border bg-surface p-3.5">
                <p className="mb-2 text-[13px] font-semibold">{label}</p>
                {!m.links![k].length ? (
                  <p className="text-[12.5px] text-muted">None yet.</p>
                ) : (
                  <ul className="grid gap-2">
                    {m.links![k].map((x) => (
                      <li key={x.id} className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-2 text-[13px]">
                        <span className="truncate">{x.name}</span>
                        <Select aria-label={`Branch for ${x.name}`} value={x.branchId ?? ""} onChange={(e) => link.mutate({ kind: k === "warehouses" ? "warehouse" : k === "locations" ? "location" : k === "projects" ? "project" : "book", id: x.id, branchId: e.target.value || null })} className="h-8 text-[12.5px]">
                          <option value="">Not linked</option>
                          {m.branches.filter((b) => b.kind !== "region").map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </Select>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {editing && <BranchDialog m={m} b={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BranchDialog({ m, b, onClose }: { m: Meta; b?: Branch; onClose: () => void }) {
  const def = m.companies.find((c) => c.isDefault)!;
  const [f, setF] = useState({ companyId: b?.companyId ?? def.id, parentId: b?.parentId ?? null, code: b?.code ?? "", name: b?.name ?? "", kind: b?.kind ?? "office", state: b?.state ?? "", address: b?.address ?? "", gstin: b?.gstin ?? "", managerId: b?.managerId ?? null, active: b?.active ?? true });
  const [deleting, setDeleting] = useState(false);
  const save = useOrgAction<void>(() => ({ path: b ? `branches/${b.id}` : "branches", method: b ? "PUT" : "POST", body: f }), "Saved", onClose);
  const del = useOrgAction<void>(() => ({ path: `branches/${b!.id}`, method: "DELETE" }), "Deleted", onClose);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <Dialog open onClose={onClose} title={b ? `Edit ${b.name}` : "New branch"} size="lg" footer={<>{b && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="e.g. BLR" />}</Field>
        <Field label="Company">
          {(p) => (
            <Select {...p} value={f.companyId} onChange={(e) => set({ companyId: e.target.value })}>
              {m.companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Type">
          {(p) => (
            <Select {...p} value={f.kind} onChange={(e) => set({ kind: e.target.value as Branch["kind"] })}>
              {BRANCH_KINDS.map((k) => (
                <option key={k} value={k}>{BRANCH_KIND_LABEL[k]}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Under">
          {(p) => (
            <Select {...p} value={f.parentId ?? ""} onChange={(e) => set({ parentId: e.target.value || null })}>
              <option value="">Nothing (top level)</option>
              {m.branches.filter((x) => x.id !== b?.id).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Manager">
          {(p) => (
            <Select {...p} value={f.managerId ?? ""} onChange={(e) => set({ managerId: e.target.value || null })}>
              <option value="">Nobody</option>
              {m.people.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="GSTIN" hint="If it's registered in another state">{(p) => <Input {...p} value={f.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />}</Field>
        <Field label="State">{(p) => <StateSelect id={p.id} value={f.state} onChange={(v) => set({ state: v })} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.address} onChange={(e) => set({ address: e.target.value })} />}</Field>
        <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={f.active} onChange={(v) => set({ active: v })} label="Active" /> Active</label>
      </div>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title={`Delete ${b?.name}?`} description="Only a branch nothing is linked to can be deleted. Otherwise switch it off." confirmLabel="Delete" destructive loading={del.isPending} onConfirm={() => del.mutate()} />
    </Dialog>
  );
}

function Units({ m }: { m: Meta }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Unit | "new" | null>(null);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Cost centres, profit centres and business units</h2>
        <div className="flex gap-2">
          <ImportButton target={target("org.units")} onImport={(rows, mode) => api(`/api/v1/orgs/${org.id}/org/units/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["org", org.id] })} />
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Add</Button>
        </div>
      </div>
      <p className="mb-3 text-[12.5px] text-muted">Charge bill lines, journal lines and people&apos;s pay to them; then filter any report by one.</p>
      {!m.units.length ? (
        <EmptyState title="None yet" description="Marketing, Operations, a product line — whatever you want to see costs and profit for." action={<Button size="sm" variant="primary" onClick={() => setEditing("new")}>Add one</Button>} />
      ) : (
        <div className="grid gap-4">
          {UNIT_KINDS.map((k) => {
            const list = m.units.filter((u) => u.kind === k);
            if (!list.length) return null;
            return (
              <div key={k}>
                <h3 className="mb-1.5 text-[13px] font-semibold text-muted">{UNIT_KIND_LABEL[k]}s</h3>
                <ul className="divide-y divide-border rounded-[16px] border border-border bg-surface shadow-sm">
                  {list.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <span className="w-20 font-mono text-[12px] text-muted">{u.code}</span>
                      <span className="min-w-0 flex-1 font-medium">{u.name}{u.parentId ? <span className="font-normal text-muted"> · under {m.units.find((x) => x.id === u.parentId)?.code}</span> : null}{!u.active && <span className="font-normal text-muted"> · off</span>}</span>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {editing && <UnitDialog m={m} u={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function UnitDialog({ m, u, onClose }: { m: Meta; u?: Unit; onClose: () => void }) {
  const [f, setF] = useState({ kind: u?.kind ?? ("cost_centre" as UnitKind), code: u?.code ?? "", name: u?.name ?? "", parentId: u?.parentId ?? null, companyId: u?.companyId ?? null, managerId: u?.managerId ?? null, active: u?.active ?? true });
  const save = useOrgAction<void>(() => ({ path: u ? `units/${u.id}` : "units", method: u ? "PUT" : "POST", body: f }), "Saved", onClose);
  const del = useOrgAction<void>(() => ({ path: `units/${u!.id}`, method: "DELETE" }), "Deleted", onClose);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <Dialog open onClose={onClose} title={u ? `Edit ${u.code}` : "New cost centre"} footer={<>{u && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.code.trim() || !f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          {(p) => (
            <Select {...p} value={f.kind} onChange={(e) => set({ kind: e.target.value as UnitKind })}>
              {UNIT_KINDS.map((k) => (
                <option key={k} value={k}>{UNIT_KIND_LABEL[k]}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="MKT" />}</Field>
        <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="Under">
          {(p) => (
            <Select {...p} value={f.parentId ?? ""} onChange={(e) => set({ parentId: e.target.value || null })}>
              <option value="">Nothing</option>
              {m.units.filter((x) => x.id !== u?.id).map((x) => (
                <option key={x.id} value={x.id}>{x.code} · {x.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Company">
          {(p) => (
            <Select {...p} value={f.companyId ?? ""} onChange={(e) => set({ companyId: e.target.value || null })}>
              <option value="">Any</option>
              {m.companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={f.active} onChange={(v) => set({ active: v })} label="Active" /> Active</label>
      </div>
    </Dialog>
  );
}

function Currencies({ m }: { m: Meta }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(m.currencies[0]?.code ?? null);
  const [adding, setAdding] = useState("");
  const add = useOrgAction<void>(() => ({ path: "currencies", body: m.common.find((c) => c.code === adding) }), "Currency added", () => (setOpen(adding), setAdding("")));
  const rates = useQuery({ queryKey: ["org", org.id, "rates", open], queryFn: () => api<{ rates: { id: string; date: string; rate: number; source: string }[] }>(`/api/v1/orgs/${org.id}/org/rates?currency=${open}`), enabled: !!open });
  const [rate, setRate] = useState(() => ({ date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), rate: "" }));
  const save = useOrgAction<void>(() => ({ path: "rates", body: { currency: open, date: rate.date, rate: Number(rate.rate) } }), "Rate saved", () => (setRate({ ...rate, rate: "" }), qc.invalidateQueries({ queryKey: ["org", org.id, "rates"] })));
  const del = useOrgAction<string>((id) => ({ path: `rates/${id}`, method: "DELETE" }), "Removed", () => qc.invalidateQueries({ queryKey: ["org", org.id, "rates"] }));
  return (
    <section className="grid gap-5">
      <div>
        <h2 className="text-[15px] font-semibold">Currencies</h2>
        <p className="mt-1 text-[12.5px] text-muted">Rupees are the base. Add the currencies you invoice, buy or get paid in, and keep their rates — the rate on a document&apos;s date is the latest one on or before it. Rates are entered or imported by you; Cloudesk doesn&apos;t fetch them.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add a currency">
          {(p) => (
            <Select {...p} value={adding} onChange={(e) => setAdding(e.target.value)} className="w-56">
              <option value="">Pick one</option>
              {m.common.filter((c) => !m.currencies.some((x) => x.code === c.code)).map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Button size="sm" disabled={!adding} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
        <span className="ml-auto">
          <ImportButton target={target("org.rates")} label="Import rates" onImport={(rows, mode) => api(`/api/v1/orgs/${org.id}/org/rates/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["org", org.id] })} />
        </span>
      </div>
      {!m.currencies.length ? (
        <p className="rounded-[16px] border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted">Only rupees so far.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <ul className="grid content-start gap-1">
            {m.currencies.map((c) => (
              <li key={c.code}>
                <button type="button" onClick={() => setOpen(c.code)} className={cx("flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-left text-[13px]", open === c.code ? "bg-fg text-bg" : "hover:bg-surface-2")}>
                  <span><b>{c.code}</b> {c.name}</span>
                  <span className="text-[12px] tabular-nums opacity-80">{c.latest ? `₹${c.latest.rate}` : "no rate"}</span>
                </button>
              </li>
            ))}
          </ul>
          {open && (
            <div className="rounded-[16px] border border-border bg-surface p-4">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Date">{(p) => <Input {...p} type="date" value={rate.date} onChange={(e) => setRate({ ...rate, date: e.target.value })} />}</Field>
                <Field label={`Rupees per 1 ${open}`}>{(p) => <Input {...p} inputMode="decimal" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} placeholder="83.25" />}</Field>
                <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} disabled={!Number(rate.rate)} loading={save.isPending} onClick={() => save.mutate()}>Save rate</Button>
              </div>
              <table className="mt-4 w-full text-[13px]">
                <tbody className="divide-y divide-border">
                  {rates.data?.rates.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">{new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</td>
                      <td className="py-2 text-right tabular-nums">₹{r.rate}</td>
                      <td className="py-2 text-right text-[12px] text-muted">{r.source}</td>
                      <td className="w-8 py-2 text-right"><button type="button" aria-label="Remove rate" onClick={() => del.mutate(r.id)} className="text-subtle hover:text-danger"><Trash2 className="size-3.5" /></button></td>
                    </tr>
                  ))}
                  {!rates.data?.rates.length && (
                    <tr>
                      <td className="py-4 text-center text-muted" colSpan={4}>No rates yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Groups({ m }: { m: Meta }) {
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Groups</h2>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Group</Button>
      </div>
      <p className="mb-3 text-[12.5px] text-muted">People who share a job, like the finance team. Use a group as an approver in approval rules.</p>
      {!m.groups.length ? (
        <EmptyState title="No groups yet" />
      ) : (
        <ul className="divide-y divide-border rounded-[16px] border border-border bg-surface shadow-sm">
          {m.groups.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1">
                <b className="font-medium">{g.name}</b>
                <span className="block truncate text-[12px] text-muted">{g.members.map((u) => m.people.find((p) => p.id === u)?.name).filter(Boolean).join(", ") || "Nobody yet"}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <GroupDialog m={m} g={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function GroupDialog({ m, g, onClose }: { m: Meta; g?: Group; onClose: () => void }) {
  const [f, setF] = useState({ name: g?.name ?? "", description: g?.description ?? "", members: g?.members ?? [] });
  const save = useOrgAction<void>(() => ({ path: g ? `groups/${g.id}` : "groups", method: g ? "PUT" : "POST", body: f }), "Saved", onClose);
  const del = useOrgAction<void>(() => ({ path: `groups/${g!.id}`, method: "DELETE" }), "Deleted", onClose);
  return (
    <Dialog open onClose={onClose} title={g ? `Edit ${g.name}` : "New group"} footer={<>{g && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="What it's for">{(p) => <Input {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Members</legend>
          <div className="flex flex-wrap gap-1.5">
            {m.people.map((p) => {
              const on = f.members.includes(p.id);
              return (
                <button key={p.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, members: on ? f.members.filter((x) => x !== p.id) : [...f.members, p.id] })} className={cx("h-8 rounded-full px-3 text-[12.5px] font-medium", on ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>
                  {p.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

type Snapshot = { userId: string; name: string; email: string; role: string; customRole: string | null; modules: string[] | null; access: { companies?: string[]; branches?: string[] } | null; mfa: boolean; lastSeen: string | null; groups: string[] };
function AccessTab({ m }: { m: Meta }) {
  const { org } = useSession();
  const q = useQuery({ queryKey: ["org", org.id, "access"], queryFn: () => api<{ members: Snapshot[]; reviews: { id: string; createdAt: string; notes: string; changes: string[]; reviewer: string | null }[] }>(`/api/v1/orgs/${org.id}/org/access`) });
  const [limiting, setLimiting] = useState<Snapshot | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [now] = useState(() => Date.now());
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const nameOf = (id: string) => m.companies.find((c) => c.id === id)?.name ?? m.branches.find((b) => b.id === id)?.name ?? "?";
  const stale = (iso: string | null) => !iso || now - Date.parse(iso) > 90 * 86400_000;
  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Who can see what</h2>
          <p className="mt-1 max-w-xl text-[12.5px] text-muted">Limit someone to some companies or branches: their accounts reports, stock locations and HR people are cut to those. Owners always see everything.</p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setReviewing(true)}>Record a review</Button>
      </div>
      <div className="overflow-x-auto rounded-[16px] border border-border bg-surface shadow-sm">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Limited to</th>
              <th className="py-2 font-medium">Two-step</th>
              <th className="py-2 font-medium">Last seen</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.data.members.map((x) => (
              <tr key={x.userId}>
                <td className="px-4 py-2.5"><b className="font-medium">{x.name}</b><span className="block text-[12px] text-muted">{x.email}{x.groups.length ? ` · ${x.groups.join(", ")}` : ""}</span></td>
                <td className="py-2.5">{x.role}{x.customRole ? <span className="block text-[12px] text-muted">{x.customRole}</span> : null}</td>
                <td className="py-2.5 text-[12.5px]">{x.access && (x.access.companies?.length || x.access.branches?.length) ? [...(x.access.companies ?? []), ...(x.access.branches ?? [])].map(nameOf).join(", ") : <span className="text-muted">Everything</span>}</td>
                <td className="py-2.5">{x.mfa ? <span className="text-success">On</span> : <span className="text-warning">Off</span>}</td>
                <td className={cx("py-2.5 text-[12.5px]", stale(x.lastSeen) ? "text-warning" : "text-muted")}>{x.lastSeen ? new Date(x.lastSeen).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Never"}</td>
                <td className="py-2.5 pr-3 text-right">{x.role !== "owner" && x.userId !== m.me.id && <Button size="sm" variant="ghost" onClick={() => setLimiting(x)}>Limit</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="text-[14px] font-semibold">Past reviews</h3>
        {!q.data.reviews.length ? (
          <p className="mt-1 text-[12.5px] text-muted">None recorded yet. A review keeps a copy of everyone&apos;s access as it was.</p>
        ) : (
          <ul className="mt-2 grid gap-2 text-[13px]">
            {q.data.reviews.map((r) => (
              <li key={r.id} className="rounded-[14px] border border-border p-3">
                <b className="font-medium">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</b> <span className="text-muted">by {r.reviewer ?? "someone"}</span>
                {r.notes && <p className="mt-1">{r.notes}</p>}
                {r.changes.length > 0 && <ul className="mt-1 list-disc pl-5 text-[12.5px] text-muted">{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {limiting && <LimitDialog m={m} x={limiting} onClose={() => setLimiting(null)} />}
      {reviewing && <ReviewDialog onClose={() => setReviewing(false)} />}
    </section>
  );
}

function LimitDialog({ m, x, onClose }: { m: Meta; x: Snapshot; onClose: () => void }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const [companies, setCompanies] = useState<string[]>(x.access?.companies ?? []);
  const [branches, setBranches] = useState<string[]>(x.access?.branches ?? []);
  const save = useOrgAction<void>(() => ({ path: `access/${x.userId}`, method: "PUT", body: { access: companies.length || branches.length ? { companies, branches } : null } }), "Access saved", () => (qc.invalidateQueries({ queryKey: ["org", org.id, "access"] }), onClose()));
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((v) => v !== id) : [...list, id]);
  return (
    <Dialog open onClose={onClose} title={`What ${x.name} can see`} description="Nothing picked means everything." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Companies</legend>
        <div className="flex flex-wrap gap-1.5">
          {m.companies.map((c) => (
            <button key={c.id} type="button" aria-pressed={companies.includes(c.id)} onClick={() => toggle(companies, setCompanies, c.id)} className={cx("h-8 rounded-full px-3 text-[12.5px] font-medium", companies.includes(c.id) ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>{c.name}</button>
          ))}
        </div>
      </fieldset>
      {m.branches.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[13px] font-medium">Branches</legend>
          <div className="flex flex-wrap gap-1.5">
            {m.branches.filter((b) => b.kind !== "region").map((b) => (
              <button key={b.id} type="button" aria-pressed={branches.includes(b.id)} onClick={() => toggle(branches, setBranches, b.id)} className={cx("h-8 rounded-full px-3 text-[12.5px] font-medium", branches.includes(b.id) ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>{b.name}</button>
            ))}
          </div>
        </fieldset>
      )}
    </Dialog>
  );
}

function ReviewDialog({ onClose }: { onClose: () => void }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [changes, setChanges] = useState("");
  const save = useOrgAction<void>(() => ({ path: "reviews", body: { notes, changes: changes.split("\n").map((c) => c.trim()).filter(Boolean) } }), "Review recorded", () => (qc.invalidateQueries({ queryKey: ["org", org.id, "access"] }), onClose()));
  return (
    <Dialog open onClose={onClose} title="Record an access review" description="Saves who had what access right now, with your notes, so you can show it later." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Record</Button></>}>
      <div className="grid gap-3">
        <Field label="Notes">{(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Quarterly review — everyone checked" />}</Field>
        <Field label="What you changed" hint="One per line">{(p) => <Textarea {...p} rows={3} value={changes} onChange={(e) => setChanges(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
