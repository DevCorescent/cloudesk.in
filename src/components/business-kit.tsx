"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, CalendarDays, Check, Megaphone, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "./ui/overlays";
import { Badge, Button, Card } from "./ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

type Kit = { industry: string; store: { recommended: boolean; why: string }; bookings: { recommended: boolean; why: string; services: { name: string; durationMin: number; capacity: number }[] }; files: { path: string; title: string }[] };
type Data = { kit: Kit; has: { store: boolean; services: number; files: string[] } };

/** "One brief → a whole business": store, bookings and a launch kit from the plan. */
export function BusinessKitCard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["business-kit", projectId], queryFn: () => api<Data>(`/api/v1/projects/${projectId}/business-kit`), retry: false });
  const [pick, setPick] = useState<{ store: boolean; bookings: boolean; marketing: boolean } | null>(null);
  const run = useMutation({
    mutationFn: (body: { store: boolean; bookings: boolean; marketing: boolean }) => api<{ done: string[] }>(`/api/v1/projects/${projectId}/business-kit`, { method: "POST", body }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["business-kit", projectId] });
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: "success", title: "Business kit created", description: r.done.length ? `Added: ${r.done.join(", ")}.` : "Everything was already set up." });
    },
    onError: (e) => toast({ tone: "error", title: "Could not create the kit", description: errorMessage(e) }),
  });
  if (!q.data) return null;
  const { kit, has } = q.data;
  const marketingDone = has.files.length === kit.files.length;
  const allDone = (has.store || !kit.store.recommended) && (has.services > 0 || !kit.bookings.recommended) && marketingDone;
  if (allDone) return null;
  const sel = pick ?? { store: kit.store.recommended && !has.store, bookings: kit.bookings.recommended && !has.services, marketing: !marketingDone };
  const row = (key: keyof typeof sel, icon: React.ReactNode, title: string, detail: string, done: boolean, recommended: boolean) => (
    <label className={`flex items-start gap-3 rounded-[var(--radius-md)] border p-3 text-[13px] ${done ? "border-border opacity-60" : "border-border hover:bg-surface-2"}`}>
      <input type="checkbox" className="mt-1" disabled={done || !canEdit} checked={done || sel[key]} onChange={(e) => setPick({ ...sel, [key]: e.target.checked })} />
      <span className="text-muted">{icon}</span>
      <span className="min-w-0">
        <span className="font-medium">
          {title} {done ? <Badge tone="success">Done</Badge> : recommended ? <Badge tone="accent">Recommended</Badge> : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted">{detail}</span>
      </span>
    </label>
  );
  return (
    <Card className="mt-6 p-4">
      <div className="flex items-center gap-2">
        <Briefcase className="size-4 text-accent" aria-hidden />
        <h2 className="text-[13px] font-semibold">Turn this site into a whole business</h2>
      </div>
      <p className="mt-0.5 text-xs text-muted">Based on your plan for a {kit.industry.toLowerCase()}. Nothing is published and nothing you made is overwritten.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {row("store", <ShoppingBag className="size-4" />, "Online store", `${kit.store.why} Cart, checkout, payments and orders.`, has.store, kit.store.recommended)}
        {row("bookings", <CalendarDays className="size-4" />, "Bookings", `${kit.bookings.why} Starts with: ${kit.bookings.services.map((s) => s.name).join(", ")} (hidden until you set prices).`, has.services > 0, kit.bookings.recommended)}
        {row("marketing", <Megaphone className="size-4" />, "Launch kit", "Social posts, a 3-email welcome series, a Google Business Profile description and a launch checklist — as files you can edit.", marketingDone, true)}
      </div>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Starter copy is written from your plan; edit it before using it.{" "}
            {has.files.length > 0 && (
              <Link href={`/projects/${projectId}/ide`} className="text-accent hover:underline">
                Open the launch kit in the IDE →
              </Link>
            )}
          </p>
          <Button variant="primary" icon={<Check className="size-3.5" />} loading={run.isPending} disabled={!sel.store && !sel.bookings && !sel.marketing} onClick={() => run.mutate(sel)}>
            Create
          </Button>
        </div>
      )}
    </Card>
  );
}
