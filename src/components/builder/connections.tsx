"use client";

// How this web app is wired to the rest of the workspace: what its forms,
// orders and bookings feed, and the sections that bring live records in (open
// jobs, events, a support form). Each line says whether it's working now; a
// module that's off links to switching it on.
import clsx from "clsx";
import { ArrowUpRight, CheckCircle2, CircleDashed, Plus } from "lucide-react";
import Link from "next/link";
import { ModuleGlyph } from "../shell/module-glyph";
import { useSession } from "../shell/session-context";
import { visibleTo, type ModuleId } from "@/lib/workspace/modules";
import type { Page } from "@/lib/site/model";

type Line = { module: ModuleId; title: string; what: string; section?: string; sectionLabel?: string; href: string };

const LINES: Line[] = [
  { module: "crm", title: "CRM", what: "Every form, order and booking on this site becomes a contact with its history; newsletter sign-ups join as subscribers who agreed to marketing email.", href: "/crm" },
  { module: "helpdesk", title: "Helpdesk", what: "A support form on the site opens a ticket, assigns it, and emails the customer a reference.", section: "support", sectionLabel: "Add a support form", href: "/helpdesk" },
  { module: "hr", title: "HR — Hiring", what: "Open roles show on the site and update by themselves; each links to apply.", section: "careers", sectionLabel: "Add open jobs", href: "/hr/hiring" },
  { module: "marketing", title: "Marketing", what: "Upcoming events show with a link to register; sign-ups are reachable from your segments.", section: "events", sectionLabel: "Add upcoming events", href: "/marketing" },
  { module: "store", title: "Online store", what: "Product grids, cart and checkout use your live catalogue and stock.", section: "productGrid", sectionLabel: "Add products", href: "" },
  { module: "bookings", title: "Bookings", what: "Visitors book a service at /book; confirmed bookings reach the CRM.", section: "booking", sectionLabel: "Add a booking request", href: "" },
  { module: "data", title: "Data & API", what: "Show rows from your own tables, and collect custom forms into them.", section: "dataList", sectionLabel: "Add a data list", href: "" },
  { module: "chatbot", title: "Chatbot", what: "Answers visitors from this site's own content once published.", href: "" },
  { module: "automations", title: "Automations", what: "Emails, WhatsApp and Slack when a form is sent, an order paid or a booking made.", href: "" },
];

export function ConnectionsPanel({ projectId, page, onAdd, readOnly }: { projectId: string; page: Page; onAdd: (type: string) => void; readOnly: boolean }) {
  const { org } = useSession();
  const canEnable = org.role === "owner" || org.role === "admin";
  const linkFor = (l: Line) => l.href || ({ store: `/projects/${projectId}/store`, bookings: `/projects/${projectId}/store`, data: `/projects/${projectId}/data`, chatbot: `/projects/${projectId}/chatbot`, automations: `/projects/${projectId}/automations` } as Record<string, string>)[l.module] || "/settings/features";
  return (
    <div className="grid gap-2 p-3">
      <p className="px-0.5 pb-1 text-[12px] text-muted">How this site works with the rest of your workspace. Live sections update by themselves — no republishing.</p>
      {LINES.map((l) => {
        const on = visibleTo(org, l.module);
        const placed = l.section ? page.sections.some((s) => s.type === l.section) : false;
        return (
          <div key={l.module} className={clsx("rounded-[14px] border p-3", on ? "border-border bg-surface" : "border-dashed border-border bg-transparent")}>
            <div className="flex items-start gap-2.5">
              <span className={clsx("grid size-8 shrink-0 place-items-center rounded-[9px]", on ? "bg-surface-2 text-fg" : "bg-surface-2 text-subtle")}>
                <ModuleGlyph id={l.module} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  {l.title}
                  {on ? <CheckCircle2 className="size-3.5 text-success" aria-label="Connected" /> : <CircleDashed className="size-3.5 text-subtle" aria-label="Not switched on" />}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted">{l.what}</span>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[42px]">
              {on ? (
                <>
                  {l.section && !readOnly && (
                    <button type="button" onClick={() => onAdd(l.section!)} className="inline-flex h-7 items-center gap-1 rounded-full bg-fg px-2.5 text-[12px] font-medium text-bg hover:opacity-90">
                      <Plus className="size-3" /> {placed ? `${l.sectionLabel} again` : l.sectionLabel}
                    </button>
                  )}
                  <Link href={linkFor(l)} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-fg">
                    Open {l.title} <ArrowUpRight className="size-3" />
                  </Link>
                </>
              ) : canEnable ? (
                <Link href="/settings/features" className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-[12px] font-medium hover:bg-surface-2">
                  Switch on {l.title} <ArrowUpRight className="size-3" />
                </Link>
              ) : (
                <span className="text-[12px] text-subtle">Not switched on — ask an owner or admin.</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
