"use client";

// Platform settings, edited section by section: general details, sign-up
// rules, admin security, maintenance mode and the announcement banner. Plans,
// prices and the free trial live in Plans & pricing (plans.tsx), which reuses
// the section editor below. Each section saves on its own and is audited.
import { useState, type ReactNode } from "react";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import type { Pricing } from "@/lib/billing/catalog";
import { useAdmin, useCan, useRun } from "./common";

export type S = {
  general: { productName: string; supportEmail: string; statusPageUrl: string; termsUrl: string; privacyUrl: string };
  signup: { mode: "open" | "invite" | "closed"; allowedDomains: string[]; blockedDomains: string[]; trialPlan: string; trialDays: number };
  security: { adminMfaRequired: boolean; adminIpAllowlist: string[] };
  maintenance: { enabled: boolean; message: string };
  announcement: { enabled: boolean; tone: "info" | "success" | "warning"; text: string; link: string; audience: string; endsAt: string | null };
  pricing: Pricing;
  legal: Legal;
};
type Legal = { companyName: string; registeredAddress: string; cin: string; gstin: string; contactEmail: string; contactPhone: string; grievanceName: string; grievanceEmail: string; grievancePhone: string; dpoName: string; dpoEmail: string; euRepresentative: string; jurisdiction: string; effectiveDate: string };
type Res = { settings: S; meta: Record<string, { updatedAt: string; by: string | null }> };

const lines = (v: string[]) => v.join("\n");
const unlines = (v: string) => v.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

