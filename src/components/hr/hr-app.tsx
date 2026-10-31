"use client";

// HR & payroll: one app for HR admins, payroll, managers and every employee.
// The menu shows each person what applies to them.
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, BarChart3, Briefcase, CalendarClock, CalendarDays, Clock, CreditCard, FileText, GraduationCap, Handshake, Home, Laptop, LogOut, MessageSquareWarning, Network, Plane, Receipt, Settings, Target, Timer, User, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { AttendanceView } from "./attendance";
import { HiringView, JobPage } from "./hiring";
import { HomeView } from "./home";
import { LeaveView } from "./leave";
import { MeView } from "./me";
import { ClaimsView, PayrollView, PayslipPage, RunPage } from "./payroll";
import { OrgChart, PeopleView, PersonPage } from "./people";
import { AssetsView, PerformanceView } from "./performance";
import { ReportsView } from "./reports";
import { CardsView, TripPage, TripsView } from "./travel";
import { SettingsView } from "./settings";
import { CasesView, DocumentsView, OvertimeView, RosterView, SettlementsView, TrainingView, WorkforceView } from "./plus";
import { Empty, HrProvider, hrApi, useHrParts, type Meta } from "./shared";

type Item = { id: string; label: string; icon: ReactNode; group?: string; part?: string; show: (m: Meta["me"]) => boolean };
const NAV: Item[] = [
  { id: "", label: "Home", icon: <Home />, show: () => true },
  { id: "me", label: "Me", icon: <User />, show: (m) => !!m.employeeId },
  { id: "people", label: "People", icon: <Users />, group: "Team", show: () => true },
  { id: "chart", label: "Org chart", icon: <Network />, show: () => true },
  { id: "attendance", part: "attendance", label: "Attendance", icon: <Clock />, show: (m) => m.manage || m.isManager || !!m.employeeId },
  { id: "leave", part: "leave", label: "Leave", icon: <CalendarDays />, show: () => true },
  { id: "roster", part: "shifts", label: "Roster", icon: <CalendarClock />, show: (m) => m.manage || m.isManager || !!m.employeeId },
  { id: "overtime", part: "shifts", label: "Overtime", icon: <Timer />, show: (m) => m.manage || m.isManager || !!m.employeeId },
  { id: "payroll", part: "payroll", label: "Payroll", icon: <Wallet />, group: "Money", show: (m) => m.payroll },
  { id: "claims", part: "claims", label: "Claims", icon: <Receipt />, show: (m) => m.payroll || m.isManager || !!m.employeeId },
  { id: "trips", part: "travel", label: "Trips", icon: <Plane />, show: (m) => m.payroll || m.isManager || m.manage || !!m.employeeId },
  { id: "cards", part: "travel", label: "Company cards", icon: <CreditCard />, show: (m) => m.payroll || !!m.employeeId },
  { id: "settlements", part: "payroll", label: "Full and final", icon: <LogOut />, show: (m) => m.payroll },
  { id: "hiring", part: "hiring", label: "Hiring", icon: <Briefcase />, group: "Grow", show: (m) => m.manage },
  { id: "performance", part: "performance", label: "Performance", icon: <Target />, show: (m) => m.manage || m.isManager || !!m.employeeId },
  { id: "assets", part: "assets", label: "Assets", icon: <Laptop />, show: (m) => m.manage },
  { id: "documents", part: "records", label: "Documents", icon: <FileText />, show: (m) => m.manage || m.isManager || !!m.employeeId },
  { id: "training", part: "records", label: "Training", icon: <GraduationCap />, show: (m) => m.manage || m.isManager || !!m.employeeId },
  { id: "cases", part: "relations", label: "Grievances", icon: <MessageSquareWarning />, show: (m) => m.manage || !!m.employeeId },
  { id: "workforce", part: "planning", label: "Workforce plan", icon: <Handshake />, show: (m) => m.manage },
  { id: "reports", label: "Reports", icon: <BarChart3 />, show: (m) => m.manage || m.payroll || m.isManager },
  { id: "settings", label: "Settings", icon: <Settings />, group: "Setup", show: (m) => m.manage },
];

// Groups carry down to the items after them, so a heading survives its first item being hidden.
const GROUPED = NAV.reduce<Item[]>((out, n) => [...out, { ...n, group: n.group ?? out[out.length - 1]?.group }], []);

