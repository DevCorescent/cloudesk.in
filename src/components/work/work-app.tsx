"use client";

// Projects & timesheets: the menu, and which screen a path opens.
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarRange, CheckCheck, CircleDollarSign, Clock, FolderKanban, Home, KanbanSquare, ListChecks, ReceiptText, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { HomeView } from "./home";
import { ResourcesView } from "./plus";
import { ProjectPage, ProjectsView } from "./projects";
import { MyTasksView, TaskPage } from "./tasks";
import { ApprovalsView, TimesheetView } from "./timesheet";
import { BillingView, ProfitView, ReportsView, SettingsView } from "./more";
import { Empty, WorkProvider, workApi, type Meta } from "./shared";

type Part = keyof Meta["parts"];
const NAV: { id: string; label: string; icon: ReactNode; group?: string; part?: Part; manage?: boolean }[] = [
  { id: "", label: "Home", icon: <Home /> },
  { id: "projects", label: "Projects", icon: <FolderKanban />, group: "Work" },
  { id: "tasks", label: "My tasks", icon: <ListChecks /> },
  { id: "resources", label: "Resources", icon: <CalendarRange />, part: "planning" },
  { id: "timesheet", label: "Timesheet", icon: <Clock />, group: "Time", part: "timesheets" },
  { id: "approvals", label: "Approvals", icon: <CheckCheck />, part: "timesheets", manage: true },
  { id: "billing", label: "Billing", icon: <ReceiptText />, group: "Money", part: "billing", manage: true },
  { id: "profit", label: "Cost & profit", icon: <CircleDollarSign />, part: "profit", manage: true },
  { id: "reports", label: "Reports", icon: <BarChart3 />, group: "Insight", part: "timesheets" },
  { id: "settings", label: "Settings", icon: <Settings />, group: "Setup", manage: true },
];

export function WorkApp({ path }: { path: string[] }) {
  const { org } = useSession();
  const router = useRouter();
  const meta = useQuery({ queryKey: ["work", org.id, "meta"], queryFn: () => api<Meta>(workApi(org.id, "meta")), retry: false });
  const [section = "", id, sub] = path;
  if (meta.isError) {
    const status = (meta.error as { status?: number }).status;
    return status === 403 ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <KanbanSquare className="mx-auto size-6 text-muted" />
        <h1 className="mt-3 text-lg font-semibold">Projects aren&apos;t open to you</h1>
        <p className="mt-1 text-[13px] text-muted">{errorMessage(meta.error)}</p>
        <Link href="/settings/features" className="mt-4 inline-flex text-[13px] font-medium underline">
          Open Features
        </Link>
      </div>
    ) : (
      <ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} />
    );
  }
  if (!meta.data)
    return (
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[210px_1fr]">
        <Skeleton className="hidden h-80 rounded-[20px] lg:block" />
        <Skeleton className="h-[70vh] rounded-[24px]" />
      </div>
    );
  const m = meta.data;
  const go = (p: string) => router.push(p ? `/work/${p}` : "/work");
  const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/.test(x);
  let body: ReactNode;
  switch (section) {
    case "projects":
      body = isId(id) ? <ProjectPage key={id} id={id!} tab={sub} /> : <ProjectsView startNew={id === "new"} />;
      break;
    case "tasks":
      body = isId(id) ? <TaskPage key={id} id={id!} /> : <MyTasksView />;
      break;
    case "resources":
      body = <ResourcesView />;
      break;
    case "timesheet":
      body = <TimesheetView />;
      break;
    case "approvals":
      body = <ApprovalsView />;
      break;
    case "billing":
      body = <BillingView />;
      break;
    case "profit":
      body = <ProfitView />;
      break;
    case "reports":
      body = <ReportsView />;
      break;
    case "settings":
      body = <SettingsView />;
      break;
    default:
      body = <HomeView />;
  }
  const entry = NAV.find((n) => n.id === section);
  if (entry?.part && !m.parts[entry.part]) body = <Empty>This part of Projects & timesheets is switched off for your workspace. An owner or admin can switch it on in Settings → Features.</Empty>;
  else if (entry?.manage && !m.me.manage) body = <Empty>Only workspace owners and admins can open this.</Empty>;
  const items = NAV.reduce<typeof NAV>((out, n) => [...out, { ...n, group: n.group ?? out[out.length - 1]?.group }], [])
    .filter((n) => (!n.part || m.parts[n.part]) && (!n.manage || m.me.manage))
    .map((n, i, all) => ({ ...n, group: n.group !== all[i - 1]?.group ? n.group : undefined }));
  return (
    <WorkProvider value={{ orgId: org.id, meta: m, go }}>
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[210px_minmax(0,1fr)] lg:py-8">
        <aside className="lg:sticky lg:top-6 lg:self-start print:hidden">
          <div className="mb-3 hidden px-2 lg:block">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">Projects & time</p>
            <p className="mt-1 truncate text-[14px] font-semibold">{org.name}</p>
          </div>
          <nav aria-label="Projects" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
            {items.map((n) => {
              const on = section === n.id;
              return (
                <div key={n.id} className="contents">
                  {n.group && <p className="hidden px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">{n.group}</p>}
                  <Link href={n.id ? `/work/${n.id}` : "/work"} aria-current={on ? "page" : undefined} className={cx("flex shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4", on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                    {n.icon}
                    {n.label}
                  </Link>
                </div>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">{body}</main>
      </div>
    </WorkProvider>
  );
}
