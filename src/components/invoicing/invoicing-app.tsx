"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, BookUser, CreditCard, FilePlus2, FileText, Gauge, Package, Palette, ReceiptText, ScrollText, Settings2, Undo2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { useProject } from "@/lib/client/use-project";
import { ClientsView, ItemsView } from "./directory";
import { DocEditor } from "./doc-editor";
import { DocList } from "./doc-list";
import { DocPage } from "./doc-page";
import { InvoicingOverview, PaymentsView, ReportsView } from "./reports";
import { InvoicingSettings } from "./settings";
import { invApi, InvProvider, PATH_TYPE, projectApiBase, type Boot } from "./shared";
import { TemplateStudio, TemplatesView } from "./templates";

const NAV: { group?: string; items: { id: string; label: string; icon: ReactNode }[] }[] = [
  {
    items: [
      { id: "", label: "Overview", icon: <Gauge /> },
      { id: "invoices", label: "Invoices", icon: <FileText /> },
      { id: "quotes", label: "Quotations", icon: <ScrollText /> },
      { id: "proforma", label: "Proforma", icon: <FilePlus2 /> },
      { id: "credit-notes", label: "Credit notes", icon: <Undo2 /> },
      { id: "payments", label: "Payments", icon: <CreditCard /> },
    ],
  },
  {
    group: "Records",
    items: [
      { id: "clients", label: "Clients", icon: <BookUser /> },
      { id: "items", label: "Items & services", icon: <Package /> },
      { id: "reports", label: "Reports", icon: <BarChart3 /> },
    ],
  },
  {
    group: "Setup",
    items: [
      { id: "templates", label: "Templates", icon: <Palette /> },
      { id: "settings", label: "Settings", icon: <Settings2 /> },
    ],
  },
];

/** Invoicing inside a project (Project → Invoices & quotes). */
export function InvoicingApp({ projectId, path }: { projectId: string; path: string[] }) {
  const project = useProject(projectId);
  if (project.isPending) return <Loading />;
  if (project.isError) return <ErrorState title="Project unavailable" message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  if (!project.data.permissions.includes("invoices:manage")) return <EmptyState icon={<ReceiptText className="size-5" />} title="No access to invoicing" description="Ask a project owner or admin to give you the Billing, Editor or Admin role." className="py-24" />;
  return <InvoicingShell ownerId={projectId} base={`/projects/${projectId}/invoicing`} apiBase={projectApiBase(projectId)} path={path} />;
}

function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-6 h-64" />
    </div>
  );
}

/** The invoicing module for any set of books: a project's, or a standalone one under Finance. */
export function InvoicingShell({ ownerId, base, apiBase, path, back }: { ownerId: string; base: string; apiBase: string; path: string[]; back?: ReactNode }) {
  const projectId = ownerId;
  const boot = useQuery({ queryKey: ["invoicing", projectId, ""], queryFn: () => api<Boot>(invApi(apiBase)), retry: false });
  const [section = "", id, sub] = path;
  if (boot.isPending) return <Loading />;
  if (boot.isError)
    return (boot.error as { status?: number }).status === 403 ? (
      <EmptyState icon={<ReceiptText className="size-5" />} title="No access to these books" description="Ask a workspace owner or admin for the Billing, Editor or Admin role." className="py-24" />
    ) : (
      <ErrorState title="Books unavailable" message={errorMessage(boot.error)} onRetry={() => boot.refetch()} />
    );

  // Editors and the template studio take the full width.
  const docType = PATH_TYPE[section];
  const wide = (docType && id) || (section === "templates" && id);
  let body: ReactNode;
  if (docType) body = !id ? <DocList type={docType} /> : id === "new" ? <DocEditor type={docType} /> : sub === "edit" ? <DocEditor type={docType} id={id} /> : <DocPage id={id} />;
  else if (section === "clients") body = <ClientsView />;
  else if (section === "items") body = <ItemsView />;
  else if (section === "payments") body = <PaymentsView />;
  else if (section === "reports") body = <ReportsView />;
  else if (section === "templates") body = id ? <TemplateStudio id={id} /> : <TemplatesView />;
  else if (section === "settings") body = <InvoicingSettings />;
  else body = <InvoicingOverview />;

  return (
    <InvProvider value={{ projectId, base, apiBase, boot: boot.data }}>
      <div className={cx("mx-auto flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:py-8", wide ? "max-w-[1500px]" : "max-w-7xl")}>
        <aside className="lg:w-52 lg:shrink-0">
          <div className="mb-3 lg:mb-5">
            {back}
            <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">{boot.data.scope.kind === "book" ? "Finance" : "Invoicing"}</p>
            <p className="truncate text-sm font-semibold">{boot.data.settings.business.name || boot.data.scope.name}</p>
          </div>
          <nav aria-label="Invoicing" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {NAV.map((g, gi) => (
              <div key={gi} className="flex gap-1 lg:flex-col">
                {g.group && <p className="hidden px-2.5 pt-4 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase lg:block">{g.group}</p>}
                {g.items.map((it) => {
                  const active = section === it.id;
                  return (
                    <Link
                      key={it.id}
                      href={it.id ? `${base}/${it.id}` : base}
                      aria-current={active ? "page" : undefined}
                      className={cx("flex h-8 shrink-0 items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-[13px] whitespace-nowrap transition-colors [&_svg]:size-4", active ? "nav-active tint-butter" : "text-muted hover:bg-surface-2 hover:text-fg")}
                    >
                      {it.icon}
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{body}</main>
      </div>
    </InvProvider>
  );
}
