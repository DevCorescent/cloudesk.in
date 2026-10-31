"use client";

// Infrastructure: how this installation is running right now, how ready it is
// to run on several servers, and the reference setups shipped in /deploy.
import { Check, CircleAlert } from "lucide-react";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { bytes, duration, Section } from "./common";
import { useHealth } from "./health";

const READY: { ok: boolean; title: string; detail: string }[] = [
  { ok: true, title: "Stateless web servers", detail: "Sessions, files, uploads and settings live in Postgres, so any web server can answer any request. Add servers behind a load balancer." },
  { ok: true, title: "Durable background jobs", detail: "Jobs are claimed with row locks (SKIP LOCKED); several workers never run the same job twice." },
  { ok: true, title: "Web / worker split", detail: "APP_ROLE=web turns off the worker and every scheduler on a node. Run one or two worker nodes without it." },
  { ok: true, title: "Health checks", detail: "GET /api/v1/health answers 200 when the database is reachable, 503 when it isn't — use it for load-balancer and orchestrator probes." },
  { ok: true, title: "Zero-downtime releases", detail: "Run migrations (npm run db:migrate) as a one-off step, then roll web servers one by one. Keep each migration compatible with the version still running (add first, remove later)." },
  { ok: true, title: "Rate limits shared by every server", detail: "In production, limits are counted in Postgres with one atomic update per check, so they hold across the fleet. The proxy must overwrite X-Forwarded-For with the real client address." },
  { ok: true, title: "Settings without redeploying", detail: "Integration keys saved in the console reach every server within 30 seconds; platform settings within 10." },
  { ok: false, title: "AI tasks run on the server that started them", detail: "A running AI task can only be cancelled on that server; if it restarts, interrupted tasks are recovered on start-up." },
  { ok: false, title: "Uploads are stored in Postgres", detail: "Simple and consistent, but large media libraries grow the database; size the database storage and backups accordingly." },
];

const LAYERS = [
  { name: "Edge", what: "DNS → CDN / WAF → load balancer with TLS (on-demand certificates for customer domains)." },
  { name: "Web", what: "3+ app containers (APP_ROLE=web), autoscaled on CPU. Stateless." },
  { name: "Worker", what: "1–2 app containers with the worker and schedulers on." },
  { name: "Data", what: "Managed PostgreSQL 15+ with point-in-time recovery, a connection pooler (PgBouncer, transaction mode) and a standby for failover." },
  { name: "Email & billing", what: "Resend / Postmark / SendGrid / SMTP; Stripe or Razorpay with webhooks pointed at the app." },
  { name: "Observability", what: "Uptime check on /api/v1/health, container logs (JSON lines) shipped to your log store, alerts on 5xx rate and job backlog." },
];

const FILES = [
  { path: "deploy/Dockerfile", what: "One image for web, worker and migrations; runs as a non-root user with a health check." },
  { path: "deploy/docker-compose.yml", what: "Postgres + migrate + web (scale with --scale web=3) + worker on one host." },
  { path: "deploy/kubernetes.yaml", what: "Migration Job, autoscaled web Deployment, worker Deployment and Service." },
  { path: "docs/DEPLOY.md", what: "Step-by-step: environment, first release, scaling, backups and upgrades." },
];

export function InfraPanel() {
  const q = useHealth();
  const s = q.data?.server;
  const d = q.data?.database;
  return (
    <div className="space-y-8">
      <Section title="This server" sub="Live">
        {!s || !d ? <Skeleton className="h-24" /> : (
          <Card className="grid gap-x-6 gap-y-2 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <p><span className="text-muted">Role </span><b className="font-medium">{s.role}</b></p>
            <p><span className="text-muted">Mode </span><b className="font-medium">{s.env}</b></p>
            <p><span className="text-muted">Node </span><b className="font-medium">{s.node}</b></p>
            <p><span className="text-muted">Up </span><b className="font-medium">{duration(s.uptimeSec)}</b></p>
            <p><span className="text-muted">Memory </span><b className="font-medium">{bytes(s.rssBytes)}</b></p>
            <p><span className="text-muted">Data region </span><b className="font-medium">{s.region || "not set"}</b></p>
            <p className="sm:col-span-2 lg:col-span-3"><span className="text-muted">Database </span><b className="font-medium">{d.version}</b> · {bytes(d.sizeBytes)} · {d.connections}/{d.maxConnections} connections</p>
          </Card>
        )}
      </Section>

      <Section title="Ready for several servers?" sub="What's built in, and what to plan around">
        <Card className="divide-y divide-border">
          {READY.map((r) => (
            <div key={r.title} className="flex gap-3 px-4 py-3 text-[13px]">
              {r.ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              <div><p className="font-medium">{r.title}</p><p className="text-muted">{r.detail}</p></div>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Reference architecture">
        <Card className="divide-y divide-border">
          {LAYERS.map((l) => (
            <div key={l.name} className="grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[8rem_1fr]">
              <Badge className="w-fit">{l.name}</Badge>
              <p className="text-muted">{l.what}</p>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Deployment files in the repository">
        <Card className="divide-y divide-border">
          {FILES.map((f) => (
            <div key={f.path} className="grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[16rem_1fr]">
              <code className="text-[12.5px]">{f.path}</code>
              <p className="text-muted">{f.what}</p>
            </div>
          ))}
        </Card>
      </Section>
    </div>
  );
}
