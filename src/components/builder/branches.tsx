"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ExternalLink, GitBranch, GitMerge, Plus, Rocket, Trash2, X } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { ConfirmDialog, Dialog, useToast } from "../ui/overlays";
import { Badge, Button, Field, Input, Notice, Spinner } from "../ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";

export type BranchRow = { id: string; name: string; description: string; revision: number; updatedAt: string; mergedAt: string | null; createdByName: string | null; mainChanged: boolean };
type Conflict = { id: string; label: string; main: unknown; branch: unknown };
type Preview = { into: "main" | "branch"; branchRevision: number; mainRevision: number; incoming: number; conflicts: Conflict[]; upToDate: boolean; problems: string[] };

export function useBranches(projectId: string, enabled = true) {
  return useQuery({ queryKey: ["branches", projectId], queryFn: () => api<{ mainRevision: number; branches: BranchRow[] }>(`/api/v1/projects/${projectId}/branches`), enabled });
}

/** Lists branches; create, open or delete them. */
export function BranchesDialog({ projectId, open, onClose, canWrite, currentId, onOpen }: { projectId: string; open: boolean; onClose: () => void; canWrite: boolean; currentId: string | null; onOpen: (id: string | null) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useBranches(projectId, open);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deleting, setDeleting] = useState<BranchRow | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ branch: { id: string } }>(`/api/v1/projects/${projectId}/branches`, { method: "POST", body: { name, description } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["branches", projectId] });
      setName("");
      setDescription("");
      onOpen(r.branch.id);
    },
    onError: (e) => toast({ tone: "error", title: "Could not create the branch", description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/branches/${id}`, { method: "DELETE" }),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["branches", projectId] });
      setDeleting(null);
      if (id === currentId) onOpen(null);
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete the branch", description: errorMessage(e) }),
  });
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Branches" description="Try a redesign without touching the live site. A branch is a separate copy of the design: edit it, preview it, share it, then merge it back. Only parts both sides changed need a decision.">
      <div className="space-y-4">
        {canWrite && (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali look" maxLength={60} required />}</Field>
            <Field label="What are you trying? (optional)">{(a) => <Input {...a} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Festive colours and a sale banner" maxLength={300} />}</Field>
            <Button type="submit" variant="primary" icon={<Plus className="size-3.5" />} loading={create.isPending} disabled={!name.trim()}>
              Create from main
            </Button>
          </form>
        )}
        {q.isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border text-[13px]">
            <li className={clsx("flex items-center justify-between gap-2 px-3 py-2", !currentId && "bg-accent-soft/40")}>
              <span>
                <span className="font-medium">Main</span> <span className="text-xs text-muted">· the version that gets published</span>
              </span>
              {currentId ? (
                <Button size="sm" variant="ghost" onClick={() => onOpen(null)}>
                  Open
                </Button>
              ) : (
                <Badge tone="accent">Editing</Badge>
              )}
            </li>
            {(q.data?.branches ?? []).map((b) => (
              <li key={b.id} className={clsx("flex flex-wrap items-center justify-between gap-2 px-3 py-2", b.id === currentId && "bg-accent-soft/40")}>
                <span className="min-w-0">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <GitBranch className="size-3.5 text-muted" aria-hidden /> {b.name}
                  </span>{" "}
                  {b.mergedAt && <Badge tone="success">Merged {timeAgo(b.mergedAt)}</Badge>} {b.mainChanged && <Badge tone="warning">Main has newer changes</Badge>}
                  <span className="block text-xs text-muted">
                    {b.description ? `${b.description} · ` : ""}updated {timeAgo(b.updatedAt)}
                    {b.createdByName ? ` · by ${b.createdByName}` : ""}
                  </span>
                </span>
                <span className="flex gap-1">
                  {b.id === currentId ? (
                    <Badge tone="accent">Editing</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => onOpen(b.id)}>
                      Open
                    </Button>
                  )}
                  {canWrite && <Button size="sm" variant="ghost" aria-label={`Delete ${b.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(b)} />}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">AI edits and version history work on main. Comments and presence are shared across branches.</p>
      </div>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        destructive
        title={`Delete "${deleting?.name}"?`}
        description={deleting?.mergedAt ? "The branch was merged; main keeps the merged changes. Edits made after the merge are lost." : "This branch was never merged. Its changes are lost for good; main is not affected."}
        confirmLabel="Delete branch"
      />
    </Dialog>
  );
}

function show(v: unknown) {
  if (v === null || v === undefined) return <em className="text-muted">(removed)</em>;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return <span className="break-words">{s.length > 220 ? `${s.slice(0, 220)}…` : s}</span>;
}

