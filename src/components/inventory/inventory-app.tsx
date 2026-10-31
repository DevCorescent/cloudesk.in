"use client";

// Inventory & purchasing: the menu, and which screen a path opens.
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, BarChart3, Boxes, CalendarClock, ClipboardCheck, ClipboardList, FileQuestion, Grid3x3, Home, Layers, PackageCheck, PackageX, RefreshCcw, Scale, Settings, ShoppingCart, Truck, Waves } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { HomeView } from "./home";
import { ItemPage, ItemsView } from "./items";
import { OrderEditor, OrderPage, OrderPrint, OrdersView, ReceiptsView, ReorderView } from "./orders";
import { CountsView, ReportsView, SettingsView, SuppliersView, TransfersView } from "./more";
import { Empty, InvProvider, invApi, type Meta } from "./shared";
import { ControlView, RequisitionsView, RfqPage, RfqsView, SupplierReturnsView } from "./procurement";
import { BinsView, CountsDueView, StockValueView, WavePage, WavesView } from "./warehouse";

type Part = keyof Meta["parts"];
const NAV: { id: string; label: string; icon: ReactNode; group?: string; part?: Part; manage?: boolean }[] = [
  { id: "", label: "Home", icon: <Home /> },
  { id: "items", label: "Items & stock", icon: <Boxes />, group: "Stock" },
  { id: "transfers", label: "Transfers", icon: <ArrowLeftRight />, part: "locations" },
  { id: "counts", label: "Counts & adjustments", icon: <ClipboardCheck /> },
  { id: "counts-due", label: "Cycle counts due", icon: <CalendarClock /> },
  { id: "bins", label: "Bins", icon: <Grid3x3 />, group: "Warehouse", part: "warehouse" },
  { id: "waves", label: "Pick, pack & dispatch", icon: <Waves />, part: "warehouse" },
  { id: "orders", label: "Purchase orders", icon: <ShoppingCart />, group: "Buying", part: "purchasing" },
  { id: "receipts", label: "Goods received", icon: <PackageCheck />, part: "purchasing" },
  { id: "reorder", label: "Reorder", icon: <RefreshCcw />, part: "purchasing" },
  { id: "suppliers", label: "Suppliers", icon: <Truck />, part: "purchasing" },
  { id: "requisitions", label: "Requisitions", icon: <ClipboardList />, group: "Procurement", part: "procurement" },
  { id: "rfqs", label: "RFQs & quotes", icon: <FileQuestion />, part: "procurement" },
  { id: "supplier-returns", label: "Returns to suppliers", icon: <PackageX />, part: "procurement" },
  { id: "control", label: "Purchase control", icon: <Scale />, part: "procurement" },
  { id: "reports", label: "Reports", icon: <BarChart3 />, group: "Insight" },
  { id: "stock-value", label: "Stock value & age", icon: <Layers /> },
  { id: "settings", label: "Settings", icon: <Settings />, group: "Setup", manage: true },
];

export function InventoryApp({ path }: { path: string[] }) {
  const { org } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const meta = useQuery({ queryKey: ["inv", org.id, "meta"], queryFn: () => api<Meta>(invApi(org.id, "meta")), retry: false });
  const [section = "", id, sub] = path;
  if (meta.isError) {
    const status = (meta.error as { status?: number }).status;
    return status === 403 ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <Boxes className="mx-auto size-6 text-muted" />
        <h1 className="mt-3 text-lg font-semibold">Inventory isn&apos;t open to you</h1>
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
  const go = (p: string) => router.push(p ? `/inventory/${p}` : "/inventory");
  const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/.test(x);
  let body: ReactNode;
  switch (section) {
    case "items":
      body = isId(id) ? <ItemPage key={id} id={id!} /> : <ItemsView />;
      break;
    case "orders":
      body = id === "new" ? <OrderEditor /> : isId(id) ? (sub === "edit" ? <OrderEditor id={id} /> : sub === "print" ? <OrderPrint id={id!} /> : <OrderPage key={id} id={id!} />) : <OrdersView />;
      break;
    case "receipts":
      body = <ReceiptsView />;
      break;
    case "bins":
      body = <BinsView />;
      break;
    case "waves":
      body = isId(id) ? <WavePage key={id} id={id!} /> : <WavesView />;
      break;
    case "stock-value":
      body = <StockValueView />;
      break;
    case "counts-due":
      body = <CountsDueView />;
      break;
    case "requisitions":
      body = <RequisitionsView />;
      break;
    case "rfqs":
      body = isId(id) ? <RfqPage key={id} id={id!} /> : <RfqsView fromReq={params.get("from")} />;
      break;
    case "supplier-returns":
      body = <SupplierReturnsView />;
      break;
    case "control":
      body = <ControlView tab={id} />;
      break;
    case "reorder":
      body = <ReorderView />;
      break;
    case "suppliers":
      body = <SuppliersView />;
      break;
    case "transfers":
      body = <TransfersView />;
      break;
    case "counts":
      body = <CountsView />;
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
  const off = NAV.find((n) => n.id === section)?.part;
  if (off && !m.parts[off]) body = <Empty>This part of Inventory is switched off for your workspace. An owner or admin can switch it on in Settings → Features.</Empty>;
  const items = NAV.reduce<typeof NAV>((out, n) => [...out, { ...n, group: n.group ?? out[out.length - 1]?.group }], [])
    .filter((n) => (!n.part || m.parts[n.part]) && (!n.manage || m.me.manage))
    .map((n, i, all) => ({ ...n, group: n.group !== all[i - 1]?.group ? n.group : undefined }));
  const print = section === "orders" && sub === "print";
  return (
    <InvProvider value={{ orgId: org.id, meta: m, go }}>
      <div className={cx("mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-8 lg:py-8", !print && "lg:grid-cols-[210px_minmax(0,1fr)]")}>
        {!print && (
          <aside className="lg:sticky lg:top-6 lg:self-start print:hidden">
            <div className="mb-3 hidden px-2 lg:block">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">Cloudesk Inventory</p>
              <p className="mt-1 truncate text-[14px] font-semibold">{org.name}</p>
            </div>
            <nav aria-label="Inventory" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
              {items.map((n) => {
                const on = section === n.id;
                return (
                  <div key={n.id} className="contents">
                    {n.group && <p className="hidden px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">{n.group}</p>}
                    <Link href={n.id ? `/inventory/${n.id}` : "/inventory"} aria-current={on ? "page" : undefined} className={cx("flex shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4", on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
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
    </InvProvider>
  );
}
