"use client";

// Outlets: every venue in the workspace with today's numbers — for groups and
// chains — and copying a menu from one outlet into this one.
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, Copy, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Badge, ButtonLink, Button, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { useSession } from "@/components/shell/session-context";
import { api } from "@/lib/client/api";
import { formatPrice } from "@/lib/store/money";
import { Stat, useH, useHAction, useMoney } from "./shared";

type Outlet = { projectId: string; name: string; kind: string; currency: string; sales: number; bills: number; covers: number; open: number; tables: number };
const KIND: Record<string, string> = { restaurant: "Restaurant", cafe: "Café", bar: "Bar & lounge", hotel: "Hotel", cloud_kitchen: "Cloud kitchen" };

export function OutletsView() {
  const { org } = useSession();
  const { projectId } = useH();
  const money = useMoney();
  const q = useQuery({ queryKey: ["horeca-outlets", org.id], queryFn: () => api<{ outlets: Outlet[]; totals: { sales: number; bills: number; covers: number } }>(`/api/v1/orgs/${org.id}/horeca`), refetchInterval: 30000 });
  const [copying, setCopying] = useState<Outlet | null>(null);
  const copy = useHAction<void, { categories: number; items: number }>(() => ({ path: "menu/copy", body: { fromProjectId: copying!.projectId } }), { success: (r) => `Copied ${r.items} dishes in ${r.categories} categories`, onDone: () => setCopying(null) });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[22px]" />;
  const { outlets, totals } = q.data;
  return (
    <div>
      <PageHeader
        title="Outlets"
        description="Every restaurant, café, bar and hotel in this workspace, with today's numbers. Each outlet is its own project with its own tables, menu, staff and stock."
        actions={
          <ButtonLink href="/create" size="sm" icon={<Plus className="size-4" />}>
            New outlet
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outlets" value={outlets.length} />
        <Stat label="Sales today" value={money(totals.sales)} sub="all outlets" />
        <Stat label="Bills today" value={totals.bills} />
        <Stat label="Covers today" value={totals.covers} />
      </div>
      {!outlets.length ? (
        <EmptyState icon={<Building2 />} title="Just this one" description="Create another project and set up Horeca in it to run more outlets." className="mt-6" />
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {outlets.map((o) => {
            const here = o.projectId === projectId;
            return (
              <section key={o.projectId} className="flex flex-col rounded-[20px] border border-border bg-surface p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[15px] font-semibold">
                      <Building2 className="size-4 text-muted" />
                      <span className="truncate">{o.name}</span>
                    </p>
                    <p className="text-[12.5px] text-muted">
                      {KIND[o.kind] ?? o.kind} · {o.tables} tables
                    </p>
                  </div>
                  {here && <Badge tone="accent">This one</Badge>}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-[12px] bg-surface-2 py-2">
                    <b className="block text-[15px] tabular-nums">{formatPrice(o.sales, o.currency)}</b>
                    <span className="text-[11px] text-muted">sales</span>
                  </div>
                  <div className="rounded-[12px] bg-surface-2 py-2">
                    <b className="block text-[15px] tabular-nums">{o.bills}</b>
                    <span className="text-[11px] text-muted">bills</span>
                  </div>
                  <div className="rounded-[12px] bg-surface-2 py-2">
                    <b className="block text-[15px] tabular-nums">{o.open}</b>
                    <span className="text-[11px] text-muted">open now</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  {!here && (
                    <>
                      <Link href={`/projects/${o.projectId}/horeca`} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-full bg-fg text-[13px] font-medium text-bg">
                        Open <ArrowRight className="size-3.5" />
                      </Link>
                      <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => setCopying(o)}>
                        Copy its menu here
                      </Button>
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={!!copying} onClose={() => setCopying(null)} onConfirm={() => copy.mutate()} loading={copy.isPending} title={`Copy ${copying?.name}'s menu here?`} description="Its categories, add-ons and dishes are added to this outlet's menu. Bar links and recipes stay behind — link them to this outlet's stock after." confirmLabel="Copy menu" />
    </div>
  );
}
