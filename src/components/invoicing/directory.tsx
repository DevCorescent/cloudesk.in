"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/shell/session-context";
import { visibleTo } from "@/lib/workspace/modules";
import { BookUser, Package, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ConfirmDialog, Dialog, useToast } from "@/components/ui/overlays";
import { Button, EmptyState, ErrorState, Input, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { emptyAddress, type Party } from "@/lib/invoicing/model";
import { GST_STATES, validateGstin } from "@/lib/store/gst";
import { MoneyInput, SubHeader } from "../store/shared";
import { invApi, money, useInv, useInvQuery, type Client, type Item } from "./shared";

const STATES = Object.values(GST_STATES).sort();
type ClientForm = Party & { notes: string };
const blankClient = (): ClientForm => ({ name: "", company: "", email: "", phone: "", gstin: "", billing: emptyAddress(), shipping: null, notes: "" });

export function ClientsView() {
  const { apiBase, base, boot, projectId } = useInv();
  const qc = useQueryClient();
  const q = useInvQuery<{ clients: Client[] }>("clients");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<{ id: string | null; form: ClientForm } | null>(null);
  const rows = (q.data?.clients ?? []).filter((c) => !search.trim() || `${c.name} ${c.company} ${c.email} ${c.gstin}`.toLowerCase().includes(search.toLowerCase()));
  const cur = boot.settings.currency;
  return (
    <div>
      <SubHeader
        title="Clients"
        description="Everyone you bill, with what they owe. Saved clients fill in invoices for you."
        actions={
          <>
            <ImportButton target={target("invoicing.clients")} onImport={(r, mode) => api(invApi(apiBase, "clients/import"), { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["invoicing", projectId] })} />
            <ExportMenu name="clients" rows={q.data?.clients} columns={[{ key: "name", label: "Name" }, { key: "company", label: "Company" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "gstin", label: "GSTIN" }, { key: "billing", label: "Address", format: (v) => (v as { line1?: string })?.line1 ?? "" }, { key: "billing", label: "City", format: (v) => (v as { city?: string })?.city ?? "" }, { key: "billing", label: "State", format: (v) => (v as { state?: string })?.state ?? "" }, { key: "billing", label: "PIN code", format: (v) => (v as { postalCode?: string })?.postalCode ?? "" }, { key: "invoiced", label: "Invoiced", money: true }, { key: "balance", label: "Owes", money: true }]} />
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ id: null, form: blankClient() })}>New client</Button>
          </>
        }
      />
      <div className="relative mb-3 w-full sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients" className="!h-8 pl-8 text-[13px]" aria-label="Search clients" />
      </div>
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-64" />
      ) : !q.data.clients.length ? (
        <EmptyState icon={<BookUser className="size-5" />} title="No clients yet" description="Add them here, or tick “Save to my clients” when you write an invoice." action={<Button variant="primary" onClick={() => setEdit({ id: null, form: blankClient() })}>Add a client</Button>} className="py-16" />
      ) : (
        <div className="glass-card overflow-x-auto rounded-[var(--radius-xl)]">
          <table className="w-full min-w-[680px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted">
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 font-medium">GSTIN</th>
                <th className="px-4 py-2.5 text-right font-medium">Invoiced</th>
                <th className="px-4 py-2.5 text-right font-medium">Owes you</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setEdit({ id: c.id, form: { name: c.name, company: c.company, email: c.email, phone: c.phone, gstin: c.gstin, billing: c.billing, shipping: c.shipping, notes: c.notes } })}>{c.company || c.name}</button>
                    {c.company && <span className="block text-[12px] text-muted">{c.name}</span>}
                  </td>
                  <td className="px-4 py-3 text-muted">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3 font-mono text-[12px]">{c.gstin || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(c.invoiced, cur)}<span className="block text-[11px] text-muted">{c.invoices} invoice{c.invoices === 1 ? "" : "s"}</span></td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{c.balance ? money(c.balance, cur) : "—"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link className="text-[12px] text-accent hover:underline" href={`${base}/invoices/new?client=${c.id}`}>Invoice</Link>
                    <span className="mx-1.5 text-subtle">·</span>
                    <Link className="text-[12px] text-accent hover:underline" href={`${base}/quotes/new?client=${c.id}`}>Quote</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ClientDialog id={edit.id} initial={edit.form} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ClientDialog({ id, initial, onClose }: { id: string | null; initial: ClientForm; onClose: () => void }) {
  const { projectId, apiBase } = useInv();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [archive, setArchive] = useState(false);
  const gst = f.gstin ? validateGstin(f.gstin) : null;
  const done = () => {
    qc.invalidateQueries({ queryKey: ["invoicing", projectId, "clients"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => api(invApi(apiBase, id ? `clients/${id}` : "clients"), { method: id ? "PUT" : "POST", body: f }),
    onSuccess: () => {
      toast({ tone: "success", title: id ? "Client updated" : "Client added" });
      done();
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) }),
  });
  const del = useMutation({ mutationFn: () => api(invApi(apiBase, `clients/${id}`), { method: "DELETE" }), onSuccess: done });
  const addr = (patch: Partial<Party["billing"]>) => setF({ ...f, billing: { ...f.billing, ...patch } });
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={id ? `Edit ${initial.company || initial.name}` : "New client"}
      footer={
        <>
          {id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => setArchive(true)}>Remove</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || (!!gst && !gst.ok)} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Contact name *"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></F>
        <F label="Company"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></F>
        <F label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value.trim() })} /></F>
        <F label="Phone / WhatsApp"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></F>
        <F label="GSTIN" hint={gst ? (gst.ok ? `Valid · ${gst.state}` : gst.reason) : "Optional, for B2B invoices"}>
          <Input value={f.gstin} onChange={(e) => { const g = e.target.value.toUpperCase().slice(0, 15); const v = validateGstin(g); setF({ ...f, gstin: g, billing: v.ok && !f.billing.state ? { ...f.billing, state: v.state } : f.billing }); }} className="font-mono text-[13px]" aria-invalid={!!gst && !gst.ok} />
        </F>
        <F label="State">
          <Select value={f.billing.state} onChange={(e) => addr({ state: e.target.value })}>
            <option value="">—</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            {f.billing.state && !STATES.includes(f.billing.state) && <option value={f.billing.state}>{f.billing.state}</option>}
          </Select>
        </F>
        <F label="Address" className="sm:col-span-2">
          <Input value={f.billing.line1} onChange={(e) => addr({ line1: e.target.value })} placeholder="Street, building" />
          <div className="grid grid-cols-3 gap-2">
            <Input value={f.billing.line2} onChange={(e) => addr({ line2: e.target.value })} placeholder="Area" aria-label="Area" />
            <Input value={f.billing.city} onChange={(e) => addr({ city: e.target.value })} placeholder="City" aria-label="City" />
            <Input value={f.billing.postalCode} onChange={(e) => addr({ postalCode: e.target.value })} placeholder="PIN / ZIP" aria-label="Postal code" />
          </div>
        </F>
        <F label="Private notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Payment habits, contacts… (never printed)" /></F>
      </div>
      <ConfirmDialog open={archive} onClose={() => setArchive(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title="Remove this client?" description="They disappear from your client list. Their past invoices stay exactly as they were." confirmLabel="Remove" />
    </Dialog>
  );
}

