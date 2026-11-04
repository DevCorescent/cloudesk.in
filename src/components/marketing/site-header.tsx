"use client";

// The marketing header: a categorised Products mega-menu, an Industries menu,
// site search (also on ⌘K and “/”), and a compact mobile menu with the same
// groups. Menus open on hover with intent, and on click or keyboard focus.
import clsx from "clsx";
import { ArrowRight, ChevronDown, ChevronRight, CornerDownLeft, Menu, Search, Sparkles, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Wordmark } from "@/components/brand";
import { bestAnswer, businessOf, featureOf, groupFeatures, INDUSTRY_GROUPS, MENU_FEATURE, MENU_SECTIONS, PRODUCT_GROUPS, searchIndex, searchSite, shortName, type SearchEntry } from "./nav";
import { useShortcuts } from "@/components/ui/shortcut";

/** The everyday workspace, one tab each in the header. */
export const WORKDAY_TABS = [
  { slug: "my-work", label: "My work" },
  { slug: "mail", label: "Mail" },
  { slug: "calendar", label: "Calendar" },
  { slug: "chat", label: "Chat" },
  { slug: "notes", label: "Notes" },
  { slug: "copilot", label: "Copilot" },
] as const;

type MenuId = "products" | "industries";
const SUITES = ["horeca", "clinic", "education", "construction"];

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const searchKeys = useShortcuts().keys("mod+k");
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A click closes a menu only if a click opened it (hovering then clicking keeps it open).
  const openedBy = useRef<"hover" | "click">("hover");
  // Whether the bar is still over the page's dark first band (its bottom, less the bar's 64px).
  const [inBand, setInBand] = useState(true);
  useEffect(() => {
    const on = () => {
      setScrolled(window.scrollY > 8);
      const band = document.querySelector<HTMLElement>("main .mk-under-head");
      // The top half of the band's fade into the page still reads as dark.
      const fade = band?.nextElementSibling as HTMLElement | null;
      const extra = fade && /mk-(dark|matte)-fade/.test(fade.className) ? fade.offsetHeight / 2 : 0;
      setInBand(!!band && band.getBoundingClientRect().bottom + extra > 64);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    // On phones the page sits hidden behind the intro until "Explore the website": look again when it appears.
    const shown = new MutationObserver(() => requestAnimationFrame(on));
    shown.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      shown.disconnect();
    };
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setMobile(false);
      }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const open = (id: MenuId) => {
    clearTimeout(timer.current);
    setMenu(id);
  };
  const close = (delay = 160) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMenu(null), delay);
  };
  const pick = () => {
    clearTimeout(timer.current);
    setMenu(null);
    setMobile(false);
  };
  const trigger = (id: MenuId, label: string) => (
    <button
      type="button"
      aria-expanded={menu === id}
      aria-haspopup="true"
      aria-controls={`menu-${id}`}
      onMouseEnter={() => {
        openedBy.current = "hover";
        open(id);
      }}
      onFocus={() => open(id)}
      onClick={() => {
        if (menu === id && openedBy.current === "click") setMenu(null);
        else {
          openedBy.current = "click";
          open(id);
        }
      }}
      className={clsx("inline-flex h-9 items-center gap-1 rounded-full pr-2.5 pl-3 transition-colors duration-200", menu === id ? "bg-fg/[0.05] text-fg" : "text-fg/65 hover:text-fg")}
    >
      {label} <ChevronDown className={clsx("size-3.5 opacity-50 transition-transform duration-300", menu === id && "rotate-180")} />
    </button>
  );
  const solid = scrolled || mobile || !!menu;
  // Pages that open on a dark band: the header sits over it, transparent and light, until you scroll.
  const overDark = DARK_TOP.some((re) => re.test(pathname ?? ""));
  // Light-on-dark while over the band with nothing open; menus and search (drawn inside the
  // header, so they'd inherit its light-on-dark colours) always get the light bar.
  const onDark = overDark && inBand && !mobile && !menu && !search;
  const tab = "inline-flex h-9 items-center rounded-full px-3 whitespace-nowrap transition-colors duration-200";
  return (
    <header className={clsx("sticky top-0 z-40", overDark && "-mb-16", onDark && "mk-head-dark")} onMouseLeave={() => close()}>
      {/* Transparent at the top of the page; frosted glass once it scrolls — dark glass over the dark band, light glass after. */}
      <div aria-hidden className={clsx("absolute inset-0 -z-10 transition-[background-color,box-shadow,backdrop-filter] duration-500", !solid ? "bg-transparent" : onDark ? "bg-[rgb(12_12_14/0.55)] shadow-[0_1px_0_rgb(255_255_255/0.06),0_10px_30px_-20px_rgb(0_0_0/0.6)] backdrop-blur-2xl backdrop-saturate-150" : "bg-[var(--p-canvas)]/72 shadow-[0_1px_0_rgb(0_0_0/0.06),0_10px_30px_-20px_rgb(20_20_40/0.25)] backdrop-blur-2xl backdrop-saturate-150")} />
      <div className={clsx(BAR, "flex h-16 items-center")}>
        <Link href="/" aria-label="Cloudesk home" className="mr-4 flex shrink-0 items-center xl:mr-6" onMouseEnter={() => close(60)}>
          <Wordmark className="text-[23px]" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-0.5 text-[14px] lg:flex">
          {trigger("products", "Products")}
          {trigger("industries", "Industries")}
          {/* Cloudesk AI: its own glowing tab. */}
          <Link href="/intelligence" onMouseEnter={() => close(60)} aria-current={pathname === "/intelligence" ? "page" : undefined} className="mk-ai-tab">
            <Sparkles className="size-3.5" /><span>AI</span>
          </Link>
          <span aria-hidden className="mx-2 hidden h-4 w-px bg-fg/10 min-[1400px]:block" />
          {WORKDAY_TABS.map((t) => {
            const on = pathname === `/features/${t.slug}`;
            return (
              <Link key={t.slug} href={`/features/${t.slug}`} onMouseEnter={() => close(60)} aria-current={on ? "page" : undefined} className={clsx("mk-tab relative hidden h-9 items-center rounded-full px-3 whitespace-nowrap transition-colors duration-200 min-[1400px]:inline-flex", on ? "text-fg" : "text-fg/65 hover:text-fg")} data-on={on || undefined}>
                {t.label}
              </Link>
            );
          })}
          <span aria-hidden className="mx-2 hidden h-4 w-px bg-fg/10 min-[1400px]:block" />
          <Link href="/features" onMouseEnter={() => close(60)} className={clsx(tab, pathname === "/features" ? "text-fg" : "text-fg/65 hover:text-fg")}>All features</Link>
          <Link href="/pricing" onMouseEnter={() => close(60)} className={clsx(tab, pathname === "/pricing" ? "text-fg" : "text-fg/65 hover:text-fg")}>Pricing</Link>
          <Link href="/partners" onMouseEnter={() => close(60)} className={clsx(tab, pathname === "/partners" ? "text-fg" : "text-fg/65 hover:text-fg")}>Partners</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1.5" onMouseEnter={() => close(60)}>
          <button
            type="button"
            onClick={() => setSearch(true)}
            aria-label="Search the site"
            className="hidden h-10 w-[248px] items-center gap-2.5 rounded-full bg-fg/[0.04] px-4 text-[13.5px] text-fg/45 ring-1 ring-fg/[0.06] transition-colors hover:bg-fg/[0.07] hover:text-fg/70 2xl:flex"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search Cloudesk</span>
            {searchKeys && <kbd className="rounded-[6px] bg-bg/80 px-1.5 py-0.5 font-sans text-[11px] font-medium text-fg/50 ring-1 ring-fg/10">{searchKeys}</kbd>}
          </button>
          <button type="button" aria-label="Search the site" onClick={() => setSearch(true)} className="grid size-10 place-items-center rounded-full text-fg/65 transition-colors hover:bg-fg/[0.05] hover:text-fg 2xl:hidden">
            <Search className="size-[18px]" />
          </button>
          {signedIn ? (
            <Link href="/home" className="p-cta ml-1 inline-flex !h-10 items-center gap-1.5 px-5 text-[14px]">Dashboard <ArrowRight className="size-4" /></Link>
          ) : (
            <>
              <Link href="/login" className="hidden h-10 items-center rounded-full px-3.5 text-[14px] text-fg/65 transition-colors hover:text-fg sm:inline-flex">Sign in</Link>
              <Link href="/start" className="p-cta ml-1 inline-flex !h-10 items-center gap-1.5 px-5 text-[14px]">Start free <ArrowRight className="size-4" /></Link>
            </>
          )}
          <button type="button" aria-label={mobile ? "Close menu" : "Open menu"} aria-expanded={mobile} onClick={() => setMobile(!mobile)} className="grid size-10 place-items-center rounded-full lg:hidden">
            {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Desktop mega-menus: a solid panel under the bar, the page dimmed behind it. */}
      <div aria-hidden className={clsx("pointer-events-none fixed inset-x-0 top-16 bottom-0 -z-20 hidden bg-[rgb(10_10_20/0.12)] transition-opacity duration-300 lg:block", menu ? "opacity-100" : "opacity-0")} />
      <div
        className={clsx("absolute inset-x-0 top-full hidden transition-[opacity,transform,visibility] duration-[260ms] ease-[cubic-bezier(.2,.8,.2,1)] lg:block", menu ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible -translate-y-1 opacity-0")}
        onMouseEnter={() => clearTimeout(timer.current)}
      >
        <div className={clsx(BAR, "pt-1.5")}>
          <div className="max-w-[1180px] overflow-hidden rounded-[20px] bg-white shadow-[0_32px_80px_-28px_rgb(20_20_40/0.32),0_10px_28px_-14px_rgb(20_20_40/0.16)] ring-1 ring-fg/[0.07]">
            {menu === "products" && <ProductsMenu onPick={pick} />}
            {menu === "industries" && <IndustriesMenu onPick={pick} />}
          </div>
        </div>
      </div>

      {mobile && <MobileMenu onPick={pick} onSearch={() => {
            setMobile(false);
            setSearch(true);
          }} />}
      {search && <SiteSearch onClose={() => setSearch(false)} />}
    </header>
  );
}

/** Pages whose first band is matte black (the homepage hero, components/marketing/dark-hero.tsx). */
const DARK_TOP = [/^\/$/, /^\/intelligence$/, /^\/features(\/[^/]+)?$/, /^\/for(\/[^/]+)?$/, /^\/pricing$/, /^\/partners$/];

/** The header's frame: the same width and gutters as the page below it. */
const BAR = "mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-14 xl:px-20";
const EYEBROW = "text-[11px] font-semibold tracking-[0.12em] text-fg/40 uppercase";

function ProductsMenu({ onPick }: { onPick: () => void }) {
  const [at, setAt] = useState(PRODUCT_GROUPS[0]!.id);
  const sections = MENU_SECTIONS[at] ?? [];
  const feature = MENU_FEATURE[at];
  return (
    <div id="menu-products" className="mk-menu-in grid min-h-[500px] grid-cols-[224px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_272px]">
      <div role="tablist" aria-label="Product categories" aria-orientation="vertical" className="flex flex-col gap-0.5 border-r border-fg/[0.06] bg-fg/[0.018] p-3">
        {PRODUCT_GROUPS.map((g) => {
          const on = g.id === at;
          return (
            <button key={g.id} type="button" role="tab" aria-selected={on} onMouseEnter={() => setAt(g.id)} onFocus={() => setAt(g.id)} onClick={() => setAt(g.id)} className={clsx("group/tab flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-left transition-[background,box-shadow] duration-200", on ? "bg-white shadow-[0_1px_2px_rgb(0_0_0/0.05)] ring-1 ring-fg/[0.07]" : "hover:bg-fg/[0.035]")}>
              <span className="min-w-0 flex-1">
                <span className={clsx("block text-[14px] font-medium", on ? "text-fg" : "text-fg/75")}>{g.title}</span>
                <span className="block text-[12px] leading-snug text-fg/45">{g.line}</span>
              </span>
              <ChevronRight className={clsx("size-3.5 shrink-0 transition-[opacity,transform] duration-200", on ? "translate-x-0 text-fg/50 opacity-100" : "-translate-x-1 opacity-0")} />
            </button>
          );
        })}
        <Link href="/features" onClick={onPick} className="mt-auto inline-flex items-center gap-1 px-3 pt-3 text-[13px] font-medium text-fg/60 transition-colors hover:text-fg">
          All features <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div key={at} className={clsx("mk-pane-in p-5", sections.length > 1 && "columns-2 gap-x-3")}>
        {sections.map((s) => (
          <div key={s.title} className="mb-4 min-w-0 break-inside-avoid">
            <p className={clsx(EYEBROW, "mb-1.5 px-2.5")}>{s.title}</p>
            <div className={clsx(sections.length === 1 && "grid grid-cols-2 gap-x-3")}>
              {s.slugs.map(featureOf).map((f) => {
                if (!f) return null;
                const Icon = f.icon;
                return (
                  <Link key={f.slug} href={`/features/${f.slug}`} onClick={onPick} className={clsx("group/row flex items-start gap-3 rounded-[12px] px-2.5 py-2 transition-colors hover:bg-fg/[0.04]", `tint-${f.tint}`)}>
                    <span className="tint-chip mt-px grid size-8 shrink-0 place-items-center rounded-[9px] transition-transform duration-300 group-hover/row:scale-105"><Icon className="size-[15px]" /></span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] leading-tight font-medium text-fg/85 group-hover/row:text-fg">{shortName(f.name)}</span>
                      <span className="mt-0.5 line-clamp-1 text-[12px] text-fg/45">{f.short}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {feature && (
        <Link key={`f-${at}`} href={feature.href} onClick={onPick} className="group/f mk-pane-in m-3 ml-0 hidden flex-col xl:flex overflow-hidden rounded-[16px] bg-fg/[0.025] ring-1 ring-fg/[0.06] transition-colors hover:bg-fg/[0.04]">
          <span className="relative block aspect-[16/11] overflow-hidden border-b border-fg/[0.06]">
            <Image src={feature.img} alt="" fill sizes="272px" className="object-cover object-left-top transition-transform duration-700 group-hover/f:scale-[1.03]" />
          </span>
          <span className="flex flex-1 flex-col p-4">
            <span className="text-[14.5px] leading-snug font-medium">{feature.title}</span>
            <span className="mt-1 text-[12.5px] leading-relaxed text-fg/55">{feature.body}</span>
            <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[12.5px] font-medium text-fg/70 group-hover/f:text-fg">Explore <ArrowRight className="size-3.5 transition-transform group-hover/f:translate-x-0.5" /></span>
          </span>
        </Link>
      )}
    </div>
  );
}

function IndustriesMenu({ onPick }: { onPick: () => void }) {
  return (
    <div id="menu-industries" className="mk-menu-in grid grid-cols-[minmax(0,1fr)_272px]">
      <div className="grid grid-cols-3 content-start gap-x-3 p-5">
        {INDUSTRY_GROUPS.map((g) => (
          <div key={g.title} className="min-w-0">
            <p className={clsx(EYEBROW, "mb-1.5 px-2.5")}>{g.title}</p>
            {g.slugs.map((s) => {
              const b = businessOf(s);
              if (!b) return null;
              const Icon = b.icon;
              return (
                <Link key={s} href={`/for/${s}`} onClick={onPick} className={clsx("group/row flex items-start gap-3 rounded-[12px] px-2.5 py-2 transition-colors hover:bg-fg/[0.04]", `tint-${b.tint}`)}>
                  <span className="tint-chip mt-px grid size-8 shrink-0 place-items-center rounded-[9px]"><Icon className="size-[15px]" /></span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] leading-tight font-medium text-fg/85 group-hover/row:text-fg">{b.name}</span>
                    <span className="mt-0.5 line-clamp-1 text-[12px] text-fg/45">{b.line}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="m-3 ml-0 flex flex-col rounded-[16px] bg-fg/[0.025] p-3 ring-1 ring-fg/[0.06]">
        <p className={clsx(EYEBROW, "mb-1.5 px-1.5 pt-1")}>Industry suites</p>
        {SUITES.map((s) => {
          const f = featureOf(s);
          if (!f) return null;
          const Icon = f.icon;
          return (
            <Link key={s} href={`/features/${s}`} onClick={onPick} className={clsx("group/row flex items-center gap-3 rounded-[11px] px-1.5 py-1.5 transition-colors hover:bg-white", `tint-${f.tint}`)}>
              <span className="tint-chip grid size-8 shrink-0 place-items-center rounded-[9px]"><Icon className="size-[15px]" /></span>
              <span className="min-w-0">
                <span className="block text-[13.5px] leading-tight font-medium text-fg/85">{shortName(f.name)}</span>
                <span className="mt-0.5 line-clamp-1 text-[12px] text-fg/45">{f.short}</span>
              </span>
            </Link>
          );
        })}
        <Link href="/for" onClick={onPick} className="mt-auto inline-flex items-center gap-1 px-1.5 pt-3 text-[13px] font-medium text-fg/60 transition-colors hover:text-fg">All industries <ArrowRight className="size-3.5" /></Link>
      </div>
    </div>
  );
}

function MobileMenu({ onPick, onSearch }: { onPick: () => void; onSearch: () => void }) {
  const [openGroup, setOpenGroup] = useState<string | null>("build");
  return (
    <nav aria-label="Mobile" className="mk-menu-in max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-fg/5 bg-[var(--p-canvas)] px-5 pt-3 pb-8 lg:hidden">
      <button type="button" onClick={onSearch} className="mb-3 flex h-11 w-full items-center gap-2.5 rounded-full bg-fg/[0.05] px-4 text-[14px] text-fg/50">
        <Search className="size-4" /> Search features, industries…
      </button>
      <Link href="/intelligence" onClick={onPick} className="mk-ai-tab !mx-0 mb-4 !flex !h-12 justify-center text-[15px]">
        <Sparkles className="size-4" /><span>Cloudesk AI</span>
      </Link>
      <p className="pt-1 text-[11px] font-semibold tracking-[0.14em] text-fg/40 uppercase">Your workday</p>
      <div className="flex flex-wrap gap-1.5 border-b border-fg/[0.06] py-3">
        {WORKDAY_TABS.map((t) => <Link key={t.slug} href={`/features/${t.slug}`} onClick={onPick} className="rounded-full bg-fg/[0.05] px-3.5 py-1.5 text-[13.5px] text-fg/80">{t.label}</Link>)}
      </div>
      {PRODUCT_GROUPS.map((g) => (
        <div key={g.id} className="border-b border-fg/[0.06]">
          <button type="button" aria-expanded={openGroup === g.id} onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)} className="flex w-full items-center justify-between py-3.5 text-[15px] font-medium">
            {g.title} <ChevronDown className={clsx("size-4 opacity-50 transition-transform", openGroup === g.id && "rotate-180")} />
          </button>
          {openGroup === g.id && (
            <div className="grid grid-cols-2 gap-1 pb-3">
              {groupFeatures(g).map((f) => (
                <Link key={f.slug} href={`/features/${f.slug}`} onClick={onPick} className="rounded-[10px] px-2 py-2 text-[13.5px] text-fg/75 hover:bg-fg/[0.05]">{shortName(f.name)}</Link>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="border-b border-fg/[0.06]">
        <button type="button" aria-expanded={openGroup === "industries"} onClick={() => setOpenGroup(openGroup === "industries" ? null : "industries")} className="flex w-full items-center justify-between py-3.5 text-[15px] font-medium">
          Industries <ChevronDown className={clsx("size-4 opacity-50 transition-transform", openGroup === "industries" && "rotate-180")} />
        </button>
        {openGroup === "industries" && (
          <div className="grid grid-cols-2 gap-1 pb-3">
            {INDUSTRY_GROUPS.flatMap((g) => g.slugs).map((s) => {
              const b = businessOf(s);
              return b ? <Link key={s} href={`/for/${s}`} onClick={onPick} className="rounded-[10px] px-2 py-2 text-[13.5px] text-fg/75 hover:bg-fg/[0.05]">{b.name}</Link> : null;
            })}
          </div>
        )}
      </div>
      <Link href="/pricing" onClick={onPick} className="flex w-full items-center justify-between border-b border-fg/[0.06] py-3.5 text-[15px] font-medium">Pricing <ArrowRight className="size-4 opacity-50" /></Link>
      <Link href="/partners" onClick={onPick} className="flex w-full items-center justify-between border-b border-fg/[0.06] py-3.5 text-[15px] font-medium">Become a partner <ArrowRight className="size-4 opacity-50" /></Link>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Link href="/login" onClick={onPick} className="inline-flex h-11 items-center justify-center rounded-full text-[14px] font-medium ring-1 ring-fg/10">Sign in</Link>
        <Link href="/start" onClick={onPick} className="p-cta inline-flex !h-11 items-center justify-center text-[14px]">Start free</Link>
      </div>
    </nav>
  );
}

/** Search across features, industries and key pages, with keyboard navigation. */
function SiteSearch({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const index = useMemo(() => searchIndex(), []);
  const results = useMemo(() => searchSite(q, index), [q, index]);
  const answer = useMemo(() => bestAnswer(q, index), [q, index]);
  const popular = useMemo(() => ["website-builder", "online-store", "point-of-sale", "invoicing", "crm", "hrms"].map((s) => index.find((e) => e.href === `/features/${s}`)!).filter(Boolean), [index]);
  // The quick answer isn't repeated in the list under it.
  const list: SearchEntry[] = q.trim() ? results.filter((e) => e !== answer) : popular;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => void (document.body.style.overflow = prev);
  }, []);
  const go = (e: SearchEntry | undefined) => {
    if (!e) return;
    onClose();
    router.push(e.href);
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Search the site" className="fixed inset-0 z-50 flex items-start justify-center bg-fg/25 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mk-menu-in w-full max-w-[640px] overflow-hidden rounded-[22px] bg-[var(--p-canvas)] shadow-[0_40px_100px_-30px_rgb(0_0_0/0.45)] ring-1 ring-fg/10">
        <div className="flex items-center gap-3 border-b border-fg/[0.07] px-5">
          <Search className="size-5 text-fg/40" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setI(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI(Math.min(i + 1, list.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setI(Math.max(i - 1, 0));
              }
              if (e.key === "Enter") go(list[i]);
              if (e.key === "Escape") onClose();
            }}
            aria-label="Search"
            placeholder="Search anything — features, industries, prices, policies, or ask a question"
            className="h-[60px] min-w-0 flex-1 bg-transparent text-[16px] !outline-none placeholder:text-fg/35 focus:!outline-none focus-visible:!outline-none"
          />
          <button type="button" onClick={onClose} className="rounded-[7px] px-2 py-1 text-[11.5px] font-medium text-fg/50 ring-1 ring-fg/10">Esc</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Results" data-popover="static">
          {answer && (
            <button type="button" onClick={() => go(answer)} className="mb-1 grid w-full gap-1.5 rounded-[16px] bg-[linear-gradient(135deg,var(--p-lavender),color-mix(in_srgb,var(--p-lavender)_25%,white))] p-4 text-left ring-1 ring-fg/[0.05]">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-[var(--p-lavender-ink)] uppercase"><Sparkles className="size-3.5" /> Quick answer · {answer.group}</span>
              <span className="text-[14.5px] font-semibold">{answer.title}</span>
              <span className="text-[13.5px] leading-relaxed text-fg/70">{answer.answer}</span>
              <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-fg/60">Read more <ArrowRight className="size-3.5" /></span>
            </button>
          )}
          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.12em] text-fg/40 uppercase">{q.trim() ? `${list.length} result${list.length === 1 ? "" : "s"}` : "Popular"}</p>
          {list.map((e, n) => (
            <button
              key={`${e.kind}-${e.title}-${e.href}`}
              type="button"
              role="option"
              aria-selected={n === i}
              onMouseEnter={() => setI(n)}
              onClick={() => go(e)}
              className={clsx("flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left", n === i && "bg-fg/[0.05]")}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium">{e.title}</span>
                <span className="line-clamp-1 block text-[12.5px] text-fg/50">{e.line}</span>
              </span>
              <span className="hidden shrink-0 rounded-full bg-fg/[0.05] px-2 py-0.5 text-[11px] text-fg/50 sm:inline">{e.kind === "Answer" ? "Question" : (e.group ?? e.kind)}</span>
              {n === i && <CornerDownLeft className="size-4 shrink-0 text-fg/40" />}
            </button>
          ))}
          {q.trim() && !results.length && !answer && <p className="px-3 py-8 text-center text-[14px] text-fg/50">Nothing matches “{q}”. Try “invoice”, “GST”, “UPI”, “restaurant” or ask “can I export my data?”.</p>}
        </div>
      </div>
    </div>
  );
}
