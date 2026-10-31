"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Copy, ExternalLink, Plus, RefreshCw, Trash2, Truck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmDialog, Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, IconButton, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { convertMinor, ROUNDING_LABELS } from "@/lib/store/fx";
import { CURRENCIES, formatMoney, minorDigits } from "@/lib/store/money";
import { COUNTRIES, INDIAN_STATES } from "@/lib/store/shipping";
import { LabelProvidersPanel, ShiprocketPanel } from "./operations";
import { MoneyInput, Panel, pct, storeApi, SubHeader, Table, td, useMoney, useStoreCtx, useStoreQuery, type Store } from "./shared";

function useSave<T>(path: string, method: "PUT" | "POST", success: string, after?: (r: T) => void) {
  const { projectId } = useStoreCtx();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: unknown) => api<T>(storeApi(projectId, path), { method, body }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: "success", title: success });
      after?.(r);
    },
    onError: (e) => toast({ tone: "error", title: "Could not save", description: errorMessage(e) }),
  });
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset?: () => void }) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-4 z-20 mt-4 flex items-center justify-between gap-3 glass-strong rounded-full px-5 py-2.5">
      <span className="text-[13px] text-muted">You have unsaved changes</span>
      <div className="flex gap-2">
        {onReset && <Button onClick={onReset}>Discard</Button>}
        <Button variant="primary" loading={saving} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ─── Payments ────────────────────────────────────────────────────────────────

type Provider = {
  id: string;
  name: string;
  description: string;
  methods: string[];
  regions: string;
  online: boolean;
  fields: { key: string; label: string; secret: boolean; placeholder?: string; help?: string }[];
  docsUrl?: string;
  refunds: "api" | "manual";
  enabled: boolean;
  mode: string;
  status: string;
  lastError: string | null;
  settings: { fee?: number; maxOrder?: number; label?: string; upiId?: string; instructions?: string };
  credentialHints: Record<string, string>;
  webhookUrl: string | null;
};