function F({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`grid content-start gap-1 ${className ?? ""}`}>
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}

const TAXES = [0, 25, 300, 500, 1200, 1800, 2800];

export function ItemsView() {
  const { boot, apiBase, projectId } = useInv();
  const qc = useQueryClient();
  const q = useInvQuery<{ items: Item[] }>("items");
  const [edit, setEdit] = useState<{ id: string | null; form: Omit<Item, "id"> } | null>(null);
  const blank = (): Omit<Item, "id"> => ({ name: "", description: "", hsn: "", unit: "", rate: 0, taxBps: boot.settings.taxMode === "none" ? 0 : boot.settings.defaultTaxBps });
  const cur = boot.settings.currency;
  return (
    <div>
      <SubHeader
        title="Items & services"
        description="Things you bill for often. Type a name on any invoice line to pick one."
        actions={
          <>
            <ImportButton target={target("invoicing.items")} onImport={(r, mode) => api(invApi(apiBase, "items/import"), { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["invoicing", projectId] })} />
            <ExportMenu name="items-and-services" rows={q.data?.items} columns={[{ key: "name", label: "Name" }, { key: "description", label: "Description" }, { key: "hsn", label: "HSN/SAC" }, { key: "unit", label: "Unit" }, { key: "rate", label: "Rate", money: true }, { key: "taxBps", label: "GST %", format: (v) => Number(v) / 100 }]} />
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ id: null, form: blank() })}>New item</Button>
          </>
        }
      />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-64" />
      ) : !q.data.items.length ? (
        <EmptyState icon={<Package className="size-5" />} title="No saved items yet" description="Add your services and products with their rate, HSN/SAC and tax — or save a line from any invoice." action={<Button variant="primary" onClick={() => setEdit({ id: null, form: blank() })}>Add an item</Button>} className="py-16" />
      ) : (
        <div className="glass-card overflow-x-auto rounded-[var(--radius-xl)]">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium">HSN/SAC</th>
                <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                <th className="px-4 py-2.5 text-right font-medium">Tax</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((i) => (
                <tr key={i.id} onClick={() => setEdit({ id: i.id, form: { name: i.name, description: i.description, hsn: i.hsn, unit: i.unit, rate: i.rate, taxBps: i.taxBps, invItemId: i.invItemId ?? null } })} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3"><span className="font-medium">{i.name}</span>{i.description && <span className="block truncate text-[12px] text-muted">{i.description}</span>}</td>
                  <td className="px-4 py-3 font-mono text-[12px]">{i.hsn || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(i.rate, cur)}{i.unit && <span className="text-muted"> / {i.unit}</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{i.taxBps / 100}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ItemDialog id={edit.id} initial={edit.form} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ItemDialog({ id, initial, onClose }: { id: string | null; initial: Omit<Item, "id">; onClose: () => void }) {
  const { projectId, apiBase, boot } = useInv();
  const { org } = useSession();
  // With Inventory on, an item can take its stock from an inventory item when invoiced.
  const stock = useQuery({ queryKey: ["inv", org.id, "items"], queryFn: () => api<{ items: { id: string; name: string; sku: string; onHand: number; unit: string }[] }>(`/api/v1/orgs/${org.id}/inventory/items`), enabled: visibleTo(org, "inventory"), retry: false });
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["invoicing", projectId, "items"] });
    onClose();
  };
  const save = useMutation({ mutationFn: () => api(invApi(apiBase, id ? `items/${id}` : "items"), { method: id ? "PUT" : "POST", body: f }), onSuccess: done, onError: (e) => toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) }) });
  const del = useMutation({ mutationFn: () => api(invApi(apiBase, `items/${id}`), { method: "DELETE" }), onSuccess: done });
  const badHsn = !!f.hsn && ![4, 6, 8].includes(f.hsn.length);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={id ? "Edit item" : "New item"}
      footer={
        <>
          {id && <Button variant="ghost" className="mr-auto text-danger" loading={del.isPending} onClick={() => del.mutate()}>Remove</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || badHsn} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <F label="Name *"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Website maintenance" /></F>
        <F label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></F>
        <div className="grid grid-cols-2 gap-3">
          <F label="Rate"><MoneyInput value={f.rate} onChange={(v) => setF({ ...f, rate: v ?? 0 })} currency={boot.settings.currency} /></F>
          <F label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="hour, pcs, month" /></F>
          <F label="HSN/SAC" hint={badHsn ? "4, 6 or 8 digits" : undefined}><Input value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value.replace(/\D/g, "").slice(0, 8) })} className="font-mono" aria-invalid={badHsn} /></F>
          <F label="Tax">
            <Select value={String(f.taxBps)} onChange={(e) => setF({ ...f, taxBps: Number(e.target.value) })}>
              {[...new Set([...TAXES, f.taxBps])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r / 100}%</option>)}
            </Select>
          </F>
        </div>
        {stock.data && (
          <F label="Takes stock from" hint="Issuing an invoice takes this out of Inventory; a credit note or void puts it back.">
            <Select aria-label="Takes stock from" value={f.invItemId ?? ""} onChange={(e) => setF({ ...f, invItemId: e.target.value || null })}>
              <option value="">Nothing — a service or untracked item</option>
              {stock.data.items.map((s) => <option key={s.id} value={s.id}>{s.name}{s.sku ? ` (${s.sku})` : ""} — {s.onHand} {s.unit} on hand</option>)}
            </Select>
          </F>
        )}
      </div>
    </Dialog>
  );
}
