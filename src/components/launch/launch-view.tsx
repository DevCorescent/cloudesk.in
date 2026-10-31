"use client";

// The five-minute launch: store or website → brand → products → look →
// payments → live. Every preview is the real renderer with the owner's own
// name, colours and products; the launch streams real server steps.
import clsx from "clsx";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Banknote, Check, CircleCheck, Copy, ExternalLink, Globe, ImagePlus, LayoutDashboard, LayoutTemplate, Link2, Loader2, Monitor, Package, Palette, ReceiptText, RefreshCw, Rocket, ScanLine, ShoppingBag, Smartphone, Sparkles, Store, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { SitePreview } from "@/components/site-preview";
import { useSession } from "@/components/shell/session-context";
import { visibleTo } from "@/lib/workspace/modules";
import { Button, Input } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { cleanDomain } from "@/lib/onboarding/understand";
import { composeLaunchSite, launchDocJson, looksFor, previewCatalog, WEBSITE_CATEGORIES, type Brand, type LaunchKind } from "@/lib/launch/compose";
import { PERSONALITIES } from "@/lib/site/design";
import { photoUrl } from "@/lib/site/media";
import { renderPage } from "@/lib/site/render";
import { isReady, type DraftProduct } from "@/lib/store/import";
import { CURRENCIES } from "@/lib/store/money";
import { COUNTRIES } from "@/lib/store/shipping";
import { STORE_TEMPLATES, STORE_TEMPLATES_SHOWN } from "@/lib/store/templates";
import { colorsFromImageUrl } from "../builder/media";
import { ProductDrop, ProductReview, withPhotoCheck, type Analysis } from "./product-import";

type StepId = "kind" | "brand" | "products" | "look" | "payments" | "domain" | "launch";
type DnsRecord = { type: "TXT" | "CNAME" | "A"; name: string; value: string; purpose: string };
type LaunchDomain = { id: string; hostname: string; records: DnsRecord[]; targetConfigured: boolean };
type Ev = { step: string; status?: string; detail?: string; done?: number; total?: number; message?: string; projectId?: string; liveUrl?: string | null; drafts?: number; imported?: number; problems?: string[]; domain?: LaunchDomain };
type Onboarding = { onboarding: { name?: string; brief?: string; kind?: LaunchKind; category?: string; domain?: string; assets?: string[]; goals?: string[] } };

const LOCALE_DEFAULTS: Record<string, [string, string]> = { "Asia/Kolkata": ["IN", "INR"], "Asia/Calcutta": ["IN", "INR"], "Asia/Dubai": ["AE", "AED"], "Asia/Singapore": ["SG", "SGD"], "Europe/London": ["GB", "GBP"], "Australia/Sydney": ["AU", "AUD"], "America/Toronto": ["CA", "CAD"], "Asia/Tokyo": ["JP", "JPY"], "Europe/Berlin": ["DE", "EUR"], "Europe/Paris": ["FR", "EUR"], "Europe/Amsterdam": ["NL", "EUR"] };
function localeDefaults(): [string, string] {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (LOCALE_DEFAULTS[tz]) return LOCALE_DEFAULTS[tz];
    if (tz.startsWith("America/")) return ["US", "USD"];
  } catch {
    /* default below */
  }
  return ["IN", "INR"];
}

const LOOK_LABEL = (id: string) => PERSONALITIES.find((p) => p.id === id)?.label ?? id;
const ACCENTS = ["#111111", "#1d4ed8", "#0f766e", "#b45309", "#be123c", "#7c3aed", "#15803d", "#c2410c"];