export function PaymentsView() {
  const { can } = useStoreCtx();
  const q = useStoreQuery<{ providers: Provider[] }>("payments");
  const editable = can("secrets:manage");
  return (
    <div>
      <SubHeader title="Payments" description="Choose how customers pay. Online payments happen on the provider's secure page — card details never touch your store." />
      {!editable && (
        <div className="mb-4">
          <Notice tone="neutral" title="View only">Only project owners and admins can connect payment providers, because it involves secret keys.</Notice>
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Online payments</p>
          {q.data.providers.filter((p) => p.online).map((p) => <ProviderCard key={p.id} p={p} editable={editable} />)}
          <p className="pt-3 text-xs font-medium tracking-wide text-subtle uppercase">Offline payments</p>
          {q.data.providers.filter((p) => !p.online).map((p) => <ProviderCard key={p.id} p={p} editable={editable} />)}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ p, editable }: { p: Provider; editable: boolean }) {
  const { store, projectId } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState(p.settings);
  const [mode, setMode] = useState<"test" | "live">(p.mode === "live" ? "live" : "test");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = useMutation({
    mutationFn: (body: { enabled: boolean; credentials?: Record<string, string>; settings?: Provider["settings"]; mode?: string }) => api(storeApi(projectId, `payments/${p.id}`), { method: "PUT", body }),
    onSuccess: (_r, body) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      setCreds({});
      setErrors({});
      toast({ tone: "success", title: body.credentials ? `${p.name} connected` : body.enabled ? `${p.name} turned on` : `${p.name} turned off` });
      if (body.credentials) setOpen(false);
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      toast({ tone: "error", title: `Could not update ${p.name}`, description: errorMessage(e) });
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; error?: string }>(storeApi(projectId, `payments/${p.id}/test`), { method: "POST", body: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast(r.ok ? { tone: "success", title: "Connection works" } : { tone: "error", title: "Connection failed", description: r.error });
    },
    onError: (e) => toast({ tone: "error", title: "Could not test", description: errorMessage(e) }),
  });
  const connected = p.status === "connected";
  const statusBadge = !p.online ? null : connected ? <Badge tone="success">Connected{p.mode === "test" ? " · test mode" : ""}</Badge> : p.status === "error" ? <Badge tone="danger">Connection error</Badge> : <Badge>Not connected</Badge>;
  const paypalCurrencyWarning = p.id === "paypal" && store.currency === "INR";
  const razorpayCurrencyWarning = p.id === "razorpay" && store.currency !== "INR";

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{p.name}</h3>
            {statusBadge}
            {p.enabled && <Badge tone="accent">Shown at checkout</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">{p.description}</p>
          <p className="mt-1.5 flex flex-wrap gap-1">
            {p.methods.map((m) => (
              <span key={m} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                {m}
              </span>
            ))}
            <span className="px-1 text-[11px] text-subtle">{p.regions}</span>
          </p>
          {p.lastError && <p className="mt-2 text-xs text-danger">{p.lastError}</p>}
        </div>
        <div className="flex items-center gap-2">
          {p.online && editable && (
            <Button size="sm" onClick={() => setOpen(!open)}>
              {connected ? "Settings" : "Connect"}
            </Button>
          )}
          {!p.online && editable && (
            <Button size="sm" onClick={() => setOpen(!open)}>
              Settings
            </Button>
          )}
          <Switch
            checked={p.enabled}
            disabled={!editable || save.isPending || (p.online && !connected)}
            onChange={(v) => {
              if (p.id === "manual" && v && !p.settings.upiId && !p.settings.instructions) {
                setOpen(true);
                toast({ tone: "info", title: "Add your UPI ID or bank details first" });
                return;
              }
              save.mutate({ enabled: v });
            }}
            label={`Offer ${p.name} at checkout`}
          />
        </div>
      </div>
      {connected && editable && ["stripe", "razorpay", "paypal"].includes(p.id) && <LiveTestPanel p={p} />}
      {(paypalCurrencyWarning || razorpayCurrencyWarning) && (
        <div className="px-4 pb-3">
          <Notice tone="warning">{paypalCurrencyWarning ? "PayPal accepts INR only for India-registered PayPal business accounts. It is hidden at checkout if PayPal rejects the currency." : "Razorpay is designed for INR. Payments in other currencies need international payments enabled on your Razorpay account."}</Notice>
        </div>
      )}
      {open && editable && (
        <form
          className="space-y-4 border-t border-border bg-surface-2/40 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (p.online) save.mutate({ enabled: p.enabled, credentials: creds, mode: p.id === "paypal" ? mode : undefined });
            else save.mutate({ enabled: p.id === "manual" ? !!(settings.upiId || settings.instructions) && p.enabled : p.enabled, settings });
          }}
        >
          {p.online && (
            <>
              {p.fields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.help ?? (p.credentialHints[f.key] ? `Saved: ${p.credentialHints[f.key]}${f.secret ? " — leave blank to keep it" : ""}` : undefined)} error={errors[f.key]?.[0]}>
                  {(a) => (
                    <Input
                      {...a}
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      className="font-mono text-xs"
                      placeholder={p.credentialHints[f.key] && f.secret ? "••••••••" : f.placeholder}
                      value={creds[f.key] ?? (f.secret ? "" : (p.credentialHints[f.key] ?? ""))}
                      onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
              {p.id === "paypal" && <Segmented label="Environment" value={mode} onChange={setMode} options={[{ value: "test", label: "Sandbox" }, { value: "live", label: "Live" }]} />}
              {p.webhookUrl && (
                <div>
                  <p className="text-[13px] font-medium">Webhook URL</p>
                  <p className="mt-0.5 text-xs text-muted">Optional but recommended: payments are confirmed even if the customer closes the tab before returning.</p>
                  <div className="mt-1.5 flex gap-2">
                    <Input readOnly value={p.webhookUrl} className="font-mono text-xs" aria-label="Webhook URL" onFocus={(e) => e.target.select()} />
                    <IconButton label="Copy webhook URL" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(p.webhookUrl!).then(() => toast({ tone: "success", title: "Copied" }))} />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted">Keys are checked with {p.name} before saving and stored encrypted. Test keys create test payments only; switch to live keys when you are ready to sell.</p>
              <div className="flex flex-wrap justify-between gap-2">
                <div className="flex gap-2">
                  {p.docsUrl && (
                    <a href={p.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                      Where do I find these? <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  {connected && (
                    <Button icon={<RefreshCw className="size-3.5" />} loading={test.isPending} onClick={() => test.mutate()}>
                      Test connection
                    </Button>
                  )}
                  <Button type="submit" variant="primary" loading={save.isPending} disabled={!Object.values(creds).some((v) => v.trim())}>
                    Save &amp; verify
                  </Button>
                </div>
              </div>
            </>
          )}
          {p.id === "cod" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Extra fee for cash on delivery" hint="Optional handling fee added at checkout.">
                {(a) => <MoneyInput {...a} value={settings.fee ?? 0} onChange={(v) => setSettings({ ...settings, fee: v ?? 0 })} currency={store.currency} />}
              </Field>
              <Field label="Maximum order value" hint="Hide COD above this total. Blank for no limit.">
                {(a) => <MoneyInput {...a} value={settings.maxOrder ?? null} onChange={(v) => setSettings({ ...settings, maxOrder: v ?? undefined })} currency={store.currency} />}
              </Field>
            </div>
          )}
          {p.id === "manual" && (
            <>
              <Field label="UPI ID" hint="Customers see a “Pay with UPI app” button with the exact amount.">
                {(a) => <Input {...a} value={settings.upiId ?? ""} onChange={(e) => setSettings({ ...settings, upiId: e.target.value.trim() })} placeholder="yourname@okbank" className="font-mono text-xs" maxLength={80} />}
              </Field>
              <Field label="Bank details or instructions" hint="Shown on the order page after checkout.">
                {(a) => <Textarea {...a} rows={3} value={settings.instructions ?? ""} onChange={(e) => setSettings({ ...settings, instructions: e.target.value })} maxLength={1000} placeholder={"Account name: …\nAccount number: …\nIFSC: …"} />}
              </Field>
            </>
          )}
          {!p.online && (
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={save.isPending}>
                Save
              </Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}

// ─── Shipping ────────────────────────────────────────────────────────────────

type Rate = { name: string; kind: "flat" | "free_over" | "weight" | "pickup"; amount: number; freeOver: number | null; weightTiers: { upToGrams: number; amount: number }[]; eta: string; codAllowed: boolean };
type Zone = { name: string; countries: string[]; regions: string[]; postalPrefixes: string[]; rates: Rate[] };

const RATE_KINDS: { value: Rate["kind"]; label: string }[] = [
  { value: "flat", label: "Flat rate" },
  { value: "free_over", label: "Free above an order value" },
  { value: "weight", label: "By weight" },
  { value: "pickup", label: "Store pickup (free)" },
];

export function ShippingView() {
  const { can } = useStoreCtx();
  const q = useStoreQuery<{ zones: (Zone & { id: string })[] }>("shipping");
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const initial = q.data.zones.map(({ name, countries, regions, postalPrefixes, rates }) => ({ name, countries, regions, postalPrefixes, rates: rates.map(({ name, kind, amount, freeOver, weightTiers, eta, codAllowed }) => ({ name, kind, amount, freeOver, weightTiers, eta, codAllowed })) }));
  return <ShippingEditor key={q.dataUpdatedAt} initial={initial} editable={can("store:manage")} />;
}

function ShippingEditor({ initial, editable }: { initial: Zone[]; editable: boolean }) {
  const { store } = useStoreCtx();
  const money = useMoney();
  const [zones, setZones] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const save = useSave("shipping", "PUT", "Shipping saved", () => setDirty(false));
  const update = (z: Zone[]) => {
    setZones(z);
    setDirty(true);
  };
  const setZone = (i: number, patch: Partial<Zone>) => update(zones.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  const setRate = (zi: number, ri: number, patch: Partial<Rate>) => setZone(zi, { rates: zones[zi].rates.map((r, j) => (j === ri ? { ...r, ...patch } : r)) });
  const newRate = (): Rate => ({ name: "Standard delivery", kind: "flat", amount: store.currency === "INR" ? 9900 : 500, freeOver: null, weightTiers: [], eta: "3–6 business days", codAllowed: true });

  return (
    <div>
      <SubHeader
        title="Shipping & delivery"
        description="Where you deliver and what it costs. Customers see the rates for their address at checkout; the most specific zone wins."
        actions={editable && <Button icon={<Plus className="size-3.5" />} onClick={() => update([...zones, { name: "New zone", countries: [store.country], regions: [], postalPrefixes: [], rates: [newRate()] }])}>Add zone</Button>}
      />
      <ShiprocketPanel />
      <LabelProvidersPanel />
      {zones.length === 0 && (
        <Card>
          <EmptyState icon={<Truck className="size-5" />} title="No delivery zones" description="Add a zone so customers can check out." />
        </Card>
      )}
      <fieldset disabled={!editable} className="space-y-4">
        {zones.map((z, zi) => (
          <Panel
            key={zi}
            title={z.name || "Zone"}
            description={`${z.countries.includes("*") ? "Rest of the world" : z.countries.map((c) => COUNTRIES.find(([k]) => k === c)?.[1] ?? c).join(", ")}${z.regions.length ? ` · ${z.regions.length} region${z.regions.length === 1 ? "" : "s"}` : ""}${z.postalPrefixes.length ? ` · ${z.postalPrefixes.length} PIN/postal prefixes` : ""}`}
            actions={editable && <IconButton size="sm" label="Remove zone" icon={<Trash2 className="size-3.5" />} onClick={() => update(zones.filter((_, j) => j !== zi))} />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Zone name">{(a) => <Input {...a} value={z.name} onChange={(e) => setZone(zi, { name: e.target.value })} maxLength={80} />}</Field>
              <Field label="Countries">
                {(a) => (
                  <Select {...a} value={z.countries.includes("*") ? "*" : z.countries[0] ?? ""} onChange={(e) => setZone(zi, { countries: [e.target.value], regions: [] })}>
                    {COUNTRIES.map(([c, n]) => (
                      <option key={c} value={c}>
                        {n}
                      </option>
                    ))}
                    <option value="*">Rest of the world</option>
                  </Select>
                )}
              </Field>
            </div>
            {z.countries[0] === "IN" && (
              <details className="mt-3 rounded-[var(--radius-md)] border border-border px-3 py-2 text-[13px]">
                <summary className="cursor-pointer">States {z.regions.length ? `(${z.regions.length} selected)` : "(all of India)"}</summary>
                <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {INDIAN_STATES.map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={z.regions.includes(s)} onChange={(e) => setZone(zi, { regions: e.target.checked ? [...z.regions, s] : z.regions.filter((x) => x !== s) })} />
                      {s}
                    </label>
                  ))}
                </div>
              </details>
            )}
            <Field className="mt-3" label="Only these PIN / postal code prefixes (optional)" hint="Comma separated, e.g. 560, 110001. Use this for local delivery areas.">
              {(a) => <Input {...a} defaultValue={z.postalPrefixes.join(", ")} onBlur={(e) => setZone(zi, { postalPrefixes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500) })} className="font-mono text-xs" />}
            </Field>

            <div className="mt-4 space-y-3">
              <p className="text-xs font-medium text-muted">Rates customers can choose</p>
              {z.rates.map((r, ri) => (
                <div key={ri} className="rounded-[var(--radius-md)] border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Field label="Name shown at checkout">{(a) => <Input {...a} value={r.name} onChange={(e) => setRate(zi, ri, { name: e.target.value })} maxLength={80} />}</Field>
                    <Field label="How it is priced">
                      {(a) => (
                        <Select {...a} value={r.kind} onChange={(e) => setRate(zi, ri, { kind: e.target.value as Rate["kind"], ...(e.target.value === "pickup" ? { amount: 0 } : {}), ...(e.target.value === "weight" && !r.weightTiers.length ? { weightTiers: [{ upToGrams: 1000, amount: r.amount }, { upToGrams: 5000, amount: r.amount * 2 }] } : {}) })}>
                          {RATE_KINDS.map((k) => (
                            <option key={k.value} value={k.value}>
                              {k.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <div className="flex items-end">
                      <IconButton label="Remove rate" icon={<Trash2 className="size-3.5" />} onClick={() => setZone(zi, { rates: z.rates.filter((_, j) => j !== ri) })} />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {(r.kind === "flat" || r.kind === "free_over") && (
                      <Field label="Price">{(a) => <MoneyInput {...a} value={r.amount} onChange={(v) => setRate(zi, ri, { amount: v ?? 0 })} currency={store.currency} />}</Field>
                    )}
                    {r.kind === "free_over" && (
                      <Field label="Free when the order is at least">{(a) => <MoneyInput {...a} value={r.freeOver} onChange={(v) => setRate(zi, ri, { freeOver: v })} currency={store.currency} />}</Field>
                    )}
                    <Field label="Delivery time">{(a) => <Input {...a} value={r.eta} onChange={(e) => setRate(zi, ri, { eta: e.target.value })} maxLength={60} placeholder="3–5 business days" />}</Field>
                    <label className="flex items-center justify-between gap-2 self-end pb-1.5 text-[13px]">
                      Allow cash on delivery
                      <Switch checked={r.codAllowed} onChange={(v) => setRate(zi, ri, { codAllowed: v })} label="Allow cash on delivery" />
                    </label>
                  </div>
                  {r.kind === "weight" && (
                    <div className="mt-3 space-y-2">
                      {r.weightTiers.map((t, ti) => (
                        <div key={ti} className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className="text-muted">Up to</span>
                          <Input aria-label="Up to grams" type="number" min={1} value={t.upToGrams} onChange={(e) => setRate(zi, ri, { weightTiers: r.weightTiers.map((x, j) => (j === ti ? { ...x, upToGrams: Math.max(1, Math.trunc(Number(e.target.value) || 1)) } : x)) })} className="w-28" />
                          <span className="text-muted">grams costs</span>
                          <div className="w-32">
                            <MoneyInput aria-label="Tier price" value={t.amount} onChange={(v) => setRate(zi, ri, { weightTiers: r.weightTiers.map((x, j) => (j === ti ? { ...x, amount: v ?? 0 } : x)) })} currency={store.currency} />
                          </div>
                          <IconButton size="sm" label="Remove tier" icon={<Trash2 className="size-3.5" />} onClick={() => setRate(zi, ri, { weightTiers: r.weightTiers.filter((_, j) => j !== ti) })} />
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setRate(zi, ri, { weightTiers: [...r.weightTiers, { upToGrams: (r.weightTiers.at(-1)?.upToGrams ?? 0) + 1000, amount: r.weightTiers.at(-1)?.amount ?? 0 }] })}>
                        Add weight tier
                      </Button>
                      <p className="text-xs text-muted">Orders heavier than the last tier cannot use this rate.</p>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-subtle">
                    Customer sees: {r.name || "—"} · {r.kind === "pickup" ? "Free" : r.kind === "weight" ? "by weight" : money(r.amount)}
                    {r.kind === "free_over" && r.freeOver !== null ? ` (free over ${money(r.freeOver)})` : ""}
                    {r.eta ? ` · ${r.eta}` : ""}
                  </p>
                </div>
              ))}
              {editable && (
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setZone(zi, { rates: [...z.rates, newRate()] })}>
                  Add rate
                </Button>
              )}
            </div>
          </Panel>
        ))}
      </fieldset>
      <Notice tone="neutral" title="Shipping labels">{store.country === "IN" ? "Connect Shiprocket above to book couriers and print labels from each order. Otherwise, book with your courier and add the tracking number on the order." : "Book shipments with your courier, then add the tracking number on the order. Automatic label purchase is available for India through Shiprocket."}</Notice>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate({ zones })} onReset={() => { setZones(initial); setDirty(false); }} />
    </div>
  );
}

// ─── Taxes ───────────────────────────────────────────────────────────────────

type TaxRate = { country: string; region: string; rateBps: number; name: string };
type Taxes = { pricesIncludeTax: boolean; defaultTaxBps: number; taxId: string; rates: TaxRate[] };

export function TaxesView() {
  const { can } = useStoreCtx();
  const q = useStoreQuery<Taxes>("taxes");
  if (q.isPending) return <Skeleton className="h-80" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return (
    <>
      <TaxEditor key={q.dataUpdatedAt} initial={{ ...q.data, rates: q.data.rates.map(({ country, region, rateBps, name }) => ({ country, region, rateBps, name })) }} editable={can("store:manage")} />
      <GstReports />
    </>
  );
}

type Amt = { taxable: number; igst: number; cgst: number; sgst: number; total: number };
type GstData = {
  month: string;
  invoices: number;
  totals: Amt;
  b2b: (Amt & { invoice: string; date: string; gstin: string; name: string; placeOfSupply: string })[];
  b2cl: (Amt & { invoice: string; date: string; placeOfSupply: string })[];
  b2cs: (Amt & { placeOfSupply: string; rate: number })[];
  hsn: (Amt & { hsn: string; description: string; quantity: number; rate: number })[];
  creditNotes: { invoice: string; date: string; amount: number; taxable: number; tax: number }[];
  notes: string[];
};

/** Monthly GST summary for Indian stores, with CSV downloads for each section. */
function GstReports() {
  const { store, projectId, can } = useStoreCtx();
  const money = useMoney();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const q = useStoreQuery<GstData>(`gst?month=${month}`, { enabled: store.country === "IN" && can("store:orders") });
  if (store.country !== "IN" || !can("store:orders")) return null;
  const csv = (section: string) => storeApi(projectId, `gst/csv?month=${month}&section=${section}`);
  const Dl = ({ section, n }: { section: string; n: number }) => (n ? <a className="text-xs text-accent hover:underline" href={csv(section)}>Download CSV</a> : null);
  return (
    <div className="mt-6">
      <Panel title="GST summary" description="Monthly figures in the shape of GSTR-1, from paid orders by invoice date. Share with your accountant; this is not a filed return." actions={<Input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" />}>
        {q.isPending ? (
          <Skeleton className="h-40" />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} />
        ) : (
          <div className="space-y-5 text-[13px]">
            <div className="grid gap-3 sm:grid-cols-4">
              {[["Invoices", String(q.data.invoices)], ["Taxable value", money(q.data.totals.taxable)], ["IGST", money(q.data.totals.igst)], ["CGST + SGST", money(q.data.totals.cgst + q.data.totals.sgst)]].map(([k, v]) => (
                <div key={k} className="rounded-[var(--radius-md)] bg-surface-2 p-3">
                  <p className="text-xs text-muted">{k}</p>
                  <p className="mt-0.5 font-semibold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            {(
              [
                ["B2B invoices (buyers with GSTIN)", "b2b", q.data.b2b.length, q.data.b2b.map((r) => [r.invoice, r.gstin, r.placeOfSupply, money(r.taxable), money(r.igst + r.cgst + r.sgst)])],
                ["B2C large (inter-state, over ₹1 lakh)", "b2cl", q.data.b2cl.length, q.data.b2cl.map((r) => [r.invoice, "—", r.placeOfSupply, money(r.taxable), money(r.igst)])],
                ["B2C small (by state and rate)", "b2cs", q.data.b2cs.length, q.data.b2cs.map((r) => [`${(r.rate / 100).toFixed(0)}%`, "—", r.placeOfSupply, money(r.taxable), money(r.igst + r.cgst + r.sgst)])],
                ["HSN summary", "hsn", q.data.hsn.length, q.data.hsn.map((r) => [r.hsn, `${r.quantity} × ${r.description}`, `${(r.rate / 100).toFixed(0)}%`, money(r.taxable), money(r.igst + r.cgst + r.sgst)])],
                ["Refunds (credit notes to raise)", "cdn", q.data.creditNotes.length, q.data.creditNotes.map((r) => [r.invoice, r.date, "—", money(r.taxable), money(r.tax)])],
              ] as [string, string, number, string[][]][]
            ).map(([title, section, n, rows]) => (
              <div key={section}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="font-medium">
                    {title} <span className="text-xs text-muted">({n})</span>
                  </p>
                  <Dl section={section} n={n} />
                </div>
                {n === 0 ? (
                  <p className="text-xs text-muted">None this month.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
                    {rows.slice(0, 8).map((r, i) => (
                      <li key={i} className="grid grid-cols-5 gap-2 px-3 py-1.5 text-xs tabular-nums">
                        {r.map((c, j) => (
                          <span key={j} className={j >= 3 ? "text-right" : "truncate"}>{c}</span>
                        ))}
                      </li>
                    ))}
                    {rows.length > 8 && <li className="px-3 py-1.5 text-xs text-muted">and {rows.length - 8} more in the CSV</li>}
                  </ul>
                )}
              </div>
            ))}
            <ul className="space-y-0.5 text-xs text-muted">
              {q.data.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

function TaxEditor({ initial, editable }: { initial: Taxes; editable: boolean }) {
  const { store } = useStoreCtx();
  const [t, setT] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const save = useSave("taxes", "PUT", "Tax settings saved", () => setDirty(false));
  const set = (patch: Partial<Taxes>) => {
    setT({ ...t, ...patch });
    setDirty(true);
  };
  const india = store.country === "IN";
  const rateInput = (bps: number, onChange: (b: number) => void, label: string) => (
    <div className="relative w-28">
      <Input aria-label={label} type="number" min={0} max={100} step={0.01} value={bps / 100} onChange={(e) => onChange(Math.round(Math.min(100, Math.max(0, Number(e.target.value) || 0)) * 100))} className="pr-7 tabular-nums" />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[13px] text-subtle">%</span>
    </div>
  );
  return (
    <div>
      <SubHeader title="Taxes" description={india ? "GST settings. Invoices automatically split tax into CGST + SGST for orders in your state, or IGST for other states." : "Sales tax or VAT settings for your store."} />
      <fieldset disabled={!editable} className="space-y-4">
        <Panel title="How prices are entered">
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span>
                My prices already include tax
                <span className="block text-xs text-muted">{india ? "Usual in India (MRP-style pricing). Tax is shown as “included” at checkout." : "Common for VAT. Turn off to add tax on top at checkout (common in the US)."}</span>
              </span>
              <Switch checked={t.pricesIncludeTax} onChange={(v) => set({ pricesIncludeTax: v })} label="Prices include tax" />
            </label>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p className="mb-1.5 text-[13px] font-medium">Default tax rate</p>
                {rateInput(t.defaultTaxBps, (b) => set({ defaultTaxBps: b }), "Default tax rate")}
              </div>
              {india && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {[0, 500, 1200, 1800, 2800].map((b) => (
                    <Button key={b} size="sm" variant={t.defaultTaxBps === b ? "primary" : "secondary"} onClick={() => set({ defaultTaxBps: b })}>
                      {pct(b)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-muted">You can override the rate on individual products.</p>
            <Field label={india ? "GSTIN" : "Tax registration number"} hint="Printed on invoices.">
              {(a) => <Input {...a} value={t.taxId} onChange={(e) => set({ taxId: e.target.value.toUpperCase() })} maxLength={40} className="max-w-xs font-mono text-xs" />}
            </Field>
          </div>
        </Panel>
        <Panel title="Rates for other places" description="Use a different rate when delivering to a specific country or state. Leave empty to use the default everywhere." actions={editable && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set({ rates: [...t.rates, { country: store.country === "IN" ? "US" : store.country, region: "", rateBps: 0, name: "Tax" }] })}>Add rate</Button>}>
          {t.rates.length === 0 ? (
            <p className="text-[13px] text-muted">No overrides — the default rate applies to every order.</p>
          ) : (
            <ul className="space-y-2">
              {t.rates.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <Select aria-label="Country" value={r.country} onChange={(e) => set({ rates: t.rates.map((x, j) => (j === i ? { ...x, country: e.target.value } : x)) })} className="w-44">
                    {COUNTRIES.map(([c, n]) => (
                      <option key={c} value={c}>
                        {n}
                      </option>
                    ))}
                  </Select>
                  <Input aria-label="State or region (optional)" placeholder="State (optional)" value={r.region} onChange={(e) => set({ rates: t.rates.map((x, j) => (j === i ? { ...x, region: e.target.value } : x)) })} className="w-40" />
                  <Input aria-label="Tax name" value={r.name} onChange={(e) => set({ rates: t.rates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="w-28" maxLength={40} />
                  {rateInput(r.rateBps, (b) => set({ rates: t.rates.map((x, j) => (j === i ? { ...x, rateBps: b } : x)) }), "Rate")}
                  <IconButton size="sm" label="Remove rate" icon={<Trash2 className="size-3.5" />} onClick={() => set({ rates: t.rates.filter((_, j) => j !== i) })} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <p className="text-xs text-muted">These settings calculate tax at checkout. Check the rates that apply to your products with your accountant — tax rules differ by product and place.</p>
      </fieldset>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(t)} onReset={() => { setT(initial); setDirty(false); }} />
    </div>
  );
}

// ─── Discounts ───────────────────────────────────────────────────────────────

type Discount = { id: string; code: string; kind: "percent" | "fixed" | "free_shipping"; value: number; minSubtotal: number; usageLimit: number | null; usedCount: number; oncePerCustomer: boolean; startsAt: string | null; endsAt: string | null; active: boolean };

export function DiscountsView() {
  const { projectId, can } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<{ discounts: Discount[] }>("discounts");
  const [edit, setEdit] = useState<Partial<Discount> | null>(null);
  const [del, setDel] = useState<Discount | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(storeApi(projectId, `discounts/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      setDel(null);
      toast({ tone: "success", title: "Discount deleted" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete", description: errorMessage(e) }),
  });
  const describe = (d: Discount) => (d.kind === "percent" ? `${d.value}% off` : d.kind === "fixed" ? `${money(d.value)} off` : "Free shipping") + (d.minSubtotal ? ` orders over ${money(d.minSubtotal)}` : "");
  const state = (d: Discount): { label: string; tone: "success" | "neutral" | "warning" } => {
    // Evaluated as of the last fetch, which keeps rendering pure.
    const now = q.dataUpdatedAt;
    if (!d.active) return { label: "Off", tone: "neutral" };
    if (d.startsAt && new Date(d.startsAt).getTime() > now) return { label: "Scheduled", tone: "warning" };
    if (d.endsAt && new Date(d.endsAt).getTime() < now) return { label: "Expired", tone: "neutral" };
    if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return { label: "Used up", tone: "neutral" };
    return { label: "Active", tone: "success" };
  };
  return (
    <div>
      <SubHeader title="Discount codes" description="Codes customers enter in their cart. Share them on social media, with newsletters or on your site’s announcement bar." actions={can("store:manage") && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ code: "", kind: "percent", value: 10, minSubtotal: 0, usageLimit: null, oncePerCustomer: false, active: true, startsAt: null, endsAt: null })}>Create code</Button>} />
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <Table head={["Code", "Offer", "Used", "Status", ""]} empty={q.data.discounts.length === 0 && <EmptyState icon={<BadgePercent className="size-5" />} title="No discount codes" description="Create a code like WELCOME10 to reward first-time customers." />}>
          {q.data.discounts.map((d) => {
            const s = state(d);
            return (
              <tr key={d.id}>
                <td className={`${td} font-mono font-medium`}>{d.code}</td>
                <td className={td}>{describe(d)}</td>
                <td className={`${td} tabular-nums`}>
                  {d.usedCount}
                  {d.usageLimit !== null && <span className="text-muted"> / {d.usageLimit}</span>}
                </td>
                <td className={td}>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  {can("store:manage") && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(d)}>
                        Edit
                      </Button>
                      <IconButton size="sm" label={`Delete ${d.code}`} icon={<Trash2 className="size-3.5" />} onClick={() => setDel(d)} />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {edit && <DiscountDialog initial={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending} destructive title={`Delete ${del?.code}?`} description="Customers will no longer be able to use this code. Past orders keep their discount." confirmLabel="Delete" />
    </div>
  );
}

const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function DiscountDialog({ initial, onClose }: { initial: Partial<Discount>; onClose: () => void }) {
  const { store } = useStoreCtx();
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = useSave(initial.id ? `discounts/${initial.id}` : "discounts", initial.id ? "PUT" : "POST", initial.id ? "Discount saved" : "Discount created", onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title={initial.id ? `Edit ${initial.code}` : "Create a discount code"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!d.code?.trim()}
            onClick={() =>
              save.mutate(
                { code: d.code, kind: d.kind, value: d.kind === "free_shipping" ? 0 : d.value, minSubtotal: d.minSubtotal ?? 0, usageLimit: d.usageLimit ?? null, oncePerCustomer: !!d.oncePerCustomer, startsAt: d.startsAt ?? null, endsAt: d.endsAt ?? null, active: d.active ?? true },
                { onError: (e) => e instanceof ApiClientError && setErrors(e.fieldErrors()) },
              )
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Code" hint="Customers type this in the cart. Not case-sensitive." error={errors.code?.[0]}>
          {(a) => (
            <div className="flex gap-2">
              <Input {...a} value={d.code ?? ""} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} maxLength={40} className="font-mono" />
              <Button onClick={() => setD({ ...d, code: `SAVE${Math.random().toString(36).slice(2, 7).toUpperCase()}` })}>Generate</Button>
            </div>
          )}
        </Field>
        <Segmented label="Discount type" value={d.kind ?? "percent"} onChange={(k) => setD({ ...d, kind: k, value: k === "percent" ? 10 : k === "fixed" ? (store.currency === "INR" ? 10000 : 500) : 0 })} options={[{ value: "percent", label: "Percentage" }, { value: "fixed", label: "Fixed amount" }, { value: "free_shipping", label: "Free shipping" }]} />
        {d.kind === "percent" && (
          <Field label="Percent off" error={errors.value?.[0]}>
            {(a) => <Input {...a} type="number" min={1} max={100} value={d.value ?? 0} onChange={(e) => setD({ ...d, value: Math.trunc(Number(e.target.value) || 0) })} className="w-28" />}
          </Field>
        )}
        {d.kind === "fixed" && <Field label="Amount off">{(a) => <MoneyInput {...a} value={d.value ?? 0} onChange={(v) => setD({ ...d, value: v ?? 0 })} currency={store.currency} />}</Field>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum order value" hint="Optional">
            {(a) => <MoneyInput {...a} value={d.minSubtotal || null} onChange={(v) => setD({ ...d, minSubtotal: v ?? 0 })} currency={store.currency} />}
          </Field>
          <Field label="Total uses allowed" hint="Blank for unlimited">
            {(a) => <Input {...a} type="number" min={1} value={d.usageLimit ?? ""} onChange={(e) => setD({ ...d, usageLimit: e.target.value ? Math.max(1, Math.trunc(Number(e.target.value))) : null })} />}
          </Field>
          <Field label="Starts" hint="Optional">
            {(a) => <Input {...a} type="datetime-local" value={toLocalInput(d.startsAt ?? null)} onChange={(e) => setD({ ...d, startsAt: fromLocalInput(e.target.value) })} />}
          </Field>
          <Field label="Ends" hint="Optional">
            {(a) => <Input {...a} type="datetime-local" value={toLocalInput(d.endsAt ?? null)} onChange={(e) => setD({ ...d, endsAt: fromLocalInput(e.target.value) })} />}
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          One use per customer (by email)
          <Switch checked={!!d.oncePerCustomer} onChange={(v) => setD({ ...d, oncePerCustomer: v })} label="One use per customer" />
        </label>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          Active
          <Switch checked={d.active ?? true} onChange={(v) => setD({ ...d, active: v })} label="Active" />
        </label>
      </div>
    </Dialog>
  );
}

// ─── Currencies ──────────────────────────────────────────────────────────────

/** Extra currencies shoppers can choose, at exchange rates the store sets. */
function CurrenciesPanel() {
  const { store, can } = useStoreCtx();
  const [list, setList] = useState(store.currencies ?? []);
  const save = useSave<{ store: Store }>("currencies", "PUT", "Currencies saved");
  const editable = can("store:manage");
  const options = CURRENCIES.filter((c) => c.code !== store.currency);
  const sample = 100 * 10 ** minorDigits(store.currency); // 100 units of the base currency
  return (
    <Panel
      title="Currencies"
      description={`Let shoppers see prices and pay in other currencies. ${store.currency} stays your accounting currency; you set the exchange rates. Cash on delivery, bank transfer and gift cards remain in ${store.currency}.`}
      actions={
        editable && (
          <Button size="sm" icon={<Plus className="size-3.5" />} disabled={list.length >= options.length} onClick={() => setList([...list, { code: options.find((o) => !list.some((l) => l.code === o.code))!.code, rate: "", rounding: "x.99" }])}>
            Add currency
          </Button>
        )
      }
    >
      {list.length === 0 ? (
        <p className="text-[13px] text-muted">Only {store.currency} is offered.</p>
      ) : (
        <div className="grid gap-2">
          {list.map((c, i) => {
            const preview = Number(c.rate) > 0 ? convertMinor(sample, store.currency, c, { price: true }) : null;
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[110px_1fr_170px_auto]">
                <Field label="Currency">
                  {(a) => (
                    <Select {...a} value={c.code} disabled={!editable} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}>
                      {options.map((o) => (
                        <option key={o.code} value={o.code} disabled={o.code !== c.code && list.some((l) => l.code === o.code)}>
                          {o.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={`1 ${store.currency} =`} hint={preview !== null ? `${formatMoney(sample, store.currency)} shows as ${formatMoney(preview, c.code)}` : "Enter the rate"}>
                  {(a) => <Input {...a} inputMode="decimal" value={c.rate} disabled={!editable} placeholder="0.012" onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, rate: e.target.value.trim() } : x)))} />}
                </Field>
                <Field label="Price endings">
                  {(a) => (
                    <Select {...a} value={c.rounding} disabled={!editable} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, rounding: e.target.value as typeof c.rounding } : x)))}>
                      {Object.entries(ROUNDING_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {editable && <IconButton label="Remove currency" icon={<Trash2 className="size-3.5" />} onClick={() => setList(list.filter((_, j) => j !== i))} />}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-subtle">{store.currencyRatesUpdatedAt ? `Rates last updated ${new Date(store.currencyRatesUpdatedAt).toLocaleDateString()}. Review them regularly.` : "Check your payment provider supports these currencies (Stripe and PayPal do; Razorpay needs international payments enabled)."}</p>
        {editable && (
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ currencies: list })}>
            Save currencies
          </Button>
        )}
      </div>
    </Panel>
  );
}

// ─── Store settings ──────────────────────────────────────────────────────────

export function SettingsView() {
  const { store, can, mailDelivery, liveUrl } = useStoreCtx();
  const initial = {
    name: store.name,
    email: store.email,
    phone: store.phone,
    currency: store.currency,
    country: store.country,
    region: store.region,
    address: store.address ?? { line1: "", line2: "", city: "", region: store.region, postalCode: "", country: store.country },
    orderPrefix: store.orderPrefix,
    lowStockThreshold: store.lowStockThreshold,
    notifyEmails: store.notifyEmails,
    policies: { refund: store.policies.refund ?? "", shipping: store.policies.shipping ?? "", privacy: store.policies.privacy ?? "", terms: store.policies.terms ?? "" },
    checkout: { requirePhone: store.checkout.requirePhone ?? true, orderNotes: store.checkout.orderNotes ?? true, termsRequired: store.checkout.termsRequired ?? false, showTrustBadges: store.checkout.showTrustBadges ?? true, announcement: store.checkout.announcement ?? "", returnDays: store.checkout.returnDays ?? 7 },
  };
  const [s, setS] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [currencyWarn, setCurrencyWarn] = useState(false);
  const save = useSave<{ store: Store }>("settings", "PUT", "Store settings saved", () => setDirty(false));
  const editable = can("store:manage");
  const set = (patch: Partial<typeof s>) => {
    setS({ ...s, ...patch });
    setDirty(true);
  };
  const india = s.country === "IN";
  const row = (label: string, hint: string, checked: boolean, onChange: (v: boolean) => void): ReactNode => (
    <label className="flex items-center justify-between gap-3 text-[13px]">
      <span>
        {label}
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
  return (
    <div>
      <SubHeader title="Store settings" description="Your business details, checkout options and the policies shown in your store footer." />
      <div className="mb-4">
        {mailDelivery ? (
          <Notice tone="success" title="Emails are being delivered">Order confirmations, shipping updates and other store emails are sent from your store name, with replies going to your contact email.</Notice>
        ) : (
          <Notice tone="warning" title="Emails are not being delivered yet">Store emails (order confirmations, shipping updates, gift cards) are recorded but not sent, because no mail provider is configured for this platform. The platform administrator can connect Resend, Postmark, SendGrid or an SMTP server and set MAIL_FROM.</Notice>
        )}
      </div>
      {liveUrl && (
        <Panel className="mb-4" title="Google Shopping and search engines" description="Submit these links in Google Merchant Center and Search Console so your products can appear in Google Shopping and search.">
          <div className="space-y-2 text-[13px]">
            {[["Product feed", "/products.xml"], ["Sitemap", "/sitemap.xml"]].map(([label, path]) => (
              <div key={path} className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-muted">{label}</span>
                <a href={`${liveUrl}${path}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent hover:underline">{`${liveUrl}${path}`}</a>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <div className="mb-4">
        <CurrenciesPanel />
      </div>
      <fieldset disabled={!editable} className="space-y-4">
        <Panel title="Business details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Store name">{(a) => <Input {...a} value={s.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />}</Field>
            <Field label="Contact email" hint="Order notifications go here; customers can reply to it.">{(a) => <Input {...a} type="email" value={s.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
            <Field label="Phone">{(a) => <Input {...a} type="tel" value={s.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={30} />}</Field>
            <Field label="Also notify (comma separated)" hint="Extra emails for new-order alerts.">
              {(a) => <Input {...a} defaultValue={s.notifyEmails.join(", ")} onBlur={(e) => set({ notifyEmails: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10) })} />}
            </Field>
            <Field label="Country">
              {(a) => (
                <Select {...a} value={s.country} onChange={(e) => set({ country: e.target.value, address: { ...s.address, country: e.target.value } })}>
                  {COUNTRIES.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Currency" hint={currencyWarn ? "Changing currency does not convert your prices — update them after saving." : undefined}>
              {(a) => (
                <Select
                  {...a}
                  value={s.currency}
                  onChange={(e) => {
                    setCurrencyWarn(e.target.value !== store.currency);
                    set({ currency: e.target.value });
                  }}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <p className="mt-5 mb-2 text-xs font-medium text-muted">Business address (printed on invoices)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input aria-label="Address line 1" placeholder="Address" value={s.address.line1} onChange={(e) => set({ address: { ...s.address, line1: e.target.value } })} maxLength={200} />
            <Input aria-label="Address line 2" placeholder="Area / landmark (optional)" value={s.address.line2 ?? ""} onChange={(e) => set({ address: { ...s.address, line2: e.target.value } })} maxLength={200} />
            <Input aria-label="City" placeholder="City" value={s.address.city} onChange={(e) => set({ address: { ...s.address, city: e.target.value } })} maxLength={80} />
            {india ? (
              <Select aria-label="State" value={s.region} onChange={(e) => set({ region: e.target.value, address: { ...s.address, region: e.target.value } })}>
                <option value="">State</option>
                {INDIAN_STATES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            ) : (
              <Input aria-label="State / region" placeholder="State / region" value={s.region} onChange={(e) => set({ region: e.target.value, address: { ...s.address, region: e.target.value } })} maxLength={80} />
            )}
            <Input aria-label="Postal code" placeholder={india ? "PIN code" : "Postal code"} value={s.address.postalCode} onChange={(e) => set({ address: { ...s.address, postalCode: e.target.value } })} maxLength={12} />
          </div>
        </Panel>
        <Panel title="Orders & checkout">
          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Order number prefix" hint={`Orders look like ${s.orderPrefix || ""}1001`}>{(a) => <Input {...a} value={s.orderPrefix} onChange={(e) => set({ orderPrefix: e.target.value })} maxLength={8} className="w-28" />}</Field>
              <Field label="Low stock alert at" hint="Highlight items at or below this many units.">{(a) => <Input {...a} type="number" min={0} value={s.lowStockThreshold} onChange={(e) => set({ lowStockThreshold: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} className="w-28" />}</Field>
            </div>
            {row("Require a phone number", "Couriers usually need one for delivery.", s.checkout.requirePhone, (v) => set({ checkout: { ...s.checkout, requirePhone: v } }))}
            {row("Allow order notes", "Customers can add delivery instructions or a gift message.", s.checkout.orderNotes, (v) => set({ checkout: { ...s.checkout, orderNotes: v } }))}
            {row("Require accepting terms", "Customers must tick a box agreeing to your terms and refund policy.", s.checkout.termsRequired, (v) => set({ checkout: { ...s.checkout, termsRequired: v } }))}
            {row("Show trust badges", "Secure checkout, easy returns and delivery promises under the cart.", s.checkout.showTrustBadges, (v) => set({ checkout: { ...s.checkout, showTrustBadges: v } }))}
            <Field label="Return requests" hint="Customers can ask for a return this many days after their order ships (plus a week for delivery). 0 turns online return requests off.">
              {(a) => (
                <div className="flex items-center gap-2">
                  <Input {...a} type="number" min={0} max={365} value={s.checkout.returnDays} onChange={(e) => set({ checkout: { ...s.checkout, returnDays: Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))) } })} className="w-24" />
                  <span className="text-[13px] text-muted">days</span>
                </div>
              )}
            </Field>
            <Field label="Cart announcement (optional)" hint="A short message on the cart page, e.g. “Free shipping over ₹999”.">
              {(a) => <Input {...a} value={s.checkout.announcement} onChange={(e) => set({ checkout: { ...s.checkout, announcement: e.target.value } })} maxLength={200} />}
            </Field>
          </div>
        </Panel>
        <Panel title="Policies" description="Shown at /policies/… and linked from checkout. Replace the starter text with your own — it is marked “[Edit this policy]” until you do.">
          <div className="space-y-4">
            {(["shipping", "refund", "privacy", "terms"] as const).map((k) => (
              <Field key={k} label={{ shipping: "Shipping policy", refund: "Refund & return policy", privacy: "Privacy policy", terms: "Terms of service" }[k]}>
                {(a) => <Textarea {...a} rows={4} value={s.policies[k]} onChange={(e) => set({ policies: { ...s.policies, [k]: e.target.value } })} maxLength={20000} className={cx(s.policies[k].includes("[Edit this policy]") && "border-warning")} />}
              </Field>
            ))}
          </div>
        </Panel>
      </fieldset>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate({ ...s, address: s.address.line1 ? { ...s.address, region: s.region, country: s.country } : null })} onReset={() => { setS(initial); setDirty(false); }} />
    </div>
  );
}

// ─── Live payment test ───────────────────────────────────────────────────────

type PayCheck = { id: string; label: string; status: "pass" | "fail" | "warn" | "manual"; detail: string };
type PayTest = { id: string; status: "created" | "passed" | "failed" | "expired" | "refunded"; amount: number; currency: string; providerSaysPaid: boolean | null; error: string | null; createdAt: string; webhookAt: string | null };

/** End-to-end check with the provider's test environment; passes only on a signed webhook. */
function LiveTestPanel({ p }: { p: Provider }) {
  const { projectId, store } = useStoreCtx();
  const toast = useToast();
  const [checks, setChecks] = useState<{ checks: PayCheck[]; ready: boolean; webhookUrl: string } | null>(null);
  const [testId, setTestId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("paymentTest")));
  const pre = useMutation({
    mutationFn: () => api<{ checks: PayCheck[]; ready: boolean; webhookUrl: string }>(storeApi(projectId, `payments/${p.id}/preflight`), { method: "POST", body: {} }),
    onSuccess: setChecks,
    onError: (e) => toast({ tone: "error", title: "Couldn't run checks", description: errorMessage(e) }),
  });
  const start = useMutation({
    mutationFn: () => api<{ test: PayTest; redirectUrl: string }>(storeApi(projectId, `payments/${p.id}/tests`), { method: "POST", body: {} }),
    onSuccess: (r) => {
      setTestId(r.test.id);
      window.open(r.redirectUrl, "_blank", "noopener");
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't start the test", description: errorMessage(e) }),
  });
  const test = useStoreQuery<{ test: PayTest }>(`payments/${p.id}/tests/${testId}`, { enabled: !!testId, refetchInterval: (q) => (q.state.data?.test.status === "created" ? 3000 : false) });
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (what: "check" | "refund") => api<{ test: PayTest }>(storeApi(projectId, `payments/${p.id}/tests/${testId}/${what}`), { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store", projectId] }),
    onError: (e) => toast({ tone: "error", title: "Request failed", description: errorMessage(e) }),
  });
  const t = test.data?.test;
  const icon = (s: PayCheck["status"]) => (s === "pass" ? "✓" : s === "fail" ? "✕" : s === "warn" ? "!" : "→");
  return (
    <div className="space-y-3 border-t border-border bg-surface-2/40 p-4 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Live payment test</p>
          <p className="text-xs text-muted">Pays {formatMoney(100, store?.currency ?? "INR")} in {p.name} test mode and waits for the signed webhook. A return to your site alone never counts.</p>
        </div>
        <Button size="sm" loading={pre.isPending} onClick={() => pre.mutate()}>{checks ? "Re-run checks" : "Run checks"}</Button>
      </div>
      {checks && (
        <ul className="space-y-1.5">
          {checks.checks.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span className={cx("mt-px w-4 shrink-0 text-center font-semibold", c.status === "pass" ? "text-success" : c.status === "fail" ? "text-danger" : "text-warning")} aria-label={c.status}>{icon(c.status)}</span>
              <span className="min-w-0"><b className="font-medium">{c.label}</b> <span className="break-words text-muted">— {c.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
      {checks?.ready && (
        <Button variant="primary" size="sm" loading={start.isPending} onClick={() => start.mutate()}>Start test payment</Button>
      )}
      {t && (
        <Notice
          tone={t.status === "passed" || t.status === "refunded" ? "success" : t.status === "created" ? "neutral" : "danger"}
          title={t.status === "created" ? "Waiting for the webhook…" : t.status === "passed" ? "Passed: signed webhook received" : t.status === "refunded" ? "Passed and refunded" : t.status === "expired" ? "No webhook arrived" : "Failed"}
          action={
            <span className="flex gap-1.5">
              {t.status === "created" && p.id !== "paypal" && <Button size="sm" loading={act.isPending} onClick={() => act.mutate("check")}>Ask {p.name}</Button>}
              {t.status === "passed" && <Button size="sm" loading={act.isPending} onClick={() => act.mutate("refund")}>Refund test payment</Button>}
            </span>
          }
        >
          {t.status === "created"
            ? t.providerSaysPaid
              ? `${p.name} says it's paid, but the webhook hasn't arrived — check the webhook URL and secret.`
              : "Complete the payment in the tab that opened (use the provider's test card or UPI)."
            : t.error ?? (t.webhookAt ? `Webhook verified at ${new Date(t.webhookAt).toLocaleTimeString()}.` : "")}
        </Notice>
      )}
    </div>
  );
}