export function HrApp({ path }: { path: string[] }) {
  const { org } = useSession();
  const router = useRouter();
  const meta = useQuery({ queryKey: ["hr", org.id, "meta"], queryFn: () => api<Meta>(hrApi(org.id, "meta")), retry: false });
  const part = useHrParts();
  const [section = "", id, sub] = path;
  if (meta.isError) {
    const status = (meta.error as { status?: number }).status;
    return status === 403 ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <BadgeCheck className="mx-auto size-6 text-muted" />
        <h1 className="mt-3 text-lg font-semibold">HR isn&apos;t on for this workspace</h1>
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
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[200px_1fr]">
        <Skeleton className="hidden h-80 rounded-[20px] lg:block" />
        <Skeleton className="h-[70vh] rounded-[24px]" />
      </div>
    );
  const m = meta.data.me;
  const go = (p: string) => router.push(p ? `/hr/${p}` : "/hr");
  const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/.test(x);
  let body: ReactNode;
  switch (section) {
    case "me":
      body = <MeView />;
      break;
    case "people":
      body = isId(id) ? <PersonPage key={id} id={id!} tab={sub} /> : <PeopleView />;
      break;
    case "chart":
      body = <OrgChart />;
      break;
    case "attendance":
      body = <AttendanceView />;
      break;
    case "leave":
      body = <LeaveView />;
      break;
    case "payroll":
      body = isId(id) ? <RunPage key={id} id={id!} /> : <PayrollView />;
      break;
    case "payslips":
      body = isId(id) ? <PayslipPage key={id} id={id!} /> : <MeView />;
      break;
    case "claims":
      body = <ClaimsView />;
      break;
    case "trips":
      body = isId(id) ? <TripPage key={id} id={id!} /> : <TripsView />;
      break;
    case "cards":
      body = <CardsView />;
      break;
    case "hiring":
      body = isId(id) ? <JobPage key={id} id={id!} /> : <HiringView />;
      break;
    case "performance":
      body = <PerformanceView />;
      break;
    case "assets":
      body = <AssetsView />;
      break;
    case "roster":
      body = <RosterView />;
      break;
    case "overtime":
      body = <OvertimeView />;
      break;
    case "settlements":
      body = <SettlementsView />;
      break;
    case "documents":
      body = <DocumentsView />;
      break;
    case "training":
      body = <TrainingView />;
      break;
    case "cases":
      body = <CasesView />;
      break;
    case "workforce":
      body = <WorkforceView />;
      break;
    case "reports":
      body = <ReportsView />;
      break;
    case "settings":
      body = <SettingsView tab={id} />;
      break;
    default:
      body = <HomeView />;
  }
  const items = GROUPED.filter((n) => n.show(m) && (!n.part || part(n.part)))
    .map((n, i, all) => ({ ...n, group: n.group !== all[i - 1]?.group ? n.group : undefined }));
  const offPart = NAV.find((n) => n.id === section)?.part ?? (section === "payslips" ? "payroll" : undefined);
  if (offPart && !part(offPart)) body = <Empty>This part of HR is switched off for your workspace. An owner or admin can switch it on in Settings → Features.</Empty>;
  const print = section === "payslips" && isId(id);
  return (
    <HrProvider value={{ orgId: org.id, meta: meta.data, go }}>
      <div className={cx("mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-8 lg:py-8", !print && "lg:grid-cols-[200px_minmax(0,1fr)]")}>
        {!print && (
          <aside className="lg:sticky lg:top-6 lg:self-start print:hidden">
            <div className="mb-3 hidden px-2 lg:block">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">Cloudesk HR</p>
              <p className="mt-1 truncate text-[14px] font-semibold">{org.name}</p>
            </div>
            <nav aria-label="HR" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
              {items.map((n) => {
                const on = section === n.id || (n.id === "me" && section === "payslips");
                return (
                  <div key={n.id} className="contents">
                    {n.group && <p className="hidden px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">{n.group}</p>}
                    <Link href={n.id ? `/hr/${n.id}` : "/hr"} aria-current={on ? "page" : undefined} className={cx("flex shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4", on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                      {n.icon}
                      {n.label}
                    </Link>
                  </div>
                );
              })}
            </nav>
          </aside>
        )}
        <main className="min-w-0">{body}</main>
      </div>
    </HrProvider>
  );
}