export function LaunchView() {
  const { org, user } = useSession();
  const router = useRouter();
  const [country0, currency0] = useMemo(localeDefaults, []);
  // Coming from onboarding with a choice already made skips the first question.
  const params = useSearchParams();
  const preset = params.get("kind");
  const presetKind: LaunchKind | null = preset === "store" || preset === "website" ? preset : null;
  const fromOnboarding = params.get("from") === "onboarding";
  const [step, setStep] = useState<StepId>(presetKind ? "brand" : "kind");
  const [brand, setBrand] = useState<Brand>({ kind: presetKind ?? "store", name: "", tagline: "", category: presetKind === "website" ? "restaurant" : "fashion", currency: currency0, country: country0, colors: [], personality: "", cod: country0 === "IN", accent: undefined });
  const [logoFile, setLogoFile] = useState<{ name: string; data: string } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [products, setProducts] = useState<DraftProduct[]>([]);
  const [upiId, setUpiId] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [events, setEvents] = useState<Ev[]>([]);
  const [launching, setLaunching] = useState(false);
  const [domain, setDomain] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [goals, setGoals] = useState<string[]>([]);

  // Coming from onboarding: start from what they told us.
  const answers = useQuery({ queryKey: ["onboarding"], queryFn: () => api<Onboarding>("/api/v1/auth/onboarding"), enabled: fromOnboarding });
  const o = answers.data?.onboarding;
  if (o && !prefilled) {
    setPrefilled(true);
    const k: LaunchKind = o.kind === "website" || o.kind === "store" ? o.kind : brand.kind;
    const validCategory = k === "store" ? STORE_TEMPLATES.some((t) => t.id === o.category) : WEBSITE_CATEGORIES.some((c) => c.id === o.category);
    setBrand((b) => ({ ...b, kind: k, name: o.name ?? b.name, tagline: (o.brief ?? b.tagline).slice(0, 200), category: validCategory ? o.category! : k === "store" ? "fashion" : "restaurant", personality: "" }));
    if (o.domain) setDomain(o.domain);
    setGoals(o.goals ?? []);
  }

  const steps: StepId[] = brand.kind === "store" ? ["kind", "brand", "products", "look", "payments", "domain", "launch"] : ["kind", "brand", "look", "domain", "launch"];
  const idx = steps.indexOf(step);
  const go = (d: 1 | -1) => setStep(steps[Math.max(0, Math.min(steps.length - 1, idx + d))]);
  const set = (patch: Partial<Brand>) => setBrand((b) => ({ ...b, ...patch }));
  const looks = looksFor(brand);
  const personality = brand.personality || looks[0];
  const finalBrand = { ...brand, personality };

  const canNext = step === "kind" ? true : step === "brand" ? brand.name.trim().length > 1 : step === "domain" ? !domain || !!cleanDomain(domain) : true;
  const complete = events.find((e) => e.step === "complete");
  const failed = events.find((e) => e.step === "error");

  async function launch() {
    setLaunching(true);
    setEvents([]);
    try {
      const res = await fetch(`/api/v1/orgs/${org.id}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: brand.kind,
          name: brand.name.trim(),
          tagline: brand.tagline.trim(),
          email: user.email,
          country: brand.country,
          currency: brand.currency,
          doc: launchDocJson(finalBrand, products),
          products: brand.kind === "store" ? products : [],
          payments: { cod: brand.cod, upiId: upiId.trim(), instructions: "" },
          publish: true,
          logo: logoFile ?? undefined,
          domain: cleanDomain(domain) ?? undefined,
          bookings: goals.includes("bookings"),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        setEvents([{ step: "error", message: j?.error?.message ?? "Couldn't start the launch." }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) setEvents((ev) => [...ev, JSON.parse(line) as Ev]);
        }
      }
    } catch {
      setEvents((ev) => [...ev, { step: "error", message: "The connection dropped. Check Projects — anything already created is saved there." }]);
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="lx-stage">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-bg/60 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/home" className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-[9px] bg-gradient-to-br from-[#3a3a3c] to-black text-white dark:from-white dark:to-[#c7c7cc] dark:text-black">
              <Rocket className="size-3.5" />
            </span>
            Launch
          </Link>
          <ol className="mx-auto hidden items-center gap-1.5 sm:flex" aria-label="Progress">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className={clsx("h-1.5 rounded-full transition-all duration-500", i < idx ? "w-6 bg-fg" : i === idx ? "w-10 bg-fg" : "w-6 bg-border-strong")} aria-current={i === idx ? "step" : undefined} />
              </li>
            ))}
          </ol>
          <Link href="/home" aria-label="Exit" className="ml-auto grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg sm:ml-0">
            <X className="size-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 pb-32 sm:px-6 sm:pt-14">
        {fromOnboarding && prefilled && step === "brand" && (
          <p className="lx-rise mx-auto mb-6 flex w-fit items-center gap-2 rounded-full border border-border bg-surface/80 px-4 py-1.5 text-[12px] text-muted backdrop-blur-xl">
            <Sparkles className="size-3.5" /> Filled in from your answers — change anything
          </p>
        )}
        <div key={step} className="lx-step">
          {step === "kind" && <KindStep kind={brand.kind} onPick={(kind) => { set({ kind, category: kind === "store" ? "fashion" : "restaurant", personality: "" }); setStep("brand"); }} />}
          {step === "brand" && <BrandStep brand={brand} set={set} logo={logoFile} setLogo={setLogoFile} />}
          {step === "products" && (
            <Shell eyebrow="Step 3 · Products" title="Bring your products" sub="Drop the spreadsheet you already have. We'll sort out the columns and show you exactly what's missing.">
              {analysis ? <ProductReview analysis={analysis} setAnalysis={(a) => { setAnalysis(a); if (!a) setProducts([]); }} products={products} setProducts={setProducts} currency={brand.currency} /> : (
                <ProductDrop
                  onRead={async (a) => {
                    const { buildProducts } = await import("@/lib/store/import");
                    const { minorDigits } = await import("@/lib/store/money");
                    setAnalysis(a);
                    setProducts(withPhotoCheck(buildProducts(a.headers, a.rows, a.mapping, { digits: minorDigits(brand.currency) }), a.broken));
                  }}
                />
              )}
            </Shell>
          )}
          {step === "look" && (
            <LookStep brand={finalBrand} set={set} looks={looks} products={products} device={device} setDevice={setDevice} />
          )}
          {step === "payments" && <PaymentsStep brand={brand} set={set} upiId={upiId} setUpiId={setUpiId} />}
          {step === "domain" && <DomainStep brand={brand} orgSlug={org.slug} domain={domain} setDomain={setDomain} />}
          {step === "launch" && (
            <LaunchStep
              upiId={upiId}
              brand={finalBrand}
              products={products}
              domain={cleanDomain(domain)}
              goals={goals}
              events={events}
              launching={launching}
              onLaunch={launch}
              complete={complete}
              failed={failed}
              onOpen={(path) => router.push(path)}
            />
          )}
        </div>
      </main>

      {/* Bottom bar */}
      {step !== "kind" && !(step === "launch" && (launching || complete)) && (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-bg/70 backdrop-blur-2xl">
          <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-3 px-4 sm:px-6">
            <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => go(-1)}>
              Back
            </Button>
            <p className="hidden text-[12px] text-muted sm:block">
              {step === "products" && products.length > 0 && `${products.filter(isReady).length} ready · ${products.filter((p) => !isReady(p)).length} drafts`}
              {step === "products" && !products.length && "You can skip this and add products later."}
            </p>
            {step !== "launch" && (
              <Button variant="primary" size="lg" className="ml-auto min-w-36" disabled={!canNext} onClick={() => go(1)} icon={<ArrowRight className="size-4" />}>
                {step === "products" && !products.length ? "Skip for now" : "Continue"}
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function Shell({ eyebrow, title, sub, children, wide }: { eyebrow: string; title: string; sub?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={clsx("mx-auto grid gap-8", wide ? "max-w-6xl" : "max-w-3xl")}>
      <div className="grid gap-2 text-center">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">{eyebrow}</p>
        <h1 className="text-[clamp(1.9rem,4.5vw,3rem)] leading-[1.05] font-semibold tracking-[-0.035em]">{title}</h1>
        {sub && <p className="mx-auto max-w-xl text-[15px] text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function KindStep({ kind, onPick }: { kind: LaunchKind; onPick: (k: LaunchKind) => void }) {
  const cards: { k: LaunchKind; icon: React.ReactNode; title: string; sub: string; bullets: string[] }[] = [
    { k: "store", icon: <ShoppingBag className="size-6" />, title: "An online store", sub: "Sell products with checkout, delivery and payments.", bullets: ["Import products from Excel or CSV", "Cash on delivery, UPI and cards", "Orders, invoices and tracking"] },
    { k: "website", icon: <Globe className="size-6" />, title: "A website", sub: "Show what you do and get enquiries and bookings.", bullets: ["Pages written for your business", "Contact and booking forms", "Your colours, your look"] },
  ];
  return (
    <Shell eyebrow="Let's launch" title="What are we creating today?" sub="Answer a few questions and you'll be live in about five minutes. You can change everything later.">
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c, i) => (
          <button
            key={c.k}
            type="button"
            onClick={() => onPick(c.k)}
            className={clsx("lx-card lx-rise group relative grid gap-5 overflow-hidden rounded-[28px] border bg-surface/80 p-7 text-left backdrop-blur-xl", kind === c.k ? "border-fg/20" : "border-border")}
            style={{ animationDelay: `${120 + i * 90}ms` }}
          >
            <span className="grid size-14 place-items-center rounded-[18px] bg-gradient-to-br from-[#3a3a3c] to-black text-white shadow-[0_18px_40px_-18px_rgb(0_0_0/.55)] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105 dark:from-white dark:to-[#c7c7cc] dark:text-black">{c.icon}</span>
            <div>
              <p className="text-[22px] font-semibold tracking-tight">{c.title}</p>
              <p className="mt-1 text-[14px] text-muted">{c.sub}</p>
            </div>
            <ul className="grid gap-1.5 text-[13px]">
              {c.bullets.map((b) => (
                <li key={b} className="flex items-center gap-2">
                  <Check className="size-3.5 text-success" /> {b}
                </li>
              ))}
            </ul>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
              Start <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

function BrandStep({ brand, set, logo, setLogo }: { brand: Brand; set: (p: Partial<Brand>) => void; logo: { name: string; data: string } | null; setLogo: (l: { name: string; data: string } | null) => void }) {
  const [reading, setReading] = useState(false);
  const store = brand.kind === "store";
  const onLogo = async (f: File) => {
    if (f.size > 3 * 1024 * 1024) return;
    setReading(true);
    try {
      const url = await new Promise<string>((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = bad;
        r.readAsDataURL(f);
      });
      setLogo({ name: f.name, data: url.split(",")[1] ?? "" });
      const colors = await colorsFromImageUrl(url).catch(() => []);
      set({ logo: url, colors: colors.slice(0, 5).map((c) => c.hex) });
    } finally {
      setReading(false);
    }
  };
  return (
    <Shell eyebrow="Step 2 · Your brand" title={store ? "Tell us about your store" : "Tell us about your business"} sub="This shapes your design, your words and your colours.">
      <div className="grid gap-6">
        <div className="lx-rise grid gap-4 rounded-[28px] border border-border bg-surface/80 p-6 backdrop-blur-xl sm:p-8">
          <label className="grid gap-2">
            <span className="text-[13px] font-medium text-muted">{store ? "Store name" : "Business name"}</span>
            <input autoFocus value={brand.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder={store ? "Saanjh Studio" : "Tide Yoga"} className="border-0 border-b-2 border-border bg-transparent pb-2 text-[clamp(1.6rem,4vw,2.4rem)] font-semibold tracking-tight outline-none transition-colors placeholder:text-subtle focus:border-fg" />
          </label>
          <label className="grid gap-2">
            <span className="text-[13px] font-medium text-muted">In one line, what makes you special?</span>
            <Input value={brand.tagline} maxLength={200} onChange={(e) => set({ tagline: e.target.value })} placeholder={store ? "Handwoven everyday wear from Jaipur artisans." : "Sunrise yoga classes and weekend retreats by the sea."} className="!h-11 text-[15px]" />
          </label>
        </div>

        <div className="lx-rise grid gap-3" style={{ animationDelay: "80ms" }}>
          <p className="text-[13px] font-medium text-muted">{store ? "What do you sell?" : "What kind of business?"}</p>
          {store ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {STORE_TEMPLATES_SHOWN.map((t) => (
                <button key={t.id} type="button" onClick={() => set({ category: t.id, personality: "" })} aria-pressed={brand.category === t.id} className={clsx("lx-card group relative h-28 overflow-hidden rounded-[18px] border text-left", brand.category === t.id ? "border-fg ring-2 ring-fg/80" : "border-border")}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- category photo */}
                  <img src={photoUrl(t.image, 500, [16, 9])} alt="" className="absolute inset-0 size-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                  <span className="absolute bottom-2.5 left-3 text-[13px] font-semibold text-white">{t.name}</span>
                  {brand.category === t.id && <span className="lx-pop absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-white text-black"><Check className="size-3.5" /></span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {WEBSITE_CATEGORIES.map((c) => (
                <button key={c.id} type="button" onClick={() => set({ category: c.id, personality: "" })} aria-pressed={brand.category === c.id} className={clsx("h-10 rounded-full border px-4 text-[13px] font-medium transition-all", brand.category === c.id ? "border-transparent bg-fg text-bg" : "border-border bg-surface/80 hover:border-fg/40")}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lx-rise grid gap-4 sm:grid-cols-2" style={{ animationDelay: "140ms" }}>
          <label className="lx-card grid cursor-pointer gap-3 rounded-[22px] border border-dashed border-border-strong bg-surface/60 p-5 backdrop-blur-xl">
            <span className="flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-surface-2">
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local logo preview
                  <img src={brand.logo} alt="" className="size-full object-contain" />
                ) : reading ? (
                  <Loader2 className="lx-spin size-5 text-muted" />
                ) : (
                  <ImagePlus className="size-5 text-muted" />
                )}
              </span>
              <span>
                <span className="block text-[14px] font-semibold">{logo ? "Logo added" : "Add your logo"}</span>
                <span className="block text-[12px] text-muted">{logo ? "We picked your colours from it" : "Optional — we'll match your colours to it"}</span>
              </span>
            </span>
            {brand.colors.length > 0 && (
              <span className="flex gap-1.5">
                {brand.colors.map((c) => <span key={c} className="lx-pop size-6 rounded-full ring-1 ring-black/10" style={{ background: c }} />)}
              </span>
            )}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void onLogo(e.target.files[0])} />
          </label>
          <div className="grid gap-3 rounded-[22px] border border-border bg-surface/60 p-5 backdrop-blur-xl">
            <label className="grid gap-1 text-[12px] text-muted">
              Country
              <select value={brand.country} onChange={(e) => set({ country: e.target.value, cod: e.target.value === "IN" ? true : brand.cod })} className="h-10 rounded-[12px] border border-border bg-bg px-3 text-[14px] text-fg">
                {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </label>
            {store && (
              <label className="grid gap-1 text-[12px] text-muted">
                Currency
                <select value={brand.currency} onChange={(e) => set({ currency: e.target.value })} className="h-10 rounded-[12px] border border-border bg-bg px-3 text-[14px] text-fg">
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.label}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function LookStep({ brand, set, looks, products, device, setDevice }: { brand: Brand; set: (p: Partial<Brand>) => void; looks: string[]; products: DraftProduct[]; device: "desktop" | "mobile"; setDevice: (d: "desktop" | "mobile") => void }) {
  const catalog = useMemo(() => previewCatalog(products, brand.currency), [products, brand.currency]);
  // Thumbnails depend on everything except the chosen look.
  const thumbKey = JSON.stringify({ ...brand, personality: "" });
  const thumbs = useMemo(() => Object.fromEntries(looks.map((l) => [l, renderLook(JSON.parse(thumbKey) as Brand, l, products, catalog)])), [looks, thumbKey, products, catalog]);
  const main = useMemo(() => renderLook(brand, brand.personality, products, catalog), [brand, products, catalog]);
  const accents = [...new Set([...brand.colors.slice(0, 3), ...ACCENTS])].slice(0, 9);
  return (
    <Shell eyebrow={`Step ${brand.kind === "store" ? 4 : 3} · Look`} title="Pick the look you love" sub="Every option is your real site — your name, your words, your products. Fine-tune anything later in the builder." wide>
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="grid min-w-0 content-start gap-5">
          <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:overflow-visible lg:px-0">
            {looks.map((l, i) => (
              <button key={l} type="button" onClick={() => set({ personality: l })} aria-pressed={brand.personality === l} className={clsx("lx-card lx-rise w-[200px] shrink-0 snap-start overflow-hidden rounded-[18px] border bg-surface text-left lg:w-auto", brand.personality === l ? "border-fg ring-2 ring-fg/80" : "border-border")} style={{ animationDelay: `${i * 60}ms` }}>
                <SitePreview html={thumbs[l]} title={`${LOOK_LABEL(l)} look`} height={92} className="border-b border-border" />
                <span className="flex items-center justify-between px-3 py-2 text-[13px] font-medium">
                  {LOOK_LABEL(l)}
                  {i === 0 && <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] font-semibold text-bg">Best match</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-2 rounded-[18px] border border-border bg-surface/80 p-4 backdrop-blur-xl">
            <p className="flex items-center gap-1.5 text-[13px] font-medium"><Palette className="size-3.5" /> Accent colour</p>
            <div className="flex flex-wrap gap-2">
              {accents.map((c) => (
                <button key={c} type="button" aria-label={`Accent ${c}`} onClick={() => set({ accent: brand.accent === c ? undefined : c })} className={clsx("size-8 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110", brand.accent === c && "ring-[3px] ring-fg ring-offset-2 ring-offset-bg")} style={{ background: c }} />
              ))}
              <label className="relative grid size-8 cursor-pointer place-items-center rounded-full border border-dashed border-border-strong text-[10px] text-muted" title="Custom colour">
                +
                <input type="color" className="absolute inset-0 opacity-0" value={brand.accent ?? "#111111"} onChange={(e) => set({ accent: e.target.value })} />
              </label>
            </div>
          </div>
        </div>
        <div className="lx-rise grid content-start gap-3" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-muted">Live preview · {LOOK_LABEL(brand.personality)}</p>
            <div className="inline-flex rounded-full bg-surface-2 p-1">
              {([["desktop", Monitor], ["mobile", Smartphone]] as const).map(([d, Icon]) => (
                <button key={d} type="button" aria-label={d} onClick={() => setDevice(d)} className={clsx("grid h-7 w-9 place-items-center rounded-full transition-all", device === d ? "bg-bg shadow-sm" : "text-muted")}>
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>
          </div>
          <div className={clsx("mx-auto w-full overflow-hidden border border-border bg-surface shadow-[0_40px_80px_-40px_rgb(0_0_0/.45)] transition-all duration-500", device === "mobile" ? "max-w-[360px] rounded-[36px] border-[6px] border-fg/90" : "rounded-[18px]")}>
            <SitePreview key={device} html={main} title="Your site" height={device === "mobile" ? 640 : 560} width={device === "mobile" ? 390 : 1280} />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function PaymentsStep({ brand, set, upiId, setUpiId }: { brand: Brand; set: (p: Partial<Brand>) => void; upiId: string; setUpiId: (v: string) => void }) {
  return (
    <Shell eyebrow="Step 5 · Getting paid" title="How will customers pay?" sub="Start with these today. Add cards and wallets through Razorpay, Stripe or PayPal whenever you're ready.">
      <div className="grid gap-3">
        <button type="button" onClick={() => set({ cod: !brand.cod })} aria-pressed={brand.cod} className={clsx("lx-card lx-rise flex items-center gap-4 rounded-[22px] border bg-surface/80 p-5 text-left backdrop-blur-xl", brand.cod ? "border-fg ring-2 ring-fg/80" : "border-border")}>
          <span className="grid size-12 place-items-center rounded-[14px] bg-surface-2"><Banknote className="size-5" /></span>
          <span className="flex-1">
            <span className="block text-[15px] font-semibold">Cash on delivery</span>
            <span className="block text-[13px] text-muted">Customers pay when the parcel arrives. Marked paid when you mark it delivered.</span>
          </span>
          <span className={clsx("grid size-6 place-items-center rounded-full border-2", brand.cod ? "border-fg bg-fg text-bg" : "border-border-strong")}>{brand.cod && <Check className="size-3.5" />}</span>
        </button>
        <div className="lx-rise flex flex-wrap items-center gap-4 rounded-[22px] border border-border bg-surface/80 p-5 backdrop-blur-xl" style={{ animationDelay: "70ms" }}>
          <span className="grid size-12 place-items-center rounded-[14px] bg-surface-2"><Wallet className="size-5" /></span>
          <span className="min-w-48 flex-1">
            <span className="block text-[15px] font-semibold">UPI / bank transfer</span>
            <span className="block text-[13px] text-muted">Shown at checkout; you confirm the payment before shipping.</span>
          </span>
          <Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@upi (optional)" className="!h-10 w-full sm:w-60" aria-label="UPI ID" />
        </div>
        <div className="lx-rise flex items-center gap-4 rounded-[22px] border border-dashed border-border-strong p-5 text-[13px] text-muted" style={{ animationDelay: "140ms" }}>
          <span className="grid size-12 place-items-center rounded-[14px] bg-surface-2"><Store className="size-5" /></span>
          Cards, UPI apps and wallets: connect Razorpay, Stripe or PayPal after launch in Online store → Payments, then run the live payment test.
        </div>
      </div>
    </Shell>
  );
}

function renderLook(brand: Brand, personality: string, products: DraftProduct[], catalog: ReturnType<typeof previewCatalog>) {
  const doc = composeLaunchSite({ ...brand, personality }, products);
  return renderPage(doc, doc.pages[0], { kind: "preview" }, { catalog });
}

const STEP_LABEL: Record<string, string> = { project: "Creating your project", design: "Applying your design", store: "Setting up checkout, delivery and taxes", products: "Adding your products", payments: "Turning on payments", publish: "Publishing your site", domain: "Connecting your domain", bookings: "Setting up bookings" };

function LaunchStep({ brand, products, domain, upiId = "", goals, events, launching, onLaunch, complete, failed, onOpen }: { brand: Brand; products: DraftProduct[]; domain: string | null; upiId?: string; goals: string[]; events: Ev[]; launching: boolean; onLaunch: () => void; complete?: Ev; failed?: Ev; onOpen: (path: string) => void }) {
  const { org } = useSession();
  const [copied, setCopied] = useState(false);
  const order = [...(brand.kind === "store" ? ["project", "design", "store", "products", "payments"] : ["project", "design"]), ...(goals.includes("bookings") ? ["bookings"] : []), "publish", ...(domain ? ["domain"] : [])];
  const latest = (s: string) => [...events].reverse().find((e) => e.step === s);
  const ready = products.filter(isReady).length;
  const progress = Math.round((order.filter((s) => ["done", "skipped"].includes(latest(s)?.status ?? "")).length / order.length) * 100);

  if (!launching && !complete && !failed && !events.length) {
    return (
      <Shell eyebrow="Final step" title={`Ready to launch ${brand.name || "your site"}?`} sub="One click creates everything and puts it online. You can keep editing afterwards — nothing is locked in.">
        <div className="lx-rise mx-auto grid w-full max-w-lg gap-3 rounded-[28px] border border-border bg-surface/80 p-6 backdrop-blur-xl">
          {[
            [<LayoutTemplate key="l" className="size-4" />, `${LOOK_LABEL(brand.personality)} design${brand.colors.length ? " in your brand colours" : ""}`],
            ...(brand.kind === "store"
              ? [
                  [<Package key="p" className="size-4" />, products.length ? `${ready} product${ready === 1 ? "" : "s"} going live${products.length - ready ? `, ${products.length - ready} saved as drafts` : ""}` : "No products yet — add them any time"],
                  [<Banknote key="b" className="size-4" />, [brand.cod && "Cash on delivery", upiId.trim() && `UPI to ${upiId.trim()}`, "delivery rates", `prices in ${brand.currency}`].filter(Boolean).join(" · ")],
                ]
              : []),
            [<Globe key="g" className="size-4" />, domain ? `Published, and ${domain} added — you'll set two DNS records next` : "Published on your free address — connect your own domain any time"],
          ].map(([icon, text], i) => (
            <p key={i} className="flex items-center gap-3 text-[14px]">
              <span className="grid size-8 place-items-center rounded-full bg-surface-2">{icon}</span>
              {text}
            </p>
          ))}
          <Button variant="primary" size="lg" className="lx-sheen mt-3 h-14 text-[16px]" icon={<Rocket className="size-5" />} onClick={onLaunch}>
            Launch {brand.kind === "store" ? "my store" : "my website"}
          </Button>
        </div>
      </Shell>
    );
  }

  if (complete) {
    const live = complete.liveUrl;
    const domainEv = latest("domain");
    return (
      <div className="mx-auto grid max-w-2xl justify-items-center gap-7 pt-6 text-center">
        <Confetti />
        <span className="lx-pop grid size-20 place-items-center rounded-full bg-fg text-bg shadow-[0_24px_60px_-20px_rgb(0_0_0/.6)]">
          <svg className="lx-check" viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <div className="lx-rise grid gap-2" style={{ animationDelay: "150ms" }}>
          <h1 className="text-[clamp(2rem,5vw,3.2rem)] leading-[1.05] font-semibold tracking-[-0.035em]">{live ? `${brand.name} is live` : `${brand.name} is ready`}</h1>
          <p className="text-[15px] text-muted">{live ? "Share your link — anyone can visit it now." : "Your project is created. Publishing needs one fix first."}</p>
        </div>
        {live && (
          <div className="lx-rise flex w-full max-w-lg items-center gap-2 rounded-full border border-border bg-surface/80 p-1.5 pl-5 backdrop-blur-xl" style={{ animationDelay: "250ms" }}>
            <span className="min-w-0 flex-1 truncate text-left text-[14px] font-medium">{live.replace(/^https?:\/\//, "")}</span>
            <Button size="sm" variant="ghost" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(live).then(() => setCopied(true))}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <a href={live} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">
              Visit <ExternalLink className="size-3.5" />
            </a>
          </div>
        )}
        {domainEv?.domain && <DomainSetup projectId={complete.projectId!} domain={domainEv.domain} />}
        {domainEv?.status === "skipped" && <p className="lx-rise w-full rounded-[16px] border border-border bg-surface/80 p-3 text-left text-[13px] text-muted">{domainEv.detail}</p>}
        <Button variant="primary" size="lg" className="lx-rise lx-sheen h-12 px-7 text-[15px]" style={{ animationDelay: "300ms" }} icon={<LayoutDashboard className="size-4" />} onClick={() => onOpen(`/projects/${complete.projectId}?tour=1`)}>
          Open my dashboard — quick tour
        </Button>
        <div className="lx-rise grid w-full gap-2.5 sm:grid-cols-3" style={{ animationDelay: "350ms" }}>
          <NextCard icon={<LayoutTemplate className="size-4" />} title="Customise the design" sub="Edit any text, colour or section" onClick={() => onOpen(`/projects/${complete.projectId}/builder`)} />
          {brand.kind === "store" ? (
            <NextCard icon={<Package className="size-4" />} title={complete.drafts ? `Finish ${complete.drafts} draft${complete.drafts === 1 ? "" : "s"}` : "Manage products"} sub={complete.drafts ? "Add the missing details" : "Photos, stock and prices"} onClick={() => onOpen(`/projects/${complete.projectId}/store/products`)} />
          ) : (
            <NextCard icon={<Globe className="size-4" />} title="Connect a domain" sub="Use your own address" onClick={() => onOpen(`/projects/${complete.projectId}/deployments`)} />
          )}
          {brand.kind === "store" && goals.includes("pos") && visibleTo(org, "pos") ? (
            <NextCard icon={<ScanLine className="size-4" />} title="Open the till" sub="Print labels, then scan and bill" onClick={() => onOpen(`/projects/${complete.projectId}/store/labels`)} />
          ) : brand.kind !== "store" && org.modules?.includes("invoicing") ? (
            <NextCard icon={<ReceiptText className="size-4" />} title="Send your first invoice" sub="GST invoices clients pay by UPI" onClick={() => onOpen(`/projects/${complete.projectId}/invoicing`)} />
          ) : (
            <NextCard icon={<Sparkles className="size-4" />} title={brand.kind === "store" ? "Accept cards" : "See your project"} sub={brand.kind === "store" ? "Connect Razorpay, Stripe or PayPal" : "Forms, analytics and more"} onClick={() => onOpen(brand.kind === "store" ? `/projects/${complete.projectId}/store/payments` : `/projects/${complete.projectId}`)} />
          )}
        </div>
        {(complete.problems?.length ?? 0) > 0 && (
          <details className="w-full rounded-[16px] border border-border p-3 text-left text-[12px] text-muted">
            <summary className="cursor-pointer">{complete.problems!.length} thing{complete.problems!.length === 1 ? "" : "s"} to look at</summary>
            <ul className="mt-2 list-disc pl-5">{complete.problems!.map((p) => <li key={p}>{p}</li>)}</ul>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-lg gap-8 pt-6">
      <div className="grid justify-items-center gap-4 text-center">
        <div className="relative grid size-28 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="44" fill="none" stroke="var(--border)" strokeWidth="6" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={276.5} strokeDashoffset={276.5 - (276.5 * progress) / 100} style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)" }} />
          </svg>
          <span className="text-[22px] font-semibold tabular-nums">{progress}%</span>
        </div>
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{failed ? "Launch stopped" : `Launching ${brand.name}…`}</h1>
      </div>
      <ol className="grid gap-2">
        {order.map((s, i) => {
          const e = latest(s);
          const status = e?.status;
          const active = status === "running";
          return (
            <li key={s} className={clsx("lx-rise flex items-center gap-3 rounded-[16px] border px-4 py-3 transition-colors", active ? "border-fg/30 bg-surface" : "border-border bg-surface/60")} style={{ animationDelay: `${i * 60}ms` }}>
              <span className={clsx("grid size-7 shrink-0 place-items-center rounded-full", status === "done" ? "bg-fg text-bg" : status === "skipped" ? "bg-surface-2 text-muted" : "border border-border")}>
                {status === "done" ? <Check className="lx-pop size-3.5" /> : active ? <Loader2 className="lx-spin size-3.5" /> : status === "skipped" ? "–" : <span className="size-1.5 rounded-full bg-border-strong" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={clsx("block text-[14px]", status ? "font-medium" : "text-muted")}>{STEP_LABEL[s]}</span>
                {(e?.detail || (s === "products" && e?.total)) && (
                  <span className="block truncate text-[12px] text-muted">{s === "products" && active && e?.total ? `${e.done ?? 0} of ${e.total}` : e?.detail}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {failed && (
        <div className="grid gap-3 text-center">
          <p className="text-[14px] text-danger">{failed.message}</p>
          <Button onClick={onLaunch} disabled={launching}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

function NextCard({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="lx-card grid gap-1 rounded-[18px] border border-border bg-surface/80 p-4 text-left backdrop-blur-xl">
      <span className="grid size-8 place-items-center rounded-full bg-surface-2">{icon}</span>
      <span className="mt-1 text-[14px] font-semibold">{title}</span>
      <span className="text-[12px] text-muted">{sub}</span>
    </button>
  );
}

/** A short CSS confetti burst (skipped for reduced motion by the global rule). */
function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: 70 }, (_, i) => ({
      x: `${Math.round((Math.random() - 0.5) * 120)}vw`,
      y: `${Math.round(30 + Math.random() * 70)}vh`,
      r: `${Math.round((Math.random() - 0.5) * 900)}deg`,
      c: ["#111", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#a855f7", "#e5e5e5"][i % 7],
      d: Math.random() * 0.25,
    })),
  );
  return (
    <div className="lx-confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i key={i} style={{ background: p.c, animationDelay: `${p.d}s`, ["--x" as string]: p.x, ["--y" as string]: p.y, ["--r" as string]: p.r }} />
      ))}
    </div>
  );
}

function DomainStep({ brand, orgSlug, domain, setDomain }: { brand: Brand; orgSlug: string; domain: string; setDomain: (v: string) => void }) {
  const [mode, setMode] = useState<"free" | "own">(domain ? "own" : "free");
  const clean = cleanDomain(domain);
  const bad = mode === "own" && !!domain.trim() && !clean;
  const apex = clean && clean.split(".").length === 2;
  const slug = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "your-site";
  const free = `${typeof window !== "undefined" ? window.location.host : "creation.cloud"}/s/${orgSlug}/${slug}`;
  return (
    <Shell eyebrow="Your address" title="Where will people find you?" sub="Go live on a free address now. If you own a domain, we'll connect it — you'll just add a couple of DNS records at your registrar.">
      <div className="grid gap-3">
        <button type="button" onClick={() => { setMode("free"); setDomain(""); }} aria-pressed={mode === "free"} className={clsx("lx-card lx-rise flex items-center gap-4 rounded-[22px] border bg-surface/80 p-5 text-left backdrop-blur-xl", mode === "free" ? "border-fg ring-2 ring-fg/80" : "border-border")}>
          <span className="grid size-12 place-items-center rounded-[14px] bg-surface-2"><Globe className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Free address</span>
            <span className="block truncate font-mono text-[12px] text-muted">{free}</span>
          </span>
          <span className={clsx("grid size-6 place-items-center rounded-full border-2", mode === "free" ? "border-fg bg-fg text-bg" : "border-border-strong")}>{mode === "free" && <Check className="size-3.5" />}</span>
        </button>
        <div className={clsx("lx-rise grid gap-4 rounded-[22px] border bg-surface/80 p-5 backdrop-blur-xl", mode === "own" ? "border-fg ring-2 ring-fg/80" : "border-border")} style={{ animationDelay: "70ms" }}>
          <button type="button" onClick={() => setMode("own")} aria-pressed={mode === "own"} className="flex items-center gap-4 text-left">
            <span className="grid size-12 place-items-center rounded-[14px] bg-surface-2"><Link2 className="size-5" /></span>
            <span className="flex-1">
              <span className="block text-[15px] font-semibold">Connect a domain I own</span>
              <span className="block text-[13px] text-muted">Like {slug.replace(/-/g, "")}.com — bought from GoDaddy, Namecheap, Hostinger, Cloudflare or any registrar</span>
            </span>
            <span className={clsx("grid size-6 place-items-center rounded-full border-2", mode === "own" ? "border-fg bg-fg text-bg" : "border-border-strong")}>{mode === "own" && <Check className="size-3.5" />}</span>
          </button>
          {mode === "own" && (
            <div className="grid gap-2">
              <Input autoFocus value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.yourbrand.com" aria-label="Your domain" aria-invalid={bad} spellCheck={false} autoComplete="off" className="!h-12 font-mono text-[15px]" />
              {bad ? (
                <p className="text-[12px] text-danger">That doesn&apos;t look like a domain — try www.yourbrand.com</p>
              ) : apex ? (
                <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  Most registrars can&apos;t point a bare domain with a CNAME record.
                  <button type="button" className="font-semibold text-fg underline underline-offset-2" onClick={() => setDomain(`www.${clean}`)}>Use www.{clean}</button>
                </p>
              ) : (
                <p className="text-[12px] text-muted">Your site goes live on the free address right away and moves to {clean ?? "your domain"} as soon as the DNS records are in.</p>
              )}
            </div>
          )}
        </div>
        <p className="lx-rise px-1 text-[12px] text-muted" style={{ animationDelay: "140ms" }}>Don&apos;t have a domain yet? Buy one from any registrar and connect it later in Deployments → Custom domains. We don&apos;t sell domains.</p>
      </div>
    </Shell>
  );
}

/** After launch: the exact records to add, with copy buttons and a live check. */
function DomainSetup({ projectId, domain }: { projectId: string; domain: LaunchDomain }) {
  const [copied, setCopied] = useState<string | null>(null);
  const check = useMutation({ mutationFn: () => api<{ domain: { status: string; lastError: string | null } }>(`/api/v1/projects/${projectId}/domains/${domain.id}/check`, { method: "POST", body: {} }) });
  const status = check.data?.domain.status;
  const copy = (v: string) => void navigator.clipboard.writeText(v).then(() => { setCopied(v); setTimeout(() => setCopied(null), 1500); });
  return (
    <div className="lx-rise grid w-full gap-4 rounded-[24px] border border-border bg-surface/80 p-5 text-left backdrop-blur-xl" style={{ animationDelay: "280ms" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <Link2 className="size-4" /> Connect {domain.hostname}
        </p>
        <span className={clsx("rounded-full px-2.5 py-1 text-[11px] font-semibold", status === "verified" ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>{status === "verified" ? "Connected" : "Waiting for DNS"}</span>
      </div>
      <ol className="grid gap-1 text-[13px] text-muted">
        <li>1. Sign in where you bought the domain and open its <b className="text-fg">DNS settings</b>.</li>
        <li>2. Add {domain.records.length === 1 ? "this record" : `these ${domain.records.length} records`} exactly as shown.</li>
        <li>3. Come back and check — changes usually show within minutes, sometimes a few hours.</li>
      </ol>
      <div className="grid gap-2">
        {domain.records.map((r) => (
          <div key={r.type + r.name} className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[14px] border border-border bg-bg/60 p-3">
            <span className="row-span-3 self-start rounded-md bg-surface-2 px-2 py-1 text-center font-mono text-[12px] font-semibold">{r.type}</span>
            {[["Name / Host", r.name], ["Value / Points to", r.value]].map(([label, v]) => (
              <button key={label} type="button" onClick={() => copy(v)} className="group grid min-w-0 gap-0.5 rounded-[10px] px-2 py-1 text-left hover:bg-surface-2" title={`Copy ${label.toLowerCase()}`}>
                <span className="text-[10px] font-medium tracking-wide text-muted uppercase">{label}</span>
                <span className="flex min-w-0 items-start gap-1.5 font-mono text-[12px]">
                  {/* Shown in full: it has to be typed or pasted exactly. */}
                  <span className="min-w-0 break-all">{v}</span>
                  {copied === v ? <Check className="mt-0.5 size-3 shrink-0 text-success" /> : <Copy className="mt-0.5 size-3 shrink-0 opacity-40 transition-opacity group-hover:opacity-80" />}
                </span>
              </button>
            ))}
            <span className="px-2 text-[11px] text-muted">{r.purpose}</span>
          </div>
        ))}
        {!domain.targetConfigured && <p className="text-[12px] text-warning">This server hasn&apos;t been given an address for custom domains yet, so only the ownership record is shown. Your administrator needs to set CUSTOM_DOMAIN_CNAME (and a TLS proxy) before visitors can reach the site on your domain.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={status === "verified" ? <CircleCheck className="size-3.5" /> : <RefreshCw className="size-3.5" />} loading={check.isPending} onClick={() => check.mutate()}>
          {status === "verified" ? "Connected" : "Check now"}
        </Button>
        {check.isError && <span className="text-[12px] text-danger">{errorMessage(check.error)}</span>}
        {check.data && status !== "verified" && <span className="text-[12px] text-muted">{check.data.domain.lastError ?? "Not visible yet."} You can also check later from Deployments.</span>}
      </div>
    </div>
  );
}