/** A one-per-line list that keeps what's typed (blank lines included) while saving the cleaned list. */
function ListBox({ value, onChange, className, ...a }: { value: string[]; onChange: (v: string[]) => void; className?: string; id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) {
  const [text, setText] = useState(lines(value));
  const [base, setBase] = useState(value);
  if (base !== value && JSON.stringify(unlines(text)) !== JSON.stringify(value)) {
    setBase(value);
    setText(lines(value));
  }
  return <Textarea {...a} rows={3} className={className} value={text} onChange={(e) => { setText(e.target.value); onChange(unlines(e.target.value)); }} />;
}

/** One editable section with its own Save. */
export function Block<K extends keyof S>({ k, title, sub, data, meta, perm, children }: { k: K; title: string; sub: string; data: S[K]; meta?: { updatedAt: string; by: string | null }; perm: boolean; children: (v: S[K], set: (p: Partial<S[K]>) => void) => ReactNode }) {
  const [v, setV] = useState(data);
  const [base, setBase] = useState(data);
  const run = useRun();
  const [saving, setSaving] = useState(false);
  // Fresh data from the server (after a save, or another admin's change) resets the form.
  if (base !== data) {
    setBase(data);
    setV(data);
  }
  const dirty = JSON.stringify(v) !== JSON.stringify(data);
  return (
    <Card className="p-5" data-testid={`settings-${String(k)}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <p className="text-[12.5px] text-muted">{sub}</p>
          {meta && <p className="mt-0.5 text-[11.5px] text-subtle">Last changed {dateTime(meta.updatedAt)}{meta.by ? ` by ${meta.by}` : ""}</p>}
        </div>
        {perm && <Button variant="primary" size="sm" disabled={!dirty} loading={saving} onClick={async () => { setSaving(true); await run(`settings/${k}`, "PUT", v, `${title} saved`); setSaving(false); }}>Save</Button>}
      </div>
      <fieldset disabled={!perm} className="grid gap-3">{children(v, (p) => setV({ ...v, ...p }))}</fieldset>
    </Card>
  );
}

export function useSettings() {
  return useAdmin<Res>("settings");
}

export function SettingsPanel() {
  const q = useSettings();
  const can = useCan();
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { settings: s, meta } = q.data;
  const w = can("settings:write");
  return (
    <div className="space-y-5">
      {!w && <Notice>Only platform owners can change settings.</Notice>}
      <Block k="general" title="General" sub="How the product presents itself and where people get help." data={s.general} meta={meta.general} perm={w}>
        {(v, set) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product name">{(a) => <Input {...a} value={v.productName} onChange={(e) => set({ productName: e.target.value })} />}</Field>
            <Field label="Support email">{(a) => <Input {...a} type="email" value={v.supportEmail} onChange={(e) => set({ supportEmail: e.target.value })} />}</Field>
            <Field label="Status page">{(a) => <Input {...a} value={v.statusPageUrl} placeholder="https://status.…" onChange={(e) => set({ statusPageUrl: e.target.value })} />}</Field>
            <Field label="Terms of service">{(a) => <Input {...a} value={v.termsUrl} placeholder="https://" onChange={(e) => set({ termsUrl: e.target.value })} />}</Field>
            <Field label="Privacy policy">{(a) => <Input {...a} value={v.privacyUrl} placeholder="https://" onChange={(e) => set({ privacyUrl: e.target.value })} />}</Field>
          </div>
        )}
      </Block>
      <Block k="signup" title="Sign-up" sub="Who can make an account." data={s.signup} meta={meta.signup} perm={w}>
        {(v, set) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who can sign up">
              {(a) => (
                <Select {...a} value={v.mode} onChange={(e) => set({ mode: e.target.value as S["signup"]["mode"] })}>
                  <option value="open">Anyone</option><option value="invite">Only people invited to a workspace</option><option value="closed">Nobody (closed)</option>
                </Select>
              )}
            </Field>
            <p className="self-end pb-2 text-[12.5px] text-muted" data-testid="trial-pointer">
              Free trial: {s.pricing.trialDays ? `${s.pricing.trialDays} days of everything` : "none"} — change in <a href="#plans" className="font-medium text-fg underline underline-offset-2">Plans &amp; pricing</a>
            </p>
            <Field label="Only these email domains" hint="One per line. Empty: any domain. Invited people are always let in.">{(a) => <ListBox {...a} value={v.allowedDomains} onChange={(x) => set({ allowedDomains: x })} />}</Field>
            <Field label="Blocked email domains" hint="One per line, e.g. disposable-mail services.">{(a) => <ListBox {...a} value={v.blockedDomains} onChange={(x) => set({ blockedDomains: x })} />}</Field>
          </div>
        )}
      </Block>
      <Block k="security" title="Admin security" sub="Who can reach this console, and how they must sign in." data={s.security} meta={meta.security} perm={w}>
        {(v, set) => (
          <>
            <label className="flex items-start justify-between gap-3 text-[13px]">
              <span>Require two-step sign-in for admins<span className="block text-xs text-muted">Admins without it are refused until they turn it on. Turn yours on first.</span></span>
              <Switch label="Require two-step sign-in for admins" checked={v.adminMfaRequired} onChange={(x) => set({ adminMfaRequired: x })} />
            </label>
            <Field label="Allowed addresses" hint="One IP or IPv4 range (10.0.0.0/8) per line. Empty: anywhere. Include your own address, or you'll lock yourself out. Needs a proxy that sets X-Forwarded-For.">
              {(a) => <ListBox {...a} className="font-mono" value={v.adminIpAllowlist} onChange={(x) => set({ adminIpAllowlist: x })} />}
            </Field>
          </>
        )}
      </Block>
      {s.legal && (
        <Block k="legal" title="Legal & company details" sub="Shown on the public Terms, Privacy, Grievance, Contact and Security pages. Empty fields are left out of the pages — nothing is made up." data={s.legal} meta={meta.legal} perm={w}>
          {(v, set) => <LegalFields v={v} set={set} supportEmail={s.general.supportEmail} />}
        </Block>
      )}
    </div>
  );
}

/** What the public legal pages still lack; the Grievance Officer is required for Indian intermediaries (IT Rules 2021, rule 3(2)). */
function legalGaps(v: Legal, supportEmail: string) {
  const gaps: { label: string; why: string; required?: boolean }[] = [];
  if (!v.grievanceName) gaps.push({ label: "Grievance Officer name", why: "IT Rules 2021, rule 3(2) and the DPDP Act", required: true });
  if (!v.grievanceEmail && !v.contactEmail && !supportEmail) gaps.push({ label: "Grievance Officer email", why: "complaints need a published contact", required: true });
  if (!v.companyName) gaps.push({ label: "Company name", why: "who the Terms are with" });
  if (!v.registeredAddress) gaps.push({ label: "Registered address", why: "IT Rules and E-Commerce Rules expect it published" });
  if (!v.contactEmail && !supportEmail) gaps.push({ label: "Contact email", why: "privacy requests, refunds and security reports" });
  if (!v.jurisdiction) gaps.push({ label: "Courts (jurisdiction)", why: "the Terms fall back to \"the courts at the registered office\"" });
  if (!v.effectiveDate) gaps.push({ label: "Effective date", why: "the pages show the date the text was last revised" });
  return gaps;
}

function LegalFields({ v, set, supportEmail }: { v: Legal; set: (p: Partial<Legal>) => void; supportEmail: string }) {
  const gaps = legalGaps(v, supportEmail);
  const required = gaps.filter((g) => g.required);
  return (
    <>
      {gaps.length ? (
        <Notice tone="warning" title={required.length ? "Before go-live: the Grievance Officer is required" : "Some legal details are still empty"}>
          <ul className="mt-1 list-disc space-y-0.5 pl-5" data-testid="legal-gaps">
            {gaps.map((g) => (
              <li key={g.label}><span className="font-medium">{g.label}</span>{g.required ? " (required)" : ""} — {g.why}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <p className="flex items-center gap-2 text-[12.5px] text-muted"><Badge tone="success">Complete</Badge> Every legal detail the public pages use is filled in.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name" hint="The registered legal name, e.g. ending in Private Limited or LLP.">{(a) => <Input {...a} value={v.companyName} onChange={(e) => set({ companyName: e.target.value })} />}</Field>
        <Field label="Courts (jurisdiction)" hint="City and state, e.g. Bengaluru, Karnataka.">{(a) => <Input {...a} value={v.jurisdiction} onChange={(e) => set({ jurisdiction: e.target.value })} />}</Field>
        <Field label="Registered address" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={v.registeredAddress} onChange={(e) => set({ registeredAddress: e.target.value })} />}</Field>
        <Field label="CIN / LLPIN">{(a) => <Input {...a} value={v.cin} onChange={(e) => set({ cin: e.target.value })} />}</Field>
        <Field label="GSTIN">{(a) => <Input {...a} value={v.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />}</Field>
        <Field label="Legal contact email" hint={supportEmail ? `Empty: the support email (${supportEmail}) is used.` : "Also the security contact in security.txt."}>{(a) => <Input {...a} type="email" value={v.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />}</Field>
        <Field label="Contact phone">{(a) => <Input {...a} value={v.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} />}</Field>
      </div>
      <p className="mt-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Grievance Officer</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name">{(a) => <Input {...a} value={v.grievanceName} onChange={(e) => set({ grievanceName: e.target.value })} />}</Field>
        <Field label="Email" hint="Empty: the legal contact email.">{(a) => <Input {...a} type="email" value={v.grievanceEmail} onChange={(e) => set({ grievanceEmail: e.target.value })} />}</Field>
        <Field label="Phone">{(a) => <Input {...a} value={v.grievancePhone} onChange={(e) => set({ grievancePhone: e.target.value })} />}</Field>
      </div>
      <p className="mt-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Privacy</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data protection officer / privacy contact">{(a) => <Input {...a} value={v.dpoName} onChange={(e) => set({ dpoName: e.target.value })} />}</Field>
        <Field label="Privacy email" hint="Empty: the legal contact email.">{(a) => <Input {...a} type="email" value={v.dpoEmail} onChange={(e) => set({ dpoEmail: e.target.value })} />}</Field>
        <Field label="EU/UK representative (GDPR Art. 27)" hint="Only if you've appointed one: name and address." className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={v.euRepresentative} onChange={(e) => set({ euRepresentative: e.target.value })} />}</Field>
        <Field label="Policies effective from" hint="Shown as the effective date on every policy.">{(a) => <Input {...a} type="date" value={v.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />}</Field>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">
        The policy texts (<a className="underline" href="/terms" target="_blank" rel="noreferrer">Terms</a>, <a className="underline" href="/privacy" target="_blank" rel="noreferrer">Privacy</a>, <a className="underline" href="/refunds" target="_blank" rel="noreferrer">Refunds</a>, <a className="underline" href="/dpa" target="_blank" rel="noreferrer">DPA</a>, <a className="underline" href="/legal" target="_blank" rel="noreferrer">all pages</a>) are a starting point written for how this product works. Have them reviewed by a qualified lawyer for your company and jurisdictions before relying on them.
      </p>
    </>
  );
}

export function NoticesPanel() {
  const q = useSettings();
  const can = useCan();
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (!q.data) return <Skeleton className="h-60" />;
  const { settings: s, meta } = q.data;
  const w = can("notices:write");
  return (
    <div className="space-y-5">
      <Block k="maintenance" title="Maintenance mode" sub="Workspaces become read-only and show this message. Signing in, published sites and stores keep working; platform admins can still make changes." data={s.maintenance} meta={meta.maintenance} perm={w}>
        {(v, set) => (
          <>
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-2">Maintenance mode {s.maintenance.enabled && <Badge tone="warning">On now</Badge>}</span>
              <Switch label="Maintenance mode" checked={v.enabled} onChange={(x) => set({ enabled: x })} />
            </label>
            <Field label="Message">{(a) => <Input {...a} value={v.message} onChange={(e) => set({ message: e.target.value })} />}</Field>
          </>
        )}
      </Block>
      <Block k="announcement" title="Announcement" sub="A banner across the top of the app for everyone, or for workspaces on one plan." data={s.announcement} meta={meta.announcement} perm={w}>
        {(v, set) => (
          <>
            <label className="flex items-center justify-between gap-3 text-[13px]"><span>Show the announcement</span><Switch label="Show the announcement" checked={v.enabled} onChange={(x) => set({ enabled: x })} /></label>
            <Field label="Text">{(a) => <Input {...a} value={v.text} maxLength={300} onChange={(e) => set({ text: e.target.value })} />}</Field>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tone">{(a) => <Select {...a} value={v.tone} onChange={(e) => set({ tone: e.target.value as S["announcement"]["tone"] })}><option value="info">Information</option><option value="success">Good news</option><option value="warning">Warning</option></Select>}</Field>
              <Field label="Who sees it">{(a) => <Select {...a} value={v.audience} onChange={(e) => set({ audience: e.target.value })}><option value="all">Everyone</option><option value="free">Free workspaces</option><option value="pro">Pro workspaces</option><option value="business">Business workspaces</option></Select>}</Field>
              <Field label="Link (optional)">{(a) => <Input {...a} value={v.link} placeholder="https://" onChange={(e) => set({ link: e.target.value })} />}</Field>
              <Field label="Ends (optional)">{(a) => <Input {...a} type="datetime-local" value={v.endsAt ? v.endsAt.slice(0, 16) : ""} onChange={(e) => set({ endsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />}</Field>
            </div>
          </>
        )}
      </Block>
    </div>
  );
}