/** Reviews a merge in either direction and asks only about real conflicts. */
export function MergeDialog({ projectId, branch, into, open, onClose, onDone, flush }: { projectId: string; branch: { id: string; name: string }; into: "main" | "branch"; open: boolean; onClose: () => void; onDone: () => void; flush: () => Promise<boolean> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [choices, setChoices] = useState<Record<string, "main" | "branch">>({});
  const q = useQuery({
    queryKey: ["merge", projectId, branch.id, into],
    queryFn: async () => {
      // Merge what is on screen, not an older save.
      if (!(await flush())) throw new Error("Save your changes first (they could not be saved).");
      return api<Preview>(`/api/v1/projects/${projectId}/branches/${branch.id}/merge?into=${into}`);
    },
    enabled: open,
    gcTime: 0,
    retry: false,
  });
  const merge = useMutation({
    mutationFn: (p: Preview) => api(`/api/v1/projects/${projectId}/branches/${branch.id}/merge`, { method: "POST", body: { into, mainRevision: p.mainRevision, branchRevision: p.branchRevision, resolutions: choices } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches", projectId] });
      toast({ tone: "success", title: into === "main" ? `Merged "${branch.name}" into main` : "Branch updated from main", description: into === "main" ? "Main now has the changes. Publish when you are ready." : undefined });
      setChoices({});
      onDone();
    },
    onError: (e) => {
      toast({ tone: "error", title: "Could not merge", description: errorMessage(e) });
      void q.refetch();
    },
  });
  const p = q.data;
  const sideOf = (c: Conflict) => choices[c.id];
  const open_ = p?.conflicts.filter((c) => !sideOf(c)).length ?? 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={into === "main" ? `Merge "${branch.name}" into main` : `Update "${branch.name}" from main`}
      description={into === "main" ? "The branch's changes are applied to main. Nothing is published until you publish." : "Newer changes on main are brought into this branch. Main is not changed."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<GitMerge className="size-3.5" />} loading={merge.isPending} disabled={!p || p.upToDate || open_ > 0} onClick={() => p && merge.mutate(p)}>
            {open_ > 0 ? `Decide ${open_} more` : into === "main" ? "Merge into main" : "Update branch"}
          </Button>
        </>
      }
    >
      {q.isLoading || q.isFetching ? (
        <Spinner label="Comparing versions" />
      ) : q.error ? (
        <Notice tone="danger">{errorMessage(q.error)}</Notice>
      ) : p ? (
        <div className="space-y-3 text-[13px]">
          {p.upToDate ? (
            <Notice tone="success">{into === "main" ? "Main already has everything from this branch." : "This branch already has everything from main."}</Notice>
          ) : (
            <p>
              {p.incoming} change{p.incoming === 1 ? "" : "s"} will come in from {into === "main" ? "the branch" : "main"}.{" "}
              {p.conflicts.length ? `${p.conflicts.length} part${p.conflicts.length === 1 ? " was" : "s were"} changed on both sides — choose which version to keep:` : "No conflicts."}
            </p>
          )}
          {p.problems.length > 0 && <Notice tone="warning" title="The combined site has problems">{p.problems.slice(0, 5).join(" · ")}</Notice>}
          {p.conflicts.length > 0 && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setChoices(Object.fromEntries(p.conflicts.map((c) => [c.id, "main"])))}>
                Keep all from main
              </Button>
              <Button size="sm" onClick={() => setChoices(Object.fromEntries(p.conflicts.map((c) => [c.id, "branch"])))}>
                Take all from the branch
              </Button>
            </div>
          )}
          <ul className="space-y-2">
            {p.conflicts.map((c) => (
              <li key={c.id} className="rounded-[var(--radius-md)] border border-border p-2.5">
                <p className="mb-2 text-xs font-medium">{c.label}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["main", "branch"] as const).map((side) => (
                    <label key={side} className={clsx("flex cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border p-2 text-xs", sideOf(c) === side ? "border-accent bg-accent-soft/40" : "border-border hover:bg-surface-2")}>
                      <input type="radio" name={c.id} className="mt-0.5" checked={sideOf(c) === side} onChange={() => setChoices((x) => ({ ...x, [c.id]: side }))} />
                      <span className="min-w-0">
                        <span className="block font-medium">{side === "main" ? "Main" : `Branch "${branch.name}"`}</span>
                        <span className="text-muted">{show(side === "main" ? c.main : c.branch)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

/** Shown under the builder header while a branch is open. */
export function BranchBar({
  projectId,
  branch,
  canWrite,
  canDeploy,
  flush,
  onExit,
  onMerge,
  onSync,
}: {
  projectId: string;
  branch: BranchRow;
  canWrite: boolean;
  canDeploy: boolean;
  flush: () => Promise<boolean>;
  onExit: () => void;
  onMerge: () => void;
  onSync: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);
  const deploy = useMutation({
    mutationFn: async () => {
      if (!(await flush())) throw new Error("Save your changes first (they could not be saved).");
      return api<{ deployment: { id: string; status: string; error: string | null } }>(`/api/v1/projects/${projectId}/branches/${branch.id}/deploy`, { method: "POST", body: {} });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["deployments", projectId] });
      if (r.deployment.status === "ready") setPreview(`/sites/${r.deployment.id}`);
      else toast({ tone: "error", title: "Preview failed", description: r.deployment.error ?? "See the deployment log." });
    },
    onError: (e) => toast({ tone: "error", title: "Preview failed", description: errorMessage(e) }),
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent-soft/50 px-4 py-1.5 text-[13px]">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <GitBranch className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="truncate">
          Editing branch <strong>{branch.name}</strong> — the live site is not affected.
        </span>
        {branch.mainChanged && <Badge tone="warning">Main has newer changes</Badge>}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {preview && (
          <a href={preview} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 text-xs font-medium text-accent hover:underline">
            Open preview <ExternalLink className="size-3" />
          </a>
        )}
        {canDeploy && (
          <Button size="sm" variant="ghost" icon={<Rocket className="size-3.5" />} loading={deploy.isPending} onClick={() => deploy.mutate()}>
            Preview branch
          </Button>
        )}
        {canWrite && branch.mainChanged && (
          <Button size="sm" variant="ghost" icon={<ArrowDownToLine className="size-3.5" />} onClick={onSync}>
            Update from main
          </Button>
        )}
        {canWrite && (
          <Button size="sm" variant="primary" icon={<GitMerge className="size-3.5" />} onClick={onMerge}>
            Merge into main
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={onExit}>
          Back to main
        </Button>
      </span>
    </div>
  );
}
