"use client";

// Security → Posture: how well this installation is protected, as the server
// checks it live (configuration and the last day's activity). The score is the
// server's: every check weighted by severity, nothing counted that wasn't
// checked. Each failing check says why and how to fix it, with a way there.
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Badge, Button, Card, ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { num, Section, Stat, useAdmin } from "./common";

type Area = "transport" | "firewall" | "edge" | "accounts" | "secrets" | "legal";
type Severity = "high" | "medium" | "low";
export type PostureCheck = { id: string; area: Area; title: string; ok: boolean; severity: Severity; detail: string; fix?: string };
type Posture = { score: number; checks: PostureCheck[]; activity: { blocked24h: number; bans: number; failedLogins24h: number; users: number; usersWithMfa: number } };

const AREAS: { id: Area; label: string; line: string }[] = [
  { id: "firewall", label: "Firewall", line: "The app's own firewall in front of every request." },
  { id: "edge", label: "Edge & network", line: "Cloudflare, and where visitor addresses come from." },
  { id: "accounts", label: "Accounts & sign-in", line: "Admins, two-step sign-in and sign-in email." },
  { id: "transport", label: "Transport", line: "HTTPS and how the server runs." },
  { id: "secrets", label: "Secrets", line: "Encryption of stored keys and signed webhooks." },
  { id: "legal", label: "Legal", line: "Details the law requires on the public pages." },
];

// Where each check is fixed in the console (checks fixed in the server's environment have no link).
const WHERE: Record<string, { tab: string; label: string }> = {
  "firewall-mode": { tab: "firewall", label: "Firewall" },
  "firewall-rules": { tab: "firewall", label: "Firewall" },
  "rate-limit": { tab: "firewall", label: "Firewall" },
  "auto-ban": { tab: "firewall", label: "Firewall" },
  "trust-proxy": { tab: "firewall", label: "Firewall" },
  cloudflare: { tab: "cloudflare", label: "Cloudflare" },
  "origin-lock": { tab: "cloudflare", label: "Cloudflare" },
  "admin-mfa-rule": { tab: "settings", label: "Settings" },
  "admin-mfa": { tab: "admins", label: "Admins" },
  "admin-ips": { tab: "settings", label: "Settings" },
  "failed-logins": { tab: "audit", label: "Audit log" },
  mail: { tab: "integrations", label: "Integrations" },
  "webhook-secrets": { tab: "integrations", label: "Integrations" },
  legal: { tab: "settings", label: "Settings" },
};

const SEV: Record<Severity, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "neutral" },
};

const grade = (s: number) => (s >= 85 ? { label: "Well protected", tone: "text-success", stroke: "var(--success)" } : s >= 60 ? { label: "Needs attention", tone: "text-warning", stroke: "var(--warning)" } : { label: "At risk", tone: "text-danger", stroke: "var(--danger)" });

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const g = grade(score);
  return (
    <div className="relative size-[136px] shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="9" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={g.stroke} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[34px] font-semibold tabular-nums tracking-[-0.03em]" data-testid="posture-score">{score}</span>
        <span className="-mt-1 text-[11px] text-subtle">out of 100</span>
      </div>
    </div>
  );
}

export function SecurityPosturePanel({ onGo }: { onGo?: (tab: string) => void }) {
  const q = useAdmin<Posture>("security/posture");
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { score, checks, activity } = q.data;
  const g = grade(score);
  const failing = checks.filter((c) => !c.ok);
  const highFailing = failing.filter((c) => c.severity === "high");
  const mfaPct = activity.users ? Math.round((activity.usersWithMfa / activity.users) * 100) : 0;
  // Failing checks first (most severe first), so the list reads as a to-do.
  const order = (c: PostureCheck) => (c.ok ? 10 : 0) + { high: 0, medium: 1, low: 2 }[c.severity];

  return (
    <div className="space-y-6" data-testid="security-posture">
      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <ScoreRing score={score} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cx("text-[20px] font-semibold tracking-[-0.02em]", g.tone)}>{g.label}</h3>
            <Badge tone={failing.length ? "warning" : "success"}>{checks.length - failing.length} of {checks.length} checks pass</Badge>
          </div>
          <p className="text-[13px] text-muted">
            Score from {checks.length} checks of this installation, weighted by severity (high counts 3, medium 2, low 1). Checked live just now from its configuration and the last 24 hours — not an external scan.
          </p>
          {highFailing.length > 0 ? (
            <p className="flex items-start gap-1.5 text-[13px] text-danger"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{highFailing.length} high-severity {highFailing.length === 1 ? "issue" : "issues"}: {highFailing.map((c) => c.title).join(" · ")}</p>
          ) : failing.length ? (
            <p className="text-[13px] text-muted">No high-severity issues. {failing.length} smaller {failing.length === 1 ? "one" : "ones"} below.</p>
          ) : (
            <p className="text-[13px] text-success">Every check passes.</p>
          )}
        </div>
        <Button size="sm" variant="ghost" icon={<RefreshCw className={cx("size-4", q.isFetching && "animate-spin")} />} onClick={() => void q.refetch()} className="self-start">Check again</Button>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Blocked requests · 24h" value={num(activity.blocked24h)} sub="by the app firewall" tone={activity.blocked24h ? "warning" : undefined} />
        <Stat label="Banned addresses" value={num(activity.bans)} sub="automatic and manual" />
        <Stat label="Failed sign-ins · 24h" value={num(activity.failedLogins24h)} sub={activity.failedLogins24h >= 200 ? "unusually many" : "wrong passwords and codes"} tone={activity.failedLogins24h >= 200 ? "danger" : undefined} />
        <Stat label="Two-step sign-in" value={`${mfaPct}%`} sub={`${num(activity.usersWithMfa)} of ${num(activity.users)} people`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {AREAS.map((a) => {
          const list = checks.filter((c) => c.area === a.id).sort((x, y) => order(x) - order(y));
          if (!list.length) return null;
          const bad = list.filter((c) => !c.ok).length;
          return (
            <Section key={a.id} title={a.label} sub={a.line} actions={<Badge tone={bad ? "warning" : "success"}>{bad ? `${bad} to fix` : "All good"}</Badge>}>
              <Card className="divide-y divide-border">
                {list.map((c) => {
                  const where = WHERE[c.id];
                  return (
                    <div key={c.id} className="flex gap-3 px-4 py-3 text-[13px]" data-testid={`check-${c.id}`}>
                      {c.ok ? <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-success" aria-label="Passes" /> : <XCircle className={cx("mt-0.5 size-[18px] shrink-0", c.severity === "low" ? "text-subtle" : c.severity === "medium" ? "text-warning" : "text-danger")} aria-label="Fails" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="font-medium">{c.title}</p>
                          {!c.ok && <Badge tone={SEV[c.severity].tone}>{SEV[c.severity].label}</Badge>}
                        </div>
                        <p className="mt-0.5 break-words text-muted">{c.detail}</p>
                        {!c.ok && c.fix && <p className="mt-1.5 text-fg"><span className="font-medium">Fix: </span>{c.fix}</p>}
                      </div>
                      {!c.ok && where && onGo && (
                        <button type="button" onClick={() => onGo(where.tab)} className="flex shrink-0 items-center gap-1 self-start rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-accent hover:bg-accent-soft">
                          <span className="hidden sm:inline">{where.label}</span><ArrowRight className="size-3.5" aria-label={`Open ${where.label}`} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </Card>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
