"use client";

// Adding a mailbox, with a hand on the shoulder all the way: we work out the
// provider from the address (or let you pick), show exactly what to switch on
// and where to get an app password, sign in (or "Sign in with Google /
// Microsoft"), test the connection step by step with plain fixes for each
// failure, and let you name, colour and share the mailbox before it syncs.
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, ExternalLink, Eye, EyeOff, Inbox, Loader2, Lock, Mail, Shield, Sparkles, Users, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, Notice, Switch, cx } from "@/components/ui/primitives";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import type { AccountOut, CheckOut, ConnectIn, DetectOut, FailKind, MetaOut } from "@/lib/mail/api";
import { PROVIDERS, providerForAddress, providerOf, type ProviderId } from "@/lib/mail/model";
import { colorFor, EMAIL, useMailApi, useMailRefresh } from "./shared";

const STEPS = ["Your address", "Get it ready", "Sign in", "Test", "Personalise"] as const;
export const SWATCHES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

/** A provider "logo" made from its initials and a colour — no external images. */
export function ProviderMark({ id, size = 36 }: { id: string; size?: number }) {
  const p = providerOf(id);
  const name = p?.name ?? id;
  const letters = id === "custom" ? "@" : name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-[10px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]" style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(140deg, ${colorFor(id + "x")}, ${colorFor(id)})` }}>
      {letters}
    </span>
  );
}

/** Explains a failed connection check in plain words, with what to try. */
function explain(side: { error?: string; kind?: FailKind }, which: "imap" | "smtp", provider: ProviderId): { title: string; fix: string } {
  const name = which === "imap" ? "IMAP" : "SMTP";
  switch (side.kind) {
    case "auth":
      return { title: "The password wasn't accepted", fix: providerOf(provider)?.password === false ? "This provider needs “Sign in with …” instead of a password." : "Use an app password, not your normal password — go back a step for how to create one. Check the address is typed exactly." };
    case "dns":
      return { title: `Couldn't find the ${name} server`, fix: `Check the ${name} server name under Advanced server settings — a typo here is the usual cause.` };
    case "network":
      return { title: "Couldn't reach the server", fix: `Check the ${name} port and SSL setting under Advanced server settings. Some networks block mail ports; port ${which === "imap" ? "993" : "465 or 587"} must be open.` };
    case "tls":
      return { title: "A secure connection couldn't be made", fix: which === "smtp" ? "Try port 587 with SSL off (it upgrades with STARTTLS), or 465 with SSL on." : "Try port 993 with SSL on, or ask your host for the right setting." };
    case "disabled":
      return { title: "IMAP is switched off for this mailbox", fix: "Turn on IMAP in your mail settings — see “Get it ready”." };
    default:
      return { title: which === "imap" ? "Couldn't read your mail" : "Couldn't send mail", fix: side.error || "Check the settings and try again." };
  }
}

type Form = { address: string; displayName: string; password: string; imapHost: string; imapPort: string; imapSecure: boolean; smtpHost: string; smtpPort: string; smtpSecure: boolean; username: string };

