"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Barcode, BookOpen, Boxes, CalendarDays, Check, KeyRound, CreditCard, ExternalLink, FolderTree, Gauge, Gift, MessageCircle, Undo2, Landmark, PackageSearch, Receipt, Repeat, ScanLine, Settings2, ShoppingBag, ShoppingCart, Star, Store as StoreIcon, Truck, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import { Button, ButtonLink, cx, EmptyState, ErrorState, Field, Input, Select, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { useProject } from "@/lib/client/use-project";
import { CURRENCIES } from "@/lib/store/money";
import { COUNTRIES, INDIAN_STATES } from "@/lib/store/shipping";
import { AddStore } from "./add-store";
import { CollectionsView, InventoryView, ReviewsView } from "./catalog-views";
import { AbandonedView, CustomerDetail, CustomersView, MembersView } from "./customers";
import { BookingsView } from "./bookings";
import { LabelsView } from "./labels";
import { GiftCardsView, ReturnsView, SubscriptionsView } from "./operations";
import { CatalogueEditor, CataloguesView } from "./catalogues";
import { OrderDetail, OrdersView } from "./orders";
import { StoreOverview } from "./overview";
import { ProductEditor, ProductsView } from "./products";
import { DiscountsView, PaymentsView, SettingsView, ShippingView, TaxesView } from "./settings";
import { WhatsAppView } from "./whatsapp";
import { storeApi, StoreProvider, type Store, type TemplateCard } from "./shared";

const NAV: { group?: string; items: { id: string; label: string; icon: ReactNode; perm?: string; href?: (projectId: string) => string }[] }[] = [
  {
    items: [
      { id: "", label: "Overview", icon: <Gauge /> },
      { id: "orders", label: "Orders", icon: <Receipt />, perm: "store:orders" },
      { id: "returns", label: "Returns", icon: <Undo2 />, perm: "store:orders" },
      { id: "subscriptions", label: "Subscriptions", icon: <Repeat />, perm: "store:orders" },
      { id: "bookings", label: "Bookings", icon: <CalendarDays /> },
      { id: "products", label: "Products", icon: <ShoppingBag /> },
      { id: "collections", label: "Collections", icon: <FolderTree /> },
      { id: "catalogues", label: "Catalogues", icon: <BookOpen /> },
      { id: "inventory", label: "Inventory", icon: <Boxes /> },
      { id: "customers", label: "Customers", icon: <Users />, perm: "store:orders" },
      { id: "members", label: "Members", icon: <KeyRound />, perm: "store:orders" },
    ],
  },
  {
    group: "In-store",
    items: [
      { id: "pos", label: "Point of sale", icon: <ScanLine />, perm: "store:orders", href: (projectId: string) => `/projects/${projectId}/pos` },
      { id: "labels", label: "Labels & barcodes", icon: <Barcode /> },
    ],
  },
  {
    group: "Marketing",
    items: [
      { id: "discounts", label: "Discounts", icon: <BadgePercent /> },
      { id: "giftcards", label: "Gift cards", icon: <Gift /> },
      { id: "abandoned", label: "Abandoned carts", icon: <ShoppingCart />, perm: "store:orders" },
      { id: "reviews", label: "Reviews", icon: <Star /> },
    ],
  },
  {
    group: "Setup",
    items: [
      { id: "payments", label: "Payments", icon: <CreditCard /> },
      { id: "shipping", label: "Shipping", icon: <Truck /> },
      { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle /> },
      { id: "taxes", label: "Taxes", icon: <Landmark /> },
      { id: "settings", label: "Store settings", icon: <Settings2 /> },
    ],
  },
];

