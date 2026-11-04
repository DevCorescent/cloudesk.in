"use client";

// A workspace's allowances in the console: what it has used of each (this month,
// or in total), its limit, and the platform team's overrides on top of its plan —
// features added, limits raised or lowered, allowances changed or made
// unlimited. Saved overrides are on the timeline and in the audit log.
import { useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, Field, Input, Notice, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { QUOTA_KEYS, QUOTA_LABEL, type QuotaKey } from "@/lib/billing/catalog";
import type { Overrides } from "@/lib/billing/schema";
import { moduleById, type ModuleId } from "@/lib/workspace/modules";
import { num, Section, useAdmin, useRun } from "./common";
import { ModulePicker } from "./subscriptions";

type Allowances = {
  state: string;
  plan: string;
  modules: string[] | null;
  limits: { projects: number; seats: number; customDomains: number; automationsPerProject: number };
  overrides: Partial<Overrides>;
  quotas: { key: QuotaKey; name: string; unit: string; used: number; limit: number | null }[];
};

const LIMITS = [["projects", "Web apps"], ["seats", "Seats"], ["customDomains", "Custom domains"], ["automationsPerProject", "Automations per web app"]] as const;
const show = (k: QuotaKey, n: number) => (k === "aiBudgetUsd" ? `$${n.toFixed(2)}` : k === "storageMb" ? (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`) : num(Math.round(n)));

export function AllowancesSection({ orgId, write }: { orgId: string; write: boolean }) {
  const q = useAdmin<Allowances>(`subscriptions/${orgId}/allowances`);
  const [open, setOpen] = useState(false);
  const d = q.data;
  const o = d?.overrides ?? {};
  const has = !!(o.modules?.length || Object.keys(o.limits ?? {}).length || Object.keys(o.quotas ?? {}).length);
  return (
    <Section title="Allowances & overrides" sub="What the workspace has used of each allowance, and anything the platform team set on top of its plan." actions={write && d && <Button size="sm" onClick={() => setOpen(true)}>{has ? "Edit overrides" : "Override"}</Button>}>
      {!d ? <Skeleton className="h-40" /> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="allowances">
            {d.quotas.map((x) => {
              const pct = x.limit ? Math.min(100, (x.used / x.limit) * 100) : 0;
              const changed = o.quotas && x.key in o.quotas;
              return (
                <Card key={x.key} className="p-3">
                  <p className="flex items-center justify-between gap-2 text-[12px] text-muted">{x.name}{changed && <Badge tone="accent">Override</Badge>}</p>
                  <p className="mt-1 text-[15px] font-semibold tabular-nums">{show(x.key, x.used)} <span className="text-[12px] font-normal text-muted">/ {x.limit === null ? "unlimited" : show(x.key, x.limit)}</span></p>
                  {x.limit !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={cx("h-full rounded-full", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success")} style={{ width: `${pct}%` }} /></div>}
                </Card>
              );
            })}
          </div>
          {has && (
            <Notice title="Overrides in place">
              {[o.modules?.length ? `Added: ${o.modules.map((m) => moduleById(m as ModuleId)?.name ?? m).join(", ")}` : "", Object.entries(o.limits ?? {}).map(([k, v]) => `${k} ${num(v as number)}`).join(", "), Object.entries(o.quotas ?? {}).map(([k, v]) => `${QUOTA_LABEL[k as QuotaKey]?.name ?? k}: ${v === null ? "unlimited" : show(k as QuotaKey, v as number)}`).join(", "), o.note ? `“${o.note}”` : ""].filter(Boolean).join(" · ")}
            </Notice>
          )}
          {open && <OverridesEditor orgId={orgId} d={d} onClose={() => setOpen(false)} />}
        </>
      )}
    </Section>
  );
}

function OverridesEditor({ orgId, d, onClose }: { orgId: string; d: Allowances; onClose: () => void }) {
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const [modules, setModules] = useState<ModuleId[]>((d.overrides.modules ?? []) as ModuleId[]);
  const [limits, setLimits] = useState<Record<string, number>>({ ...(d.overrides.limits ?? {}) } as Record<string, number>);
  const [quotas, setQuotas] = useState<Record<string, number | null>>({ ...(d.overrides.quotas ?? {}) } as Record<string, number | null>);
  const [note, setNote] = useState(d.overrides.note ?? "");
  const planLimit = (k: QuotaKey) => d.quotas.find((x) => x.key === k)?.limit ?? null;
  const save = async (clear = false) => {
    setBusy(true);
    const overrides = clear ? { modules: [], limits: {}, quotas: {}, note: "" } : { modules, limits, quotas, note };
    const ok = await run(`subscriptions/${orgId}`, "POST", { action: "set_overrides", overrides }, clear ? "Overrides removed" : "Overrides saved");
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Overrides for this workspace"
      description={`On top of ${d.plan || "its plan"}. Leave a field empty to keep the plan's. They stay until you remove them, whatever plan the workspace moves to.`}
      footer={<><Button variant="ghost" className="mr-auto" onClick={() => void save(true)} disabled={busy}>Remove all</Button><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save overrides</Button></>}
    >
      <div className="space-y-5 text-[13px]" data-testid="overrides-editor">
        <div className="space-y-2">
          <h4 className="font-semibold">Allowances</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUOTA_KEYS.map((k) => {
              const v = quotas[k];
              const plan = planLimit(k);
              return (
                <Field key={k} label={QUOTA_LABEL[k].name} hint={v === null ? "Unlimited (override)" : `Plan: ${plan === null ? "unlimited" : show(k, plan)}`}>
                  {(a) => (
                    <div className="flex gap-1.5">
                      <Input {...a} type="number" min={0} step={k === "aiBudgetUsd" ? "0.01" : "1"} value={typeof v === "number" ? v : ""} placeholder={v === null ? "∞" : "plan"} onChange={(e) => { const next = { ...quotas }; if (e.target.value === "") delete next[k]; else next[k] = k === "aiBudgetUsd" ? Math.round(Number(e.target.value) * 100) / 100 : Math.trunc(Number(e.target.value)); setQuotas(next); }} />
                      <Button size="sm" variant={v === null ? "primary" : "ghost"} aria-pressed={v === null} onClick={() => { const next = { ...quotas }; if (v === null) delete next[k]; else next[k] = null; setQuotas(next); }}>∞</Button>
                    </div>
                  )}
                </Field>
              );
            })}
          </div>
        </div>
        <div className="space-y-2">
          <h4 className="font-semibold">Limits</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LIMITS.map(([k, label]) => (
              <Field key={k} label={label} hint={`Plan: ${num(d.limits[k])}`}>
                {(a) => <Input {...a} type="number" min={0} max={100000} value={limits[k] ?? ""} placeholder="plan" onChange={(e) => { const next = { ...limits }; if (e.target.value === "") delete next[k]; else next[k] = Math.trunc(Number(e.target.value)); setLimits(next); }} />}
              </Field>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <h4 className="font-semibold">Extra features</h4>
          {d.modules === null ? <p className="text-muted">The plan already includes every feature.</p> : <ModulePicker value={modules} onChange={setModules} />}
        </div>
        <Field label="Note" hint="Why — shown on the timeline.">{(a) => <Textarea {...a} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
