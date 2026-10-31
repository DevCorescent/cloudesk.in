"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Globe, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, useToast } from "./ui/overlays";
import { Badge, Button, Card, IconButton, Input, Notice, Skeleton } from "./ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";

type Domain = { id: string; hostname: string; status: "pending" | "verified" | "failed"; verificationToken: string; lastError: string | null; lastCheckedAt: string | null };
type Data = { domains: Domain[]; target: { cname: string; ipv4: string[] }; txtPrefix: string };

export function DomainsCard({ projectId, canManage, live }: { projectId: string; canManage: boolean; live: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["domains", projectId], queryFn: () => api<Data>(`/api/v1/projects/${projectId}/domains`) });
  const [host, setHost] = useState("");
  const [remove, setRemove] = useState<Domain | null>(null);
  const base = `/api/v1/projects/${projectId}/domains`;
  const refresh = () => qc.invalidateQueries({ queryKey: ["domains", projectId] });
  const add = useMutation({
    mutationFn: () => api(base, { method: "POST", body: { hostname: host } }),
    onSuccess: () => {
      setHost("");
      refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Could not add the domain", description: errorMessage(e) }),
  });
  const check = useMutation({
    mutationFn: (id: string) => api<{ domain: Domain }>(`${base}/${id}/check`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      refresh();
      toast(r.domain.status === "verified" ? { tone: "success", title: `${r.domain.hostname} is connected` } : { tone: "info", title: "Not ready yet", description: "DNS changes can take up to a few hours to spread." });
    },
    onError: (e) => toast({ tone: "error", title: "Check failed", description: errorMessage(e) }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemove(null);
      refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Could not remove", description: errorMessage(e) }),
  });
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast({ tone: "success", title: "Copied" }));

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-muted" aria-hidden />
        <h2 className="text-[13px] font-semibold">Custom domains</h2>
      </div>
      <p className="mt-0.5 text-xs text-muted">Serve your live site on your own address, like shop.yourbrand.com. Your store, checkout and order pages work there too.</p>
      {q.isPending ? (
        <Skeleton className="mt-3 h-16" />
      ) : q.isError ? (
        <p className="mt-3 text-[13px] text-danger">{errorMessage(q.error)}</p>
      ) : (
        <>
          {!q.data.target.cname && !q.data.target.ipv4.length && (
            <div className="mt-3">
              <Notice tone="warning" title="Platform DNS target not configured">The platform administrator must set CUSTOM_DOMAIN_CNAME (or CUSTOM_DOMAIN_IPV4) and put a TLS proxy in front of the app before customer domains can receive traffic. Ownership checks still work.</Notice>
            </div>
          )}
          <ul className="mt-3 space-y-3">
            {q.data.domains.map((d) => (
              <li key={d.id} className="rounded-[var(--radius-md)] border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-[13px]">{d.hostname}</span>
                    <Badge tone={d.status === "verified" ? "success" : d.status === "failed" ? "danger" : "warning"}>{d.status === "verified" ? "Connected" : d.status === "failed" ? "Check failing" : "Waiting for DNS"}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {d.status === "verified" && live && (
                      <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 px-2 text-xs text-accent hover:underline">
                        Visit <ExternalLink className="size-3" />
                      </a>
                    )}
                    {canManage && (
                      <>
                        <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={check.isPending && check.variables === d.id} onClick={() => check.mutate(d.id)}>
                          Check now
                        </Button>
                        <IconButton size="sm" label={`Remove ${d.hostname}`} icon={<Trash2 className="size-3.5" />} onClick={() => setRemove(d)} />
                      </>
                    )}
                  </div>
                </div>
                {d.status !== "verified" && (
                  <div className="mt-3 space-y-2 text-xs">
                    <p className="text-muted">Add these records at your domain provider (GoDaddy, Namecheap, Cloudflare…), then click Check now.</p>
                    <DnsRow type="TXT" name={`${q.data.txtPrefix}.${d.hostname}`} value={d.verificationToken} onCopy={copy} />
                    {q.data.target.cname && <DnsRow type="CNAME" name={d.hostname} value={q.data.target.cname} onCopy={copy} />}
                    {!q.data.target.cname && q.data.target.ipv4.map((ip) => <DnsRow key={ip} type="A" name={d.hostname} value={ip} onCopy={copy} />)}
                    {d.lastError && <p className="text-warning">{d.lastError}</p>}
                    {d.lastCheckedAt && <p className="text-subtle">Last checked {timeAgo(d.lastCheckedAt)}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canManage ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (host.trim()) add.mutate();
              }}
            >
              <Input aria-label="Domain" placeholder="shop.yourbrand.com" value={host} onChange={(e) => setHost(e.target.value)} className="max-w-xs font-mono text-xs" />
              <Button type="submit" icon={<Plus className="size-3.5" />} loading={add.isPending} disabled={!host.trim()}>
                Add domain
              </Button>
            </form>
          ) : (
            <p className="mt-3 text-xs text-muted">Only people who can publish to production can add domains.</p>
          )}
        </>
      )}
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} onConfirm={() => remove && del.mutate(remove.id)} loading={del.isPending} destructive title={`Remove ${remove?.hostname}?`} description="Visitors to this address will no longer reach your site. Your platform URL keeps working." confirmLabel="Remove domain" />
    </Card>
  );
}

function DnsRow({ type, name, value, onCopy }: { type: string; name: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-sm)] bg-surface-2 px-2 py-1.5 font-mono">
      <span className="font-sans font-medium">{type}</span>
      <span className="truncate" title={name}>{name}</span>
      <span className="truncate" title={value}>{value}</span>
      <IconButton size="sm" label={`Copy ${type} value`} icon={<Copy className="size-3.5" />} onClick={() => onCopy(value)} />
    </div>
  );
}