export function ConnectWizard({ meta, onClose, onConnected }: { meta: MetaOut; onClose: () => void; onConnected: (a: AccountOut) => void }) {
  const { base, call } = useMailApi();
  const refresh = useMailRefresh();
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectOut | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [f, setF] = useState<Form>({ address: "", displayName: meta.me.name, password: "", imapHost: "", imapPort: "993", imapSecure: true, smtpHost: "", smtpPort: "465", smtpSecure: true, username: "" });
  const [advanced, setAdvanced] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [check, setCheck] = useState<CheckOut | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]!);
  const [shared, setShared] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [syncDays, setSyncDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [done, setDone] = useState<AccountOut | null>(null);
  const p = provider ? providerOf(provider) : null;
  const oauthReady = !!(p?.oauth && meta.oauth[p.oauth]);
  const passwordBlocked = p?.password === false;

  const pick = (id: ProviderId) => {
    const pr = providerOf(id)!;
    setProvider(id);
    setChoosing(false);
    setTicks({});
    setF((x) => ({ ...x, address, username: address, imapHost: pr.imap?.host ?? "", imapPort: String(pr.imap?.port ?? 993), imapSecure: pr.imap?.secure ?? true, smtpHost: pr.smtp?.host ?? "", smtpPort: String(pr.smtp?.port ?? 465), smtpSecure: pr.smtp?.secure ?? true }));
    setAdvanced(id === "custom");
  };

  const detect = async () => {
    if (!EMAIL.test(address.trim())) return;
    setDetecting(true);
    try {
      const d = await call<DetectOut>(`detect?email=${encodeURIComponent(address.trim())}`);
      setDetected(d);
      pick(d.provider);
    } catch {
      const guess = providerForAddress(address) ?? "custom";
      setDetected({ provider: guess, via: "guess", mx: [] });
      pick(guess);
    } finally {
      setDetecting(false);
      setName(address.trim().split("@")[1]?.split(".")[0] ? `${address.trim().split("@")[0]}` : "");
      setColor(colorFor(address.trim()));
    }
  };

  const connectBody = (): ConnectIn => ({ provider: provider!, address: f.address.trim(), displayName: f.displayName.trim(), username: f.username.trim() || f.address.trim(), password: f.password.replace(provider === "gmail" || provider === "google_workspace" ? /\s+/g : /^$/, ""), imapHost: f.imapHost.trim(), imapPort: Number(f.imapPort), imapSecure: f.imapSecure, smtpHost: f.smtpHost.trim(), smtpPort: Number(f.smtpPort), smtpSecure: f.smtpSecure });

  const runCheck = async () => {
    setStep(3);
    setChecking(true);
    setCheck(null);
    setCheckErr(null);
    try {
      setCheck(await call<CheckOut>("accounts/check", "POST", connectBody()));
    } catch (e) {
      setCheckErr(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      const r = await call<{ account: AccountOut }>("accounts", "POST", { ...connectBody(), name: name.trim() || f.address.trim(), color, shared, members: shared ? members : [], syncDays });
      setDone(r.account);
      void refresh();
    } catch (e) {
      setSaveErr(e instanceof ApiClientError ? e.message : errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const signInReady = !!f.address && EMAIL.test(f.address) && !!f.password && !!f.imapHost && !!f.smtpHost && Number(f.imapPort) > 0 && Number(f.smtpPort) > 0;
  const allGood = !!check?.imap.ok && !!check?.smtp.ok;

  const footer = done ? (
    <Button variant="primary" icon={<Inbox className="size-4" />} onClick={() => { onConnected(done); onClose(); }}>Open my inbox</Button>
  ) : (
    <>
      {step > 0 && <Button icon={<ArrowLeft className="size-4" />} onClick={() => setStep(step === 4 ? 3 : step === 3 ? 2 : step - 1)}>Back</Button>}
      {step === 0 && <Button variant="primary" loading={detecting} disabled={!EMAIL.test(address.trim()) && !provider} onClick={() => (provider && detected ? setStep(1) : void detect().then(() => setStep(1)))}>Continue <ArrowRight className="size-4" /></Button>}
      {step === 1 && !passwordBlocked && <Button variant="primary" onClick={() => setStep(2)}>{Object.values(ticks).filter(Boolean).length >= (p?.steps.length ?? 0) ? "Done — next" : "I'm ready"} <ArrowRight className="size-4" /></Button>}
      {step === 2 && <Button variant="primary" disabled={!signInReady} onClick={() => void runCheck()}>Test the connection <ArrowRight className="size-4" /></Button>}
      {step === 3 && !checking && (allGood ? <Button variant="primary" onClick={() => setStep(4)}>Looks good — continue <ArrowRight className="size-4" /></Button> : <Button variant="primary" onClick={() => void runCheck()}>Try again</Button>)}
      {step === 4 && <Button variant="primary" loading={saving} onClick={() => void save()}>Connect mailbox</Button>}
    </>
  );

  return (
    <Dialog open onClose={onClose} size="xl" title={done ? "You're connected" : "Add a mailbox"} description={done ? undefined : "Connect any email account — we'll guide you through every step."} footer={footer}>
      <div data-testid="mail-connect-wizard" className="grid gap-6">
        {!done && (
          <ol className="flex flex-wrap items-center gap-1.5 text-[12px]" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5" aria-current={i === step ? "step" : undefined}>
                <span className={cx("grid size-5 place-items-center rounded-full text-[11px] font-semibold", i < step ? "bg-success text-white" : i === step ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>{i < step ? <Check className="size-3" /> : i + 1}</span>
                <span className={i === step ? "font-medium" : "text-muted"}>{s}</span>
                {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-5 bg-border sm:block" />}
              </li>
            ))}
          </ol>
        )}

        {done ? (
          <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
            <span className="grid size-14 place-items-center rounded-[18px] bg-success-soft text-success"><CheckCircle2 className="size-7" /></span>
            <div>
              <p className="text-[18px] font-semibold">{done.address} is connected</p>
              <p className="mt-1 text-[14px] text-muted">We&apos;re bringing in the last {syncDays} days of mail now. It usually takes a minute or two; newer mail arrives first.</p>
              <ul className="mt-4 grid gap-2.5 text-[13.5px]">
                {[
                  [<Sparkles key="a" className="size-4" />, "Sorted as it arrives", "Primary, People, Finance, Updates, Promotions, Newsletters, Social — and new senders wait in a screener."],
                  [<Shield key="b" className="size-4" />, "Watched for fakes", "Mail that pretends to be someone else, or fails its sender's checks, is flagged."],
                  [<Mail key="c" className="size-4" />, "Your rules run on every email", "Labels, archive, assign, create tickets or contacts — set them up in Settings → Rules."],
                ].map(([icon, t, d]) => (
                  <li key={t as string} className="flex gap-3"><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[9px] bg-surface-2 text-muted">{icon}</span><span><b className="font-medium">{t}</b><span className="block text-muted">{d}</span></span></li>
                ))}
              </ul>
            </div>
          </div>
        ) : step === 0 ? (
          <div className="grid gap-4">
            <Field label="Which email address do you want to connect?" hint="We'll work out the right settings for you.">
              {(a) => <Input {...a} type="email" autoFocus placeholder="you@yourcompany.com" value={address} onChange={(e) => { setAddress(e.target.value); setDetected(null); setProvider(null); }} onKeyDown={(e) => e.key === "Enter" && EMAIL.test(address.trim()) && void detect().then(() => setStep(1))} />}
            </Field>
            {detected && p && (
              <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-surface p-3.5">
                <ProviderMark id={p.id} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">{p.name}</p>
                  <p className="text-[12.5px] text-muted">{detected.via === "mx" ? `Found from your domain's mail records (${detected.mx[0] ?? "MX"})` : detected.via === "domain" ? "Recognised from the address" : "Couldn't tell for sure — check below"}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setChoosing(!choosing)}>Not right?</Button>
              </div>
            )}
            {(choosing || !detected) && (
              <div>
                <p className="mb-2 text-[12.5px] font-medium text-muted">{detected ? "Choose your provider" : "Or pick your provider"}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PROVIDERS.map((x) => (
                    <button key={x.id} type="button" onClick={() => { if (!address) setAddress(""); pick(x.id); setDetected({ provider: x.id, via: "guess", mx: [] }); }} className={cx("flex items-center gap-3 rounded-[14px] border p-3 text-left transition-colors hover:bg-surface-2", provider === x.id ? "border-accent bg-accent/5" : "border-border")}>
                      <ProviderMark id={x.id} size={32} />
                      <span className="min-w-0"><span className="block text-[13.5px] font-medium">{x.name}</span><span className="line-clamp-1 block text-[12px] text-muted">{x.line}</span></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : step === 1 && p ? (
          <div className="grid gap-5">
            <div className="flex items-center gap-3"><ProviderMark id={p.id} /><div><p className="text-[15px] font-semibold">Getting {p.name} ready</p><p className="text-[13px] text-muted">{f.address}</p></div></div>
            {p.oauth && (
              oauthReady ? (
                <div className="rounded-[18px] border border-accent/30 bg-accent/5 p-4">
                  <p className="flex items-center gap-2 text-[14px] font-semibold"><Sparkles className="size-4 text-accent" /> Recommended: sign in with {p.oauth === "google" ? "Google" : "Microsoft"}</p>
                  <p className="mt-1 text-[13px] text-muted">No app password needed — you approve access on {p.oauth === "google" ? "Google" : "Microsoft"}&apos;s own page, and can remove it there any time.</p>
                  <a href={`${base}/oauth/${p.oauth}/start?email=${encodeURIComponent(f.address)}`} className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-fg px-5 text-[14px] font-semibold text-bg hover:opacity-90">
                    Sign in with {p.oauth === "google" ? "Google" : "Microsoft"} <ExternalLink className="size-4" />
                  </a>
                  {!passwordBlocked && <p className="mt-3 text-[12px] text-muted">Prefer an app password? Follow the steps below instead.</p>}
                </div>
              ) : passwordBlocked ? (
                <Notice tone="warning" title="Microsoft sign-in isn't set up on this platform yet">Microsoft doesn&apos;t allow passwords for mail apps any more, so this mailbox can only be connected with “Sign in with Microsoft”. Ask your platform administrator to add Microsoft sign-in (Admin → Integrations). Meanwhile you can connect other mailboxes.</Notice>
              ) : null
            )}
            {!passwordBlocked && (
              <ol className="grid gap-3">
                {p.steps.map((s, i) => (
                  <li key={s.title} className={cx("flex gap-3 rounded-[16px] border p-4 transition-colors", ticks[i] ? "border-success/30 bg-success-soft/40" : "border-border")}>
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium">{s.title}</p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-3">
                        {s.link && <a href={s.link.href} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[12.5px] font-medium hover:bg-fg/10">{s.link.label} <ExternalLink className="size-3.5" /></a>}
                        <label className="inline-flex items-center gap-2 text-[12.5px] text-muted"><input type="checkbox" checked={!!ticks[i]} onChange={(e) => setTicks({ ...ticks, [i]: e.target.checked })} className="size-4 accent-[var(--accent)]" /> I&apos;ve done this</label>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {!passwordBlocked && p.id !== "custom" && (
              <details className="rounded-[14px] bg-surface-2 px-4 py-3 text-[13px]">
                <summary className="cursor-pointer font-medium">Why an app password?</summary>
                <p className="mt-2 text-muted">It&apos;s a separate password just for Cloudesk. Your real password stays private, two-step sign-in keeps protecting your account, and you can cancel this one password any time without changing anything else. We store it encrypted and never show it again.</p>
              </details>
            )}
          </div>
        ) : step === 2 && p ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email address">{(a) => <Input {...a} type="email" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value, username: f.username === f.address ? e.target.value : f.username })} />}</Field>
              <Field label="Your name on sent mail" hint="What people see as the sender">{(a) => <Input {...a} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
            </div>
            <Field label={p.id === "custom" || ["titan", "hostinger", "godaddy"].includes(p.id) ? "Password" : "App password"} hint={p.id === "gmail" || p.id === "google_workspace" ? "The 16-letter password from Google — spaces are fine." : "Stored encrypted; never shown again."}>
              {(a) => (
                <div className="relative">
                  <Input {...a} type={showPw ? "text" : "password"} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="pr-10" />
                  <button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw(!showPw)} className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2">{showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
                </div>
              )}
            </Field>
            <div className="rounded-[16px] border border-border">
              <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="flex w-full items-center justify-between px-4 py-3 text-[13.5px] font-medium">
                Advanced server settings {p.id !== "custom" && <span className="text-[12px] font-normal text-muted">— already filled in for {p.name}</span>}
                <ChevronDown className={cx("size-4 text-muted transition-transform", advanced && "rotate-180")} />
              </button>
              {advanced && (
                <div className="grid gap-3 border-t border-border p-4">
                  <Field label="User name" hint="Usually your full email address">{(a) => <Input {...a} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />}</Field>
                  {(["imap", "smtp"] as const).map((k) => (
                    <div key={k} className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
                      <Field label={k === "imap" ? "Incoming (IMAP) server" : "Outgoing (SMTP) server"}>{(a) => <Input {...a} placeholder={k === "imap" ? "imap.yourdomain.com" : "smtp.yourdomain.com"} value={k === "imap" ? f.imapHost : f.smtpHost} onChange={(e) => setF({ ...f, [k === "imap" ? "imapHost" : "smtpHost"]: e.target.value })} />}</Field>
                      <Field label="Port">{(a) => <Input {...a} inputMode="numeric" value={k === "imap" ? f.imapPort : f.smtpPort} onChange={(e) => setF({ ...f, [k === "imap" ? "imapPort" : "smtpPort"]: e.target.value.replace(/\D/g, "") })} />}</Field>
                      <label className="flex h-9 items-center gap-2 text-[13px]"><Switch label={`${k.toUpperCase()} SSL`} checked={k === "imap" ? f.imapSecure : f.smtpSecure} onChange={(v) => setF({ ...f, [k === "imap" ? "imapSecure" : "smtpSecure"]: v })} /> SSL</label>
                    </div>
                  ))}
                  <p className="text-[12px] text-muted">Common: IMAP 993 with SSL; SMTP 465 with SSL, or 587 with SSL off (STARTTLS).</p>
                </div>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-[12px] text-muted"><Lock className="size-3.5" /> Your password is encrypted and only used to read and send mail for you.</p>
          </div>
        ) : step === 3 ? (
          <CheckList check={check} checking={checking} error={checkErr} provider={provider!} />
        ) : step === 4 ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mailbox name" hint="How it appears in your inbox list">{(a) => <Input {...a} value={name} placeholder={f.address} onChange={(e) => setName(e.target.value)} />}</Field>
              <div>
                <p className="mb-1.5 text-[13px] font-medium">Colour</p>
                <div className="flex flex-wrap gap-2">
                  {SWATCHES.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} className={cx("size-7 rounded-full ring-offset-2 ring-offset-[var(--bg)] transition-transform hover:scale-110", c === color && "ring-2 ring-fg")} style={{ background: c }} />)}
                </div>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">How much history to bring in</p>
              <div className="flex flex-wrap gap-2">
                {[7, 30, 90, 365].map((d) => <button key={d} type="button" aria-pressed={syncDays === d} onClick={() => setSyncDays(d)} className={cx("h-9 rounded-full px-4 text-[13px] ring-1", syncDays === d ? "bg-fg text-bg ring-fg" : "ring-border hover:bg-surface-2")}>{d === 365 ? "1 year" : `${d} days`}</button>)}
              </div>
            </div>
            {meta.me.manage && (
              <div className="rounded-[16px] border border-border p-4">
                <label className="flex items-start justify-between gap-3 text-[13.5px]">
                  <span><span className="flex items-center gap-1.5 font-medium"><Users className="size-4" /> Team inbox</span><span className="block text-[12.5px] text-muted">Share it with teammates — assign conversations, leave internal notes. Good for sales@ or support@.</span></span>
                  <Switch label="Team inbox" checked={shared} onChange={setShared} />
                </label>
                {shared && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {meta.members.filter((m) => m.id !== meta.me.id).map((m) => (
                      <button key={m.id} type="button" aria-pressed={members.includes(m.id)} onClick={() => setMembers(members.includes(m.id) ? members.filter((x) => x !== m.id) : [...members, m.id])} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] ring-1", members.includes(m.id) ? "bg-accent/10 text-accent ring-accent/40" : "ring-border hover:bg-surface-2")}>
                        {members.includes(m.id) && <Check className="size-3.5" />}{m.name || m.email}
                      </button>
                    ))}
                    {meta.members.length <= 1 && <p className="text-[12.5px] text-muted">Invite teammates from Team first.</p>}
                  </div>
                )}
              </div>
            )}
            {saveErr && <Notice tone="danger">{saveErr}</Notice>}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function CheckList({ check, checking, error, provider }: { check: CheckOut | null; checking: boolean; error: string | null; provider: ProviderId }) {
  const rows = useMemo(() => {
    const imapOk = check?.imap.ok;
    const smtpOk = check?.smtp.ok;
    return [
      { label: "Connecting to the incoming (IMAP) server", state: checking ? "run" : check ? (imapOk || !["dns", "network", "tls"].includes(check.imap.kind ?? "") ? "ok" : "fail") : "wait" },
      { label: "Signing in", state: checking ? "wait" : check ? (imapOk ? "ok" : "fail") : "wait" },
      { label: check?.imap.folders?.length ? `Reading folders — ${check.imap.folders.slice(0, 6).join(", ")}${check.imap.folders.length > 6 ? "…" : ""}` : "Reading your folders", state: checking ? "wait" : check ? (imapOk ? "ok" : "skip") : "wait" },
      { label: "Connecting to the outgoing (SMTP) server to send", state: checking ? "wait" : check ? (smtpOk ? "ok" : "fail") : "wait" },
    ];
  }, [check, checking]);
  const imapFix = check && !check.imap.ok ? explain(check.imap, "imap", provider) : null;
  const smtpFix = check && !check.smtp.ok ? explain(check.smtp, "smtp", provider) : null;
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-3 text-[14px]">
            {r.state === "ok" ? <CheckCircle2 className="size-5 text-success" /> : r.state === "fail" ? <XCircle className="size-5 text-danger" /> : r.state === "run" ? <Loader2 className="size-5 animate-spin text-accent" /> : <Circle className="size-5 text-subtle" />}
            <span className={r.state === "wait" || r.state === "skip" ? "text-muted" : ""}>{r.label}</span>
          </li>
        ))}
      </ul>
      {checking && <p className="text-[13px] text-muted">This takes a few seconds — we&apos;re talking to your mail server right now.</p>}
      {error && <Notice tone="danger" title="The check couldn't run">{error}</Notice>}
      {check && check.imap.ok && check.smtp.ok && <Notice tone="success" title="Everything works">Reading and sending both checked out. Next, name your mailbox.</Notice>}
      {imapFix && <Notice tone="danger" title={imapFix.title}>{imapFix.fix}</Notice>}
      {smtpFix && <Notice tone="danger" title={smtpFix.title}>{smtpFix.fix}</Notice>}
    </div>
  );
}

/** The /mail page before any mailbox is connected. */
export function MailWelcome({ onConnect, canOauth }: { onConnect: () => void; canOauth: boolean }) {
  const features = [
    { icon: <Inbox className="size-5" />, title: "Every mailbox, one inbox", body: "Gmail, Outlook, Zoho, iCloud, Titan or your own domain — side by side or unified." },
    { icon: <Sparkles className="size-5" />, title: "Sorts itself", body: "Primary, People, Finance, Updates, Promotions and a screener for new senders — with the reason shown." },
    { icon: <Users className="size-5" />, title: "Team inboxes", body: "Share support@ or sales@, assign conversations and leave notes only your team sees." },
    { icon: <Shield className="size-5" />, title: "Safer by default", body: "Remote images blocked, scripts never run, and fake senders flagged before you click." },
  ];
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 sm:py-16">
      <div className="text-center">
        <Badge tone="accent">New</Badge>
        <h1 className="mx-auto mt-4 max-w-2xl text-[clamp(1.9rem,4vw,2.8rem)] leading-[1.05] font-semibold tracking-[-0.035em]">All your email, in one calm, smart inbox.</h1>
        <p className="mx-auto mt-4 max-w-xl text-[15.5px] leading-relaxed text-muted">Connect the mailboxes you already use. Cloudesk sorts what arrives, reminds you to follow up, and links every conversation to your customers, deals and tickets.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button variant="primary" size="lg" icon={<Mail className="size-4" />} onClick={onConnect}>Connect your first mailbox</Button>
        </div>
        <p className="mt-3 text-[12.5px] text-muted">About two minutes{canOauth ? " — or one click with Google or Microsoft" : ""}. We guide you through every step.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((x) => (
          <div key={x.title} className="rounded-[20px] border border-border bg-surface p-5">
            <span className="grid size-10 place-items-center rounded-[12px] bg-accent/10 text-accent">{x.icon}</span>
            <p className="mt-3 text-[14.5px] font-semibold">{x.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{x.body}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 text-[12.5px] text-muted">
        {PROVIDERS.filter((x) => x.id !== "custom").map((x) => <span key={x.id} className="inline-flex items-center gap-1.5"><ProviderMark id={x.id} size={20} />{x.name}</span>)}
        <span className="inline-flex items-center gap-1.5"><ProviderMark id="custom" size={20} />any IMAP server</span>
      </div>
    </div>
  );
}
