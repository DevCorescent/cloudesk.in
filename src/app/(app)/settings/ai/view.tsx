"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, PlugZap, Unplug } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Skeleton } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";

type Provider = {
  id: string;
  name: string;
  description: string;
  implemented: boolean;
  docsUrl?: string;
  platformKeyAvailable: boolean;
  credential: { keyHint: string; status: string; lastVerifiedAt: string | null; lastError: string | null } | null;
};
type Model = { id: string; provider: string; label: string; inputPrice: number; outputPrice: number; capabilities: string[] };

export function ProvidersView() {
  const { org } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [disconnecting, setDisconnecting] = useState<Provider | null>(null);
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string>();
  const q = useQuery({ queryKey: ["providers", org.id], queryFn: () => api<{ providers: Provider[]; models: Model[]; routes: Record<string, string> }>(`/api/v1/orgs/${org.id}/providers`) });
  const canManage = ["owner", "admin"].includes(org.role);
  const refresh = () => qc.invalidateQueries({ queryKey: ["providers", org.id] });

  const save = useMutation({
    mutationFn: () => api(`/api/v1/orgs/${org.id}/providers/${connecting!.id}`, { method: "PUT", body: { apiKey: key } }),
    onSuccess: () => {
      refresh();
      setConnecting(null);
      setKey("");
      toast({ tone: "success", title: "Provider connected", description: "The key was verified and stored encrypted." });
    },
    onError: (e) => setKeyError(e instanceof ApiClientError ? (e.fieldErrors().apiKey?.[0] ?? e.message) : errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: (p: Provider) => api<{ ok: boolean; error?: string }>(`/api/v1/orgs/${org.id}/providers/${p.id}/test`, { method: "POST" }),
    onSuccess: (r) => {
      refresh();
      toast(r.ok ? { tone: "success", title: "Connection works" } : { tone: "error", title: "Connection failed", description: r.error });
    },
    onError: (e) => toast({ tone: "error", title: "Test failed", description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (p: Provider) => api(`/api/v1/orgs/${org.id}/providers/${p.id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      setDisconnecting(null);
      toast({ tone: "success", title: "Provider disconnected" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not disconnect", description: errorMessage(e) }),
  });

  if (q.isPending) return <Skeleton className="h-60" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  return (
    <div className="grid gap-6">
      {!canManage && <Notice>Only owners and admins can connect providers.</Notice>}
      <div className="grid gap-3">
        {q.data.providers.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{p.name}</h2>
                  {p.id === "builtin" ? (
                    <Badge tone="success">Always available</Badge>
                  ) : !p.implemented ? (
                    <Badge>Not implemented</Badge>
                  ) : p.credential?.status === "verified" ? (
                    <Badge tone="success">Connected</Badge>
                  ) : p.credential ? (
                    <Badge tone="danger">Error</Badge>
                  ) : p.platformKeyAvailable ? (
                    <Badge tone="accent">Platform key</Badge>
                  ) : (
                    <Badge>Not connected</Badge>
                  )}
                </div>
                <p className="mt-1 text-[13px] text-muted">{p.description}</p>
                {p.credential && (
                  <p className="mt-1.5 text-xs text-subtle">
                    Key <span className="font-mono">{p.credential.keyHint}</span>
                    {p.credential.lastVerifiedAt && ` · verified ${timeAgo(p.credential.lastVerifiedAt)}`}
                    {p.credential.lastError && <span className="text-danger"> · {p.credential.lastError}</span>}
                  </p>
                )}
                {!p.credential && p.platformKeyAvailable && <p className="mt-1.5 text-xs text-subtle">Using the platform’s shared key. Add your own to bill usage to your account.</p>}
              </div>
              {p.implemented && p.id !== "builtin" && canManage && (
                <div className="flex gap-2">
                  {p.credential && (
                    <>
                      <Button size="sm" loading={test.isPending && test.variables?.id === p.id} onClick={() => test.mutate(p)} icon={<PlugZap className="size-3.5" />}>
                        Test
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDisconnecting(p)} icon={<Unplug className="size-3.5" />}>
                        Disconnect
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant={p.credential ? "secondary" : "primary"} icon={<KeyRound className="size-3.5" />} onClick={() => { setKey(""); setKeyError(undefined); setConnecting(p); }}>
                    {p.credential ? "Replace key" : "Connect"}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold">Task routing</h2>
        <Card>
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle">
              <tr>
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 font-medium">Model</th>
                <th className="px-4 py-2.5 font-medium">Price per 1M tokens (in / out)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(q.data.routes).map(([task, modelId]) => {
                const m = q.data.models.find((x) => x.id === modelId);
                return (
                  <tr key={task}>
                    <td className="px-4 py-2.5 capitalize">{task.replace("_", " ")}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{m?.label ?? modelId}</td>
                    <td className="px-4 py-2.5 text-muted tabular-nums">{m ? `$${m.inputPrice} / $${m.outputPrice}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <p className="mt-2 text-xs text-subtle">Without a connected model, planning falls back to built-in rules and design edits accept a small set of commands such as “Add a pricing section”.</p>
      </section>

      <Dialog
        open={!!connecting}
        onClose={() => setConnecting(null)}
        title={`Connect ${connecting?.name}`}
        description="The key is verified with the provider, then encrypted at rest. It is never shown again or sent to the browser."
        footer={
          <>
            <Button onClick={() => setConnecting(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} disabled={key.trim().length < 20} onClick={() => save.mutate()}>
              Verify and save
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="API key" error={keyError} hint={connecting?.docsUrl ? <>Create a key in the provider console. Docs: <a className="underline" href={connecting.docsUrl} target="_blank" rel="noreferrer">{connecting.docsUrl}</a></> : undefined}>
            {(p) => <Input {...p} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" autoFocus />}
          </Field>
        </form>
      </Dialog>
      <ConfirmDialog
        open={!!disconnecting}
        onClose={() => setDisconnecting(null)}
        onConfirm={() => disconnecting && remove.mutate(disconnecting)}
        loading={remove.isPending}
        destructive
        title={`Disconnect ${disconnecting?.name}?`}
        description="The stored key is deleted. AI features fall back to built-in rules unless a platform key is configured."
        confirmLabel="Disconnect"
      />
    </div>
  );
}
