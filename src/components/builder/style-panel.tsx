"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Globe, ImageIcon, Loader2, Lock, Shuffle, Wand2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { applyBrand, applyFeel, clusterColors, paletteFromColors, type BrandKit } from "@/lib/site/brand";
import { applyPersonality, DESIGN_ACTIONS, harmonize, PALETTES, PERSONALITIES, themeFor } from "@/lib/site/design";
import { FONT_PAIRS, FONTS, fontCss, fontStack } from "@/lib/site/fonts";
import type { SiteUi } from "@/lib/site/advanced";
import type { SiteDoc, SiteTheme } from "@/lib/site/model";
import { Segmented, useToast } from "../ui/overlays";
import { Button, Field, Input, Select, Switch } from "../ui/primitives";
import { ColorField, RangeField } from "./advanced-panel";
import { useBuilder } from "./context";
import { colorsFromImageUrl } from "./media";
import { useShortcuts } from "../ui/shortcut";

type Update = (mutate: (d: SiteDoc) => void, key?: string) => void;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4">
      <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Swatches({ colors, size = "size-4" }: { colors: string[]; size?: string }) {
  return (
    <span className="flex overflow-hidden rounded-[4px] ring-1 ring-black/10">
      {colors.map((c, i) => (
        <span key={i} className={size} style={{ background: c }} />
      ))}
    </span>
  );
}

