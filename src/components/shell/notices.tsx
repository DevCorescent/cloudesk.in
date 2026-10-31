"use client";

// Platform banners at the top of every page: maintenance mode (changes are
// paused) and the operators' announcement. Announcements can be dismissed for
// this browser session; maintenance stays until it's over.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Info, Wrench, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";

type Notice = { kind: "maintenance" | "announcement"; tone: "info" | "success" | "warning"; text: string; link?: string };
const KEY = "cloudesk.notices.dismissed";

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function PlatformNotices() {
  const q = useQuery({ queryKey: ["platform-notices"], queryFn: () => api<{ notices: Notice[] }>("/api/v1/notices"), refetchInterval: 60_000, staleTime: 30_000 });
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const list = (q.data?.notices ?? []).filter((n) => n.kind === "maintenance" || !dismissed.includes(n.text));
  if (!list.length) return null;
  return (
    <div className="grid gap-px">
      {list.map((n) => {
        const Icon = n.kind === "maintenance" ? Wrench : n.tone === "warning" ? AlertTriangle : n.tone === "success" ? CheckCircle2 : Info;
        return (
          <div key={n.kind + n.text} role={n.kind === "maintenance" ? "alert" : "status"} className={clsx("flex items-center gap-2.5 px-4 py-2 text-[13px] sm:px-6", n.tone === "warning" ? "bg-warning-soft text-warning" : n.tone === "success" ? "bg-success-soft text-success" : "bg-accent-soft text-accent")}>
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 text-fg">
              {n.kind === "maintenance" && <b className="font-semibold">Maintenance · </b>}
              {n.text}
              {n.link && (
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 font-medium underline underline-offset-2">
                  Learn more <ArrowUpRight className="size-3" />
                </a>
              )}
            </span>
            {n.kind === "announcement" && (
              <button
                type="button"
                aria-label="Dismiss"
                className="grid size-6 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg"
                onClick={() => {
                  const next = [...dismissed, n.text];
                  setDismissed(next);
                  try {
                    sessionStorage.setItem(KEY, JSON.stringify(next));
                  } catch {}
                }}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
