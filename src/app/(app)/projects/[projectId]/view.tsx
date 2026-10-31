"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Code2, ExternalLink, Inbox, PanelsTopLeft, Pencil, Rocket, User } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AnalyticsView } from "@/components/analytics";
import { BusinessKitCard } from "@/components/business-kit";
import { ProjectHome } from "@/components/project-home";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Field, Input, Skeleton, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { useProject } from "@/lib/client/use-project";

type Activity = {
  revisions: { path: string; revision: number; source: string; message: string | null; createdAt: string; authorName: string | null }[];
  tasks: { id: string; kind: string; status: string; input: { instruction?: string; brief?: string }; createdAt: string }[];
};
type Submission = { id: string; formId: string; data: Record<string, string>; createdAt: string };

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "accent"> = {
  succeeded: "success",
  awaiting_review: "accent",
  failed: "danger",
  cancelled: "neutral",
  running: "warning",
  queued: "neutral",
};

export function OverviewView({ projectId }: { projectId: string }) {
  const { org } = useSession();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const project = useProject(projectId);
  const initialTab = useSearchParams().get("tab");
  const [tab, setTab] = useState<"activity" | "analytics" | "submissions" | "settings">(initialTab === "analytics" || initialTab === "submissions" || initialTab === "settings" ? initialTab : "activity");
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const can = (p: string) => project.data?.permissions.includes(p) ?? false;

  const activity = useQuery({ queryKey: ["activity", projectId], queryFn: () => api<Activity>(`/api/v1/projects/${projectId}/activity`), enabled: tab === "activity" });
  const submissions = useQuery({
    queryKey: ["submissions", projectId],
    queryFn: () => api<{ submissions: Submission[] }>(`/api/v1/projects/${projectId}/submissions`),
    enabled: tab === "submissions" && can("submissions:read"),
  });

  const save = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}`, { method: "PATCH", body: form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects", org.id] });
      setEditOpen(false);
      toast({ tone: "success", title: "Project updated" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not save", description: errorMessage(e) }),
  });
  const archive = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", org.id] });
      toast({ tone: "success", title: "Project archived" });
      router.push("/projects");
    },
    onError: (e) => toast({ tone: "error", title: "Could not archive", description: errorMessage(e) }),
  });

  if (project.isPending) return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8"><Skeleton className="h-8 w-64" /><Skeleton className="mt-6 h-40" /></div>;
  if (project.isError) return <ErrorState title="Project unavailable" message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  const p = project.data.project;
  const liveUrl = p.productionDeploymentId ? `/s/${org.slug}/${p.slug}` : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-[-0.01em]">{p.name}</h1>
            {liveUrl ? <Badge tone="success">Live</Badge> : <Badge>Draft</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-muted">{p.description || "No description"}</p>
          {liveUrl && (
            <a href={liveUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
              <span className="font-mono text-xs">{liveUrl}</span> <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/projects/${projectId}/ide`} icon={<Code2 className="size-3.5" />}>
            AI IDE
          </ButtonLink>
          <ButtonLink href={`/projects/${projectId}/deployments`} icon={<Rocket className="size-3.5" />}>
            Deploy
          </ButtonLink>
          <ButtonLink href={`/projects/${projectId}/builder`} variant="primary" icon={<PanelsTopLeft className="size-3.5" />}>
            Open builder
          </ButtonLink>
        </div>
      </div>

      <ProjectHome projectId={projectId} name={p.name} liveUrl={liveUrl} />

      <BusinessKitCard projectId={projectId} canEdit={can("project:update")} />

      <Tabs
        className="mt-8"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "activity", label: "Activity" },
          { value: "analytics", label: "Analytics" },
          { value: "submissions", label: "Form submissions" },
          { value: "settings", label: "Settings" },
        ]}
      />

      <div className="mt-5">
        {tab === "activity" &&
          (activity.isPending ? (
            <Skeleton className="h-48" />
          ) : activity.isError ? (
            <ErrorState message={errorMessage(activity.error)} onRetry={() => activity.refetch()} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <Card>
                <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold">File changes</h2>
                <ul className="divide-y divide-border">
                  {activity.data.revisions.map((r, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-3 text-[13px]">
                      <span className="mt-0.5 text-muted">{r.source === "ai" ? <Bot className="size-4" aria-label="AI" /> : <User className="size-4" aria-label="Person" />}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate">
                          <span className="font-mono text-xs">{r.path}</span> <span className="text-subtle">r{r.revision}</span>
                        </p>
                        <p className="truncate text-muted">{r.message || (r.source === "user" ? "Edited" : r.source)}</p>
                      </div>
                      <span className="shrink-0 text-xs text-subtle" title={dateTime(r.createdAt)}>
                        {r.authorName ?? "—"} · {timeAgo(r.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold">AI tasks</h2>
                {activity.data.tasks.length === 0 ? (
                  <EmptyState title="No AI tasks yet" description="Ask the assistant in the builder or IDE." className="py-8" />
                ) : (
                  <ul className="divide-y divide-border">
                    {activity.data.tasks.map((t) => (
                      <li key={t.id} className="px-4 py-3 text-[13px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{t.kind === "code_edit" ? "Code change" : t.kind === "site_edit" ? "Design change" : "Plan"}</span>
                          <Badge tone={STATUS_TONE[t.status]}>{t.status.replace("_", " ")}</Badge>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-muted">{t.input.instruction ?? t.input.brief}</p>
                        <p className="mt-0.5 text-xs text-subtle">{timeAgo(t.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          ))}

        {tab === "analytics" && <AnalyticsView projectId={projectId} />}

        {tab === "submissions" &&
          (!can("submissions:read") ? (
            <Card><EmptyState title="No access" description="Your role cannot view form submissions." /></Card>
          ) : submissions.isPending ? (
            <Skeleton className="h-48" />
          ) : submissions.isError ? (
            <ErrorState message={errorMessage(submissions.error)} onRetry={() => submissions.refetch()} />
          ) : submissions.data.submissions.length === 0 ? (
            <Card>
              <EmptyState icon={<Inbox className="size-4" />} title="No submissions yet" description="Contact and booking forms on your deployed site store messages here." />
            </Card>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border text-xs text-subtle">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Received</th>
                    <th className="px-4 py-2.5 font-medium">Form</th>
                    <th className="px-4 py-2.5 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {submissions.data.submissions.map((s) => (
                    <tr key={s.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-muted">{dateTime(s.createdAt)}</td>
                      <td className="px-4 py-3"><Badge>{s.formId}</Badge></td>
                      <td className="px-4 py-3">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                          {Object.entries(s.data).filter(([, v]) => v).map(([k, v]) => (
                            <div key={k} className="contents">
                              <dt className="text-subtle capitalize">{k}</dt>
                              <dd className="break-words whitespace-pre-wrap">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}

        {tab === "settings" && (
          <div className="grid gap-4">
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h2 className="text-[13px] font-semibold">Name and description</h2>
                <p className="text-[13px] text-muted">Shown in your workspace. The site’s own title is set in the builder.</p>
              </div>
              <Button disabled={!can("project:update")} icon={<Pencil className="size-3.5" />} onClick={() => { setForm({ name: p.name, description: p.description }); setEditOpen(true); }}>
                Edit
              </Button>
            </Card>
            <Card className="flex flex-wrap items-center justify-between gap-3 border-danger/30 p-4">
              <div>
                <h2 className="text-[13px] font-semibold">Archive project</h2>
                <p className="text-[13px] text-muted">Hides the project and takes its published site offline. File history is kept.</p>
              </div>
              <Button variant="danger" disabled={!can("project:delete")} onClick={() => setArchiveOpen(true)}>
                Archive
              </Button>
            </Card>
          </div>
        )}
      </div>

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit project"
        footer={
          <>
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Name">{(f) => <Input {...f} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Description">{(f) => <Textarea {...f} value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => archive.mutate()}
        loading={archive.isPending}
        destructive
        title={`Archive ${p.name}?`}
        description="The published site will stop responding. This cannot be undone from the interface yet."
        confirmLabel="Archive project"
      />
    </div>
  );
}
