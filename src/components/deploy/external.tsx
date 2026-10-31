"use client";

// Hosting & publishing: where this web app is live. The platform always hosts
// it; GitHub, Netlify, Vercel and Cloudflare Pages are connected with a guided,
// step-by-step setup that checks the token with the provider before saving.
// Tokens go to the server once and are never shown again.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, CheckCircle2, Cloud, Download, ExternalLink, GitBranch, Globe, Loader2, Plus, Rocket, ShieldCheck, Trash2, Triangle, Zap } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";

type Provider = "github" | "netlify" | "vercel" | "cloudflare";
type Target = { id: string; provider: Provider; name: string; config: Record<string, string>; url: string; status: string; lastError: string; lastRunAt: string | null; tokenSaved: boolean };
type Step = { title: string; body: React.ReactNode; link?: { href: string; label: string } };

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">{children}</a>
);

const PROVIDERS: Record<Provider, { name: string; icon: React.ReactNode; line: string; tokenHelp: string; tokenUrl: string; minutes: number; prepare: Step[]; token: Step; after: Step[] }> = {
  github: {
    name: "GitHub",
    icon: <GitBranch className="size-4" />,
    line: "Commit the site's files to a repository — host it with GitHub Pages or anything that builds from GitHub.",
    tokenHelp: "Fine-grained token with Contents: read and write on this repository.",
    tokenUrl: "https://github.com/settings/personal-access-tokens/new",
    minutes: 4,
    prepare: [
      { title: "Make a repository", body: <>Create a new repository on GitHub — public for free GitHub Pages. It can be completely empty; the first publish starts it.</>, link: { href: "https://github.com/new", label: "New repository" } },
    ],
    token: {
      title: "Create a fine-grained token",
      body: (
        <ol className="list-decimal space-y-1 pl-4">
          <li>Open <b>Settings → Developer settings → Fine-grained tokens → Generate new token</b>.</li>
          <li>Name it “Cloudesk” and pick an expiry.</li>
          <li><b>Repository access:</b> Only select repositories → your site&apos;s repository.</li>
          <li><b>Permissions → Repository → Contents:</b> Read and write. Nothing else is needed.</li>
          <li>Generate, then copy the token (GitHub shows it once).</li>
        </ol>
      ),
      link: { href: "https://github.com/settings/personal-access-tokens/new", label: "Create a GitHub token" },
    },
    after: [
      { title: "Turn on GitHub Pages", body: <>In the repository: <b>Settings → Pages → Deploy from a branch</b>, branch <b>main</b>, folder <b>/docs</b> (use “docs” as the folder here). Your site appears at <code>https://owner.github.io/repo</code>.</> },
      { title: "Add its address here", body: <>Edit this connection and paste the Pages address so forms from there are accepted.</> },
    ],
  },
  netlify: {
    name: "Netlify",
    icon: <Zap className="size-4" />,
    line: "Upload to a Netlify site (one is made for you if you don't name one) and go live on its address.",
    tokenHelp: "Netlify personal access token (User settings → Applications).",
    tokenUrl: "https://app.netlify.com/user/applications#personal-access-tokens",
    minutes: 2,
    prepare: [{ title: "Have a Netlify account", body: <>Free is fine. You don&apos;t need to create a site — one is made on the first publish. To use an existing site, copy its <b>Site ID</b> from <b>Site configuration → Site details</b>.</>, link: { href: "https://app.netlify.com/signup", label: "Sign up for Netlify" } }],
    token: {
      title: "Create a personal access token",
      body: (
        <ol className="list-decimal space-y-1 pl-4">
          <li>Open <b>User settings → Applications → Personal access tokens</b>.</li>
          <li>Choose <b>New access token</b>, name it “Cloudesk”, set an expiry.</li>
          <li>Copy the token (Netlify shows it once).</li>
        </ol>
      ),
      link: { href: "https://app.netlify.com/user/applications#personal-access-tokens", label: "Create a Netlify token" },
    },
    after: [{ title: "Use your own domain (optional)", body: <>In Netlify: <b>Domain management → Add a domain</b>. Then edit this connection and change the site address so forms from it are accepted.</> }],
  },
  vercel: {
    name: "Vercel",
    icon: <Triangle className="size-4" />,
    line: "Deploy to a Vercel project as production.",
    tokenHelp: "Vercel token (Account settings → Tokens), scoped to the team that owns the project.",
    tokenUrl: "https://vercel.com/account/tokens",
    minutes: 2,
    prepare: [{ title: "Have a Vercel account", body: <>The project is made on the first publish if it doesn&apos;t exist. If it belongs to a team, copy the <b>Team ID</b> from the team&apos;s <b>Settings → General</b>.</>, link: { href: "https://vercel.com/signup", label: "Sign up for Vercel" } }],
    token: {
      title: "Create a token",
      body: (
        <ol className="list-decimal space-y-1 pl-4">
          <li>Open <b>Account settings → Tokens</b>.</li>
          <li>Name it “Cloudesk”, choose the <b>scope</b> (your account or the team that owns the project) and an expiry.</li>
          <li>Create, then copy the token.</li>
        </ol>
      ),
      link: { href: "https://vercel.com/account/tokens", label: "Create a Vercel token" },
    },
    after: [{ title: "Use your own domain (optional)", body: <>In Vercel: <b>Project → Settings → Domains</b>. Then update the site address on this connection.</> }],
  },
  cloudflare: {
    name: "Cloudflare Pages",
    icon: <Cloud className="size-4" />,
    line: "Upload straight to a Cloudflare Pages project on Cloudflare's global network.",
    tokenHelp: "API token with Account · Cloudflare Pages · Edit.",
    tokenUrl: "https://dash.cloudflare.com/profile/api-tokens",
    minutes: 3,
    prepare: [
      { title: "Find your account ID", body: <>In the Cloudflare dashboard open <b>Workers &amp; Pages</b>; the <b>Account ID</b> is on the right (it&apos;s also the 32-character part of the dashboard address).</>, link: { href: "https://dash.cloudflare.com/", label: "Open Cloudflare" } },
      { title: "Pick a project name", body: <>A new Direct Upload project is made on the first publish, at <code>name.pages.dev</code>. An existing project must be a Direct Upload one — projects connected to Git don&apos;t take uploads.</> },
    ],
    token: {
      title: "Create an API token",
      body: (
        <ol className="list-decimal space-y-1 pl-4">
          <li>Open <b>My Profile → API Tokens → Create Token → Create Custom Token</b>.</li>
          <li>Name it “Cloudesk”.</li>
          <li><b>Permissions:</b> Account · Cloudflare Pages · Edit.</li>
          <li><b>Account resources:</b> Include → your account.</li>
          <li>Continue, create, then copy the token.</li>
        </ol>
      ),
      link: { href: "https://dash.cloudflare.com/profile/api-tokens", label: "Create a Cloudflare token" },
    },
    after: [{ title: "Use your own domain (optional)", body: <>In the Pages project: <b>Custom domains → Set up a domain</b>. Then update the site address on this connection.</> }],
  },
};
const ORDER: Provider[] = ["github", "netlify", "vercel", "cloudflare"];

const TONE = { done: "success", failed: "danger", running: "warning", idle: "neutral" } as const;

export function ExternalTargets({ projectId, canManage, live, liveHref }: { projectId: string; canManage: boolean; live: boolean; liveHref?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["export-targets", projectId];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ targets: Target[] }>(`/api/v1/projects/${projectId}/export/targets`) });
  const [edit, setEdit] = useState<{ provider: Provider; target?: Target } | null>(null);
  const [guide, setGuide] = useState<Provider | null>(null);
  const [remove, setRemove] = useState<Target | null>(null);
  const publish = useMutation({
    mutationFn: (id: string) => api<{ result: { url: string; note: string; files: number } }>(`/api/v1/projects/${projectId}/export/targets/${id}/publish`, { method: "POST" }),
    onSuccess: (r) => toast({ tone: "success", title: r.result.note, description: `${r.result.files} files${r.result.url ? ` · ${r.result.url}` : ""}` }),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/export/targets/${id}`, { method: "DELETE" }),
    onSuccess: () => (toast({ tone: "success", title: "Removed" }), setRemove(null), qc.invalidateQueries({ queryKey: key })),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const all = list.data?.targets ?? [];
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Hosting &amp; publishing</h2>
          <p className="mt-0.5 max-w-xl text-[13px] text-muted">Live here by default. Connect GitHub, Netlify, Vercel or Cloudflare Pages to publish the same version there in one click — forms keep arriving here, and the shop, cart and checkout stay on this platform.</p>
        </div>
        {live ? (
          <a href={`/api/v1/projects/${projectId}/export/zip`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
            <Download className="size-3.5" /> Download .zip
          </a>
        ) : (
          <Button size="sm" disabled icon={<Download className="size-3.5" />}>Download .zip</Button>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-[14px] border border-border p-3.5">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-[9px] bg-surface-2"><Globe className="size-4" /></span>
            <b className="text-[13px] font-medium">This platform</b>
          </div>
          <div className="mt-2.5">{live ? <Badge tone="success">Live</Badge> : <Badge>Not published</Badge>}</div>
          <p className="mt-1.5 text-[12px] text-muted">Always on: live sections, shop, bookings and forms run here.</p>
          {live && liveHref && <a href={liveHref} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] text-accent hover:underline">Open site <ExternalLink className="size-3" /></a>}
        </div>
        {ORDER.map((id) => {
          const p = PROVIDERS[id];
          const mine = all.filter((t) => t.provider === id);
          const last = [...mine].sort((a, b) => (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""))[0];
          const state = !mine.length ? null : mine.some((t) => t.status === "failed") ? "failed" : last?.status === "done" ? "done" : "idle";
          return (
            <div key={id} className={clsx("flex flex-col rounded-[14px] border p-3.5", mine.length ? "border-border" : "border-dashed border-border")} data-testid={`host-${id}`}>
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-[9px] bg-surface-2">{p.icon}</span>
                <b className="text-[13px] font-medium">{p.name}</b>
              </div>
              <div className="mt-2.5">
                {state === null ? <Badge>Not connected</Badge> : state === "failed" ? <Badge tone="danger">Needs attention</Badge> : state === "done" ? <Badge tone="success">Connected · published</Badge> : <Badge tone="accent">Connected</Badge>}
              </div>
              <p className="mt-1.5 flex-1 text-[12px] text-muted">
                {mine.length ? (last?.lastRunAt ? `Last published ${timeAgo(last.lastRunAt)}${mine.length > 1 ? ` · ${mine.length} connections` : ""}` : "Ready — publish whenever you like.") : `About ${p.minutes} minutes to set up.`}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {canManage && (
                  <Button size="sm" variant={mine.length ? "secondary" : "primary"} icon={<Plus className="size-3.5" />} onClick={() => setEdit({ provider: id })} aria-label={`Connect ${p.name}`}>
                    {mine.length ? "Add" : "Connect"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setGuide(id)} aria-label={`${p.name} guide`}>Guide</Button>
              </div>
            </div>
          );
        })}
      </div>

      {!live && <p className="mt-3 text-[12.5px] text-muted">Publish the site first — exports and external hosts use its live version.</p>}
      {all.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-[16px] border border-border">
          {all.map((t) => {
            const p = PROVIDERS[t.provider] ?? PROVIDERS.github;
            const running = publish.isPending && publish.variables === t.id;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2">{p.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="font-medium">{t.name}</b>
                    <span className="text-muted">· {p.name}{t.provider === "github" ? ` · ${t.config.repo}${t.config.branch ? `@${t.config.branch}` : ""}${t.config.dir ? `/${t.config.dir}` : ""}` : t.provider === "vercel" || t.provider === "cloudflare" ? ` · ${t.config.project}` : ""}</span>
                    <Badge tone={TONE[(running ? "running" : t.status) as keyof typeof TONE] ?? "neutral"}>{running ? "publishing…" : t.status === "done" ? "published" : t.status === "idle" ? "not published yet" : t.status}</Badge>
                  </span>
                  <span className="block text-[12px] text-muted">
                    {t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">{t.url.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" /></a> : t.provider === "github" ? "Add the site's address (e.g. GitHub Pages) so its forms can send here." : "Its address appears after the first publish."}
                    {t.lastRunAt && ` · last ${timeAgo(t.lastRunAt)}`}
                  </span>
                  {t.status === "failed" && t.lastError && <span className="mt-1 block rounded-[8px] bg-danger-soft px-2 py-1 text-[12px] text-danger">{t.lastError}</span>}
                </span>
                {canManage && (
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="primary" disabled={!live || publish.isPending} icon={running ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />} onClick={() => publish.mutate(t.id)}>{running ? "Publishing" : "Publish"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ provider: t.provider, target: t })}>Edit</Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove ${t.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setRemove(t)} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-subtle">S3, FTP or any other static host: download the .zip and upload its contents.</p>

      {guide && (
        <Dialog open size="lg" onClose={() => setGuide(null)} title={`${PROVIDERS[guide].name}: how it works`} description={PROVIDERS[guide].line} footer={<><Button onClick={() => setGuide(null)}>Close</Button>{canManage && <Button variant="primary" onClick={() => (setEdit({ provider: guide }), setGuide(null))}>Start setup</Button>}</>}>
          <Guide provider={guide} />
        </Dialog>
      )}
      {edit && <ConnectWizard projectId={projectId} provider={edit.provider} target={edit.target} live={live} onClose={() => setEdit(null)} onSaved={() => qc.invalidateQueries({ queryKey: key })} onPublish={(id) => publish.mutate(id)} />}
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} onConfirm={() => remove && del.mutate(remove.id)} loading={del.isPending} destructive title={`Remove ${remove?.name}?`} description="The saved token is deleted. Nothing on the other side is touched — the site there stays as it is." confirmLabel="Remove" />
    </Card>
  );
}

/** The whole tutorial at a glance: prepare, token, connect here, after the first publish. */
function Guide({ provider }: { provider: Provider }) {
  const p = PROVIDERS[provider];
  const steps: Step[] = [...p.prepare, p.token, { title: "Connect it here", body: <>Paste the token and details, then <b>Check connection</b> — the provider confirms the token works before anything is saved. Then <b>Publish</b>.</> }, ...p.after];
  return <StepList steps={steps} />;
}

function StepList({ steps, start = 1 }: { steps: Step[]; start?: number }) {
  return (
    <ol className="grid gap-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold">{i + start}</span>
          <div className="min-w-0 text-[13px]">
            <b className="block font-medium">{s.title}</b>
            <div className="mt-0.5 text-muted">{s.body}</div>
            {s.link && <div className="mt-1.5"><A href={s.link.href}>{s.link.label} ↗</A></div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const STAGES = ["Prepare", "Token", "Details", "Done"] as const;

/** Guided setup: what to prepare, how to make the token, the details (checked with the provider), then publish. */
function ConnectWizard({ projectId, provider, target, live, onClose, onSaved, onPublish }: { projectId: string; provider: Provider; target?: Target; live: boolean; onClose: () => void; onSaved: () => void; onPublish: (id: string) => void }) {
  const toast = useToast();
  const p = PROVIDERS[provider];
  const c = target?.config ?? {};
  const [stage, setStage] = useState(target ? 2 : 0);
  const [f, setF] = useState({ name: target?.name ?? p.name, token: "", url: target?.url ?? "", repo: c.repo ?? "", branch: c.branch ?? "", dir: c.dir ?? "docs", siteId: c.siteId ?? "", siteName: c.siteName ?? "", project: c.project ?? "", teamId: c.teamId ?? "", accountId: c.accountId ?? "" });
  const [err, setErr] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [saved, setSaved] = useState<Target | null>(null);
  const body = () => ({ provider, ...f, token: f.token || undefined });
  const check = useMutation({
    mutationFn: () => api<{ check: { note: string } }>(`/api/v1/projects/${projectId}/export/check`, { method: "POST", body: { ...body(), id: target?.id } }),
    onSuccess: (r) => (setErr(""), setChecked(r.check.note)),
    onError: (e) => (setChecked(null), setErr(errorMessage(e))),
  });
  const save = useMutation({
    mutationFn: () => api<{ target: Target }>(`/api/v1/projects/${projectId}/export/targets${target ? `/${target.id}` : ""}`, { method: target ? "PUT" : "POST", body: body() }),
    onSuccess: (r) => {
      onSaved();
      if (target) return void (toast({ tone: "success", title: "Saved" }), onClose());
      setSaved(r.target);
      setStage(3);
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => (setF({ ...f, [k]: e.target.value }), setChecked(null));
  const footer =
    stage < 2 ? (
      <>
        <Button onClick={stage ? () => setStage(stage - 1) : onClose}>{stage ? "Back" : "Cancel"}</Button>
        <Button variant="primary" onClick={() => setStage(stage + 1)}>{stage === 0 ? "I'm ready" : "I have a token"}</Button>
      </>
    ) : stage === 2 ? (
      <>
        <Button onClick={target ? onClose : () => setStage(1)}>{target ? "Cancel" : "Back"}</Button>
        <Button loading={check.isPending} icon={<ShieldCheck className="size-3.5" />} onClick={() => check.mutate()}>Check connection</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{target ? "Save" : "Connect"}</Button>
      </>
    ) : (
      <>
        <Button onClick={onClose}>Done</Button>
        {saved && <Button variant="primary" disabled={!live} icon={<Rocket className="size-3.5" />} onClick={() => (onPublish(saved.id), onClose())}>Publish now</Button>}
      </>
    );
  return (
    <Dialog open size="lg" onClose={onClose} title={target ? `Edit ${target.name}` : `Connect ${p.name}`} description={p.line} footer={footer}>
      {!target && (
        <ol className="mb-4 flex flex-wrap items-center gap-1.5 text-[12px]" aria-label="Setup steps">
          {STAGES.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5" aria-current={i === stage ? "step" : undefined}>
              <span className={clsx("grid size-5 place-items-center rounded-full text-[11px] font-semibold", i < stage ? "bg-success text-white" : i === stage ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>{i < stage ? <Check className="size-3" /> : i + 1}</span>
              <span className={i === stage ? "font-medium" : "text-muted"}>{s}</span>
              {i < STAGES.length - 1 && <span className="mx-1 h-px w-5 bg-border" />}
            </li>
          ))}
        </ol>
      )}
      {stage === 0 && <StepList steps={p.prepare} />}
      {stage === 1 && <StepList steps={[p.token]} start={p.prepare.length + 1} />}
      {stage === 2 && (
        <div className="grid gap-3">
          {err && <Notice tone="danger">{err}</Notice>}
          {checked && <Notice tone="success" title="Connection works">{checked}</Notice>}
          <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={set("name")} />}</Field>
          <Field label="Access token" hint={<>{p.tokenHelp} <A href={p.tokenUrl}>Create one</A>{target?.tokenSaved ? " · Leave empty to keep the saved one." : ""}</>}>
            {(a) => <Input {...a} type="password" autoComplete="off" value={f.token} placeholder={target?.tokenSaved ? "•••••••• saved" : ""} onChange={set("token")} />}
          </Field>
          {provider === "github" && (
            <>
              <Field label="Repository" hint="owner/name — it can be empty; the first publish starts it.">{(a) => <Input {...a} value={f.repo} placeholder="acme/website" onChange={set("repo")} />}</Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Branch" hint="Empty: the repo's default">{(a) => <Input {...a} value={f.branch} placeholder="main" onChange={set("branch")} />}</Field>
                <Field label="Folder" hint="“docs” works with GitHub Pages">{(a) => <Input {...a} value={f.dir} onChange={set("dir")} />}</Field>
              </div>
            </>
          )}
          {provider === "netlify" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Site ID" hint="Empty: a new site is made">{(a) => <Input {...a} value={f.siteId} onChange={set("siteId")} />}</Field>
              <Field label="New site name" hint="For a new site, optional">{(a) => <Input {...a} value={f.siteName} placeholder="acme-site" onChange={set("siteName")} />}</Field>
            </div>
          )}
          {provider === "vercel" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Project name">{(a) => <Input {...a} value={f.project} placeholder="acme-site" onChange={set("project")} />}</Field>
              <Field label="Team ID" hint="If the project belongs to a team">{(a) => <Input {...a} value={f.teamId} onChange={set("teamId")} />}</Field>
            </div>
          )}
          {provider === "cloudflare" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Account ID" hint="32 characters, from Workers & Pages">{(a) => <Input {...a} value={f.accountId} className="font-mono" onChange={set("accountId")} />}</Field>
              <Field label="Project name" hint="New or an existing Direct Upload project">{(a) => <Input {...a} value={f.project} placeholder="acme-site" onChange={set("project")} />}</Field>
            </div>
          )}
          <Field label="Site address" hint={provider === "github" ? "Where the files are served (e.g. https://acme.github.io/website). Forms from there are accepted." : "Filled in after the first publish. Change it if you use your own domain there."}>
            {(a) => <Input {...a} value={f.url} placeholder="https://" onChange={set("url")} />}
          </Field>
        </div>
      )}
      {stage === 3 && (
        <div className="grid gap-4">
          <Notice tone="success" title={`${p.name} is connected`}>{live ? "Publish now, or any time from Hosting & publishing." : `Publish the site here first; then publish it to ${p.name}.`}</Notice>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><CheckCircle2 className="size-4 text-success" /> After the first publish</p>
            <StepList steps={p.after} start={p.prepare.length + 3} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
