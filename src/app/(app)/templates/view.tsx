"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Search, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SitePreview } from "@/components/site-preview";
import { BUSINESSES } from "@/components/marketing/businesses";
import { StorePreview, StoreTemplatePicker } from "@/components/store/store-template-picker";
import { STORE_TEMPLATES, storeTemplate, type StoreTemplate } from "@/lib/store/templates";
import { collectionById, collectionForIndustry, TEMPLATE_COLLECTIONS } from "@/lib/templates/collections";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, PageHeader } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { directionChoices, personality, PERSONALITIES, themeFor } from "@/lib/site/design";
import { renderPage } from "@/lib/site/render";
import { TEMPLATES, templateDoc, templateSpec, type Template } from "@/lib/site/templates";

const ALL = "All";
const CATEGORIES = [ALL, ...Array.from(new Set(TEMPLATES.filter((t) => t.id !== "blank").map((t) => t.category))).sort()];

/** Renders a template's home page, optionally in another design direction. */
function previewHtml(t: Template, look?: string) {
  const spec = templateSpec(t, undefined, look);
  const doc = templateDoc(t, undefined, look);
  return { html: renderPage(doc, doc.pages[0], { kind: "preview" }), theme: doc.theme, look: spec.personality ?? "" };
}

/** Composes and renders only once the card scrolls near the viewport. */
function LazyPreview({ t, height }: { t: Template; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const out = useMemo(() => (seen ? previewHtml(t) : null), [seen, t]);
  return (
    <div ref={ref} style={{ height }} className="relative overflow-hidden border-b border-border bg-surface-2">
      {out ? <SitePreview html={out.html} title={`${t.name} preview`} height={height} /> : <div className="skeleton absolute inset-0" aria-hidden />}
    </div>
  );
}

function Swatches({ look, size = "size-3" }: { look: string; size?: string }) {
  const p = themeFor(look).palette;
  return (
    <span className="inline-flex -space-x-1" aria-hidden>
      {[p.background, p.accent, p.text].map((c, i) => (
        <span key={i} className={clsx(size, "rounded-full ring-1 ring-black/10 dark:ring-white/15")} style={{ background: c }} />
      ))}
    </span>
  );
}

export function TemplatesView() {
  const { org } = useSession();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [category, setCategory] = useState(ALL);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [look, setLook] = useState<string | undefined>(undefined);
  const params = useSearchParams();
  const [kind, setKind] = useState<"business" | "site" | "store">(params.get("kind") === "store" ? "store" : params.get("kind") === "site" ? "site" : "business");
  // Opens on the visitor's own business when we know it.
  const [business, setBusiness] = useState(() => collectionById(params.get("business"))?.id ?? collectionForIndustry(org.industry)?.id ?? TEMPLATE_COLLECTIONS[0].id);
  const [storeChosen, setStoreChosen] = useState<StoreTemplate | null>(null);
  const [storeName, setStoreName] = useState("");
  const createStore = useMutation({
    mutationFn: () => api<{ project: { id: string } }>(`/api/v1/orgs/${org.id}/projects`, { method: "POST", body: { templateId: "store", name: storeName.trim() || storeChosen!.storeName } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["projects", org.id] });
      const qs = new URLSearchParams({ template: storeChosen!.id, name: storeName.trim() || storeChosen!.storeName, fresh: "1" });
      router.push(`/projects/${r.project.id}/store?${qs}`);
    },
    onError: (e) => toast({ tone: "error", title: "Could not create the store", description: errorMessage(e) }),
  });

  const shown = TEMPLATES.filter((t) => (category === ALL || t.category === category) && (!q.trim() || `${t.name} ${t.category} ${t.description} ${t.features.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())));
  const suggested = useMemo(() => (chosen ? (templateSpec(chosen).personality ?? "modern") : "modern"), [chosen]);
  const activeLook = look ?? suggested;
  const big = useMemo(() => (chosen ? previewHtml(chosen, activeLook) : null), [chosen, activeLook]);
  const choices = useMemo(() => (chosen ? directionChoices(templateSpec(chosen).industry, chosen.brief) : []), [chosen]);

  const create = useMutation({
    mutationFn: () => api<{ project: { id: string } }>(`/api/v1/orgs/${org.id}/projects`, { method: "POST", body: { templateId: chosen!.id, name: name.trim() || undefined, personality: activeLook } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["projects", org.id] });
      router.push(`/projects/${r.project.id}/builder`);
    },
    onError: (e) => toast({ tone: "error", title: "Could not create the web app", description: errorMessage(e) }),
  });

  const open = (t: Template) => {
    setChosen(t);
    setName(t.defaultName);
    setLook(undefined);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Templates"
        description={
          kind === "business"
            ? "Five premium starting points for each kind of business — websites and online stores, made for how you work."
            : kind === "store"
            ? `${STORE_TEMPLATES.length} online store designs — from glass-modern to classic. Each one creates a working store with checkout, ready for your products.`
            : `${TEMPLATES.length - 1} starting points across ${CATEGORIES.length - 1} categories. Each one creates a real, editable web app — choose a look, then make it yours.`
        }
      />

      <div role="tablist" aria-label="Template type" className="mb-6 inline-flex rounded-full bg-surface-2 p-1">
        {(
          [
            ["business", "By business"],
            ["site", "Websites"],
            ["store", "Online stores"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={kind === id} onClick={() => setKind(id)} className={clsx("h-8 rounded-full px-4 text-[13px] font-medium transition-[background,color,box-shadow] duration-[var(--dur)]", kind === id ? "bg-surface-solid text-fg shadow-sm" : "text-muted hover:text-fg")}>
            {label} {id !== "business" && <span className="ml-0.5 tabular-nums opacity-60">{id === "site" ? TEMPLATES.length - 1 : STORE_TEMPLATES.length}</span>}
          </button>
        ))}
      </div>

      {kind === "business" ? (
        <ByBusiness business={business} setBusiness={setBusiness} onSite={open} onStore={(t) => { setStoreChosen(t); setStoreName(t.storeName); }} />
      ) : kind === "store" ? (
        <StoreTemplatePicker />
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative w-full lg:max-w-xs">
              <span className="sr-only">Search templates</span>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="!rounded-full pl-10" />
            </label>
            <div role="radiogroup" aria-label="Category" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:pb-0">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={category === c}
                  onClick={() => setCategory(c)}
                  className={clsx("h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-[background,color,box-shadow] duration-[var(--dur)]", category === c ? "bg-fg text-bg shadow-sm" : "glass-card text-muted hover:text-fg")}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-muted">No templates match “{q}”.</p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((t) => {
                const dir = templateSpec(t).personality ?? "modern";
                return (
                  <article key={t.id} className="group glass-card flex flex-col overflow-hidden rounded-[var(--radius-xl)] transition-[transform,box-shadow] duration-300 ease-[var(--ease)] hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]">
                    <button onClick={() => open(t)} className="block text-left" aria-label={`Preview ${t.name}`}>
                      <LazyPreview t={t} height={200} />
                    </button>
                    <div className="flex flex-1 flex-col p-5">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
                          {t.name}
                          {t.crafted && <span className="rounded-full bg-fg px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-bg">Premium</span>}
                        </h2>
                        <Badge>{t.category}</Badge>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t.description}</p>
                      <ul className="mt-3 flex flex-wrap gap-1.5 text-[12px] text-muted">
                        {t.features.map((f) => (
                          <li key={f} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5">
                            <Check className="size-3 text-success" aria-hidden /> {f}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-5">
                        <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                          <Swatches look={dir} /> {t.pages ? `${t.pages.length} pages built` : personality(dir).label}
                        </span>
                        <Button variant="primary" onClick={() => open(t)}>
                          Use template
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      <Dialog
        open={!!chosen}
        onClose={() => setChosen(null)}
        size="2xl"
        title={`New web app from “${chosen?.name}”`}
        description={chosen?.pages ? "A complete multi-page site, ready to edit — change any word, image or colour after." : "Pick a look — you can change the design, content and colours any time after."}
        footer={
          <>
            <Button onClick={() => setChosen(null)}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              Create and open builder
            </Button>
          </>
        }
      >
        {chosen && big && (
          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            <div className="self-start overflow-hidden rounded-[var(--radius-lg)] border border-border shadow-[var(--shadow-md)]">
              <SitePreview key={activeLook} html={big.html} title={`${chosen.name} in the ${personality(activeLook).label} look`} height={440} />
            </div>
            <div className="min-w-0 space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <Field label="Web app name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />}</Field>
              </form>
              {chosen.pages ? (
                <div>
                  <p className="mb-2 text-[13px] font-medium">Pages included</p>
                  <ul className="grid grid-cols-2 gap-1.5 text-[13px]">
                    {chosen.pages.map((pg) => (
                      <li key={pg} className="flex items-center gap-1.5 rounded-[10px] bg-surface-2 px-2.5 py-1.5">
                        <Check className="size-3.5 text-success" aria-hidden /> {pg}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[12px] leading-relaxed text-muted">Facts only you know — clients, numbers, quotes and people — are marked [like this]. The design review lists them before you publish.</p>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-[13px] font-medium">Look</p>
                  <div role="radiogroup" aria-label="Look" className="grid grid-cols-1 gap-1.5">
                    {[...choices, ...PERSONALITIES.map((p) => p.id).filter((id) => !choices.includes(id))].map((id, i) => {
                      const p = personality(id);
                      const on = activeLook === id;
                      return (
                        <button
                          key={id}
                          role="radio"
                          aria-checked={on}
                          onClick={() => setLook(id)}
                          className={clsx("flex items-center gap-2.5 rounded-[12px] border px-3 py-2 text-left transition-[background,border,box-shadow] duration-[var(--dur)]", on ? "border-accent bg-accent-soft shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]" : "border-border hover:bg-surface-2")}
                        >
                          <Swatches look={id} size="size-3.5" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[13px] font-medium">
                              {p.label}
                              {i === 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-accent">
                                  <Sparkles className="size-3" aria-hidden /> Best match
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-[11px] text-muted">{p.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!storeChosen}
        onClose={() => setStoreChosen(null)}
        size="lg"
        title={`New store from “${storeChosen?.name}”`}
        description="A working storefront with checkout, payments and delivery — with sample products you replace with your own."
        footer={
          <>
            <Button onClick={() => setStoreChosen(null)}>Cancel</Button>
            <Button variant="primary" loading={createStore.isPending} onClick={() => createStore.mutate()}>
              Create store
            </Button>
          </>
        }
      >
        {storeChosen && (
          <div className="grid gap-4 sm:grid-cols-[1fr_260px]">
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
              <StorePreview t={storeChosen} height={300} />
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                createStore.mutate();
              }}
            >
              <Field label="Store name">{(p) => <Input {...p} value={storeName} onChange={(e) => setStoreName(e.target.value)} autoFocus maxLength={80} />}</Field>
              <p className="text-[12.5px] leading-relaxed text-muted">{storeChosen.description}</p>
            </form>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** Five templates for one kind of business: websites and stores side by side. */
function ByBusiness({ business, setBusiness, onSite, onStore }: { business: string; setBusiness: (id: typeof TEMPLATE_COLLECTIONS[number]["id"]) => void; onSite: (t: Template) => void; onStore: (t: StoreTemplate) => void }) {
  const c = collectionById(business) ?? TEMPLATE_COLLECTIONS[0];
  return (
    <div>
      <div role="radiogroup" aria-label="Business" className="-mx-1 mb-6 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TEMPLATE_COLLECTIONS.map((x) => {
          const b = BUSINESSES.find((y) => y.slug === x.id);
          const Icon = b?.icon;
          const on = x.id === c.id;
          return (
            <button key={x.id} role="radio" aria-checked={on} onClick={() => setBusiness(x.id)} className={clsx("inline-flex h-9 shrink-0 items-center gap-2 rounded-full pr-3.5 pl-2 text-[13px] font-medium transition-[background,color,box-shadow] duration-[var(--dur)]", on ? "bg-fg text-bg shadow-sm" : "glass-card text-muted hover:text-fg")}>
              {Icon && (
                <span className={clsx("grid size-6 place-items-center rounded-full", on ? "bg-bg/15" : `tint-${b!.tint} tint-chip`)}>
                  <Icon className="size-3.5" />
                </span>
              )}
              {x.label}
            </button>
          );
        })}
      </div>
      <div key={c.id} className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {c.items.map((ref, i) => {
          if (ref.kind === "site") {
            const t = TEMPLATES.find((x) => x.id === ref.id);
            if (!t) return null;
            const dir = templateSpec(t).personality ?? "modern";
            return (
              <article key={`s-${t.id}`} className="lx-rise group glass-card flex flex-col overflow-hidden rounded-[var(--radius-xl)] transition-[transform,box-shadow] duration-300 ease-[var(--ease)] hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]" style={{ animationDelay: `${i * 60}ms` }}>
                <button onClick={() => onSite(t)} className="block text-left" aria-label={`Preview ${t.name}`}>
                  <LazyPreview t={t} height={220} />
                </button>
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t.name}</h2>
                    <Badge>Website</Badge>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t.description}</p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-5">
                    <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                      <Swatches look={dir} /> {t.pages ? `${t.pages.length} pages` : personality(dir).label}
                    </span>
                    <Button variant="primary" onClick={() => onSite(t)}>
                      Use template
                    </Button>
                  </div>
                </div>
              </article>
            );
          }
          const t = storeTemplate(ref.id);
          if (!t) return null;
          return (
            <article key={`o-${t.id}`} className="lx-rise group glass-card flex flex-col overflow-hidden rounded-[var(--radius-xl)] transition-[transform,box-shadow] duration-300 ease-[var(--ease)] hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]" style={{ animationDelay: `${i * 60}ms` }}>
              <button onClick={() => onStore(t)} className="block text-left" aria-label={`Preview ${t.name}`}>
                <StorePreview t={t} height={220} />
              </button>
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t.name}</h2>
                  <Badge tone="accent">Online store</Badge>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t.description}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-5">
                  <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                    <span className="size-3 rounded-full ring-1 ring-black/10" style={{ background: t.accent }} /> {t.products.length} sample products
                  </span>
                  <Button variant="primary" onClick={() => onStore(t)}>
                    Use template
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
