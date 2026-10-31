"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FlaskConical, Lightbulb, Rocket, Settings2, Sparkles, Square, Store, TrendingUp, Wand2, X } from "lucide-react";
import { useState } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, ErrorState, Notice, Skeleton, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { useProject } from "@/lib/client/use-project";
import { formatMoney } from "@/lib/store/money";

type Metric = "submit" | "cart_add" | "checkout" | "order";
type Opp = {
  key: string;
  kind: "test" | "store" | "design";
  title: string;
  why: string;
  evidence: string[];
  impact: "high" | "medium" | "low";
  page?: string;
  test?: { path: string; metric: Metric; hypothesis: string; aiWritable: boolean };
  action?: { type: string; label: string; href?: string };
};
type Live = { A: { views: number; conversions: number }; B: { views: number; conversions: number }; rateA: number; rateB: number; confidence: number | null; verdict: string; uplift: number | null; days: number };
type Exp = {
  id: string;
  path: string;
  title: string;
  hypothesis: string;
  metric: Metric;
  status: "running" | "won" | "lost" | "inconclusive" | "stopped";
  source: string;
  outcome: string;
  startedAt: string;
  endedAt: string | null;
  change: { variant?: string; props?: Record<string, string>; before?: { variant?: string; props?: Record<string, string> } };
  result: (Live & { impact: { extra: number; unit: string; revenue: number | null; currency: string | null } | null; published: { ok: boolean; error?: string } | null }) | null;
  live: Live | null;
};
type Data = { settings: { autoApplyWinners: boolean; autoPublish: boolean; autoStart: boolean }; opportunities: Opp[]; experiments: Exp[]; aiAvailable: boolean; live: boolean };

