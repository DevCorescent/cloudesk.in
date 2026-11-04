"use client";

// Accounting & GST: the menu, and which screen a path opens.
import { SectionSwitcher } from "@/components/shell/module-frame";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, BookOpenCheck, Building, Building2, FileText, HandCoins, Home, Landmark, ListTree, Percent, Receipt, Repeat, ScrollText, Send, Settings, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { BankView, ReconcileView } from "./bank";
import { BillPage, BillsView } from "./bills";
import { AccountsView, HomeView, JournalsView, LedgerView, SettingsView } from "./books";
import { GstView, ReportsView } from "./reports";
import { AssetPage, AssetsView, BudgetsView, SchedulesView } from "./finance";
import { PaymentRunsView, ReceiptsView, RunPage, TdsView } from "./payables";
import { GroupView } from "./group";
import { AccProvider, Empty, accApi, type Meta } from "./shared";

type Part = keyof Meta["parts"];
const NAV: { id: string; label: string; icon: ReactNode; group?: string; part?: Part; manage?: boolean }[] = [
  { id: "", label: "Home", icon: <Home /> },
  { id: "journals", label: "Day book", icon: <ScrollText />, group: "Books" },
  { id: "accounts", label: "Chart of accounts", icon: <ListTree /> },
  { id: "bills", label: "Bills & expenses", icon: <Receipt />, part: "bills" },
  { id: "payments", label: "Payment runs", icon: <Send />, part: "bills" },
  { id: "tds", label: "TDS", icon: <Percent />, part: "bills" },
  { id: "receipts", label: "Money received", icon: <HandCoins /> },
  { id: "bank", label: "Banking", icon: <Landmark />, part: "banking" },
  { id: "assets", label: "Fixed assets", icon: <Building /> },
  { id: "schedules", label: "Repeating & spread", icon: <Repeat /> },
  { id: "reports", label: "Reports", icon: <BarChart3 />, group: "Insight" },
  { id: "gst", label: "GST returns", icon: <FileText />, part: "gst" },
  { id: "budgets", label: "Budgets", icon: <Target /> },
  { id: "group", label: "Group", icon: <Building2 /> },
  { id: "settings", label: "Settings", icon: <Settings />, group: "Setup", manage: true },
];

export function AccountsApp({ path }: { path: string[] }) {
  const [slice, setSlice] = useState({ companyId: "", branchId: "", costCentreId: "" });
  const { org } = useSession();
  const router = useRouter();
  const meta = useQuery({ queryKey: ["acc", org.id, "meta"], queryFn: () => api<Meta>(accApi(org.id, "meta")), retry: false });
  const [section = "", id] = path;
  if (meta.isError) {
    const status = (meta.error as { status?: number }).status;
    return status === 403 ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <BookOpenCheck className="mx-auto size-6 text-muted" />
        <h1 className="mt-3 text-lg font-semibold">The books aren&apos;t open to you</h1>
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
  const go = (p: string) => router.push(p ? `/accounts/${p}` : "/accounts");
  const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/.test(x);
  let body: ReactNode;
  switch (section) {
    case "journals":
      body = <JournalsView />;
      break;
    case "accounts":
      body = isId(id) ? <LedgerView key={id} id={id!} /> : <AccountsView />;
      break;
    case "bills":
      body = isId(id) ? <BillPage key={id} id={id!} /> : <BillsView />;
      break;
    case "payments":
      body = isId(id) ? <RunPage key={id} id={id!} /> : <PaymentRunsView />;
      break;
    case "tds":
      body = <TdsView />;
      break;
    case "receipts":
      body = <ReceiptsView />;
      break;
    case "bank":
      body = isId(id) ? <ReconcileView key={id} id={id!} /> : <BankView />;
      break;
    case "reports":
      body = <ReportsView tab={id} />;
      break;
    case "gst":
      body = <GstView tab={id} />;
      break;
    case "assets":
      body = isId(id) ? <AssetPage key={id} id={id!} /> : <AssetsView />;
      break;
    case "schedules":
      body = <SchedulesView />;
      break;
    case "group":
      body = <GroupView tab={id} />;
      break;
    case "budgets":
      body = <BudgetsView key={id ?? "list"} id={isId(id) ? id : undefined} />;
      break;
    case "settings":
      body = <SettingsView />;
      break;
    default:
      body = <HomeView />;
  }
  const off = NAV.find((n) => n.id === section)?.part;
  if (off && !m.parts[off]) body = <Empty>This part of Accounting is switched off for your workspace. An owner or admin can switch it on in Settings → Features.</Empty>;
  const items = NAV.reduce<typeof NAV>((out, n) => [...out, { ...n, group: n.group ?? out[out.length - 1]?.group }], [])
    .filter((n) => (!n.part || m.parts[n.part]) && (!n.manage || m.me.manage))
    .map((n, i, all) => ({ ...n, group: n.group !== all[i - 1]?.group ? n.group : undefined }));
  return (
    <AccProvider value={{ orgId: org.id, meta: m, go, slice, setSlice }}>
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[210px_minmax(0,1fr)] lg:py-8">
        <SectionSwitcher title="Accounts" items={items} section={section} href={(id) => (id ? `/accounts/${id}` : "/accounts")} />
        <aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start print:hidden">
          <div className="mb-3 hidden px-2 lg:block">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">Cloudesk Accounts</p>
            <p className="mt-1 truncate text-[14px] font-semibold">{org.name}</p>
            <p className="text-[12px] text-muted">{m.fy.label}</p>
          </div>
          <nav aria-label="Accounts" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
            {items.map((n) => {
              const on = section === n.id;
              return (
                <div key={n.id} className="contents">
                  {n.group && <p className="hidden px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">{n.group}</p>}
                  <Link href={n.id ? `/accounts/${n.id}` : "/accounts"} aria-current={on ? "page" : undefined} className={cx("flex shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4", on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
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
    </AccProvider>
  );
}
