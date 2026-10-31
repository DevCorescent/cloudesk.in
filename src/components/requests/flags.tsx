"use client";

// Release flags in the browser: features delivered through a feature request
// (to everyone or to chosen workspaces) switch on with `useFlag("fr-…")`, or
// by wrapping them in <WhenFlag flag="fr-…">. The server checks the same flag
// with isFlagOn(key, orgId) — always check there too for anything it serves.
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { api } from "@/lib/client/api";

export function useFlags() {
  const { org } = useSession();
  return useQuery({ queryKey: ["flags", org.id], queryFn: () => api<{ flags: string[] }>(`/api/v1/orgs/${org.id}/requests/flags`), staleTime: 60_000, refetchInterval: 5 * 60_000 });
}

export function useFlag(key: string) {
  return !!useFlags().data?.flags.includes(key);
}

export function WhenFlag({ flag, children, otherwise = null }: { flag: string; children: ReactNode; otherwise?: ReactNode }) {
  return useFlag(flag) ? <>{children}</> : <>{otherwise}</>;
}
