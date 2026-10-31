"use client";

// Adding an online store to a project that already has a website. Two ways:
// add it to this website (the design stays; shop sections, menu and footer
// links are added in the site's own style — previewed live before and after),
// or build a separate store. The website's previous version stays in history.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, ExternalLink, LayoutTemplate, Package, Palette, Rocket, ShoppingBag, Sparkles, Store as StoreIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SitePreview } from "@/components/site-preview";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import { Button, ButtonLink, Field, Input, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { parseSiteDoc, SITE_DOC_PATH, type SiteDoc } from "@/lib/site/model";
import { renderPage } from "@/lib/site/render";
import { embedStoreInSite, hasStorefront, type EmbedOptions } from "@/lib/store/embed";
import { CURRENCIES } from "@/lib/store/money";
import { COUNTRIES } from "@/lib/store/shipping";
import { photoUrl } from "@/lib/site/media";
import type { Catalog } from "@/lib/store/storefront";
import { samplePrice, slugifyTitle, STORE_TEMPLATES_SHOWN, storeTemplate, type StoreTemplate } from "@/lib/store/templates";
import { sampleFor } from "@/lib/templates/collections";

type Step = "choose" | "embed" | "done";
type Result = { seeded: number; added: string[] };

export function AddStore({ projectId, projectName, canDesign, onRedesign }: { projectId: string; projectName: string; canDesign: boolean; onRedesign: () => void }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<Step>("choose");
  const [opts, setOpts] = useState<EmbedOptions>({ placement: "after-hero", categories: true });
  const [view, setView] = useState<"after" | "before">("after");
  const [sample, setSample] = useState<string>(sampleFor(org.industry));
  const [form, setForm] = useState({ name: projectName, country: "IN", currency: "INR" });
  const [result, setResult] = useState<Result | null>(null);
  const sampleT = storeTemplate(sample);
  const file = useQuery({ queryKey: ["file", projectId, SITE_DOC_PATH], queryFn: () => api<{ content: string }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(SITE_DOC_PATH)}`) });
  const doc = useMemo(() => {
    const r = file.data ? parseSiteDoc(file.data.content) : null;
    return r?.ok ? r.doc : null;
  }, [file.data]);
  // Shows just the part of the home page that changes: the menu, the shop
  // sections and the section that follows — before and after.
  const preview = useMemo(() => {
    if (!doc) return null;
    const after = embedStoreInSite(doc, opts);
    const page = (d: SiteDoc) => d.pages.find((p) => p.path === "/" && !p.lang) ?? d.pages[0];
    const home = page(after.doc);
    const fresh = home.sections.filter((x) => !page(doc).sections.some((o) => o.id === x.id));
    const lastNew = home.sections.indexOf(fresh[fresh.length - 1]);
    const following = home.sections.slice(lastNew + 1).find((x) => !["footer"].includes(x.type));
    const chrome = (d: SiteDoc, type: string) => page(d).sections.find((x) => x.type === type);
    const pick = view === "after" ? after.doc : doc;
    const sections = [chrome(pick, "banner"), chrome(pick, "navbar"), ...(view === "after" ? fresh : []), following, chrome(pick, "footer")].filter((x): x is NonNullable<typeof x> => !!x);
    return { html: renderPage(pick, { ...page(pick), sections }, { kind: "preview" }, { catalog: sampleT ? previewCatalog(sampleT, form.currency) : null }), added: after.added };
  }, [doc, opts, view, sampleT, form.currency]);
  const embed = useMutation({
    mutationFn: () => api<Result>(`/api/v1/projects/${projectId}/store/embed`, { method: "POST", body: { ...form, name: form.name.trim() || projectName, sample: sample || null, ...opts } }),
    onSuccess: (r) => {
      setResult(r);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["file", projectId] });
    },
    onError: (e) => toast({ tone: "error", title: "The store wasn't added", description: errorMessage(e) }),
  });
  const already = doc ? hasStorefront(doc) : false;

  if (step === "done" && result)
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 text-center sm:px-8">
        <span className="lx-rise mx-auto grid size-16 place-items-center rounded-[22px] bg-success-soft text-success shadow-[0_20px_40px_-20px_rgb(0_0_0/0.25)]">
          <Check className="size-8" />
        </span>
        <h1 className="lx-rise mt-5 text-[28px] font-semibold tracking-[-0.03em]" style={{ animationDelay: "60ms" }}>
          Your store is part of your website
        </h1>
        <p className="lx-rise mt-2 text-[15px] text-muted" style={{ animationDelay: "120ms" }}>
          Same design, same pages — now with a shop.{result.seeded ? ` ${result.seeded} sample products are in place; replace them with your own before you sell.` : ""}
        </p>
        <ul className="lx-rise mx-auto mt-7 grid max-w-md gap-2 text-left" style={{ animationDelay: "180ms" }}>
          {result.added.map((a) => (
            <li key={a} className="flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-2.5 text-[14px]">
              <span className="grid size-6 place-items-center rounded-full bg-success-soft text-success">
                <Check className="size-3.5" />
              </span>
              {a}
            </li>
          ))}
        </ul>
        <div className="lx-rise mt-8 flex flex-wrap justify-center gap-2.5" style={{ animationDelay: "240ms" }}>
          <Button
            variant="primary"
            size="lg"
            icon={<Package className="size-4" />}
            onClick={() => {
              // Switch the page over to the store dashboard.
              void qc.invalidateQueries({ queryKey: ["store", projectId] });
            }}
          >
            Open my store
          </Button>
          <ButtonLink href={`/projects/${projectId}/builder`} size="lg" icon={<Palette className="size-4" />}>
            See it in the builder
          </ButtonLink>
        </div>
        <p className="mt-6 text-[12.5px] text-subtle">Changed your mind? Restore the previous version from the builder&apos;s version history.</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-[16px] border border-border bg-surface shadow-sm">
          <StoreIcon className="size-5" />
        </span>
        <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.03em]">{step === "choose" ? "Add an online store" : "Your store, in your website's style"}</h1>
        <p className="mt-2 text-[14.5px] text-muted">
          {step === "choose" ? "Sell from the website you already have, or start a separate store." : "Here's your home page with the store blended in. Nothing changes until you press Add the store."}
        </p>
      </div>

      {step === "choose" && (
        <div className="mx-auto mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setStep("embed")}
            disabled={!canDesign || already}
            className="lx-rise group relative flex flex-col overflow-hidden rounded-[24px] border-2 border-fg bg-surface text-left shadow-[0_24px_60px_-34px_rgb(30_20_60/0.45)] transition-transform duration-300 hover:-translate-y-1 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <EmbedArt />
            <span className="grid gap-2 p-6">
              <span className="flex items-center justify-between gap-2">
                <b className="text-[18px] font-semibold tracking-[-0.01em]">Add it to this website</b>
                <span className="rounded-full bg-fg px-2.5 py-1 text-[11px] font-semibold text-bg">Recommended</span>
              </span>
              <span className="text-[13.5px] leading-relaxed text-muted">Your design stays. We add the shop in your colours, fonts and layout — so it feels like it was always there.</span>
              <ul className="mt-2 grid gap-1.5 text-[13px]">
                {["A Shop link and cart in your menu", "Bestsellers and categories on your home page", "Shop, product, cart and checkout pages", "One website, one address, one login"].map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <Check className="size-3.5 text-success" />
                    {x}
                  </li>
                ))}
              </ul>
              <span className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold">
                {already ? "This website already has shop sections" : !canDesign ? "Needs permission to edit the design" : "Preview it on my site"} {canDesign && !already && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
              </span>
            </span>
          </button>
          <div className="lx-rise flex flex-col overflow-hidden rounded-[24px] border border-border bg-surface" style={{ animationDelay: "80ms" }}>
            <SeparateArt />
            <span className="grid gap-2 p-6">
              <b className="text-[18px] font-semibold tracking-[-0.01em]">Build a separate store</b>
              <span className="text-[13.5px] leading-relaxed text-muted">A new project with its own storefront design and address. Best when the store is a different brand from this website.</span>
              <div className="mt-3 flex flex-wrap gap-2">
                <ButtonLink href="/launch?kind=store" variant="primary" icon={<Rocket className="size-4" />}>
                  Five-minute store launch
                </ButtonLink>
                <ButtonLink href="/templates?kind=business" icon={<LayoutTemplate className="size-4" />}>
                  Store templates
                </ButtonLink>
              </div>
            </span>
          </div>
          {canDesign && (
            <p className="text-center text-[12.5px] text-muted md:col-span-2">
              Or{" "}
              <button type="button" onClick={onRedesign} className="font-medium text-fg underline-offset-4 hover:underline">
                redesign this project as a store
              </button>{" "}
              with a storefront template (replaces the current design; it stays in version history).
            </p>
          )}
        </div>
      )}

      {step === "embed" && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div role="tablist" aria-label="Preview" className="inline-flex rounded-full bg-surface-2 p-1">
                {(
                  [
                    ["after", "With your store"],
                    ["before", "Before"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={clsx("h-8 rounded-full px-4 text-[13px] font-medium transition-[background,color,box-shadow] duration-[var(--dur)]", view === v ? "bg-surface-solid text-fg shadow-sm" : "text-muted hover:text-fg")}>
                    {l}
                  </button>
                ))}
              </div>
              <span className="text-[12px] text-subtle">The part of your home page that changes</span>
            </div>
            <div className="overflow-hidden rounded-[20px] border border-border shadow-[var(--shadow-md)]">
              {preview ? <SitePreview key={`${view}-${opts.placement}-${opts.categories}`} html={preview.html} title={view === "after" ? "Your home page with the store" : "Your home page now"} height={620} /> : file.isError ? <p className="p-10 text-center text-[13px] text-danger">Couldn&apos;t load your website: {errorMessage(file.error)}</p> : <Skeleton className="h-[620px]" />}
            </div>
          </div>
          <aside className="grid content-start gap-4 lg:sticky lg:top-20">
            <section className="rounded-[20px] border border-border bg-surface p-4">
              <p className="mb-3 text-[13px] font-semibold">What we&apos;ll add</p>
              <ul className="grid gap-2 text-[13px]">
                {(preview?.added ?? []).map((a) => (
                  <li key={a} className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
                    {a}
                  </li>
                ))}
              </ul>
            </section>
            <section className="grid gap-3 rounded-[20px] border border-border bg-surface p-4">
              <p className="text-[13px] font-semibold">On your home page</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ["after-hero", "After the hero"],
                    ["before-footer", "Near the end"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={opts.placement === v} onClick={() => setOpts({ ...opts, placement: v })} className={clsx("h-9 rounded-[12px] border text-[12.5px] font-medium", opts.placement === v ? "border-fg bg-surface-2" : "border-border")}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between text-[13px]">
                Shop by category tiles
                <Switch checked={opts.categories} onChange={(v) => setOpts({ ...opts, categories: v })} label="Shop by category tiles" />
              </div>
            </section>
            <section className="grid gap-3 rounded-[20px] border border-border bg-surface p-4">
              <Field label="Store name">{(a) => <Input {...a} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />}</Field>
              <div className="grid grid-cols-2 gap-2">
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
                          {c.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Field label="Start with sample products" hint={sampleT ? `${sampleT.products.length} samples from ${sampleT.name} — they can't be bought until you edit them.` : "Add your own products after."}>
                {(a) => (
                  <Select {...a} value={sample} onChange={(e) => setSample(e.target.value)}>
                    <option value="">No samples — I&apos;ll add mine</option>
                    {STORE_TEMPLATES_SHOWN.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.category} — {t.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </section>
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("choose")}>
                Back
              </Button>
              <Button variant="primary" size="lg" icon={<ShoppingBag className="size-4" />} loading={embed.isPending} disabled={!doc} onClick={() => embed.mutate()}>
                Add the store
              </Button>
            </div>
            <p className="text-[12px] leading-relaxed text-subtle">
              Your current website is kept in version history. <Link href={`/projects/${projectId}/builder`} className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline">Open the builder <ExternalLink className="size-3" /></Link>
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

/** A website frame with the shop sliding into place. */
function EmbedArt() {
  return (
    <span aria-hidden className="relative block h-40 overflow-hidden bg-[linear-gradient(135deg,var(--p-lavender),var(--p-peach))]">
      <span className="absolute inset-x-8 top-6 bottom-0 rounded-t-[14px] bg-surface shadow-[0_20px_40px_-20px_rgb(0_0_0/0.35)]">
        <span className="flex items-center gap-1 border-b border-border px-3 py-2">
          <i className="size-1.5 rounded-full bg-[#ff5f57]" />
          <i className="size-1.5 rounded-full bg-[#febc2e]" />
          <i className="size-1.5 rounded-full bg-[#28c840]" />
          <span className="ml-auto flex items-center gap-2 text-[9px] font-semibold text-muted">
            Home <span className="rounded-full bg-fg px-1.5 py-px text-bg">Shop</span> About <ShoppingBag className="size-2.5" />
          </span>
        </span>
        <span className="mx-3 mt-2 block h-6 rounded-[6px] bg-surface-2" />
        <span className="mx-3 mt-2 grid grid-cols-4 gap-1.5" style={{ animation: "lx-rise .7s .3s cubic-bezier(.2,.8,.2,1) both" }}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="grid gap-1">
              <span className="aspect-square rounded-[5px]" style={{ background: ["var(--p-peach)", "var(--p-mint)", "var(--p-sky)", "var(--p-butter)"][i] }} />
              <span className="h-1 w-3/4 rounded-full bg-fg/15" />
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

/** Two separate projects, side by side. */
function SeparateArt() {
  return (
    <span aria-hidden className="relative flex h-40 items-end justify-center gap-4 overflow-hidden bg-surface-2 px-8 pt-6">
      {["Website", "Store"].map((l, i) => (
        <span key={l} className="flex h-full w-1/2 flex-col rounded-t-[12px] bg-surface shadow-[0_16px_30px_-20px_rgb(0_0_0/0.3)]">
          <span className="border-b border-border px-2.5 py-1.5 text-[9px] font-semibold text-muted">{l}</span>
          <span className="m-2 flex-1 rounded-[6px]" style={{ background: i ? "var(--p-peach)" : "var(--p-sky)" }} />
        </span>
      ))}
    </span>
  );
}

/** The sample products a template would add, as a catalogue for the preview. */
function previewCatalog(t: StoreTemplate, currency: string): Catalog {
  const collections = t.collections.map((c, i) => ({ id: `c${i}`, slug: slugifyTitle(c.title), title: c.title, description: c.description, image: photoUrl(c.photo, 800, [4, 5]), productCount: t.products.filter((p) => p.collection === i).length }));
  return {
    currency,
    collections,
    products: t.products.map((p, i) => ({
      id: `p${i}`,
      slug: slugifyTitle(p.title),
      title: p.title,
      description: p.description,
      images: [photoUrl(p.photo, 800, [4, 5])],
      vendor: "",
      tags: [],
      featured: !!p.featured,
      createdAt: new Date(2026, 0, 1 + i).toISOString(),
      collectionIds: [`c${p.collection}`],
      options: p.options ? [p.options] : [],
      variants: [{ id: `v${i}`, title: "", price: samplePrice(p.inr, currency), compareAt: p.compareInr ? samplePrice(p.compareInr, currency) : null, available: 10, options: {} }],
    })),
  };
}
