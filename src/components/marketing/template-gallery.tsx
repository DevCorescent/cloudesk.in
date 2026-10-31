"use client";

// The modern store templates, each shown as its real, full storefront.
// Hover (or focus) a card and the page scrolls by itself, top to bottom.
import clsx from "clsx";
import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const TEMPLATES = [
  { id: "noir", name: "Noir", kind: "Streetwear", line: "After-dark drops, a giant outlined ticker and a full-bleed hero.", fonts: "Syne · Manrope", swatch: ["#0a0a0f", "#c6ff3d"] },
  { id: "kiln", name: "Kiln", kind: "Handmade ceramics", line: "Gallery-quiet editorial type with a dark story band.", fonts: "Instrument Serif · Inter", swatch: ["#f6f2ee", "#7d5a44"] },
  { id: "verde", name: "Verde", kind: "Plant shop", line: "A moody full-bleed hero, bento promises and a leafy lookbook.", fonts: "Bricolage · DM Sans", swatch: ["#f6f8f1", "#4f6b26"] },
  { id: "sonic", name: "Sonic", kind: "Audio & tech", line: "Product-launch glow on a deep night palette.", fonts: "Space Grotesk · Inter", swatch: ["#070b14", "#7c9cff"] },
  { id: "casa", name: "Casa", kind: "Furniture & living", line: "Warm, architectural and calm, with big serif type.", fonts: "Cormorant · Manrope", swatch: ["#faf7f2", "#7e5f33"] },
  { id: "lumen", name: "Lumen", kind: "Skincare & fragrance", line: "Dewy frosted panels over soft light — clinical-clean and calm.", fonts: "Instrument Serif · Inter", swatch: ["#f5f7fb", "#0066d6"], glass: true },
  { id: "saanjh", name: "Saanjh", kind: "Ethnic wear", line: "Festive glass over jewel tones for sarees and lehengas.", fonts: "Playfair · DM Sans", swatch: ["#fff7fa", "#be185d"], glass: true },
  { id: "brewhouse", name: "Brewhouse", kind: "Coffee & tea", line: "Warm espresso glass — cosy, rich and slow.", fonts: "Fraunces · Inter", swatch: ["#15100d", "#d4a373"], glass: true },
  { id: "harvest", name: "Harvest", kind: "Grocery & wellness", line: "Fresh, leafy glass for farm-to-door food.", fonts: "Outfit · Nunito", swatch: ["#f8faf6", "#3e6b3a"], glass: true },
  { id: "tote", name: "Tote & Co.", kind: "Bags & accessories", line: "Rosy glass and serif elegance for leather goods.", fonts: "Cormorant · Manrope", swatch: ["#fbf6f4", "#9f3a4a"], glass: true },
  { id: "tinytales", name: "Tiny Tales", kind: "Kids & toys", line: "Playful pastel glass for toys and little ones.", fonts: "Outfit · Nunito", swatch: ["#fbf9fe", "#6b4fa3"], glass: true },
  { id: "pawpal", name: "Pawpal", kind: "Pet supplies", line: "Bright, breezy glass for food, toys and comfy things.", fonts: "Bricolage · DM Sans", swatch: ["#f4f9fb", "#0b6e99"], glass: true },
  { id: "optica", name: "Optica", kind: "Eyewear & watches", line: "Crisp graphite glass for frames and timepieces.", fonts: "Space Grotesk · Inter", swatch: ["#0e0f12", "#5ac8fa"], glass: true },
  { id: "folio", name: "Folio", kind: "Stationery & art", line: "Creative violet glass for notebooks, pens and prints.", fonts: "Sora · Plus Jakarta", swatch: ["#fcfbff", "#5b34d6"], glass: true },
];

const FILTERS = [
  ["all", "All"],
  ["glass", "Glass collection"],
  ["signature", "Signature"],
] as const;

export function TemplateGallery() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const shown = TEMPLATES.filter((t) => filter === "all" || (filter === "glass" ? "glass" in t : !("glass" in t)));
  return (
    <div>
      <div role="tablist" aria-label="Template collections" className="mx-auto mb-10 flex w-max gap-1 rounded-full bg-fg/[0.04] p-1">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={clsx("rounded-full px-4 py-2 text-[13px] font-medium transition-colors", filter === id ? "bg-[var(--surface-solid)] text-fg shadow-sm ring-1 ring-fg/[0.06]" : "text-fg/55 hover:text-fg")}>
            {label} <span className="ml-1 tabular-nums opacity-50">{TEMPLATES.filter((t) => id === "all" || (id === "glass" ? "glass" in t : !("glass" in t))).length}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((t, i) => (
          <Link key={t.id} href="/start" className={`group tpl-card relative flex flex-col overflow-hidden rounded-[26px] bg-[var(--surface-solid)] ring-1 ring-fg/[0.07] shadow-[0_30px_70px_-45px_rgb(30_20_70/0.5)] transition-transform duration-500 hover:-translate-y-1 ${i === 0 ? "lg:row-span-2" : ""}`}>
            <div className={`tpl-window relative overflow-hidden bg-fg/[0.03] ${i === 0 ? "h-[440px] lg:h-full lg:min-h-[640px]" : "h-[440px]"}`}>
              <Image src={`/marketing/store/templates/${t.id}.jpg`} alt={`The ${t.name} storefront, full page`} width={1200} height={7400} sizes="(min-width: 1024px) 34vw, (min-width: 640px) 50vw, 100vw" className="tpl-page absolute inset-x-0 top-0 h-auto w-full" />
              <span className="absolute top-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white backdrop-blur">{"glass" in t ? "Glass" : "Signature"}</span>
              <span className="absolute top-3 right-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-black/70 backdrop-blur transition-opacity group-hover:opacity-0">Hover to scroll ↓</span>
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-fg/[0.06] p-5">
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold tracking-[0.14em] text-fg/45 uppercase">{t.kind}</p>
                <p className="mt-1 text-[22px] font-medium tracking-[-0.02em]">{t.name}</p>
                <p className="mt-1 text-[13.5px] leading-snug text-fg/55">{t.line}</p>
                <p className="mt-2.5 text-[12px] text-fg/45">{t.fonts}</p>
              </div>
              <span className="flex shrink-0 -space-x-1.5 pt-1">
                {t.swatch.map((c) => (
                  <span key={c} className="size-6 rounded-full ring-2 ring-[var(--surface-solid)]" style={{ background: c }} />
                ))}
              </span>
            </div>
            <span className="sr-only">Start a store with {t.name}</span>
            <ArrowRight aria-hidden className="absolute right-5 bottom-5 size-4 text-fg/30 transition-transform group-hover:translate-x-1 group-hover:text-fg" />
          </Link>
        ))}
      </div>
    </div>
  );
}