/** Loads the web fonts used by the panel's own previews. */
function FontLinks({ keys }: { keys: string[] }) {
  return (
    <>
      {fontCss(keys).map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
    </>
  );
}

function BrandKitSection({ doc, update, readOnly }: { doc: SiteDoc; update: Update; readOnly: boolean }) {
  const { projectId, openMedia } = useBuilder();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [matchFeel, setMatchFeel] = useState(true);
  const [busy, setBusy] = useState(false);
  const importUrl = useMutation({
    mutationFn: () => api<{ brand: BrandKit }>(`/api/v1/projects/${projectId}/brand-import`, { method: "POST", body: { url } }),
    onSuccess: (r) => setKit(r.brand),
    onError: (e) => toast({ tone: "error", title: "Could not import", description: errorMessage(e) }),
  });
  const fromLogo = () =>
    openMedia(async (logo) => {
      setBusy(true);
      try {
        const colors = clusterColors(await colorsFromImageUrl(logo), 6).map((c) => c.hex);
        setKit({ logo, colors, fontNames: [], source: "logo" });
      } catch {
        toast({ tone: "error", title: "Could not read that image", description: "Upload the logo to your media library and try again." });
      } finally {
        setBusy(false);
      }
    });
  const apply = (dark: boolean) => {
    if (!kit) return;
    update((d) => {
      d.theme = applyBrand(d.theme, kit, { dark });
      if (kit.feel && matchFeel) d.theme = applyFeel(d.theme, kit.feel);
      d.brand = { logo: kit.logo ?? d.brand?.logo, colors: kit.colors, source: kit.source };
      if (kit.logo) for (const p of d.pages) for (const s of p.sections) if (s.type === "navbar") s.props.logo = kit.logo;
      if (kit.name && d.name.startsWith("My ")) d.name = kit.name;
    });
    toast({ tone: "success", title: "Brand applied", description: "Colours were adjusted where needed to keep text readable." });
  };
  const preview = kit?.colors.length ? paletteFromColors(kit.colors.map((hex, i) => ({ hex, weight: kit.colors.length - i }))) : null;
  return (
    <Section title="Brand kit" hint="Start from your existing brand: we read colours, fonts and logo, then build an accessible theme.">
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (url.trim()) importUrl.mutate(); }}>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourbusiness.com" aria-label="Website to import from" disabled={readOnly} />
        <Button type="submit" size="md" disabled={readOnly || !url.trim()} loading={importUrl.isPending} icon={<Globe className="size-3.5" />}>Import</Button>
      </form>
      <Button size="sm" variant="ghost" className="mt-1.5" disabled={readOnly || busy} onClick={fromLogo} icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}>
        Use colours from a logo or photo
      </Button>
      {doc.brand?.source && !kit && <p className="mt-2 text-xs text-subtle">Current brand from {doc.brand.source}.</p>}
      {kit && (
        <div className="mt-3 grid gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- imported brand logo preview */}
            {kit.logo && <img src={kit.logo} alt="" className="size-10 rounded-[var(--radius-sm)] border border-border bg-white object-contain p-1" />}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{kit.name ?? "Detected brand"}</p>
              <p className="truncate text-xs text-muted">from {kit.source}</p>
            </div>
          </div>
          {kit.colors.length > 0 ? (
            <div>
              <p className="mb-1 text-xs text-muted">Colours found</p>
              <Swatches colors={kit.colors} size="h-5 w-5" />
            </div>
          ) : (
            <p className="text-xs text-muted">No distinct colours were found.</p>
          )}
          {preview && (
            <div>
              <p className="mb-1 text-xs text-muted">Theme it creates</p>
              <Swatches colors={[preview.background, preview.surface, preview.text, preview.accent]} size="h-5 w-8" />
            </div>
          )}
          {kit.fontNames.length > 0 && <p className="text-xs text-muted">Fonts: {kit.fontNames.slice(0, 3).join(", ")}{kit.headingFont ? ` → ${FONTS[kit.headingFont].label}` : " (no close match hosted; keeping current fonts)"}</p>}
          {kit.feel && kit.feel.evidence.length > 0 && (
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={matchFeel} onChange={(e) => setMatchFeel(e.target.checked)} disabled={readOnly} />
              <span>
                <span className="font-medium text-fg">Also match the feel</span>
                <span className="block text-muted">{kit.feel.evidence.join(" · ")}. Only the style is copied — never their text or images.</span>
              </span>
            </label>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={readOnly} onClick={() => apply(!!kit.feel?.dark && matchFeel)}>Apply brand</Button>
            <Button size="sm" disabled={readOnly} onClick={() => apply(true)}>Apply as dark</Button>
            <Button size="sm" variant="ghost" onClick={() => setKit(null)}>Dismiss</Button>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Tells the editor up front which parts of the style are locked by brand rules (the server enforces them). */
function BrandLocks() {
  const { projectId } = useBuilder();
  const q = useQuery({ queryKey: ["brand", projectId], queryFn: () => api<{ rules: { lockPalette: boolean; lockFonts: boolean; lockLogo: boolean } | null }>(`/api/v1/projects/${projectId}/brand`), staleTime: 60_000 });
  const r = q.data?.rules;
  const locked = r ? [r.lockPalette && "colours", r.lockFonts && "fonts", r.lockLogo && "logo"].filter(Boolean) : [];
  if (!locked.length) return null;
  return (
    <div className="mx-4 mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-accent-soft px-3 py-2.5 text-xs">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
      <p>
        Your brand {locked.join(" and ")} {locked.length === 1 ? "is" : "are"} locked, so changes to {locked.length === 1 ? "it" : "them"} won&apos;t save.{" "}
        <a href={`/projects/${projectId}/brand`} className="font-medium text-accent hover:underline">
          Brand rules
        </a>
      </p>
    </div>
  );
}

export function StylePanel({ doc, update, readOnly }: { doc: SiteDoc; update: Update; readOnly: boolean }) {
  const undo = useShortcuts().keys("mod+z");
  const t = doc.theme;
  const set = (fn: (theme: SiteTheme) => void, key?: string) => update((d) => fn(d.theme), key);
  const samePalette = (p: (typeof PALETTES)[number]) => {
    const h = harmonize(p);
    return h.background === t.palette.background && h.accent === t.palette.accent;
  };

  return (
    <div>
      <FontLinks keys={[...new Set(FONT_PAIRS.flatMap((p) => [p.heading, p.body]))]} />
      <BrandLocks />
      <BrandKitSection doc={doc} update={update} readOnly={readOnly} />

      <Section title="Design direction" hint={`Restyles theme, layouts, decoration and section rhythm together. Undo with ${undo ?? "the Undo button"}.`}>
        <div className="grid grid-cols-2 gap-2">
          {PERSONALITIES.map((p) => {
            const th = themeFor(p.id);
            const active = t.personality === p.id;
            return (
              <button
                key={p.id}
                disabled={readOnly}
                onClick={() => update((d) => applyPersonality(d, p.id))}
                aria-pressed={active}
                title={p.description}
                className={clsx("overflow-hidden rounded-[var(--radius-md)] border text-left transition-shadow disabled:opacity-50", active ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-border-strong")}
              >
                <div className="flex h-14 flex-col justify-between p-2" style={{ background: th.palette.background, color: th.palette.text }}>
                  <span className="truncate text-[15px] leading-none" style={{ fontFamily: fontStack(th.headingFont), fontWeight: /serif|garamond|cormorant|fraunces|playfair/i.test(fontStack(th.headingFont)) ? 500 : 650 }}>
                    Aa Studio
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-6" style={{ background: th.palette.accent, borderRadius: th.buttonStyle === "pill" ? 99 : th.buttonStyle === "sharp" ? 0 : 3 }} />
                    <span className="h-1 w-8 rounded-full opacity-40" style={{ background: th.palette.text }} />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 border-t border-border bg-surface px-2 py-1.5">
                  <span className="truncate text-xs font-medium">{p.label}</span>
                  {active && <Check className="size-3.5 shrink-0 text-accent" aria-label="Current" />}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Design actions" hint="One-click improvements. Each one is a normal, undoable edit.">
        <div className="grid gap-1">
          {DESIGN_ACTIONS.map((a) => (
            <button
              key={a.id}
              disabled={readOnly}
              onClick={() => update((d) => a.apply(d))}
              className="flex items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50"
            >
              <Wand2 className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="block text-[13px] font-medium">{a.label}</span>
                <span className="block text-xs text-muted">{a.description}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Palette" hint="Every palette is adjusted to meet WCAG AA contrast.">
        <div className="grid grid-cols-2 gap-1.5">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              disabled={readOnly}
              onClick={() => set((th) => void (th.palette = harmonize(p)))}
              aria-pressed={samePalette(p)}
              className={clsx("flex items-center gap-2 rounded-[var(--radius-md)] border p-1.5 text-left text-xs disabled:opacity-50", samePalette(p) ? "border-accent ring-2 ring-accent/25" : "border-border hover:border-border-strong")}
            >
              <Swatches colors={[p.background, p.surface, p.text, p.accent]} size="h-4 w-3" />
              <span className="truncate">{p.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(
            [
              ["background", "Background"],
              ["surface", "Surface"],
              ["text", "Text"],
              ["muted", "Secondary text"],
              ["accent", "Accent"],
              ["accentText", "Text on accent"],
            ] as [keyof SiteTheme["palette"], string][]
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-xs">
              <input type="color" disabled={readOnly} value={t.palette[k]} onChange={(e) => set((th) => void (th.palette[k] = e.target.value), `theme.${k}`)} className="size-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0" />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="grid gap-1.5">
          {FONT_PAIRS.map((f) => {
            const active = t.headingFont === f.heading && t.font === f.body;
            return (
              <button
                key={f.id}
                disabled={readOnly}
                onClick={() => set((th) => Object.assign(th, { headingFont: f.heading, font: f.body }))}
                aria-pressed={active}
                className={clsx("rounded-[var(--radius-md)] border px-2.5 py-2 text-left disabled:opacity-50", active ? "border-accent ring-2 ring-accent/25" : "border-border hover:border-border-strong")}
              >
                <span className="block truncate text-[17px] leading-tight" style={{ fontFamily: fontStack(f.heading) }}>
                  {FONTS[f.heading].label}
                </span>
                <span className="block truncate text-xs text-muted" style={{ fontFamily: fontStack(f.body) }}>
                  {FONTS[f.body].label} · {f.mood}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Details">
        <div className="grid gap-3.5">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Buttons</span>
            <Segmented label="Button style" value={t.buttonStyle} onChange={(v) => !readOnly && set((th) => void (th.buttonStyle = v))} options={[{ value: "solid", label: "Solid" }, { value: "pill", label: "Pill" }, { value: "outline", label: "Outline" }, { value: "sharp", label: "Sharp" }]} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Surfaces</span>
            <Segmented label="Surfaces" value={t.surface ?? "solid"} onChange={(v) => !readOnly && set((th) => void (th.surface = v))} options={[{ value: "solid", label: "Solid" }, { value: "glass", label: "Frosted glass" }]} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Headline size</span>
            <Segmented label="Type scale" value={t.typeScale} onChange={(v) => !readOnly && set((th) => void (th.typeScale = v))} options={[{ value: "compact", label: "Compact" }, { value: "balanced", label: "Balanced" }, { value: "dramatic", label: "Dramatic" }]} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Motion</span>
            <Segmented label="Motion" value={t.motion} onChange={(v) => !readOnly && set((th) => void (th.motion = v))} options={[{ value: "none", label: "None" }, { value: "subtle", label: "Subtle" }, { value: "expressive", label: "Expressive" }]} />
            <p className="text-xs text-subtle">Scroll reveals use CSS only and switch off for visitors who prefer reduced motion. Visible in Preview.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Corners">
              {(p) => (
                <Select {...p} disabled={readOnly} value={t.radius} onChange={(e) => set((th) => void (th.radius = e.target.value as SiteTheme["radius"]))}>
                  <option value="none">Square</option>
                  <option value="sm">Subtle</option>
                  <option value="md">Rounded</option>
                  <option value="lg">Soft</option>
                </Select>
              )}
            </Field>
            <Field label="Spacing">
              {(p) => (
                <Select {...p} disabled={readOnly} value={t.density} onChange={(e) => set((th) => void (th.density = e.target.value as SiteTheme["density"]))}>
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                  <option value="airy">Airy</option>
                </Select>
              )}
            </Field>
          </div>
          <Button size="sm" variant="ghost" className="justify-self-start" disabled={readOnly} icon={<Shuffle className="size-3.5" />} onClick={() => update((d) => applyPersonality(d, d.theme.personality ?? "modern", Math.floor(Math.random() * 1000)))}>
            Surprise me (same direction)
          </Button>
        </div>
      </Section>

      <SiteUiSection doc={doc} update={update} readOnly={readOnly} />
    </div>
  );
}

/** Site-wide fine control: header behaviour, container, type and buttons. */
function SiteUiSection({ doc, update, readOnly }: { doc: SiteDoc; update: Update; readOnly: boolean }) {
  const ui: SiteUi = doc.theme.ui ?? {};
  const setUi = (patch: Partial<SiteUi>) =>
    update((d) => {
      const next = { ...(d.theme.ui ?? {}), ...patch } as Record<string, unknown>;
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === false) delete next[k];
      if (Object.keys(next).length) d.theme.ui = next as SiteUi;
      else delete d.theme.ui;
    }, `ui.${Object.keys(patch)[0]}`);
  return (
    <Section title="Interface" hint="Fine control over the whole site. Every value can be reset to the design default.">
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Header</span>
          <Segmented label="Header behaviour" value={ui.header ?? "static"} onChange={(v) => !readOnly && setUi({ header: v === "static" ? undefined : v })} options={[{ value: "static", label: "Scrolls" }, { value: "sticky", label: "Sticky" }, { value: "glass", label: "Glass" }, { value: "transparent", label: "Over hero" }]} />
        </div>
        <RangeField label="Content width" min={880} max={1600} step={10} disabled={readOnly} value={ui.container} onChange={(container) => setUi({ container })} />
        <RangeField label="Base text size" min={14} max={20} disabled={readOnly} value={ui.baseSize} onChange={(baseSize) => setUi({ baseSize })} />
        <RangeField label="Section spacing" unit="×" step={0.05} min={0.5} max={2} disabled={readOnly} value={ui.sectionSpace} onChange={(sectionSpace) => setUi({ sectionSpace })} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Heading weight</span>
          <Segmented label="Heading weight" value={String(ui.headingWeight ?? "auto")} onChange={(v) => !readOnly && setUi({ headingWeight: v === "auto" ? undefined : (Number(v) as 700) })} options={[{ value: "auto", label: "Auto" }, { value: "400", label: "400" }, { value: "600", label: "600" }, { value: "700", label: "700" }, { value: "800", label: "800" }, { value: "900", label: "900" }]} />
        </div>
        <RangeField label="Heading letter spacing" unit="em" step={0.005} min={-0.08} max={0.2} disabled={readOnly} value={ui.headingSpacing} onChange={(headingSpacing) => setUi({ headingSpacing })} />
        <RangeField label="Button corners" min={0} max={40} disabled={readOnly} value={ui.buttonRadius} onChange={(buttonRadius) => setUi({ buttonRadius })} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Button size</span>
          <Segmented label="Button size" value={ui.buttonSize ?? "md"} onChange={(v) => !readOnly && setUi({ buttonSize: v === "md" ? undefined : v })} options={[{ value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }]} />
        </div>
        <div className="grid gap-2 text-[13px]">
          <label className="flex items-center justify-between">Uppercase buttons<Switch label="Uppercase buttons" disabled={readOnly} checked={!!ui.buttonUppercase} onChange={(v) => setUi({ buttonUppercase: v })} /></label>
          <label className="flex items-center justify-between">Glow under buttons<Switch label="Button shadow" disabled={readOnly} checked={!!ui.buttonShadow} onChange={(v) => setUi({ buttonShadow: v })} /></label>
          <label className="flex items-center justify-between">Underline links in text<Switch label="Underline links" disabled={readOnly} checked={!!ui.linkUnderline} onChange={(v) => setUi({ linkUnderline: v })} /></label>
          <label className="flex items-center justify-between">Accent scrollbar<Switch label="Accent scrollbar" disabled={readOnly} checked={!!ui.scrollbar} onChange={(v) => setUi({ scrollbar: v })} /></label>
        </div>
        <ColorField label="Text selection colour" disabled={readOnly} value={ui.selection} onChange={(selection) => setUi({ selection })} />
      </div>
    </Section>
  );
}
