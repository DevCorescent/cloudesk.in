"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/overlays";
import { Card, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

/** Owners and admins can require two-factor sign-in for everyone in the organization. */
export function OrgSecurityCard({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["org-security", orgId], queryFn: () => api<{ requireMfa: boolean; members: number; membersWithMfa: number }>(`/api/v1/orgs/${orgId}/security`) });
  const save = useMutation({
    mutationFn: (requireMfa: boolean) => api(`/api/v1/orgs/${orgId}/security`, { method: "PATCH", body: { requireMfa } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-security", orgId] }),
    onError: (e) => toast({ tone: "error", title: "Could not change the setting", description: errorMessage(e) }),
  });
  if (!q.data) return null;
  const missing = q.data.members - q.data.membersWithMfa;
  return (
    <Card className="mt-6 flex items-start gap-3 p-5">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">Require two-factor sign-in</p>
        <p className="mt-0.5 text-xs text-muted">
          {q.data.membersWithMfa} of {q.data.members} members use it.
          {q.data.requireMfa ? (missing ? ` ${missing} can't open projects until they turn it on.` : " Everyone is covered.") : " When required, members without it can't open projects until they turn it on."}
        </p>
      </div>
      <Switch label="Require two-factor sign-in" checked={q.data.requireMfa} disabled={!canManage || save.isPending} onChange={(v) => save.mutate(v)} />
    </Card>
  );
}
