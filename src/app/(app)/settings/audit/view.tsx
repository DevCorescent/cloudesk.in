"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useSession } from "@/components/shell/session-context";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";

type Event = { id: string; action: string; targetType: string | null; targetId: string | null; metadata: Record<string, unknown> | null; createdAt: string; actorName: string | null };

export function AuditView() {
  const { org } = useSession();
  const q = useInfiniteQuery({
    queryKey: ["audit", org.id],
    queryFn: ({ pageParam }) => api<{ events: Event[] }>(`/api/v1/orgs/${org.id}/audit${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => (last.events.length === 50 ? last.events[49].createdAt : undefined),
  });
  if (q.isPending) return <Skeleton className="h-60" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const events = q.data.pages.flatMap((p) => p.events);
  if (!events.length) return <Card><EmptyState icon={<ScrollText className="size-4" />} title="No events yet" /></Card>;
  return (
    <>
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border text-xs text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Who</th>
              <th className="px-4 py-2.5 font-medium">Action</th>
              <th className="px-4 py-2.5 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted">{dateTime(e.createdAt)}</td>
                <td className="px-4 py-2.5">{e.actorName ?? "System"}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{e.action}</td>
                <td className="max-w-xs truncate px-4 py-2.5 font-mono text-xs text-subtle">{e.metadata ? JSON.stringify(e.metadata) : e.targetType ? `${e.targetType}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {q.hasNextPage && (
        <Button className="mt-4" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Load older events
        </Button>
      )}
    </>
  );
}