export function StoreAdmin({ projectId, path }: { projectId: string; path: string[] }) {
  const { org } = useSession();
  const project = useProject(projectId);
  const info = useQuery({ queryKey: ["store", projectId, ""], queryFn: () => api<{ store: Store | null; mailDelivery: boolean; templates: TemplateCard[] }>(storeApi(projectId)) });

  if (project.isPending || info.isPending)
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-64" />
      </div>
    );
  if (project.isError) return <ErrorState title="Project unavailable" message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  if (info.isError) return <ErrorState title="Store unavailable" message={errorMessage(info.error)} onRetry={() => info.refetch()} />;

  const perms = project.data.permissions;
  const can = (p: string) => perms.includes(p);
  const p = project.data.project;
  const liveUrl = p.productionDeploymentId ? `/s/${org.slug}/${p.slug}` : null;
  if (!can("store:manage") && !can("store:orders")) return <EmptyState icon={<StoreIcon className="size-5" />} title="No access to the store" description="Ask a project owner or admin for access." className="py-24" />;
  if (!info.data.store) return <NoStore projectId={projectId} projectName={p.name} kind={p.kind} templates={info.data.templates} canSetup={can("store:manage")} canDesign={can("design:write")} />;

  const [section = "", id, sub] = path;
  const base = `/projects/${projectId}/store`;
  let body: ReactNode;
  switch (section) {
    case "orders":
      body = id ? <OrderDetail id={id} /> : <OrdersView />;
      break;
    case "products":
      body = id ? <ProductEditor id={id === "new" ? null : id} /> : <ProductsView />;
      break;
    case "catalogues":
      body = id ? <CatalogueEditor id={id} /> : <CataloguesView />;
      break;
    case "collections":
      body = <CollectionsView />;
      break;
    case "inventory":
      body = <InventoryView />;
      break;
    case "customers":
      body = id ? <CustomerDetail id={id} /> : <CustomersView />;
      break;
    case "discounts":
      body = <DiscountsView />;
      break;
    case "members":
      body = <MembersView />;
      break;
    case "giftcards":
      body = <GiftCardsView />;
      break;
    case "returns":
      body = <ReturnsView />;
      break;
    case "subscriptions":
      body = <SubscriptionsView />;
      break;
    case "bookings":
      body = <BookingsView />;
      break;
    case "abandoned":
      body = <AbandonedView />;
      break;
    case "reviews":
      body = <ReviewsView />;
      break;
    case "payments":
      body = <PaymentsView />;
      break;
    case "shipping":
      body = <ShippingView />;
      break;
    case "whatsapp":
      body = <WhatsAppView />;
      break;
    case "taxes":
      body = <TaxesView />;
      break;
    case "labels":
      body = <LabelsView />;
      break;
    case "settings":
      body = <SettingsView />;
      break;
    default:
      body = <StoreOverview />;
  }
  void sub;

  return (
    <StoreProvider value={{ projectId, store: info.data.store, base, can, liveUrl, mailDelivery: info.data.mailDelivery }}>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:py-8">
        <aside className="lg:w-52 lg:shrink-0">
          <div className="mb-3 flex items-center justify-between gap-2 lg:mb-5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">Store</p>
              <p className="truncate text-sm font-semibold">{info.data.store.name}</p>
            </div>
            {liveUrl && <ButtonLink href={`${liveUrl}/shop`} external size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} label="View live store" />}
          </div>
          <nav aria-label="Store" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {NAV.map((g, gi) => (
              <div key={gi} className="flex gap-1 lg:flex-col">
                {g.group && <p className="hidden px-2.5 pt-4 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase lg:block">{g.group}</p>}
                {g.items
                  .filter((it) => !it.perm || can(it.perm))
                  .map((it) => {
                    const active = section === it.id;
                    return (
                      <Link
                        key={it.id}
                        href={it.href ? it.href(projectId) : it.id ? `${base}/${it.id}` : base}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "flex h-8 shrink-0 items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-[13px] whitespace-nowrap transition-colors [&_svg]:size-4",
                          active ? "nav-active tint-peach" : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
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
    </StoreProvider>
  );
}

// ─── Setup ───────────────────────────────────────────────────────────────────

/**
 * No store yet. A project that already has a website gets the choice to add
 * the store to it (or build a separate one); a project made for a store —
 * or arriving from a store template — goes straight to the store setup.
 */
function NoStore({ projectId, projectName, kind, templates, canSetup, canDesign }: { projectId: string; projectName: string; kind: string; templates: TemplateCard[]; canSetup: boolean; canDesign: boolean }) {
  const params = useSearchParams();
  const [redesign, setRedesign] = useState(false);
  const storeFirst = kind === "store" || !!params.get("template");
  if (!canSetup || storeFirst || redesign) return <SetupWizard projectId={projectId} templates={templates} canSetup={canSetup} canDesign={canDesign} />;
  return <AddStore projectId={projectId} projectName={projectName} canDesign={canDesign} onRedesign={() => setRedesign(true)} />;
}

function SetupWizard({ projectId, templates, canSetup, canDesign }: { projectId: string; templates: TemplateCard[]; canSetup: boolean; canDesign: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  // Arriving from the Templates page: the design is already picked, so go straight to the details.
  const params = useSearchParams();
  const picked = templates.find((t) => t.id === params.get("template"))?.id ?? null;
  const [template, setTemplate] = useState<string | null>(picked ?? templates[0]?.id ?? null);
  const [step, setStep] = useState<1 | 2>(picked ? 2 : 1);
  const [form, setForm] = useState({ name: params.get("name")?.slice(0, 80) ?? "", country: "IN", currency: "INR", region: "", email: "" });
  // A project made just for this store has nothing to lose, so the design swap is pre-confirmed.
  const [replace, setReplace] = useState(!!picked && params.get("fresh") === "1");
  const setup = useMutation({
    mutationFn: () => api<{ seeded?: number }>(storeApi(projectId, "setup"), { method: "POST", body: { ...form, name: form.name || templates.find((t) => t.id === template)?.storeName || "My store", template: template ?? undefined, replaceDesign: template ? replace : undefined } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      qc.invalidateQueries({ queryKey: ["file", projectId] });
      toast({ tone: "success", title: "Your store is ready", description: r.seeded ? `Added ${r.seeded} sample products. Replace them with your own before you start selling.` : undefined });
    },
    onError: (e) => toast({ tone: "error", title: "Could not create the store", description: errorMessage(e) }),
  });
  if (!canSetup) return <EmptyState icon={<StoreIcon className="size-5" />} title="This project has no store yet" description="Ask a project owner, admin or editor to set it up." className="py-24" />;
  const india = form.country === "IN";
  const chosen = templates.find((t) => t.id === template);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex size-11 items-center justify-center rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm">
          <StoreIcon className="size-5" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em]">Start selling online</h1>
        <p className="mt-2 text-[14px] text-muted">Pick a look for your shop, add your details, and you will have a working storefront with cart, checkout, payments and order tracking in a minute.</p>
        <ol className="mt-6 flex justify-center gap-6 text-[13px]">
          {["Choose a design", "Your details"].map((l, i) => (
            <li key={l} className={cx("flex items-center gap-2", step === i + 1 ? "font-medium text-fg" : "text-muted")}>
              <span className={cx("flex size-5 items-center justify-center rounded-full text-[11px]", step > i + 1 ? "bg-success text-white" : step === i + 1 ? "bg-fg text-bg" : "bg-surface-3")}>{step > i + 1 ? <Check className="size-3" /> : i + 1}</span>
              {l}
            </li>
          ))}
        </ol>
      </div>

      {step === 1 && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                aria-pressed={template === t.id}
                className={cx("group overflow-hidden rounded-[var(--radius-lg)] border bg-surface text-left shadow-sm transition-[box-shadow,border-color]", template === t.id ? "border-fg ring-2 ring-fg/15" : "border-border hover:border-border-strong hover:shadow-md")}
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote template preview */}
                  <img src={t.image} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                  <span className="absolute bottom-2 left-2 size-4 rounded-full border-2 border-white shadow" style={{ background: t.accent }} aria-hidden />
                  {t.signature && <span className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-white backdrop-blur">Signature</span>}
                  {template === t.id && (
                    <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-fg text-bg shadow">
                      <Check className="size-3.5" />
                    </span>
                  )}
                </div>
                <div className="p-3.5">
                  <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">{t.category}</p>
                  <p className="mt-0.5 text-sm font-semibold">{t.name}</p>
                  <p className="mt-1 text-xs text-muted">{t.description}</p>
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTemplate(null)}
              aria-pressed={template === null}
              className={cx("flex min-h-48 flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed p-6 text-center", template === null ? "border-fg bg-surface" : "border-border-strong hover:bg-surface")}
            >
              <PackageSearch className="size-6 text-muted" />
              <p className="mt-2 text-sm font-semibold">Keep my current design</p>
              <p className="mt-1 text-xs text-muted">Set up the store only. Add product grids to your pages from the builder.</p>
            </button>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" size="lg" onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <form
          className="mx-auto mt-8 max-w-lg space-y-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setup.mutate();
          }}
        >
          <Field label="Store name">{(a) => <Input {...a} value={form.name} placeholder={chosen?.storeName ?? "My store"} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} autoFocus />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Country">
              {(a) => (
                <Select {...a} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value, currency: e.target.value === "IN" ? "INR" : form.currency === "INR" ? "USD" : form.currency })}>
                  {COUNTRIES.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Currency">
              {(a) => (
                <Select {...a} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {india && (
            <Field label="State" hint="Used to split GST into CGST + SGST or IGST on invoices.">
              {(a) => (
                <Select {...a} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                  <option value="">Select your state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Order notification email" hint="New orders are emailed here.">
            {(a) => <Input {...a} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />}
          </Field>
          {template && (
            <label className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-2/60 p-3 text-[13px]">
              <input type="checkbox" className="mt-0.5" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={!canDesign} />
              <span>
                <span className="font-medium">Replace my site design with the {chosen?.name} storefront</span>
                <span className="mt-0.5 block text-xs text-muted">{canDesign ? "Your current design is kept in version history and can be restored. Sample products are added if your store is empty — they cannot be bought until you edit them." : "You need design access to apply a template. Choose “Keep my current design” instead."}</span>
              </span>
            </label>
          )}
          <p className="text-xs text-muted">We will add {india ? "domestic delivery, express and store pickup rates, plus cash on delivery" : "standard, express and pickup rates"}. You can change everything later.</p>
          <div className="flex justify-between gap-2 pt-2">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button type="submit" variant="primary" loading={setup.isPending} disabled={!!template && !replace}>
              Create my store
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
