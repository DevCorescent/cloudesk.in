"use client";

// The go-live control centre: automatic checks against this installation and
// the manual ones an operator confirms, with how to fix each.
import clsx from "clsx";
import { CheckCircle2, Circle, CircleAlert, CircleX, Rocket } from "lucide-react";
import { Badge, Button, Card, ErrorState, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { useAdmin, useCan, useRun } from "./common";

type Check = { id: string; group: string; title: string; status: "pass" | "warn" | "fail" | "todo" | "done"; detail: string; fix?: string; manual?: boolean; doneBy?: string; doneAt?: string; blocking: boolean };
type List = { checks: Check[]; ready: boolean; blocking: number; done: number; total: number };

const ICON = { pass: <CheckCircle2 className="size-4 text-success" />, done: <CheckCircle2 className="size-4 text-success" />, warn: <CircleAlert className="size-4 text-warning" />, fail: <CircleX className="size-4 text-danger" />, todo: <Circle className="size-4 text-subtle" /> };

export function GoLivePanel({ onGo }: { onGo: (tab: string) => void }) {
  const q = useAdmin<List>("golive");
  const run = useRun();
  const can = useCan();
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { checks, ready, blocking, done, total } = q.data;
  const groups = [...new Set(checks.map((c) => c.group))];
  return (
    <div className="space-y-6">
      <Card className={clsx("flex flex-wrap items-center gap-4 p-5", ready ? "border-success/40" : "")}>
        <span className={clsx("grid size-12 place-items-center rounded-[14px]", ready ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}><Rocket className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold">{ready ? "Ready to go live" : `${blocking} thing${blocking === 1 ? "" : "s"} to do before going live`}</p>
          <p className="text-[13px] text-muted">{done} of {total} checks complete. Automatic checks re-run every time you open this page.</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"><div className={clsx("h-full rounded-full", ready ? "bg-success" : "bg-[var(--viz-1)]")} style={{ width: `${(done / total) * 100}%` }} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onGo("integrations")}>Integrations</Button>
          <Button size="sm" onClick={() => onGo("settings")}>Settings</Button>
          <Button size="sm" onClick={() => onGo("notices")}>Maintenance</Button>
        </div>
      </Card>
      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-2 text-[13px] font-semibold text-muted">{g}</h3>
          <Card className="divide-y divide-border">
            {checks.filter((c) => c.group === g).map((c) => (
              <div key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-[13px]" data-testid={`check-${c.id}`}>
                <span className="mt-0.5">{ICON[c.status]}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">{c.title}{!c.blocking && <Badge>Recommended</Badge>}{c.manual && <Badge tone="accent">Confirm</Badge>}</p>
                  <p className="text-muted">{c.detail}</p>
                  {c.fix && (c.status === "fail" || c.status === "warn") && <p className="mt-1 text-[12.5px]"><b className="font-medium">Fix: </b><span className="text-muted">{c.fix}</span></p>}
                  {c.doneBy && <p className="mt-1 text-[12px] text-subtle">Confirmed by {c.doneBy}{c.doneAt ? ` · ${dateTime(c.doneAt)}` : ""}</p>}
                </div>
                {c.manual && can("settings:write") && (
                  <Button size="sm" variant={c.status === "done" ? "ghost" : "secondary"} onClick={() => void run("golive", "POST", { id: c.id, done: c.status !== "done" }, c.status === "done" ? "Marked as not done" : "Confirmed")}>
                    {c.status === "done" ? "Undo" : "Mark done"}
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}
