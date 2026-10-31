"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FolderOpen, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ProjectCard } from "@/components/project-card";
import { useSession } from "@/components/shell/session-context";
import { Button, ButtonLink, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import type { ProjectSummary } from "@/lib/client/types";

const PAGE = 24;

export function ProjectsView() {
  const { org } = useSession();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setOffset(0);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const query = useQuery({
    queryKey: ["projects", org.id, "list", debounced, offset],
    queryFn: () => api<{ items: ProjectSummary[]; total: number }>(`/api/v1/orgs/${org.id}/projects?limit=${PAGE}&offset=${offset}${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Web apps"
        description={`Websites, stores and apps in ${org.name} — open one to work inside it.`}
        actions={
          <ButtonLink href="/create" variant="primary" icon={<Plus className="size-3.5" />}>
            New web app
          </ButtonLink>
        }
      />
      <div className="relative mb-5 max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search web apps" aria-label="Search web apps" className="pl-8" />
      </div>
      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-[var(--radius-lg)]" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <Card>
          {debounced ? (
            <EmptyState icon={<Search className="size-4" />} title={`No web apps match “${debounced}”`} description="Try a different search." />
          ) : (
            <EmptyState icon={<FolderOpen className="size-4" />} title="No web apps yet" description="Create your first web app from a description or a template." action={<ButtonLink href="/create" variant="primary">Create a web app</ButtonLink>} />
          )}
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {query.data.items.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
          {query.data.total > PAGE && (
            <div className="mt-6 flex items-center justify-between text-[13px] text-muted">
              <span>
                {offset + 1}–{Math.min(offset + PAGE, query.data.total)} of {query.data.total}
              </span>
              <div className="flex gap-2">
                <Button size="sm" disabled={offset === 0} onClick={() => setOffset(offset - PAGE)} icon={<ChevronLeft className="size-3.5" />}>
                  Previous
                </Button>
                <Button size="sm" disabled={offset + PAGE >= query.data.total} onClick={() => setOffset(offset + PAGE)}>
                  Next <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
