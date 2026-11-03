"use client";

// Workspace invitations waiting for you — sent to your username or email —
// at the top of every page, to join (or decline) right here.
import { useMutation, useQuery } from "@tanstack/react-query";
import { MailOpen } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlays";
import { switchOrg } from "./session-context";
import { api, errorMessage } from "@/lib/client/api";

type Invite = { id: string; orgName: string; role: string; inviter: string; expiresAt: string };

export function PendingInvites({ standalone = false }: { standalone?: boolean }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["my-invitations"], queryFn: () => api<{ invitations: Invite[] }>("/api/v1/auth/invitations"), refetchInterval: 120_000, staleTime: 60_000 });
  const answer = useMutation({
    mutationFn: (v: { id: string; accept: boolean }) => api<{ orgId: string; orgName: string; joined: boolean }>("/api/v1/auth/invitations", { method: "POST", body: v }),
    onSuccess: (r) => {
      if (!r.joined) return void q.refetch();
      toast({ tone: "success", title: `You joined ${r.orgName}` });
      switchOrg(r.orgId);
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const list = q.data?.invitations ?? [];
  if (!list.length) return standalone ? <p className="text-sm text-muted">Your account is not a member of any organization. Ask an owner to invite you — they can find you by your username.</p> : null;
  return (
    <div className={standalone ? "grid gap-3" : "grid gap-px"}>
      {list.map((i) => (
        <div key={i.id} className={standalone ? "flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4" : "flex flex-wrap items-center gap-3 bg-sky-500/10 px-4 py-2 text-[13px]"}>
          <MailOpen className="size-4 shrink-0 text-sky-600" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{i.inviter}</span> invited you to <span className="font-medium">{i.orgName}</span> as {i.role}
          </span>
          <span className="flex gap-1.5">
            <Button size="sm" variant="ghost" disabled={answer.isPending} onClick={() => answer.mutate({ id: i.id, accept: false })}>Decline</Button>
            <Button size="sm" variant="primary" loading={answer.isPending && answer.variables?.id === i.id && answer.variables.accept} onClick={() => answer.mutate({ id: i.id, accept: true })}>Join</Button>
          </span>
        </div>
      ))}
    </div>
  );
}
