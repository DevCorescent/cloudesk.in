"use client";

// Everything the platform connects to. Each integration has a step-by-step
// setup guide; email, billing, GitHub sign-in, AI and search can be set right
// here (saved encrypted — secrets are never shown again; a value in the
// server environment always wins), and tested live. Core settings (database,
// encryption key, address, domains, workers) live in the server environment.
import { CheckCircle2, Circle, CircleAlert, CircleX, ExternalLink, Lock, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { useAdmin, useCan, useRun } from "./common";

type I = { id: string; name: string; group: string; status: "ready" | "partial" | "missing" | "optional"; detail: string; keys: { key: string; set: boolean }[]; testable: boolean; docs: string };
type C = { key: string; label: string; secret: boolean; hint: string; options: string[] | null; source: "env" | "console" | null; value: string; updatedAt: string | null; updatedBy: string | null };
const ICON = { ready: <CheckCircle2 className="size-4 text-success" />, partial: <CircleAlert className="size-4 text-warning" />, missing: <CircleX className="size-4 text-danger" />, optional: <Circle className="size-4 text-subtle" /> };
const LABEL = { ready: "Connected", partial: "Incomplete", missing: "Not set up", optional: "Optional" };
const TONE = { ready: "success", partial: "warning", missing: "danger", optional: "neutral" } as const;

const A = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2">{children}<ExternalLink className="size-3" /></a>;
const Code = ({ children }: { children: ReactNode }) => <code className="rounded-[5px] bg-surface-2 px-1 py-0.5 text-[12px]">{children}</code>;

/** Step-by-step guides, written for a person doing this for the first time. */
const GUIDES: Record<string, { title: string; body: ReactNode }[]> = {
  database: [
    { title: "Create a managed PostgreSQL 15+ database", body: <>Any provider works — AWS RDS / Aurora, Google Cloud SQL, Azure, Neon, Supabase, DigitalOcean or Crunchy. Pick the region closest to your customers (and your data-residency promise). Turn on <b>automated backups with point-in-time recovery</b>.</> },
    { title: "Add a connection pooler for many servers", body: <>With more than two app servers, put PgBouncer (transaction mode) or your provider&apos;s pooler in front, and point <Code>DATABASE_URL</Code> at it.</> },
    { title: "Set DATABASE_URL on every server", body: <><Code>DATABASE_URL=postgres://user:password@host:5432/cloudesk?sslmode=require</Code></> },
    { title: "Run migrations on each release", body: <><Code>npm run db:migrate</Code> (or the migrate step in <Code>deploy/</Code>) before new servers take traffic. Health shows applied vs shipped migrations.</> },
    { title: "Do a restore drill", body: <>Restore last night&apos;s backup into a scratch database once, then tick “backups” on Go-live.</> },
  ],
  encryption: [
    { title: "Generate a key once", body: <><Code>openssl rand -base64 32</Code> — keep it in your secret manager.</> },
    { title: "Set it on every server", body: <><Code>APP_ENCRYPTION_KEY=…</Code>. All servers must share the same key. Never change it after data exists: saved tokens, two-step secrets and integration keys would become unreadable.</> },
  ],
  app_url: [
    { title: "Choose the app's address", body: <>e.g. <Code>https://app.yourdomain.com</Code>. Point its DNS at your load balancer.</> },
    { title: "Set APP_URL", body: <><Code>APP_URL=https://app.yourdomain.com</Code>. It&apos;s used in emails, payment callbacks, cookies (Secure) and the HSTS header, so it must be https in production.</> },
  ],
  email: [
    { title: "Pick a provider", body: <><A href="https://resend.com">Resend</A>, <A href="https://postmarkapp.com">Postmark</A>, <A href="https://sendgrid.com">SendGrid</A>, or any SMTP service (Amazon SES, Zoho, Google Workspace relay).</> },
    { title: "Verify your sending domain", body: <>Add the SPF, DKIM (and DMARC) DNS records the provider shows, and wait until it says the domain is verified. Without this, mail lands in spam.</> },
    { title: "Create an API key", body: <>Resend: <b>API Keys → Create</b> (sending access). Postmark: <b>Server → API Tokens</b>. SendGrid: <b>Settings → API Keys</b> (Mail Send). SMTP: host, port 587 (or 465), user and password.</> },
    { title: "Enter it below and test", body: <>Set the From address (on your verified domain), the provider and its key, save, then <b>Test</b> — a message goes to your own inbox.</> },
  ],
  stripe: [
    { title: "Create the products and prices", body: <>In <A href="https://dashboard.stripe.com/products">Stripe → Products</A> add “Pro” and “Business”, each with a recurring monthly price. Copy each <Code>price_…</Code> ID.</> },
    { title: "Get the secret key", body: <><A href="https://dashboard.stripe.com/apikeys">Developers → API keys</A>. Use a restricted key with Customers, Checkout Sessions, Subscriptions and Prices (read/write) if you prefer.</> },
    { title: "Add the webhook", body: <><A href="https://dashboard.stripe.com/webhooks">Developers → Webhooks → Add endpoint</A>: <Code>{"{APP_URL}"}/api/v1/billing/webhooks/stripe</Code>, events <Code>checkout.session.completed</Code>, <Code>customer.subscription.*</Code>, <Code>invoice.payment_failed</Code>. Copy the <Code>whsec_…</Code> signing secret.</> },
    { title: "Enter all four below, then test", body: <>The test fetches the Pro price from Stripe. Plan limits start applying once billing is connected. Use test keys first, then switch to live keys.</> },
  ],
  razorpay: [
    { title: "Create the plans", body: <>In <A href="https://dashboard.razorpay.com/app/subscriptions/plans">Razorpay → Subscriptions → Plans</A> create monthly Pro and Business plans; copy each <Code>plan_…</Code> ID.</> },
    { title: "Generate API keys", body: <><A href="https://dashboard.razorpay.com/app/website-app-settings/api-keys">Account &amp; Settings → API Keys</A>: key ID (<Code>rzp_live_…</Code>) and secret.</> },
    { title: "Add the webhook", body: <><A href="https://dashboard.razorpay.com/app/webhooks">Webhooks → Add</A>: <Code>{"{APP_URL}"}/api/v1/billing/webhooks/razorpay</Code>, subscription events, with a secret you choose.</> },
    { title: "Enter them below, then test", body: <>The test fetches the Pro plan&apos;s price from Razorpay.</> },
  ],
  github: [
    { title: "Create an OAuth app", body: <><A href="https://github.com/settings/developers">GitHub → Settings → Developer settings → OAuth Apps → New</A> (or under your organisation).</> },
    { title: "Fill in the addresses", body: <>Homepage: your <Code>APP_URL</Code>. Authorization callback URL: <Code>{"{APP_URL}"}/api/v1/auth/github/callback</Code>.</> },
    { title: "Copy the client ID and generate a secret", body: <>Enter both below. “Sign in with GitHub” appears on the login page once both are set.</> },
  ],
  google_mail: [
    { title: "Create an OAuth client", body: <>In <A href="https://console.cloud.google.com/apis/credentials">Google Cloud → APIs &amp; Services → Credentials</A>: Create credentials → OAuth client ID → Web application.</> },
    { title: "Add the redirect address", body: <>Authorised redirect URI: <Code>{"{APP_URL}"}/api/v1/mail/oauth/callback</Code>.</> },
    { title: "Set up the consent screen", body: <>OAuth consent screen: your app name, support email and the scope <Code>https://mail.google.com/</Code>. Until Google verifies the app (needed for this “restricted” scope when anyone outside your organisation uses it), add testers by email — or keep the app Internal for a Google Workspace domain.</> },
    { title: "Enter the client ID and secret below", body: <>“Sign in with Google” then appears in Mail&apos;s connect wizard. App passwords keep working either way.</> },
  ],
  microsoft_mail: [
    { title: "Register an app", body: <><A href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Microsoft Entra → App registrations</A> → New registration. Supported accounts: “Any organisational directory and personal Microsoft accounts”.</> },
    { title: "Add the redirect address", body: <>Platform: Web, redirect URI <Code>{"{APP_URL}"}/api/v1/mail/oauth/callback</Code>.</> },
    { title: "Grant mail permissions", body: <>API permissions → Add → APIs my organisation uses → “Office 365 Exchange Online” → Delegated: <Code>IMAP.AccessAsUser.All</Code> and <Code>SMTP.Send</Code>; plus Microsoft Graph <Code>offline_access</Code>, <Code>openid</Code>, <Code>email</Code>, <Code>profile</Code>.</> },
    { title: "Create a client secret and enter it below", body: <>Certificates &amp; secrets → New client secret; copy its <b>Value</b> (not the ID) with the Application (client) ID.</> },
  ],
  gemini: [
    { title: "Get a free key", body: <><A href="https://aistudio.google.com/apikey">Google AI Studio → Get API key</A>. Sign in with any Google account — no card needed.</> },
    { title: "Paste it below and test", body: <>The test lists models — it uses no quota. Free use is rate-limited by Google (a few requests a minute).</> },
  ],
  anthropic: [
    { title: "Create an API key", body: <><A href="https://console.anthropic.com/settings/keys">Anthropic Console → API keys</A>. Set a monthly spend limit on the Anthropic side too.</> },
    { title: "Set the per-workspace budget", body: <>Each workspace can spend at most this much a month (USD); requests stop when it&apos;s used up. Default 20.</> },
    { title: "Enter it below and test", body: <>The test lists models — it uses no tokens and costs nothing.</> },
  ],
  voyage: [
    { title: "Create an API key", body: <><A href="https://dash.voyageai.com">Voyage AI dashboard</A> → API keys.</> },
    { title: "Enter it below", body: <>Chatbot answers and search start using meaning-based matching; keyword search keeps working without it.</> },
  ],
  domains: [
    { title: "Pick a target hostname", body: <>e.g. <Code>sites.yourdomain.com</Code>, pointing (A/AAAA or CNAME) at your load balancer.</> },
    { title: "Serve TLS for customer domains on demand", body: <>Use a proxy that issues certificates automatically for any domain that points at you: Caddy with <Code>on_demand_tls</Code> asking <Code>{"{APP_URL}"}/api/v1/domains/ask?domain=…</Code> (it only approves verified domains with a live site — see <Code>deploy/Caddyfile</Code>), Cloudflare for SaaS, or a load balancer with automatic certificates.</> },
    { title: "Set the target", body: <><Code>CUSTOM_DOMAIN_CNAME=sites.yourdomain.com</Code> (or <Code>CUSTOM_DOMAIN_IPV4</Code> with your IPs). Customers then add a CNAME to it and verify ownership with a TXT record.</> },
  ],
  jobs: [
    { title: "Split web and worker servers", body: <>On web servers set <Code>APP_ROLE=web</Code>. Run one or two servers without it — they run background jobs and every scheduler (jobs are claimed with row locks, so two workers never run the same job).</> },
    { title: "Watch the backlog", body: <>Health and Scalability show jobs waiting and the oldest wait; add a worker if it keeps growing.</> },
  ],
  docker: [
    { title: "Enable containers for code execution", body: <>On a host with Docker installed, set <Code>EXEC_DOCKER=on</Code>. Python and full Node runs in the AI IDE then use locked-down containers (no network, read-only, capped memory/CPU).</> },
  ],
};
const GROUP_OF: Record<string, string> = { google_mail: "google_mail", microsoft_mail: "microsoft_mail", email: "email", stripe: "stripe", razorpay: "razorpay", github: "github", anthropic: "anthropic", gemini: "gemini", voyage: "voyage" };

export function IntegrationsPanel() {
  const q = useAdmin<{ integrations: I[] }>("integrations");
  const [open, setOpen] = useState<I | null>(null);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const groups = [...new Set(q.data.integrations.map((i) => i.group))];
  const ready = q.data.integrations.filter((i) => i.status === "ready").length;
  return (
    <div className="space-y-6">
      <Notice title={`${ready} of ${q.data.integrations.length} connected`}>
        Open any integration for a step-by-step guide. Email, billing, GitHub sign-in, AI and search can be set here; core settings go in the server environment. Values are never shown back — only whether they&apos;re set and where.
      </Notice>
      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-2 text-[13px] font-semibold text-muted">{g}</h3>
          <Card className="divide-y divide-border">
            {q.data.integrations.filter((i) => i.group === g).map((i) => (
              <div key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-[13px]" data-testid={`integration-${i.id}`}>
                <span className="mt-0.5">{ICON[i.status]}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">{i.name}<Badge tone={TONE[i.status]}>{LABEL[i.status]}</Badge>{GROUP_OF[i.id] && <Badge>Set up here</Badge>}</p>
                  <p className="text-muted">{i.detail}</p>
                </div>
                <Button size="sm" icon={<Settings2 className="size-3.5" />} onClick={() => setOpen(i)}>{i.status === "ready" ? "Manage" : "Set up"}</Button>
              </div>
            ))}
          </Card>
        </section>
      ))}
      {open && <SetupDialog integration={q.data.integrations.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SetupDialog({ integration: i, onClose }: { integration: I; onClose: () => void }) {
  const group = GROUP_OF[i.id];
  const cfg = useAdmin<{ config: Record<string, C[]> }>("config", { enabled: !!group });
  const run = useRun();
  const can = useCan();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const fields = group ? cfg.data?.config[group] ?? [] : [];
  const changed = Object.entries(draft).filter(([, v]) => v.trim() !== "");
  const save = async () => {
    setBusy("save");
    const ok = await run("config", "PUT", Object.fromEntries(changed.map(([k, v]) => [k, v.trim()])), "Saved — active on every server within 30 seconds");
    if (ok) setDraft({});
    setBusy(null);
  };
  const clear = async (key: string) => {
    await run("config", "PUT", { [key]: null }, "Cleared");
  };
  const test = async () => {
    setBusy("test");
    const r = await run<{ note: string; ms: number }>(`integrations/${i.id}/test`, "POST", {});
    setResult(r ? `✓ ${r.note} (${r.ms} ms)` : "✗ The test failed — see the message.");
    setBusy(null);
  };
  return (
    <Dialog open size="xl" onClose={onClose} title={i.name} description={i.detail} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-3 text-[13px] font-semibold">How to set it up</p>
          <ol className="grid gap-3">
            {(GUIDES[i.id] ?? [{ title: "Configure", body: i.docs }]).map((s, n) => (
              <li key={s.title} className="flex gap-3 text-[13px]">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold">{n + 1}</span>
                <div className="min-w-0"><b className="block font-medium">{s.title}</b><div className="mt-0.5 text-muted">{s.body}</div></div>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-3">
          <p className="text-[13px] font-semibold">{group ? "Settings" : "Environment variables"}</p>
          {!group && (
            <Card className="divide-y divide-border">
              {i.keys.map((k) => (
                <div key={k.key} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]"><code>{k.key}</code>{k.set ? <Badge tone="success">set</Badge> : <Badge>not set</Badge>}</div>
              ))}
              <p className="px-3 py-2 text-[12px] text-muted">Set these in your host&apos;s secret store on every server, then restart. {i.docs}</p>
            </Card>
          )}
          {group && (cfg.isError ? <ErrorState message={errorMessage(cfg.error)} /> : !cfg.data ? <Skeleton className="h-40" /> : (
            <div className="grid gap-3">
              {fields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.source === "env" ? "Set in the server environment — change it there." : f.source === "console" ? `Saved here${f.updatedAt ? ` ${dateTime(f.updatedAt)}` : ""}${f.updatedBy ? ` by ${f.updatedBy}` : ""}.${f.secret ? " Type a new value to replace it." : ""}` : f.hint ? `e.g. ${f.hint}` : undefined}>
                  {(a) => (
                    <div className="flex gap-1.5">
                      {f.options ? (
                        <Select {...a} disabled={f.source === "env" || !can("settings:write")} value={draft[f.key] ?? f.value} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                          <option value="">Choose…</option>
                          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </Select>
                      ) : (
                      <Input
                        {...a}
                        type={f.secret ? "password" : "text"}
                        autoComplete="off"
                        disabled={f.source === "env" || !can("settings:write")}
                        placeholder={f.source === "env" ? "•••• (environment)" : f.secret && f.source === "console" ? "•••• saved" : f.value || f.hint}
                        value={draft[f.key] ?? (f.secret ? "" : f.value)}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      />
                      )}
                      {f.source === "env" ? <span className="grid w-8 place-items-center text-subtle" title="Set in the environment"><Lock className="size-4" /></span> : f.source === "console" && can("settings:write") ? <Button size="sm" variant="ghost" onClick={() => void clear(f.key)}>Clear</Button> : null}
                    </div>
                  )}
                </Field>
              ))}
              {can("settings:write") ? <Button variant="primary" disabled={!changed.length} loading={busy === "save"} onClick={() => void save()}>Save {changed.length ? `(${changed.length})` : ""}</Button> : <p className="text-[12px] text-muted">Only platform owners can change these.</p>}
            </div>
          ))}
          {i.testable || group ? (
            <div className="space-y-2 border-t border-border pt-3">
              {can("integrations:test") && <Button loading={busy === "test"} disabled={!i.testable} onClick={() => void test()}>Test the connection</Button>}
              {!i.testable && <p className="text-[12px] text-muted">The test is available once it&apos;s fully set up.</p>}
              {result && <p className="rounded-[8px] bg-surface-2 px-2 py-1.5 text-[12.5px]">{result}</p>}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
