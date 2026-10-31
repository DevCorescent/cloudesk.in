"use client";

// Plans & pricing: the plan catalogue workspaces choose from (prices, features,
// limits, archive/restore), and the rules every subscription follows — whether
// subscriptions are enforced at all, the free trial, tax, yearly discount,
// grace and renewal notice, and the prices for building your own plan.
// Money is typed in rupees and stored in paise.
import { Plus } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { money, type CatalogPlan, type Pricing } from "@/lib/billing/catalog";
import { MODULE_GROUPS, MODULE_IDS, MODULES, type ModuleId } from "@/lib/workspace/modules";
import { num, Section, useAdmin, useCan, useRun } from "./common";
import { Block, useSettings } from "./settings";
import { MoneyInput, ModulePicker } from "./subscriptions";

type Res = { plans: CatalogPlan[]; usage: Record<string, number>; pricing: Pricing; providers: string[] };
const QUOTAS = [["invoicesPerMonth", "Invoices a month"], ["contacts", "CRM contacts"], ["aiPerMonth", "AI requests a month"]] as const;
const LIMITS = [["projects", "Web apps"], ["seats", "Seats"], ["customDomains", "Custom domains"], ["automationsPerProject", "Automations per web app"]] as const;

export function PlansPricingPanel() {
  const q = useAdmin<Res>("billing-plans");
  const s = useSettings();
  const can = useCan();
  const run = useRun();
  const [edit, setEdit] = useState<CatalogPlan | "new" | null>(null);
  const [archive, setArchive] = useState<CatalogPlan | null>(null);
  if (q.isError || s.isError) return <ErrorState message={errorMessage(q.error ?? s.error)} onRetry={() => { void q.refetch(); void s.refetch(); }} />;
  if (!q.data || !s.data) return <Skeleton className="h-96" />;
  const w = can("settings:write");
  const { plans, usage, providers } = q.data;
  const pricing = s.data.settings.pricing;
  const sorted = [...plans].sort((a, b) => Number(b.active) - Number(a.active) || a.sort - b.sort);
  const save = (p: CatalogPlan, done: string) => {
    const { id, ...body } = p;
    return run(`billing-plans/${id}`, "PUT", body, done);
  };
  return (
    <div className="space-y-6">
      {!pricing.enforce && <Notice tone="warning" title="Subscriptions aren't enforced">Every workspace is unrestricted, whatever its plan or trial. Turn enforcement on in the rules below when you&apos;re ready to charge.</Notice>}
      {!providers.length && <Notice title="No payment provider connected">Workspaces can&apos;t pay online until Razorpay or Stripe is set up (Integrations). You can still record bank or UPI payments in Subscriptions.</Notice>}
      {!w && <Notice>Only platform owners can change plans and prices.</Notice>}

      <Section title="Plans" sub="What workspaces choose from. Editing or archiving a plan never changes what existing subscribers bought — they keep it until they change plan." actions={w && <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>New plan</Button>}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sorted.map((p) => (
            <Card key={p.id} className={cx("flex flex-col gap-3 p-4 text-[13px]", !p.active && "opacity-70")} data-testid={`plan-${p.id}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-[15px] font-semibold">{p.name}</h3>
                {p.highlight && <Badge tone="accent">Highlighted</Badge>}
                <Badge>{p.kind === "basic" ? "Basic" : p.kind === "free" ? "Free plan" : "Full plan"}</Badge>
                {!p.active && <Badge tone="warning">Archived</Badge>}
              </div>
              {p.tagline && <p className="text-muted">{p.tagline}</p>}
              <p className="tabular-nums"><b className="text-[17px]">{money(p.monthly, p.currency)}</b><span className="text-muted">/month</span> · {money(p.yearly, p.currency)}<span className="text-muted">/year</span></p>
              <ul className="space-y-0.5 text-muted">
                <li>{p.modules === null ? `Every feature (${MODULE_IDS.length})` : `${p.modules.length} feature${p.modules.length === 1 ? "" : "s"}`}</li>
                <li>{num(p.limits.projects)} web apps · {num(p.limits.seats)} seats</li>
                <li>{num(p.limits.customDomains)} domains · {num(p.limits.automationsPerProject)} automations/app</li>
                <li className="text-fg">{num(usage[p.id] ?? 0)} workspace{usage[p.id] === 1 ? "" : "s"} on it</li>
              </ul>
              {w && (
                <div className="mt-auto flex gap-2">
                  <Button size="sm" onClick={() => setEdit(p)}>Edit</Button>
                  {p.active ? <Button size="sm" variant="ghost" onClick={() => setArchive(p)}>Archive</Button> : <Button size="sm" variant="ghost" onClick={() => void save({ ...p, active: true }, `${p.name} restored`)}>Restore</Button>}
                </div>
              )}
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Rules and build-your-own prices" sub="Apply to every subscription. Prices are monthly, before tax.">
        <Block k="pricing" title="Pricing & trial" sub="Saved together." data={pricing} meta={s.data.meta.pricing} perm={w}>
          {(v, set) => <PricingForm v={v} set={set} />}
        </Block>
      </Section>

      {edit && <PlanEditor plan={edit === "new" ? null : edit} taken={plans.map((p) => p.id)} onClose={() => setEdit(null)} onSave={async (p) => { if (await save(p, `${p.name} saved`)) setEdit(null); }} />}
      <Dialog
        open={!!archive}
        onClose={() => setArchive(null)}
        size="sm"
        title={`Archive ${archive?.name ?? ""}?`}
        description="New workspaces can't choose it any more. Existing subscribers keep it, at the price they bought it at, until they change plan."
        footer={<><Button onClick={() => setArchive(null)}>Cancel</Button><Button variant="danger" onClick={async () => { if (archive && (await save({ ...archive, active: false }, `${archive.name} archived`))) setArchive(null); }}>Archive</Button></>}
      />
    </div>
  );
}

function PricingForm({ v, set }: { v: Pricing; set: (p: Partial<Pricing>) => void }) {
  const int = (s: string) => (s === "" ? 0 : Math.trunc(Number(s)));
  return (
    <div className="space-y-5">
      <div className={cx("rounded-[14px] border p-3", v.enforce ? "border-border" : "border-warning bg-warning-soft")}>
        <label className="flex items-start justify-between gap-3 text-[13px]">
          <span><b className="font-medium">Enforce subscriptions</b><span className="block text-xs text-muted">On: trials end, unpaid workspaces become read-only, and plans limit features. Off: no restrictions anywhere — everyone can use everything, as before subscriptions existed. Switching it on applies at once to every workspace.</span></span>
          <Switch label="Enforce subscriptions" checked={v.enforce} onChange={(x) => set({ enforce: x })} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="After the trial" hint={v.freePlan ? "Workspaces move to the Free plan" : "Workspaces become read-only"}>{(a) => <Select {...a} value={v.freePlan ? "free" : "readonly"} onChange={(e) => set({ freePlan: e.target.value === "free" })}><option value="free">Free plan</option><option value="readonly">Read-only</option></Select>}</Field>
        {(["invoicesPerMonth", "contacts", "aiPerMonth"] as const).map((k) => <Field key={k} label={`Trial: ${k === "invoicesPerMonth" ? "invoices a month" : k === "contacts" ? "CRM contacts" : "AI requests a month"}`} hint="Fair use. Empty = unlimited">{(a) => <Input {...a} type="number" min={0} value={v.trialQuotas?.[k] ?? ""} onChange={(e) => { const q = { ...(v.trialQuotas ?? {}) }; if (e.target.value === "") delete q[k]; else q[k] = int(e.target.value); set({ trialQuotas: q }); }} />}</Field>)}
        <Field label="Free trial (days)" hint="Every feature. 0 = no trial.">{(a) => <Input {...a} type="number" min={0} max={365} value={v.trialDays} onChange={(e) => set({ trialDays: int(e.target.value) })} />}</Field>
        <Field label="Tax %" hint="Added to every invoice.">{(a) => <Input {...a} type="number" min={0} max={50} step="0.01" value={v.taxBps / 100} onChange={(e) => set({ taxBps: Math.round(Number(e.target.value || 0) * 100) })} />}</Field>
        <Field label="Tax label">{(a) => <Input {...a} maxLength={20} value={v.taxLabel} onChange={(e) => set({ taxLabel: e.target.value })} />}</Field>
        <Field label="A year costs (months)" hint={`${12 - v.yearlyMonths} month${12 - v.yearlyMonths === 1 ? "" : "s"} free on built plans.`}>{(a) => <Input {...a} type="number" min={1} max={12} value={v.yearlyMonths} onChange={(e) => set({ yearlyMonths: int(e.target.value) })} />}</Field>
        <Field label="Grace days" hint="After a missed renewal, before read-only.">{(a) => <Input {...a} type="number" min={0} max={60} value={v.graceDays} onChange={(e) => set({ graceDays: int(e.target.value) })} />}</Field>
        <Field label="Renewal notice (days)" hint="Renewal invoices are raised this early.">{(a) => <Input {...a} type="number" min={1} max={30} value={v.renewalNoticeDays} onChange={(e) => set({ renewalNoticeDays: int(e.target.value) })} />}</Field>
      </div>
      <div className="space-y-3">
        <h4 className="text-[13.5px] font-semibold">Build your own plan</h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Base price / month">{(a) => <MoneyInput {...a} value={v.customBase} onChange={(p) => set({ customBase: p ?? 0 })} />}</Field>
          <Field label="Seats included">{(a) => <Input {...a} type="number" min={1} max={1000} value={v.customSeatsIncluded} onChange={(e) => set({ customSeatsIncluded: int(e.target.value) })} />}</Field>
          <Field label="Each extra seat / month">{(a) => <MoneyInput {...a} value={v.seatPrice} onChange={(p) => set({ seatPrice: p ?? 0 })} />}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Web apps">{(a) => <Input {...a} type="number" min={0} value={v.customLimits.projects} onChange={(e) => set({ customLimits: { ...v.customLimits, projects: int(e.target.value) } })} />}</Field>
          <Field label="Custom domains">{(a) => <Input {...a} type="number" min={0} value={v.customLimits.customDomains} onChange={(e) => set({ customLimits: { ...v.customLimits, customDomains: int(e.target.value) } })} />}</Field>
          <Field label="Automations per web app">{(a) => <Input {...a} type="number" min={0} value={v.customLimits.automationsPerProject} onChange={(e) => set({ customLimits: { ...v.customLimits, automationsPerProject: int(e.target.value) } })} />}</Field>
        </div>
        <p className="text-[12.5px] text-muted">Feature prices, per month. Tick “In base” for features included in the base price. Leave a price empty and that feature can&apos;t be added to a built plan.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {MODULE_GROUPS.map((g) => {
            const mods = MODULES.filter((m) => m.group === g.id);
            if (!mods.length) return null;
            return (
              <div key={g.id} className="overflow-x-auto rounded-[12px] border border-border">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-xs text-subtle"><tr><th className="px-3 py-2 font-medium">{g.label}</th><th className="px-2 py-2 font-medium">In base</th><th className="w-36 px-3 py-2 font-medium">Price</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {mods.map((m) => {
                      const base = v.customBaseModules.includes(m.id);
                      return (
                        <tr key={m.id}>
                          <td className="px-3 py-1.5">{m.name}</td>
                          <td className="px-2 py-1.5"><input type="checkbox" aria-label={`${m.name} in the base`} checked={base} onChange={(e) => set({ customBaseModules: e.target.checked ? MODULE_IDS.filter((x) => x === m.id || v.customBaseModules.includes(x)) : v.customBaseModules.filter((x) => x !== m.id) })} /></td>
                          <td className="px-3 py-1.5">
                            {base ? <span className="text-muted">Included</span> : (
                              <MoneyInput
                                aria-label={`${m.name} price per month`}
                                placeholder="not sold"
                                value={v.modulePrices[m.id] ?? null}
                                onChange={(p) => {
                                  const next = { ...v.modulePrices };
                                  if (p === null) delete next[m.id];
                                  else next[m.id] = p;
                                  set({ modulePrices: next });
                                }}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const blank = (): CatalogPlan => ({ id: "", name: "", tagline: "", kind: "preset", modules: [], limits: { projects: 3, seats: 5, customDomains: 1, automationsPerProject: 10 }, monthly: 0, yearly: 0, currency: "INR", highlight: false, active: true, sort: 10 });

function PlanEditor({ plan, taken, onClose, onSave }: { plan: CatalogPlan | null; taken: string[]; onClose: () => void; onSave: (p: CatalogPlan) => Promise<void> }) {
  const [p, setP] = useState<CatalogPlan>(() => plan ? structuredClone(plan) : blank());
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<CatalogPlan>) => setP({ ...p, ...x });
  const isNew = !plan;
  const idErr = isNew && p.id && (!/^[a-z0-9-]{2,30}$/.test(p.id) || p.id === "custom" || p.id === "trial") ? "2–30 lowercase letters, digits or dashes (not “custom” or “trial”)" : isNew && taken.includes(p.id) ? "A plan with this id exists" : "";
  const errors = [
    !p.name.trim() && "Give it a name",
    isNew && !p.id && "Give it an id",
    idErr,
    p.monthly < 100 && "Monthly price is at least ₹1",
    p.yearly < 100 && "Yearly price is at least ₹1",
    p.modules !== null && !p.modules.length && "Pick at least one feature, or every feature",
  ].filter(Boolean) as string[];
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={isNew ? "New plan" : `Edit ${plan.name}`}
      description={isNew ? "Adds a plan workspaces can choose." : "Changes apply to new subscriptions and changes of plan. Existing subscribers keep what they bought."}
      footer={<><span className="mr-auto self-center text-[12.5px] text-danger">{errors[0] ?? ""}</span><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={errors.length > 0} onClick={async () => { setBusy(true); await onSave({ ...p, name: p.name.trim(), tagline: p.tagline.trim() }); setBusy(false); }}>Save plan</Button></>}
    >
      <div className="space-y-5 text-[13px]" data-testid="plan-editor">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {isNew && <Field label="Id" hint="Used in links; can't change later." error={idErr || undefined}>{(a) => <Input {...a} value={p.id} placeholder="e.g. clinic-plus" onChange={(e) => set({ id: e.target.value.toLowerCase() })} />}</Field>}
          <Field label="Name">{(a) => <Input {...a} maxLength={40} value={p.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
          <Field label="Kind">{(a) => <Select {...a} value={p.kind} onChange={(e) => set({ kind: e.target.value as CatalogPlan["kind"] })}><option value="preset">Full plan</option><option value="basic">Basic (one area)</option><option value="free">Free (what workspaces have without paying)</option></Select>}</Field>
          <Field label="Order" hint="Lower shows first.">{(a) => <Input {...a} type="number" min={0} max={1000} value={p.sort} onChange={(e) => set({ sort: Math.trunc(Number(e.target.value || 0)) })} />}</Field>
        </div>
        <Field label="Tagline">{(a) => <Textarea {...a} rows={2} maxLength={120} value={p.tagline} onChange={(e) => set({ tagline: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Price per month" hint="Before tax, INR.">{(a) => <MoneyInput {...a} value={p.monthly || null} onChange={(x) => set({ monthly: x ?? 0 })} />}</Field>
          <Field label="Price per year" hint={p.monthly ? `${(p.yearly / p.monthly).toFixed(1)} × monthly` : undefined}>{(a) => <MoneyInput {...a} value={p.yearly || null} onChange={(x) => set({ yearly: x ?? 0 })} />}</Field>
          <label className="flex items-center gap-2 self-end pb-2"><Switch label="Highlight" checked={p.highlight} onChange={(x) => set({ highlight: x })} /> Highlight as recommended</label>
          <label className="flex items-center gap-2 self-end pb-2"><Switch label="Available" checked={p.active} onChange={(x) => set({ active: x })} /> Available to choose</label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {QUOTAS.map(([k, label]) => <Field key={k} label={label} hint="Empty = unlimited">{(a) => <Input {...a} type="number" min={0} value={p.quotas?.[k] ?? ""} onChange={(e) => { const q = { ...(p.quotas ?? {}) }; if (e.target.value === "") delete q[k]; else q[k] = Math.trunc(Number(e.target.value)); set({ quotas: q }); }} />}</Field>)}
        </div>
        {p.kind === "free" && <Notice>The Free plan costs ₹0 and needs a list of features (not every feature). Workspaces move to it when a trial or subscription ends without payment.</Notice>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LIMITS.map(([k, label]) => <Field key={k} label={label}>{(a) => <Input {...a} type="number" min={0} max={100000} value={p.limits[k]} onChange={(e) => set({ limits: { ...p.limits, [k]: Math.trunc(Number(e.target.value || 0)) } })} />}</Field>)}
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 font-medium"><Switch label="Every feature" checked={p.modules === null} onChange={(x) => set({ modules: x ? null : [] })} /> Every feature (including ones added later)</label>
          {p.modules !== null && <ModulePicker value={p.modules as ModuleId[]} onChange={(m) => set({ modules: m })} />}
          {p.modules !== null && <p className="text-[12.5px] text-muted">{p.modules.length} picked. Features another one needs are added with it.</p>}
        </div>
        {plan && plan.active && !p.active && <Notice tone="warning">Archiving: new workspaces can&apos;t choose it; existing subscribers keep it.</Notice>}
        <p className="text-[12.5px] text-muted">{money(p.monthly || 0, p.currency)}/month · {money(p.yearly || 0, p.currency)}/year. Saving asks for your password if you haven&apos;t entered it in the last 15 minutes.</p>
      </div>
    </Dialog>
  );
}
