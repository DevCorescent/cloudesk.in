"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Input, Select, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { DOC_LABEL, DOC_TYPES, type InvoiceSettings } from "@/lib/invoicing/model";
import { GST_STATES, validateGstin } from "@/lib/store/gst";
import { CURRENCIES } from "@/lib/store/money";
import { Panel, SubHeader } from "../store/shared";
import { invApi, useInv } from "./shared";

const STATES = Object.values(GST_STATES).sort();

function preview(s: InvoiceSettings["numbering"]["invoice"], today: string) {
  const y = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const n = String(s.next).padStart(s.pad, "0");
  return s.yearly ? [s.prefix, `${y}-${String((y + 1) % 100).padStart(2, "0")}`, n].filter(Boolean).join("/") : s.prefix ? `${s.prefix}-${n}` : n;
}

export function InvoicingSettings() {
  const { projectId, apiBase, boot } = useInv();
  const qc = useQueryClient();
  const toast = useToast();
  const { saved: _saved, ...initial } = boot.settings;
  void _saved;
  const [s, setS] = useState<InvoiceSettings>(initial);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const b = s.business;
  const setB = (patch: Partial<InvoiceSettings["business"]>) => setS({ ...s, business: { ...b, ...patch } });
  const setP = (patch: Partial<InvoiceSettings["payment"]>) => setS({ ...s, payment: { ...s.payment, ...patch } });
  const gst = b.gstin ? validateGstin(b.gstin) : null;
  const save = useMutation({
    mutationFn: () => api(invApi(apiBase, "settings"), { method: "PUT", body: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
      toast({ tone: "success", title: "Settings saved" });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) }),
  });
  const logo = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch(invApi(apiBase, "upload"), { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? "Upload failed");
      return j.asset.url as string;
    },
    onSuccess: (url) => setB({ logo: url }),
    onError: (e) => toast({ tone: "error", title: "Couldn't upload the logo", description: errorMessage(e) }),
  });
  return (
    <div className="pb-24">
      <SubHeader title="Settings" description="Printed on every invoice and quotation. Changes apply to documents you create or edit from now on." />
      <div className="grid gap-4">
        {boot.scope.kind === "book" && <BookPanel />}
        <Panel title="Your business">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 sm:col-span-2">
              {b.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- uploaded logo
                <img src={b.logo} alt="Logo" className="h-14 max-w-40 rounded-lg border border-border bg-white object-contain p-1.5" />
              ) : (
                <span className="grid h-14 w-28 place-items-center rounded-lg border border-dashed border-border text-[11px] text-muted">No logo</span>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2">
                {logo.isPending ? <Loader2 className="size-3.5 lx-spin" /> : <ImagePlus className="size-3.5" />} {b.logo ? "Replace logo" : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
              </label>
              {b.logo && <button type="button" onClick={() => setB({ logo: "" })} className="text-[12px] text-muted hover:text-danger">Remove</button>}
            </div>
            <L label="Business name"><Input value={b.name} onChange={(e) => setB({ name: e.target.value })} /></L>
            <L label="Legal name (if different)"><Input value={b.legalName} onChange={(e) => setB({ legalName: e.target.value })} /></L>
            <L label="Email"><Input type="email" value={b.email} onChange={(e) => setB({ email: e.target.value.trim() })} /></L>
            <L label="Phone"><Input value={b.phone} onChange={(e) => setB({ phone: e.target.value })} /></L>
            <L label="Website"><Input value={b.website} onChange={(e) => setB({ website: e.target.value })} /></L>
            <L label="GSTIN" hint={gst ? (gst.ok ? `Valid · ${gst.state}` : gst.reason) : undefined}>
              <Input value={b.gstin} onChange={(e) => { const g = e.target.value.toUpperCase().slice(0, 15); const v = validateGstin(g); setS({ ...s, business: { ...b, gstin: g, address: v.ok && !b.address.state ? { ...b.address, state: v.state } : b.address } }); }} className="font-mono" aria-invalid={!!gst && !gst.ok} />
            </L>
            <L label="PAN"><Input value={b.pan} onChange={(e) => setB({ pan: e.target.value.toUpperCase().slice(0, 10) })} className="font-mono" /></L>
            <L label="State" hint="Decides CGST + SGST vs IGST on GST invoices">
              <Select value={b.address.state} onChange={(e) => setB({ address: { ...b.address, state: e.target.value } })}>
                <option value="">—</option>
                {STATES.map((x) => <option key={x} value={x}>{x}</option>)}
                {b.address.state && !STATES.includes(b.address.state) && <option value={b.address.state}>{b.address.state}</option>}
              </Select>
            </L>
            <L label="Address" className="sm:col-span-2">
              <Input value={b.address.line1} onChange={(e) => setB({ address: { ...b.address, line1: e.target.value } })} placeholder="Street, building" />
              <div className="grid grid-cols-3 gap-2">
                <Input value={b.address.line2} onChange={(e) => setB({ address: { ...b.address, line2: e.target.value } })} placeholder="Area" aria-label="Area" />
                <Input value={b.address.city} onChange={(e) => setB({ address: { ...b.address, city: e.target.value } })} placeholder="City" aria-label="City" />
                <Input value={b.address.postalCode} onChange={(e) => setB({ address: { ...b.address, postalCode: e.target.value } })} placeholder="PIN / ZIP" aria-label="Postal code" />
              </div>
            </L>
          </div>
        </Panel>

        <Panel title="Tax & currency">
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <L label="Default currency">
              <Select value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
              </Select>
            </L>
            <L label="Tax">
              <Select value={s.taxMode} onChange={(e) => setS({ ...s, taxMode: e.target.value as InvoiceSettings["taxMode"] })}>
                <option value="gst">GST (India)</option>
                <option value="simple">VAT / sales tax</option>
                <option value="none">Not registered — no tax</option>
              </Select>
            </L>
            {s.taxMode === "simple" && <L label="Tax name"><Input value={s.taxLabel} onChange={(e) => setS({ ...s, taxLabel: e.target.value })} placeholder="VAT" /></L>}
            {s.taxMode !== "none" && (
              <L label="Default rate %">
                <Input inputMode="decimal" value={String(s.defaultTaxBps / 100)} onChange={(e) => setS({ ...s, defaultTaxBps: Math.round(Math.min(100, Number(e.target.value) || 0) * 100) })} />
              </L>
            )}
            {s.taxMode !== "none" && (
              <label className="flex items-center gap-2 pt-5 text-[13px]">
                <Switch checked={s.inclusive} onChange={(v) => setS({ ...s, inclusive: v })} label="Prices include tax" /> Prices include tax
              </label>
            )}
          </div>
        </Panel>

        <Panel title="Numbering" description="Numbers are assigned when a document is issued, never reused, and restart each financial year (April) if you choose.">
          <div className="grid gap-3 p-4">
            {DOC_TYPES.map((t) => {
              const n = s.numbering[t];
              const setN = (patch: Partial<typeof n>) => setS({ ...s, numbering: { ...s.numbering, [t]: { ...n, ...patch } } });
              return (
                <div key={t} className="grid items-end gap-2 sm:grid-cols-[130px_100px_90px_80px_auto_1fr]">
                  <p className="pb-2 text-[13px] font-medium">{DOC_LABEL[t]}</p>
                  <L label="Prefix"><Input value={n.prefix} onChange={(e) => setN({ prefix: e.target.value.replace(/[^\w\-/.#]/g, "").slice(0, 20) })} /></L>
                  <L label="Next no."><Input inputMode="numeric" value={String(n.next)} onChange={(e) => setN({ next: Math.max(1, Math.min(999_999_999, Number(e.target.value.replace(/\D/g, "")) || 1)) })} /></L>
                  <L label="Digits"><Input inputMode="numeric" value={String(n.pad)} onChange={(e) => setN({ pad: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} /></L>
                  <label className="flex items-center gap-2 pb-2 text-[12px]"><Switch checked={n.yearly} onChange={(v) => setN({ yearly: v })} label="Include the financial year" /> FY</label>
                  <p className="pb-2 font-mono text-[13px] text-muted">Next: {preview(n, boot.today)}</p>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Defaults for new documents">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <L label="Payment due after (days)"><Input inputMode="numeric" value={String(s.dueDays)} onChange={(e) => setS({ ...s, dueDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} /></L>
            <L label="Quotations valid for (days)"><Input inputMode="numeric" value={String(s.quoteValidDays)} onChange={(e) => setS({ ...s, quoteValidDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} /></L>
            <L label="Notes"><Textarea rows={3} value={s.notes} onChange={(e) => setS({ ...s, notes: e.target.value })} placeholder="Thank you for your business!" /></L>
            <L label="Terms & conditions"><Textarea rows={3} value={s.terms} onChange={(e) => setS({ ...s, terms: e.target.value })} /></L>
          </div>
        </Panel>

        <Panel title="How clients pay you" description="Printed on invoices. With a UPI ID, invoices in rupees show a scan-to-pay QR code for the exact amount due.">
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <L label="UPI ID"><Input value={s.payment.upiId} onChange={(e) => setP({ upiId: e.target.value.trim() })} placeholder="yourname@okhdfcbank" /></L>
            <L label="Account name"><Input value={s.payment.accountName} onChange={(e) => setP({ accountName: e.target.value })} /></L>
            <L label="Bank"><Input value={s.payment.bankName} onChange={(e) => setP({ bankName: e.target.value })} /></L>
            <L label="Account number"><Input value={s.payment.accountNumber} onChange={(e) => setP({ accountNumber: e.target.value.replace(/\s/g, "") })} className="font-mono" /></L>
            <L label="IFSC"><Input value={s.payment.ifsc} onChange={(e) => setP({ ifsc: e.target.value.toUpperCase() })} className="font-mono" /></L>
            <L label="Branch"><Input value={s.payment.branch} onChange={(e) => setP({ branch: e.target.value })} /></L>
            <L label="SWIFT (international)"><Input value={s.payment.swift} onChange={(e) => setP({ swift: e.target.value.toUpperCase() })} className="font-mono" /></L>
            <L label="Other instructions" className="sm:col-span-2"><Input value={s.payment.instructions} onChange={(e) => setP({ instructions: e.target.value })} placeholder="Cheques payable to …" /></L>
          </div>
        </Panel>

        <Panel title="Payment reminders" description="Emails the client a friendly reminder with the link — once per day at most, only while something is still due.">
          <div className="grid gap-3 p-4">
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={s.reminders.enabled} onChange={(v) => setS({ ...s, reminders: { ...s.reminders, enabled: v } })} label="Send reminders automatically" /> Send reminders automatically</label>
            {s.reminders.enabled && (
              <div className="grid gap-3 sm:grid-cols-2">
                <L label="Days before the due date"><Input inputMode="numeric" value={String(s.reminders.beforeDays)} onChange={(e) => setS({ ...s, reminders: { ...s.reminders, beforeDays: Math.max(0, Math.min(30, Number(e.target.value) || 0)) } })} /></L>
                <L label="Days after it's overdue (comma-separated)">
                  <Input value={s.reminders.afterDays.join(", ")} onChange={(e) => setS({ ...s, reminders: { ...s.reminders, afterDays: [...new Set(e.target.value.split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 120))].slice(0, 5) } })} placeholder="3, 10" />
                </L>
              </div>
            )}
            {!boot.mailConfigured && <p className="text-[12px] text-warning">Email delivery isn&apos;t set up on this server yet — reminders are recorded but not delivered until it is.</p>}
          </div>
        </Panel>
      </div>
      {dirty && (
        <div className="glass-strong fixed inset-x-4 bottom-[calc(var(--dock)+16px)] z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-full px-5 py-2.5 shadow-lg">
          <span className="text-[13px] font-medium">{gst && !gst.ok ? <span className="text-danger">Fix the GSTIN first: {gst.reason}</span> : "Unsaved changes"}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setS(initial)}>Discard</Button>
            <Button size="sm" variant="primary" loading={save.isPending} disabled={!!gst && !gst.ok} onClick={() => save.mutate()}>Save</Button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Standalone books: rename, or delete with everything in them. */
function BookPanel() {
  const { apiBase, boot } = useInv();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(boot.scope.name);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState("");
  const rename = useMutation({
    mutationFn: () => api(invApi(apiBase, "book"), { method: "PUT", body: { name } }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast({ tone: "success", title: "Renamed" });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't rename", description: errorMessage(e) }),
  });
  const del = useMutation({
    mutationFn: () => api(invApi(apiBase, "book"), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries();
      router.push("/finance?all=1");
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't delete", description: errorMessage(e) }),
  });
  return (
    <Panel title="These books" description="A separate set of books for one business, outside any website or store.">
      <div className="flex flex-wrap items-end gap-3 p-4">
        <L label="Name" className="min-w-64 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} /></L>
        <Button loading={rename.isPending} disabled={!name.trim() || name === boot.scope.name} onClick={() => rename.mutate()}>Rename</Button>
        {boot.scope.canDelete && <Button variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>Delete books…</Button>}
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title={`Delete ${boot.scope.name}?`}
        description="Every invoice, quotation, client, payment and template in these books is permanently deleted, and shared links stop working. This can't be undone — export your CSVs from Reports first."
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={del.isPending} disabled={typed.trim() !== boot.scope.name} onClick={() => del.mutate()}>Delete permanently</Button></>}
      >
        <L label={`Type “${boot.scope.name}” to confirm`}><Input value={typed} onChange={(e) => setTyped(e.target.value)} /></L>
      </Dialog>
    </Panel>
  );
}

function L({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid content-start gap-1 ${className ?? ""}`}>
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}
