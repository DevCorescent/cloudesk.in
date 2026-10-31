"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Eye, RotateCcw, Rocket, ScrollText } from "lucide-react";
import { useState } from "react";
import { DomainsCard } from "@/components/domains";
import { ExternalTargets } from "@/components/deploy/external";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton, StatusDot } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { useProject } from "@/lib/client/use-project";

type Deployment = { id: string; environment: string; adapter: string; status: string; error: string | null; sourceRevisions: Record<string, number> | null; branchName: string | null; createdAt: string; finishedAt: string | null; createdByName: string | null };
type Adapter = { id: string; name: string; implemented: boolean; description: string };
type LogLine = { ts: string; level: "info" | "warn" | "error"; msg: string };

const TONE = { ready: "success", failed: "danger", building: "warning", verifying: "warning", queued: "neutral", cancelled: "neutral" } as const;

export function DeploymentsView({ projectId }: { projectId: string }) {
  const { org } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const project = useProject(projectId);
  const [logFor, setLogFor] = useState<Deployment | null>(null);
  const [confirmProd, setConfirmProd] = useState(false);
  const [rollbackTo, setRollbackTo] = useState<Deployment | null>(null);
  const list = useQuery({ queryKey: ["deployments", projectId], queryFn: () => api<{ deployments: Deployment[]; productionDeploymentId: string | null; adapters: Adapter[] }>(`/api/v1/projects/${projectId}/deployments`) });
  const log = useQuery({ queryKey: ["deployment-log", logFor?.id], queryFn: () => api<{ log: LogLine[] }>(`/api/v1/projects/${projectId}/deployments/${logFor!.id}`), enabled: !!logFor });
  const can = (p: string) => project.data?.permissions.includes(p) ?? false;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["deployments", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };
  const deploy = useMutation({
    mutationFn: (environment: "preview" | "production") => api<{ deployment: Deployment }>(`/api/v1/projects/${projectId}/deployments`, { method: "POST", body: { environment } }),
    onSuccess: (r) => {
      refresh();
      setConfirmProd(false);
      if (r.deployment.status === "ready") toast({ tone: "success", title: r.deployment.environment === "production" ? "Live in production" : "Preview ready" });
      else toast({ tone: "error", title: "Deployment failed", description: r.deployment.error ?? undefined });
    },
    onError: (e) => toast({ tone: "error", title: "Could not deploy", description: errorMessage(e) }),
  });
  const promote = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/deployments/${id}/promote`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      setRollbackTo(null);
      toast({ tone: "success", title: "Production updated" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not promote", description: errorMessage(e) }),
  });

  const p = project.data?.project;
  const prodId = list.data?.productionDeploymentId;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Deployments"
        description="Each deployment validates the site, renders every page, checks links, and only then goes live."
        actions={
          <>
            <Button disabled={!can("deploy:preview")} loading={deploy.isPending && deploy.variables === "preview"} onClick={() => deploy.mutate("preview")} icon={<Eye className="size-3.5" />}>
              Deploy preview
            </Button>
            <Button variant="primary" disabled={!can("deploy:production")} onClick={() => setConfirmProd(true)} icon={<Rocket className="size-3.5" />}>
              Deploy to production
            </Button>
          </>
        }
      />

      {p && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-surface-2 text-muted">
              <Globe className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-[13px] font-medium">Production URL</p>
              {prodId ? (
                <a href={`/s/${org.slug}/${p.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline">
                  /s/{org.slug}/{p.slug} <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                <p className="text-xs text-muted">Not deployed yet. Production deploys are public; previews are visible only to members.</p>
              )}
            </div>
          </div>
        </Card>
      )}
      {project.data && (
        <div className="mt-4">
          <DomainsCard projectId={projectId} canManage={can("deploy:production")} live={!!prodId} />
        </div>
      )}
      {project.data && (
        <div className="mt-4 mb-4">
          <ExternalTargets projectId={projectId} canManage={can("deploy:production")} live={!!prodId} liveHref={p ? `/s/${org.slug}/${p.slug}` : undefined} />
        </div>
      )}

      {list.isPending ? (
        <Skeleton className="h-60" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.deployments.length === 0 ? (
        <Card>
          <EmptyState icon={<Rocket className="size-4" />} title="No deployments yet" description="Deploy a preview to see your site exactly as visitors will." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle">
              <tr>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Environment</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.deployments.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot tone={TONE[d.status as keyof typeof TONE] ?? "neutral"} label={d.status} />
                      {d.id === prodId && <Badge tone="success">Current production</Badge>}
                      {d.branchName && <Badge tone="accent">Branch: {d.branchName}</Badge>}
                    </div>
                    {d.error && <p className="mt-0.5 max-w-xs text-xs text-danger">{d.error}</p>}
                  </td>
                  <td className="px-4 py-3 capitalize">{d.environment}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{d.sourceRevisions ? Object.entries(d.sourceRevisions).map(([k, v]) => `${k}@r${v}`).join(", ") : "—"}</td>
                  <td className="px-4 py-3 text-muted" title={dateTime(d.createdAt)}>
                    {timeAgo(d.createdAt)} · {d.createdByName ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {d.status === "ready" && (
                        <ButtonLink href={`/sites/${d.id}`} external size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />}>
                          Visit
                        </ButtonLink>
                      )}
                      {d.status === "ready" && d.id !== prodId && !d.branchName && can("deploy:production") && (
                        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setRollbackTo(d)}>
                          Promote
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" icon={<ScrollText className="size-3.5" />} onClick={() => setLogFor(d)}>
                        Log
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={!!logFor} onClose={() => setLogFor(null)} title="Deployment log" description={logFor ? `${logFor.environment} · ${dateTime(logFor.createdAt)}` : undefined} size="lg">
        {log.isPending ? (
          <Skeleton className="h-40" />
        ) : log.isError ? (
          <ErrorState message={errorMessage(log.error)} />
        ) : (
          <pre className="max-h-[50vh] overflow-auto rounded-[var(--radius-md)] bg-surface-2 p-3 font-mono text-xs leading-relaxed">
            {log.data.log.map((l, i) => (
              <div key={i} className={l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warning" : "text-muted"}>
                <span className="text-subtle">{new Date(l.ts).toLocaleTimeString()}</span> {l.msg}
              </div>
            ))}
          </pre>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmProd}
        onClose={() => setConfirmProd(false)}
        onConfirm={() => deploy.mutate("production")}
        loading={deploy.isPending && deploy.variables === "production"}
        title="Deploy to production?"
        description="The current saved version becomes publicly visible. Blocking problems such as broken links stop the deploy."
        confirmLabel="Deploy"
      />
      <ConfirmDialog
        open={!!rollbackTo}
        onClose={() => setRollbackTo(null)}
        onConfirm={() => rollbackTo && promote.mutate(rollbackTo.id)}
        loading={promote.isPending}
        title="Make this deployment live?"
        description={rollbackTo ? `Production will serve the ${rollbackTo.environment} deployment from ${dateTime(rollbackTo.createdAt)}.` : ""}
        confirmLabel="Promote"
      />
    </div>
  );
}