const METRIC: Record<Metric, string> = { submit: "form submissions", cart_add: "add-to-carts", checkout: "checkouts", order: "orders" };
const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.01 ? 2 : 1)}%`;
const MAX_DAYS = 28;

export function GrowthView({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["growth", projectId], queryFn: () => api<Data>(`/api/v1/projects/${projectId}/growth`), refetchInterval: 60_000 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [needsPublish, setNeedsPublish] = useState(false);
  const can = (p: string) => project.data?.permissions.includes(p) ?? false;
  const base = `/api/v1/projects/${projectId}/growth`;
  const done = () => qc.invalidateQueries({ queryKey: ["growth", projectId] });

  const start = useMutation({
    mutationFn: (v: { opportunityKey: string; publish: boolean }) => api<{ published: { ok: boolean; error?: string } | null }>(`${base}/tests`, { method: "POST", body: v }),
    onSuccess: (r, v) => {
      done();
      qc.invalidateQueries({ queryKey: ["file", projectId] });
      if (v.publish && r.published && !r.published.ok) toast({ tone: "error", title: "Test saved, but publishing failed", description: r.published.error });
      else toast({ tone: "success", title: v.publish ? "Test is live" : "Test added to your draft", description: v.publish ? "Half of visitors now see the new version." : "Publish your site to start showing it to visitors." });
      if (!v.publish) setNeedsPublish(true);
    },
    onError: (e) => toast({ tone: "error", title: "Could not start the test", description: errorMessage(e) }),
  });
  const act = useMutation({
    mutationFn: (key: string) => api<{ done: string; needsPublish: boolean }>(`${base}/opportunities/${key}/apply`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      done();
      toast({ tone: "success", title: "Done", description: r.done });
      if (r.needsPublish) setNeedsPublish(true);
    },
    onError: (e) => toast({ tone: "error", title: "Could not apply", description: errorMessage(e) }),
  });
  const dismiss = useMutation({ mutationFn: (key: string) => api(`${base}/opportunities/${key}/dismiss`, { method: "POST", body: {} }), onSuccess: done });
  const testAction = useMutation({
    mutationFn: (v: { id: string; action: "stop" | "apply" }) => api(`${base}/tests/${v.id}/${v.action}`, { method: "POST", body: {} }),
    onSuccess: (_r, v) => {
      done();
      setNeedsPublish(true);
      toast({ tone: "success", title: v.action === "stop" ? "Test stopped — the original stays" : "Winning version applied to your design" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not update the test", description: errorMessage(e) }),
  });
  const publish = useMutation({
    mutationFn: () => api(`${base}/publish`, { method: "POST", body: {} }),
    onSuccess: () => {
      setNeedsPublish(false);
      done();
      toast({ tone: "success", title: "Published", description: "Your live site now has these changes." });
    },
    onError: (e) => toast({ tone: "error", title: "Could not publish", description: errorMessage(e) }),
  });

  if (q.isPending || project.isPending)
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-64" />
      </div>
    );
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const running = d.experiments.filter((e) => e.status === "running");
  const finished = d.experiments.filter((e) => e.status !== "running");
  const wins = finished.filter((e) => e.status === "won");
  const tests = d.opportunities.filter((o) => o.kind === "test");
  const fixes = d.opportunities.filter((o) => o.kind !== "test");
  const editor = can("design:write");
  const publisher = can("deploy:production");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
            <TrendingUp className="size-5 text-accent" /> Growth
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">Your site tests improvements on real visitors and keeps what measurably works. Every test shows the new version to half of visitors; nothing replaces your original unless it wins.</p>
        </div>
        <div className="flex gap-2">
          {editor && (
            <Button icon={<Settings2 className="size-3.5" />} onClick={() => setSettingsOpen(true)}>
              Autopilot{d.settings.autoStart ? " · on" : ""}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted">Tests running</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{running.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Winners found</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {wins.length}
            <span className="ml-1 text-sm font-normal text-muted">of {finished.filter((e) => e.status !== "stopped").length} finished</span>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Estimated monthly gain from winners</p>
          <ImpactTotal wins={wins} />
        </Card>
      </div>

      {!d.live && (
        <div className="mt-4">
          <Notice tone="warning" title="Your site isn't published yet" action={<ButtonLink size="sm" href={`/projects/${projectId}/deployments`}>Publish</ButtonLink>}>
            Tests run on real visitors to your live site. You can prepare tests now; they start counting once the site is published.
          </Notice>
        </div>
      )}
      {needsPublish && d.live && (
        <div className="mt-4">
          <Notice tone="accent" title="Changes are in your draft" action={publisher ? <Button size="sm" variant="primary" icon={<Rocket className="size-3.5" />} loading={publish.isPending} onClick={() => publish.mutate()}>Publish now</Button> : undefined}>
            {publisher ? "Publish to put them on your live site." : "Ask someone who can publish to production to make them live."}
          </Notice>
        </div>
      )}

      <Section title="Running tests" icon={<FlaskConical className="size-4" />}>
        {running.length === 0 ? (
          <p className="text-[13px] text-muted">No tests running. Start one from the suggestions below.</p>
        ) : (
          <div className="grid gap-3">
            {running.map((e) => (
              <RunningCard key={e.id} e={e} canEdit={editor} stopping={testAction.isPending} onStop={() => testAction.mutate({ id: e.id, action: "stop" })} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Tests to try" icon={<Lightbulb className="size-4" />} hint={d.aiAvailable ? "Includes AI-written headlines." : "Connect an AI provider to also get AI-written headline tests."}>
        {tests.length === 0 ? (
          <p className="text-[13px] text-muted">No new test ideas right now. Pages with a running test are skipped, and ideas you have tried or dismissed are not repeated.</p>
        ) : (
          <div className="grid gap-3">
            {tests.map((o) => (
              <OppCard key={o.key} o={o} onDismiss={editor ? () => dismiss.mutate(o.key) : undefined}>
                {editor && (
                  <>
                    <Button size="sm" loading={start.isPending && start.variables?.opportunityKey === o.key && !start.variables.publish} icon={o.test?.aiWritable ? <Wand2 className="size-3.5" /> : <FlaskConical className="size-3.5" />} onClick={() => start.mutate({ opportunityKey: o.key, publish: false })}>
                      {o.test?.aiWritable ? "Write with AI and add test" : "Add test to draft"}
                    </Button>
                    {publisher && d.live && (
                      <Button size="sm" variant="primary" loading={start.isPending && start.variables?.opportunityKey === o.key && start.variables.publish} icon={<Rocket className="size-3.5" />} onClick={() => start.mutate({ opportunityKey: o.key, publish: true })}>
                        Start now
                      </Button>
                    )}
                  </>
                )}
              </OppCard>
            ))}
          </div>
        )}
      </Section>

      <Section title="Quick wins" icon={<Store className="size-4" />} hint="Based on your sales, stock, shipping and design.">
        {fixes.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing to fix right now.</p>
        ) : (
          <div className="grid gap-3">
            {fixes.map((o) => (
              <OppCard key={o.key} o={o} onDismiss={editor ? () => dismiss.mutate(o.key) : undefined}>
                {o.action?.type === "link" ? (
                  <ButtonLink size="sm" href={o.action.href === "builder" ? `/projects/${projectId}/builder` : `/projects/${projectId}/store/${o.action.href}`} icon={<ArrowRight className="size-3.5" />}>
                    {o.action.label}
                  </ButtonLink>
                ) : (
                  o.action && (
                    <Button size="sm" variant="primary" loading={act.isPending && act.variables === o.key} icon={<Check className="size-3.5" />} onClick={() => act.mutate(o.key)}>
                      {o.action.label}
                    </Button>
                  )
                )}
              </OppCard>
            ))}
          </div>
        )}
      </Section>

      <Section title="Results" icon={<Sparkles className="size-4" />}>
        {finished.length === 0 ? (
          <EmptyState title="No finished tests yet" description={`A test ends when one version wins with 95% confidence (at least 100 visits per group), or after ${MAX_DAYS} days without a clear winner.`} />
        ) : (
          <div className="grid gap-3">
            {finished.map((e) => (
              <ResultCard key={e.id} e={e} canApply={editor} applying={testAction.isPending} onApply={() => testAction.mutate({ id: e.id, action: "apply" })} />
            ))}
          </div>
        )}
      </Section>

      {settingsOpen && <AutopilotDialog projectId={projectId} settings={d.settings} canPublish={publisher} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function Section({ title, icon, hint, children }: { title: string; icon: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted">{icon}</span>
          {title}
        </h2>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ImpactTotal({ wins }: { wins: Exp[] }) {
  const applied = wins.filter((w) => w.result?.impact && w.outcome.startsWith("applied"));
  const byCurrency = new Map<string, number>();
  for (const w of applied) if (w.result?.impact?.revenue && w.result.impact.currency) byCurrency.set(w.result.impact.currency, (byCurrency.get(w.result.impact.currency) ?? 0) + w.result.impact.revenue);
  if (!byCurrency.size) return <p className="mt-1 text-sm text-muted">Shown once a winner is applied</p>;
  return (
    <p className="mt-1 text-2xl font-semibold tabular-nums">
      {[...byCurrency.entries()].map(([c, v]) => formatMoney(v, c)).join(" + ")}
      <span className="block text-xs font-normal text-subtle">Estimate from test results at current traffic</span>
    </p>
  );
}

function Bars({ live, metric }: { live: Live; metric: Metric }) {
  const max = Math.max(live.rateA, live.rateB, 0.0001);
  const row = (label: string, rate: number, conv: number, views: number, b: boolean) => (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className={b ? "font-medium" : "text-muted"}>{label}</span>
        <span className="tabular-nums">
          <span className="font-medium">{pct(rate)}</span>
          <span className="ml-2 text-xs text-muted">
            {conv} {METRIC[metric]} / {views} visits
          </span>
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface-2">
        <div className={cx("h-2 rounded-full", b ? "bg-accent" : "bg-border-strong")} style={{ width: `${(rate / max) * 100}%`, minWidth: rate ? 4 : 0 }} />
      </div>
    </div>
  );
  return (
    <div className="space-y-2.5">
      {row("Original (A)", live.rateA, live.A.conversions, live.A.views, false)}
      {row("New version (B)", live.rateB, live.B.conversions, live.B.views, true)}
    </div>
  );
}

function changeSummary(e: Exp) {
  const b = e.change.props ?? {};
  const a = e.change.before?.props ?? {};
  const parts = Object.keys(b).map((k) => `“${a[k] ?? ""}” → “${b[k]}”`);
  if (e.change.variant) parts.push(`layout ${e.change.before?.variant ?? "current"} → ${e.change.variant}`);
  return parts.join(" · ");
}

function RunningCard({ e, canEdit, onStop, stopping }: { e: Exp; canEdit: boolean; onStop: () => void; stopping: boolean }) {
  const live = e.live!;
  const minViews = Math.min(live.A.views, live.B.views);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{e.title}</p>
            {e.source === "ai" && <Badge tone="accent">AI-written</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted">{changeSummary(e)}</p>
        </div>
        {canEdit && (
          <Button size="sm" variant="ghost" icon={<Square className="size-3.5" />} loading={stopping} onClick={onStop}>
            Stop
          </Button>
        )}
      </div>
      <div className="mt-4">
        <Bars live={live} metric={e.metric} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          Day {live.days} of up to {MAX_DAYS}
        </span>
        <span>Measuring {METRIC[e.metric]} per visit on {e.path}</span>
        <span>{minViews < 100 ? `Needs ${100 - minViews} more visits in the smaller group before a result` : live.confidence !== null ? `${(live.confidence * 100).toFixed(0)}% confident · ${live.verdict}` : live.verdict}</span>
      </div>
    </Card>
  );
}

function ResultCard({ e, canApply, onApply, applying }: { e: Exp; canApply: boolean; onApply: () => void; applying: boolean }) {
  const r = e.result;
  const tone = { won: "success", lost: "neutral", inconclusive: "neutral", stopped: "neutral", running: "accent" }[e.status] as "success" | "neutral" | "accent";
  const label = { won: "Winner found", lost: "Original was better", inconclusive: "No clear winner", stopped: "Stopped", running: "" }[e.status];
  const outcome = e.outcome.startsWith("skipped") ? e.outcome.replace(/^skipped: /, "Not applied: ") : ({ applied: "Winning version is in your design", applied_published: "Winning version is live", awaiting_apply: "Ready to apply", kept_original: "Original kept" } as Record<string, string>)[e.outcome] ?? "";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{label}</Badge>
            <p className="text-sm font-semibold">{e.title}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {changeSummary(e)} · ended {e.endedAt ? timeAgo(e.endedAt) : ""}
          </p>
        </div>
        {e.status === "won" && e.outcome === "awaiting_apply" && canApply && (
          <Button size="sm" variant="primary" loading={applying} icon={<Check className="size-3.5" />} onClick={onApply}>
            Apply winner
          </Button>
        )}
      </div>
      {r && (
        <div className="mt-3">
          <Bars live={r} metric={e.metric} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {r?.uplift !== null && r?.uplift !== undefined && e.status === "won" && <span className="font-medium text-success">+{(r.uplift * 100).toFixed(0)}% {METRIC[e.metric]} per visit</span>}
        {r?.impact && r.impact.extra > 0 && (
          <span>
            Est. +{r.impact.extra} {r.impact.unit}/month{r.impact.revenue && r.impact.currency ? ` (≈ ${formatMoney(r.impact.revenue, r.impact.currency)})` : ""} at current traffic
          </span>
        )}
        {outcome && <span>{outcome}</span>}
        {r?.published && !r.published.ok && <span className="text-danger">Automatic publish failed: {r.published.error}</span>}
      </div>
    </Card>
  );
}

function OppCard({ o, children, onDismiss }: { o: Opp; children?: React.ReactNode; onDismiss?: () => void }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={o.impact === "high" ? "success" : o.impact === "medium" ? "accent" : "neutral"}>{o.impact === "high" ? "High impact" : o.impact === "medium" ? "Medium impact" : "Low impact"}</Badge>
            <p className="text-sm font-semibold">{o.title}</p>
          </div>
          <p className="mt-1 text-[13px] text-muted">{o.why}</p>
          {o.evidence.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-subtle">
              {o.evidence.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          )}
        </div>
        {onDismiss && <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={onDismiss} aria-label={`Dismiss: ${o.title}`} />}
      </div>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </Card>
  );
}

function AutopilotDialog({ projectId, settings, canPublish, onClose }: { projectId: string; settings: Data["settings"]; canPublish: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState(settings);
  const save = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/growth/settings`, { method: "PUT", body: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["growth", projectId] });
      toast({ tone: "success", title: "Autopilot updated" });
      onClose();
    },
    onError: (e) => toast({ tone: "error", title: "Could not save", description: errorMessage(e) }),
  });
  const row = (label: string, hint: string, k: keyof typeof s, disabled = false) => (
    <label className={cx("flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-border p-3 text-[13px]", disabled && "opacity-60")}>
      <span>
        <span className="font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted">{hint}</span>
      </span>
      <Switch checked={s[k]} disabled={disabled} onChange={(v) => setS({ ...s, [k]: v })} label={label} />
    </label>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Growth autopilot"
      description="Choose how much the autopilot does on its own. It checks results every hour and emails owners and admins when a test ends."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        {row("Apply winners to my design", "When a new version wins, put it in your draft design automatically. Losing versions are always removed.", "autoApplyWinners")}
        {row("Publish automatically", "Publish to your live site after applying a winner or starting a test. Off: you publish yourself.", "autoPublish", !canPublish)}
        {row("Start tests on its own", "When a busy page has no test, start the most promising built-in test (never AI-written copy). Needs a published site.", "autoStart", !canPublish)}
        {!canPublish && <p className="text-xs text-muted">Only people who can publish to production can turn on automatic publishing or starting.</p>}
        <p className="text-xs text-muted">Results are judged at 95% confidence with at least 100 visits per group. Small sites may take weeks per test.</p>
      </div>
    </Dialog>
  );
}
