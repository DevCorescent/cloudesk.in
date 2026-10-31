"use client";

// The top of a project's dashboard: the live site, a setup checklist worked
// out from real data and ordered by what the owner said they need, quick
// actions, and the guided tour (shown once after onboarding, replayable).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowUpRight, Check, Command, Compass, Copy, CreditCard, ExternalLink, Globe, LayoutDashboard, Package, Paintbrush, PartyPopper, Receipt, ReceiptText, Rocket, ScanLine, ShoppingBag, Sparkles, TrendingUp, UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/overlays";
import { Skeleton } from "@/components/ui/primitives";
import { useSession } from "@/components/shell/session-context";
import { api } from "@/lib/client/api";
import { visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { Tour, type TourStep } from "./tour/tour";
import { useShortcuts } from "./ui/shortcut";

type SetupItem = { id: string; title: string; detail: string; done: boolean; href: string; minutes: number };
type Setup = { kind: "store" | "website"; items: SetupItem[]; done: number; total: number };
type Domains = { domains: { hostname: string; status: string }[] };
type Onboarding = { onboarding: { tourDone?: boolean; goals?: string[] }; onboardedAt: string | null };

const ITEM_ICON: Record<string, ReactNode> = {
  publish: <Rocket className="size-4" />,
  design: <Paintbrush className="size-4" />,
  products: <Package className="size-4" />,
  payments: <CreditCard className="size-4" />,
  shipping: <ShoppingBag className="size-4" />,
  contact: <Receipt className="size-4" />,
  pos: <ScanLine className="size-4" />,
  bookings: <Sparkles className="size-4" />,
  domain: <Globe className="size-4" />,
  invoicing: <ReceiptText className="size-4" />,
};

export function ProjectHome({ projectId, name, liveUrl }: { projectId: string; name: string; liveUrl: string | null }) {
  const { org } = useSession();
  const searchKeys = useShortcuts().keys("mod+k");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ["setup", projectId], queryFn: () => api<Setup>(`/api/v1/projects/${projectId}/setup`) });
  const domains = useQuery({ queryKey: ["domains", projectId], queryFn: () => api<Domains>(`/api/v1/projects/${projectId}/domains`) });
  const onboarding = useQuery({ queryKey: ["onboarding"], queryFn: () => api<Onboarding>("/api/v1/auth/onboarding") });
  const [tour, setTour] = useState(false);
  // Rendered only in the browser (after the project loads), so window is available.
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));

  const finishTour = useMutation({
    mutationFn: () => api("/api/v1/auth/onboarding", { method: "PUT", body: { tourDone: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  // Opens by itself right after a launch (?tour=1). Otherwise, until it's been
  // taken or dismissed, a small invitation sits at the top — never a pop-up.
  const asked = params.get("tour") === "1";
  const invite = !asked && !!onboarding.data && !onboarding.data.onboarding.tourDone;
  const ready = !!setup.data;
  useEffect(() => {
    if (ready && asked) {
      const t = setTimeout(() => setTour(true), 600);
      return () => clearTimeout(t);
    }
  }, [ready, asked]);

  const closeTour = (finished: boolean) => {
    setTour(false);
    finishTour.mutate();
    if (asked) router.replace(pathname, { scroll: false });
    if (finished) toast({ tone: "success", title: "You're all set", description: "Replay the tour any time from “Take the tour”." });
  };

  // Only what this workspace has switched on (Settings → Features).
  const on = (id: ModuleId) => visibleTo(org, id);
  const store = setup.data?.kind === "store" && on("store");
  const pos = !!setup.data?.items.some((i) => i.id === "pos") && on("pos");
  const invoicing = !!setup.data?.items.some((i) => i.id === "invoicing") && on("invoicing");
  const horeca = on("horeca") && org.modules !== null;
  const domain = domains.data?.domains[0];
  const fullUrl = liveUrl && origin ? `${origin}${liveUrl}` : liveUrl;
  const next = setup.data?.items.find((i) => !i.done);

  const steps: TourStep[] = [
    { icon: <Compass />, title: `Welcome to ${name}`, body: <>This is your control centre. A one-minute tour of how to run your {store ? "store" : "website"} — you can replay it any time.</> },
    { target: "live", icon: <Globe />, title: liveUrl ? "Your site is live" : "Your site", body: <>{liveUrl ? "Visit or share your link from here." : "Once you publish, your link appears here."} {domain ? `${domain.hostname} shows here once its DNS records are in.` : "Connect your own domain whenever you're ready."}</> },
    { target: "checklist", icon: <LayoutDashboard />, title: "Your setup checklist", body: <>Made from what you told us you need. Each item ticks itself off when it&apos;s really done — we check your actual {store ? "store" : "site"}, not just clicks.</> },
    { target: "actions", icon: <Sparkles />, title: "Everyday shortcuts", body: <>The things you&apos;ll do most{store ? ": add products, see orders" : ": edit pages, read enquiries"}{pos ? ", and open the till for your counter" : ""}.</> },
    { target: "nav-builder", icon: <Paintbrush />, title: "Design anything", body: <>Click any text to style it, double-click to edit in place, and drag sections around. Changes go live when you publish.</> },
    ...(store
      ? [{ target: "nav-store", icon: <ShoppingBag />, title: "Run your store", body: <>Products, orders, payments, delivery and customers.{pos ? " Point of sale and barcode labels are under “In-store”." : " Selling at a counter too? Point of sale is under “In-store”."}</> }]
      : []),
    ...(horeca ? [{ icon: <UtensilsCrossed />, title: "Cloudesk for Horeca", body: <>QR ordering at every table, the kitchen display, bills, rooms, bar stock and valet — all under “Horeca” in the sidebar.</> }] : []),
    ...(on("invoicing") ? [{ target: "nav-invoicing", icon: <ReceiptText />, title: "Invoices & quotations", body: <>Send GST invoices and quotes in your own format — or one of eight designs — by link, email, WhatsApp or PDF. Record payments, send reminders and see what you&apos;re owed.</> }] : []),
    { target: "nav-deployments", icon: <Rocket />, title: "Publish & your domain", body: <>Publish changes, roll back with one click, and connect your own domain.</> },
    ...(on("growth") ? [{ target: "nav-growth", icon: <TrendingUp />, title: "Grow", body: <>Visitors, sales, and A/B tests with suggestions based on your real numbers.</> }] : []),
    { target: "search", icon: <Command />, title: searchKeys ? `Jump anywhere with ${searchKeys}` : "Jump anywhere", body: searchKeys ? <>Search pages, products and actions from anywhere — press {searchKeys} on any screen.</> : <>Tap the search bar at the top to find pages, products and actions from anywhere.</> },
    {
      icon: <PartyPopper />,
      title: "You're ready",
      body: next ? <>Next up: <b className="text-fg">{next.title.toLowerCase()}</b> — about {next.minutes} minute{next.minutes === 1 ? "" : "s"}.</> : <>Everything&apos;s set up. Time to share your link.</>,
      cta: next ? (
        <Link href={next.href} onClick={() => closeTour(true)} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-border text-[13px] font-semibold hover:bg-surface-2">
          Do it now <ArrowUpRight className="size-3.5" />
        </Link>
      ) : undefined,
    },
  ];

  return (
    <div className="mt-6 grid gap-4">
      {invite && !tour && (
        <div className="glass-card lx-rise flex flex-wrap items-center gap-3 rounded-[18px] px-4 py-3">
          <span className="grid size-9 place-items-center rounded-full bg-fg text-bg"><Compass className="size-4" /></span>
          <p className="min-w-0 flex-1 text-[13px]">
            <b>New here?</b> <span className="text-muted">A one-minute tour of how to run your {store ? "store" : "site"}.</span>
          </p>
          <button type="button" onClick={() => finishTour.mutate()} className="h-8 rounded-full px-3 text-[13px] text-muted hover:text-fg">Not now</button>
          <button type="button" onClick={() => setTour(true)} className="h-8 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">Take the tour</button>
        </div>
      )}
      {/* Live site */}
      <section data-tour="live" className="glass-card relative overflow-hidden rounded-[var(--radius-xl)]">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--accent)_22%,transparent),transparent_70%)] blur-2xl" aria-hidden />
        <div className="relative grid gap-5 p-5 md:grid-cols-[1fr_300px] md:items-center">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[12px] font-medium text-muted">
              <span className={clsx("size-2 rounded-full", liveUrl ? "bg-success shadow-[0_0_0_4px_color-mix(in_srgb,var(--success)_20%,transparent)]" : "bg-subtle")} />
              {liveUrl ? "Live" : "Not published yet"}
              {setup.data && <span>· {store ? "Online store" : "Website"}</span>}
            </p>
            <h2 className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em]">{liveUrl ? "Your site is live" : "Publish when you're ready"}</h2>
            {fullUrl ? (
              <div className="mt-3 flex max-w-lg items-center gap-1.5 rounded-full border border-border bg-surface/70 p-1 pl-4 backdrop-blur-xl">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{fullUrl.replace(/^https?:\/\//, "")}</span>
                <button type="button" aria-label="Copy link" onClick={() => void navigator.clipboard.writeText(fullUrl).then(() => toast({ tone: "success", title: "Link copied" }))} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
                  <Copy className="size-3.5" />
                </button>
                <a href={liveUrl!} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-full bg-fg px-3.5 text-[12px] font-semibold text-bg">
                  Visit <ExternalLink className="size-3" />
                </a>
              </div>
            ) : (
              <Link href={`/projects/${projectId}/deployments`} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">
                <Rocket className="size-3.5" /> Publish
              </Link>
            )}
            <p className="mt-2.5 flex items-center gap-1.5 text-[12px] text-muted">
              <Globe className="size-3.5" />
              {domain ? (
                <>
                  <span className="font-mono">{domain.hostname}</span> — {domain.status === "verified" ? "connected" : "waiting for DNS records"}
                </>
              ) : (
                <Link href={`/projects/${projectId}/deployments`} className="hover:text-fg hover:underline">Connect your own domain</Link>
              )}
            </p>
          </div>
          {liveUrl && (
            <a href={liveUrl} target="_blank" rel="noreferrer" aria-label="Open your live site" className="group relative hidden aspect-[16/10] overflow-hidden rounded-[14px] border border-border bg-surface-2 shadow-[0_30px_60px_-30px_rgb(0_0_0/.45)] md:block">
              <iframe src={liveUrl} title="Live site preview" tabIndex={-1} loading="lazy" className="pointer-events-none absolute top-0 left-0 h-[312.5%] w-[312.5%] origin-top-left scale-[0.32] border-0" />
              <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100">
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-black">Open <ArrowUpRight className="size-3.5" /></span>
              </span>
            </a>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Checklist */}
        <section data-tour="checklist" className="glass-card rounded-[var(--radius-xl)] p-5">
          {!setup.data ? (
            <Skeleton className="h-48" />
          ) : (
            <>
              <div className="flex items-center gap-4">
                <Ring value={setup.data.done} total={setup.data.total} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold">{setup.data.done === setup.data.total ? "Everything's set up" : "Finish setting up"}</h2>
                  <p className="text-[12px] text-muted">{setup.data.done} of {setup.data.total} done{next ? ` · next: ${next.title.toLowerCase()}` : ""}</p>
                </div>
                <button type="button" onClick={() => setTour(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium hover:bg-surface-2">
                  <Compass className="size-3.5" /> Take the tour
                </button>
              </div>
              <ul className="mt-4 grid gap-1">
                {setup.data.items.map((it, i) => (
                  <li key={it.id} className="lx-rise" style={{ animationDelay: `${i * 40}ms` }}>
                    <Link href={it.href} className={clsx("group flex items-center gap-3 rounded-[14px] p-2.5 transition-colors hover:bg-surface-2", it === next && "bg-surface-2/70")}>
                      <span className={clsx("grid size-8 shrink-0 place-items-center rounded-full transition-colors", it.done ? "bg-success text-white" : "bg-surface-2 text-muted group-hover:bg-surface-3")}>
                        {it.done ? <Check className="size-4" /> : ITEM_ICON[it.id]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={clsx("block text-[13px]", it.done ? "text-muted line-through decoration-1" : "font-medium")}>{it.title}</span>
                        {!it.done && <span className="block truncate text-[12px] text-muted">{it.detail}</span>}
                      </span>
                      {!it.done && <span className="shrink-0 text-[11px] text-subtle tabular-nums">~{it.minutes} min</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Shortcuts */}
        <section data-tour="actions" className="grid content-start gap-2.5">
          {[
            { href: `/projects/${projectId}/builder`, icon: <Paintbrush className="size-4" />, title: "Edit design", sub: "Text, photos, colours, sections" },
            ...(store
              ? [
                  { href: `/projects/${projectId}/store/products`, icon: <Package className="size-4" />, title: "Products", sub: "Add, import, stock and prices" },
                  { href: `/projects/${projectId}/store/orders`, icon: <Receipt className="size-4" />, title: "Orders", sub: "Pack, ship, invoice, refund" },
                ]
              : [
                  { href: `/projects/${projectId}?tab=submissions`, icon: <Receipt className="size-4" />, title: "Enquiries", sub: "Messages from your forms" },
                  ...(on("store") ? [{ href: `/projects/${projectId}/store`, icon: <ShoppingBag className="size-4" />, title: "Add an online store", sub: "Sell from this website, in its design" }] : []),
                ]),
            ...(invoicing ? [{ href: `/projects/${projectId}/invoicing/invoices/new`, icon: <ReceiptText className="size-4" />, title: "New invoice", sub: "Or a quotation — share it in seconds" }] : []),
            ...(horeca ? [{ href: `/projects/${projectId}/horeca`, icon: <UtensilsCrossed className="size-4" />, title: "Horeca", sub: "Tables, kitchen, rooms and bar" }] : []),
            ...(store && on("pos") ? [{ href: `/projects/${projectId}/pos`, icon: <ScanLine className="size-4" />, title: "Point of sale", sub: "Scan, bill and print receipts" }] : []),
          ].map((a, i) => (
            <Link key={a.title} href={a.href} className="glass-card lx-card lx-rise group flex items-center gap-3 rounded-[18px] p-3.5" style={{ animationDelay: `${80 + i * 50}ms` }}>
              <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-fg text-bg">{a.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">{a.title}</span>
                <span className="block truncate text-[12px] text-muted">{a.sub}</span>
              </span>
              <ArrowUpRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          ))}
        </section>
      </div>

      <Tour open={tour} steps={steps} onClose={closeTour} label={`${name} tour`} />
    </div>
  );
}

function Ring({ value, total }: { value: number; total: number }) {
  const r = 22;
  const len = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <span className="relative grid size-14 shrink-0 place-items-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--success)" strokeWidth="5" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - pct)} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.16,1,.3,1)" }} />
      </svg>
      <span className="text-[13px] font-semibold tabular-nums">{Math.round(pct * 100)}%</span>
    </span>
  );
}
