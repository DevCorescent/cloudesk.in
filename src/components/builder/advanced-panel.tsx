"use client";

// Advanced design controls for a section and for single elements inside it.
// Every control writes validated values (see src/lib/site/advanced.ts).
import clsx from "clsx";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronRight, Eye, EyeOff, ImageIcon, RotateCcw, Smartphone, Tablet, X } from "lucide-react";
import { useState } from "react";
import { CARD_STYLES, DIVIDERS, MIN_HEIGHTS, scopeCss, WIDTHS, type Adv, type DeviceElementStyle, type ElementStyle } from "@/lib/site/advanced";
import { FONTS } from "@/lib/site/fonts";
import type { Section, SiteDoc } from "@/lib/site/model";
import { Button, Field, Input, Select, Switch, Textarea } from "../ui/primitives";
import { useBuilder } from "./context";

type Edit = (fn: (s: Section) => void, key?: string) => void;

export function Group({ title, children, defaultOpen = false, badge }: { title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border last:border-0">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-11 w-full items-center gap-1.5 px-4 text-left text-[13px] font-semibold text-fg">
        {open ? <ChevronDown className="size-3.5 text-subtle" /> : <ChevronRight className="size-3.5 text-subtle" />}
        {title}
        {badge && <span className="ml-1 size-1.5 rounded-full bg-accent" aria-label="Customised" />}
      </button>
      {open && <div className="grid gap-4 px-4 pb-5">{children}</div>}
    </section>
  );
}

/** Colour picker with hex input and a clear button. */
export function ColorField({ label, value, onChange, disabled, placeholder }: { label: string; value?: string; onChange: (v: string | undefined) => void; disabled?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-[8px] ring-1 ring-black/10" style={{ background: value ?? `repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0/10px 10px` }}>
          <input type="color" disabled={disabled} className="absolute inset-0 cursor-pointer opacity-0" value={value ?? "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={`${label} colour`} />
        </label>
        <Input
          value={shown}
          disabled={disabled}
          placeholder={placeholder ?? "Theme"}
          className="h-8 font-mono text-[12px]"
          aria-label={`${label} hex`}
          onChange={(e) => {
            const v = e.target.value.trim();
            setDraft(v);
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
        />
        {value && !disabled && (
          <button type="button" className="text-subtle hover:text-fg" aria-label={`Reset ${label}`} onClick={() => onChange(undefined)}>
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Slider with a number box; empty means "theme default". */
export function RangeField({ label, value, onChange, min, max, step = 1, unit = "px", disabled, hint }: { label: string; value?: number; onChange: (v: number | undefined) => void; min: number; max: number; step?: number; unit?: string; disabled?: boolean; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        {value !== undefined && !disabled && (
          <button type="button" className="text-[11px] text-subtle hover:text-fg" onClick={() => onChange(undefined)}>
            Reset
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input type="range" className="h-1 flex-1 accent-[var(--accent)]" min={min} max={max} step={step} value={value ?? min} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} style={{ opacity: value === undefined ? 0.45 : 1 }} />
        <div className="relative w-[74px]">
          <Input type="number" value={value ?? ""} placeholder="Auto" min={min} max={max} step={step} disabled={disabled} className="h-8 pr-7 text-[12px] tabular-nums" aria-label={`${label} value`} onChange={(e) => (e.target.value === "" ? onChange(undefined) : onChange(Math.min(max, Math.max(min, Number(e.target.value)))))} />
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-subtle">{unit}</span>
        </div>
      </div>
      {hint && <p className="text-[11px] text-subtle">{hint}</p>}
    </div>
  );
}

function Chips<T extends string>({ value, options, onChange, disabled, label }: { value?: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled} onClick={() => onChange(o.value)} className={clsx("h-7 rounded-full border px-2.5 text-[12px] capitalize transition-colors", value === o.value ? "border-transparent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const FONT_OPTIONS = Object.entries(FONTS).map(([k, f]) => ({ value: k, label: (f as { label?: string }).label ?? k }));
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;

/** Section-level advanced design. */
export function AdvancedDesign({ section, edit, doc }: { section: Section; edit: Edit; doc: SiteDoc }) {
  const { readOnly, openMedia } = useBuilder();
  const adv = section.style.adv ?? {};
  const set = <K extends keyof Adv>(k: K, patch: Partial<NonNullable<Adv[K]>> | undefined) =>
    edit((s) => {
      const cur = { ...(s.style.adv ?? {}) } as Adv;
      if (patch === undefined) delete cur[k];
      else {
        const next = { ...((cur[k] as object) ?? {}), ...patch } as Record<string, unknown>;
        for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
        if (Object.keys(next).length) (cur as Record<string, unknown>)[k] = next;
        else delete cur[k];
      }
      if (Object.keys(cur).length) s.style.adv = cur;
      else delete s.style.adv;
    }, `adv.${section.id}.${String(k)}`);
  const bg = adv.bg ?? { kind: "none" as const };
  const css = adv.css ?? "";
  const cssCheck = css ? scopeCss(css, ".x") : null;
  const pal = doc.theme.palette;

  return (
    <>
      <Group title="Background & media" badge={!!adv.bg && adv.bg.kind !== "none"} defaultOpen>
        <Chips label="Type" disabled={readOnly} value={bg.kind} onChange={(kind) => set("bg", { kind })} options={[{ value: "none", label: "Theme" }, { value: "color", label: "Colour" }, { value: "gradient", label: "Gradient" }, { value: "image", label: "Image" }, { value: "video", label: "Video" }]} />
        {bg.kind === "color" && <ColorField label="Colour" disabled={readOnly} value={bg.color} onChange={(color) => set("bg", { color })} />}
        {bg.kind === "gradient" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <ColorField label="From" disabled={readOnly} value={bg.color ?? pal.accent} onChange={(color) => set("bg", { color })} />
              <ColorField label="To" disabled={readOnly} value={bg.color2 ?? pal.background} onChange={(color2) => set("bg", { color2 })} />
            </div>
            <label className="flex items-center justify-between text-[13px]">
              Radial
              <Switch label="Radial gradient" disabled={readOnly} checked={!!bg.radial} onChange={(radial) => set("bg", { radial, color: bg.color ?? pal.accent, color2: bg.color2 ?? pal.background })} />
            </label>
            {!bg.radial && <RangeField label="Angle" unit="°" min={0} max={360} disabled={readOnly} value={bg.angle} onChange={(angle) => set("bg", { angle, color: bg.color ?? pal.accent, color2: bg.color2 ?? pal.background })} />}
          </>
        )}
        {(bg.kind === "image" || bg.kind === "video") && (
          <>
            <div className="flex items-center gap-2">
              <button type="button" disabled={readOnly} onClick={() => openMedia((u) => set("bg", { image: u }))} className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-surface-2" aria-label={bg.kind === "video" ? "Choose cover image" : "Choose background image"}>
                {bg.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user media preview
                  <img src={bg.image} alt="" className="size-full object-cover" />
                ) : (
                  <ImageIcon className="size-5 text-subtle" />
                )}
              </button>
              <div className="grid flex-1 gap-1">
                <Button size="sm" disabled={readOnly} onClick={() => openMedia((u) => set("bg", { image: u }))}>{bg.kind === "video" ? "Cover image" : bg.image ? "Replace image" : "Choose image"}</Button>
                {bg.image && <button type="button" className="text-left text-[11px] text-subtle hover:text-fg" onClick={() => set("bg", { image: undefined })}>Remove</button>}
              </div>
            </div>
            {bg.kind === "video" && (
              <Field label="Video file link (.mp4 or .webm, https)" hint="Plays muted on loop behind the content.">
                {(p) => <Input {...p} disabled={readOnly} value={bg.video ?? ""} placeholder="https://…/clip.mp4" onChange={(e) => set("bg", { video: e.target.value || undefined })} />}
              </Field>
            )}
            {bg.kind === "image" && (
              <>
                <Chips label="Focus" disabled={readOnly} value={bg.position ?? "center"} onChange={(position) => set("bg", { position })} options={["center", "top", "bottom", "left", "right"].map((v) => ({ value: v as "center", label: v }))} />
                <label className="flex items-center justify-between text-[13px]">
                  Fixed while scrolling
                  <Switch label="Fixed background" disabled={readOnly} checked={!!bg.fixed} onChange={(fixed) => set("bg", { fixed })} />
                </label>
              </>
            )}
            <ColorField label="Overlay tint" disabled={readOnly} value={bg.overlay} placeholder="None" onChange={(overlay) => set("bg", { overlay, overlayOpacity: bg.overlayOpacity ?? 45 })} />
            {bg.overlay && (
              <>
                <RangeField label="Overlay strength" unit="%" min={0} max={95} disabled={readOnly} value={bg.overlayOpacity} onChange={(overlayOpacity) => set("bg", { overlayOpacity })} />
                <RangeField label="Frosted blur" min={0} max={30} disabled={readOnly} value={bg.blur} onChange={(blur) => set("bg", { blur })} />
              </>
            )}
          </>
        )}
      </Group>

      <Group title="Colours" badge={!!adv.colors}>
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Text" disabled={readOnly} value={adv.colors?.text} onChange={(text) => set("colors", { text })} />
          <ColorField label="Headings" disabled={readOnly} value={adv.colors?.heading} onChange={(heading) => set("colors", { heading })} />
          <ColorField label="Muted text" disabled={readOnly} value={adv.colors?.muted} onChange={(muted) => set("colors", { muted })} />
          <ColorField label="Accent / buttons" disabled={readOnly} value={adv.colors?.accent} onChange={(accent) => set("colors", { accent })} />
          <ColorField label="Button text" disabled={readOnly} value={adv.colors?.accentText} onChange={(accentText) => set("colors", { accentText })} />
          <ColorField label="Cards" disabled={readOnly} value={adv.colors?.surface} onChange={(surface) => set("colors", { surface })} />
        </div>
      </Group>

      <Group title="Typography" badge={!!adv.type}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Heading font">
            {(p) => (
              <Select {...p} disabled={readOnly} value={adv.type?.headingFont ?? ""} onChange={(e) => set("type", { headingFont: (e.target.value || undefined) as never })}>
                <option value="">Site font</option>
                {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Body font">
            {(p) => (
              <Select {...p} disabled={readOnly} value={adv.type?.bodyFont ?? ""} onChange={(e) => set("type", { bodyFont: (e.target.value || undefined) as never })}>
                <option value="">Site font</option>
                {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <RangeField label="Heading size" min={14} max={180} disabled={readOnly} value={adv.type?.headingSize} onChange={(headingSize) => set("type", { headingSize })} hint="Scales down smoothly on smaller screens." />
        <Chips label="Heading weight" disabled={readOnly} value={adv.type?.headingWeight ? String(adv.type.headingWeight) : undefined} onChange={(w) => set("type", { headingWeight: Number(w) as 700 })} options={WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))} />
        <RangeField label="Letter spacing" unit="em" step={0.01} min={-0.1} max={0.4} disabled={readOnly} value={adv.type?.letterSpacing} onChange={(letterSpacing) => set("type", { letterSpacing })} />
        <RangeField label="Line height" unit="×" step={0.05} min={0.8} max={2.4} disabled={readOnly} value={adv.type?.lineHeight} onChange={(lineHeight) => set("type", { lineHeight })} />
        <RangeField label="Body text size" min={12} max={28} disabled={readOnly} value={adv.type?.bodySize} onChange={(bodySize) => set("type", { bodySize })} />
        <label className="flex items-center justify-between text-[13px]">
          Uppercase headings
          <Switch label="Uppercase headings" disabled={readOnly} checked={!!adv.type?.uppercase} onChange={(uppercase) => set("type", { uppercase: uppercase || undefined })} />
        </label>
      </Group>

      <Group title="Size & spacing" badge={!!adv.space}>
        <div className="grid gap-3">
          <RangeField label="Space above" min={0} max={360} disabled={readOnly} value={adv.space?.top} onChange={(top) => set("space", { top })} />
          <RangeField label="Space below" min={0} max={360} disabled={readOnly} value={adv.space?.bottom} onChange={(bottom) => set("space", { bottom })} />
        </div>
        <Chips label="Content width" disabled={readOnly} value={adv.space?.width ?? "normal"} onChange={(width) => set("space", { width: width === "normal" ? undefined : width })} options={WIDTHS.map((w) => ({ value: w, label: w }))} />
        <Chips label="Minimum height" disabled={readOnly} value={adv.space?.minHeight ?? "auto"} onChange={(minHeight) => set("space", { minHeight: minHeight === "auto" ? undefined : minHeight })} options={MIN_HEIGHTS.map((w) => ({ value: w, label: w === "auto" ? "Auto" : w.replace("vh", "% screen") }))} />
        {adv.space?.minHeight && <Chips label="Vertical position" disabled={readOnly} value={adv.space?.valign ?? "center"} onChange={(valign) => set("space", { valign })} options={[{ value: "start", label: "Top" }, { value: "center", label: "Middle" }, { value: "end", label: "Bottom" }]} />}
        <RangeField label="Gap between items" min={0} max={120} disabled={readOnly} value={adv.space?.gap} onChange={(gap) => set("space", { gap })} />
        <p className="flex items-center gap-1.5 pt-1 text-[12px] font-medium text-muted"><Smartphone className="size-3.5" /> On phones</p>
        <div className="grid gap-3">
          <RangeField label="Space above" min={0} max={240} disabled={readOnly} value={adv.space?.mobileTop} onChange={(mobileTop) => set("space", { mobileTop })} />
          <RangeField label="Space below" min={0} max={240} disabled={readOnly} value={adv.space?.mobileBottom} onChange={(mobileBottom) => set("space", { mobileBottom })} />
        </div>
        <RangeField label="Heading size" min={14} max={120} disabled={readOnly} value={adv.space?.mobileHeadingSize} onChange={(mobileHeadingSize) => set("space", { mobileHeadingSize })} />
      </Group>

      <Group title="Cards, corners & borders" badge={!!adv.card || !!adv.border}>
        <Chips label="Card style" disabled={readOnly} value={adv.card?.style ?? "theme"} onChange={(style) => set("card", { style: style === "theme" ? undefined : style })} options={CARD_STYLES.map((c) => ({ value: c, label: c }))} />
        <div className="grid gap-3">
          <RangeField label="Card corners" min={0} max={64} disabled={readOnly} value={adv.card?.radius} onChange={(radius) => set("card", { radius })} />
          <RangeField label="Image corners" min={0} max={64} disabled={readOnly} value={adv.card?.imageRadius} onChange={(imageRadius) => set("card", { imageRadius })} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <label className="flex items-center justify-between">Line above<Switch label="Border top" disabled={readOnly} checked={!!adv.border?.top} onChange={(top) => set("border", { top: top || undefined })} /></label>
          <label className="flex items-center justify-between">Line below<Switch label="Border bottom" disabled={readOnly} checked={!!adv.border?.bottom} onChange={(bottom) => set("border", { bottom: bottom || undefined })} /></label>
        </div>
        {(adv.border?.top || adv.border?.bottom) && <ColorField label="Line colour" disabled={readOnly} value={adv.border?.color} onChange={(color) => set("border", { color })} />}
        <RangeField label="Round the whole section" min={0} max={64} disabled={readOnly} value={adv.border?.radius} onChange={(radius) => set("border", { radius })} hint="Pair with side inset for a floating panel look." />
        <RangeField label="Side inset" min={0} max={64} disabled={readOnly} value={adv.border?.inset} onChange={(inset) => set("border", { inset })} />
      </Group>

      <Group title="Shape dividers" badge={!!adv.divider}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Top edge">
            {(p) => (
              <Select {...p} disabled={readOnly} value={adv.divider?.top ?? "none"} onChange={(e) => set("divider", { top: e.target.value === "none" ? undefined : (e.target.value as "wave") })}>
                {DIVIDERS.map((d) => <option key={d} value={d}>{d === "none" ? "None" : d[0].toUpperCase() + d.slice(1)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Bottom edge">
            {(p) => (
              <Select {...p} disabled={readOnly} value={adv.divider?.bottom ?? "none"} onChange={(e) => set("divider", { bottom: e.target.value === "none" ? undefined : (e.target.value as "wave") })}>
                {DIVIDERS.map((d) => <option key={d} value={d}>{d === "none" ? "None" : d[0].toUpperCase() + d.slice(1)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        {(adv.divider?.top || adv.divider?.bottom) && (
          <>
            <ColorField label="Divider colour" disabled={readOnly} value={adv.divider?.color} placeholder="Page background" onChange={(color) => set("divider", { color })} />
            <RangeField label="Divider height" min={16} max={200} disabled={readOnly} value={adv.divider?.height} onChange={(height) => set("divider", { height })} />
            <label className="flex items-center justify-between text-[13px]">Flip horizontally<Switch label="Flip divider" disabled={readOnly} checked={!!adv.divider?.flip} onChange={(flip) => set("divider", { flip: flip || undefined })} /></label>
          </>
        )}
      </Group>

      <Group title="Anchor & custom CSS" badge={!!adv.anchor || !!adv.css}>
        <Field label="Anchor name" hint={`Link to this section with #${adv.anchor || "name"} — e.g. a menu link to /#${adv.anchor || "services"}.`}>
          {(p) => (
            <Input
              {...p}
              disabled={readOnly}
              value={adv.anchor ?? ""}
              placeholder="services"
              onChange={(e) =>
                edit((s) => {
                  const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^[^a-z]+/, "").slice(0, 41);
                  const cur = { ...(s.style.adv ?? {}) };
                  if (v) cur.anchor = v;
                  else delete cur.anchor;
                  s.style.adv = cur;
                }, `adv.${section.id}.anchor`)
              }
            />
          )}
        </Field>
        <Field label="Custom CSS" hint="Declarations apply to this section; rules like “h2 { … }” are scoped to it. @-rules, scripts and outside URLs are removed.">
          {(p) => (
            <Textarea
              {...p}
              rows={5}
              disabled={readOnly}
              className="font-mono text-[12px]"
              value={css}
              maxLength={6000}
              placeholder={"h2 { font-style: italic }\n.card:hover { transform: rotate(-1deg) }"}
              onChange={(e) =>
                edit((s) => {
                  const cur = { ...(s.style.adv ?? {}) };
                  if (e.target.value) cur.css = e.target.value;
                  else delete cur.css;
                  s.style.adv = cur;
                }, `adv.${section.id}.css`)
              }
            />
          )}
        </Field>
        {cssCheck?.problems.map((m) => <p key={m} className="text-[11px] text-warning">{m}</p>)}
      </Group>

      {Object.keys(adv).length > 0 && !readOnly && (
        <div className="px-4 py-3">
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => edit((s) => void delete s.style.adv)}>
            Reset advanced design
          </Button>
        </div>
      )}
    </>
  );
}

/** Styles for one element (heading, paragraph, button…) inside a section. */
export function ElementPanel({ section, path, edit, onClose }: { section: Section; path: string; edit: Edit; onClose: () => void }) {
  const { readOnly, viewport } = useBuilder();
  if (viewport !== "desktop") return <DeviceElementPanel section={section} path={path} edit={edit} onClose={onClose} device={viewport} />;
  const st: ElementStyle = section.style.elements?.[path] ?? {};
  const set = (patch: Partial<ElementStyle>) =>
    edit((s) => {
      const all = { ...(s.style.elements ?? {}) };
      const next = { ...(all[path] ?? {}), ...patch } as Record<string, unknown>;
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === false) delete next[k];
      if (Object.keys(next).length) all[path] = next as ElementStyle;
      else delete all[path];
      if (Object.keys(all).length) s.style.elements = all;
      else delete s.style.elements;
    }, `el.${section.id}.${path}`);
  const value = getPath(section.props, path);
  const label = path.replace(/\.(\d+)\./, (_m, n) => ` #${Number(n) + 1} `).replace(/([A-Z])/g, " $1").toLowerCase();
  return (
    <div className="grid gap-4 border-b border-border bg-accent-soft/40 px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Element · {label}</p>
        <button type="button" onClick={onClose} className="text-subtle hover:text-fg" aria-label="Back to section">
          <X className="size-3.5" />
        </button>
      </div>
      {typeof value === "string" && (
        <Field label="Text" hint="Or double-click the text on the canvas to type in place.">
          {(p) => <Textarea {...p} rows={value.length > 80 ? 4 : 2} disabled={readOnly} value={value} onChange={(e) => edit((s) => setPath(s.props, path, e.target.value), `${section.id}.${path}`)} />}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <ColorField label="Colour" disabled={readOnly} value={st.color} onChange={(color) => set({ color })} />
        <ColorField label="Background" disabled={readOnly} value={st.bg} placeholder="None" onChange={(bg) => set({ bg })} />
      </div>
      <div className="grid gap-3">
        <RangeField label="Size" min={10} max={200} disabled={readOnly} value={st.size} onChange={(size) => set({ size })} />
        <RangeField label="Size on phones" min={10} max={120} disabled={readOnly} value={st.mobileSize} onChange={(mobileSize) => set({ mobileSize })} />
      </div>
      <Chips label="Weight" disabled={readOnly} value={st.weight ? String(st.weight) : undefined} onChange={(w) => set({ weight: Number(w) as 400 })} options={WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))} />
      <Field label="Font">
        {(p) => (
          <Select {...p} disabled={readOnly} value={st.font ?? ""} onChange={(e) => set({ font: (e.target.value || undefined) as never })}>
            <option value="">Inherit</option>
            {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-1">
        {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
          <Button key={a} size="sm" variant={st.align === a ? "primary" : "ghost"} disabled={readOnly} icon={<Icon className="size-3.5" />} aria-label={`Align ${a}`} onClick={() => set({ align: st.align === a ? undefined : a })} />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <Button size="sm" variant={st.italic ? "primary" : "ghost"} disabled={readOnly} onClick={() => set({ italic: !st.italic })}><i>I</i></Button>
        <Button size="sm" variant={st.underline ? "primary" : "ghost"} disabled={readOnly} onClick={() => set({ underline: !st.underline })}><u>U</u></Button>
        <Button size="sm" variant={st.uppercase ? "primary" : "ghost"} disabled={readOnly} onClick={() => set({ uppercase: !st.uppercase })}>AA</Button>
      </div>
      <RangeField label="Letter spacing" unit="em" step={0.01} min={-0.1} max={0.4} disabled={readOnly} value={st.letterSpacing} onChange={(letterSpacing) => set({ letterSpacing })} />
      <RangeField label="Line height" unit="×" step={0.05} min={0.8} max={2.4} disabled={readOnly} value={st.lineHeight} onChange={(lineHeight) => set({ lineHeight })} />
      <RangeField label="Max width" min={0} max={1600} step={10} disabled={readOnly} value={st.maxWidth} onChange={(maxWidth) => set({ maxWidth })} />
      <div className="grid gap-3">
        <RangeField label="Padding sides" min={0} max={80} disabled={readOnly} value={st.padX} onChange={(padX) => set({ padX })} />
        <RangeField label="Padding top/bottom" min={0} max={60} disabled={readOnly} value={st.padY} onChange={(padY) => set({ padY })} />
      </div>
      <div className="grid gap-3">
        <RangeField label="Corners" min={0} max={64} disabled={readOnly} value={st.radius} onChange={(radius) => set({ radius })} />
        <RangeField label="Opacity" unit="%" min={10} max={100} disabled={readOnly} value={st.opacity} onChange={(opacity) => set({ opacity })} />
      </div>
      <Chips label="Shadow" disabled={readOnly} value={st.shadow ?? "none"} onChange={(shadow) => set({ shadow: shadow === "none" ? undefined : shadow })} options={(["none", "soft", "strong", "glow"] as const).map((v) => ({ value: v, label: v }))} />
      <details className="group rounded-[12px] border border-border bg-surface px-3 py-2" open={!!st.hover}>
        <summary className="cursor-pointer list-none text-[12.5px] font-semibold">On hover {st.hover ? <span className="font-normal text-muted">· on</span> : <span className="font-normal text-muted">· how it reacts to the pointer</span>}</summary>
        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <ColorField label="Hover colour" disabled={readOnly} value={st.hover?.color} onChange={(color) => set({ hover: clean({ ...st.hover, color }) })} />
            <ColorField label="Hover background" disabled={readOnly} value={st.hover?.bg} placeholder="None" onChange={(bg) => set({ hover: clean({ ...st.hover, bg }) })} />
          </div>
          <RangeField label="Grow" unit="%" min={90} max={115} disabled={readOnly} value={st.hover?.scale} onChange={(scale) => set({ hover: clean({ ...st.hover, scale }) })} />
          <Chips label="Shadow" disabled={readOnly} value={st.hover?.shadow ?? "none"} onChange={(shadow) => set({ hover: clean({ ...st.hover, shadow: shadow === "none" ? undefined : shadow }) })} options={(["none", "soft", "strong", "glow"] as const).map((v) => ({ value: v, label: v }))} />
          <Button size="sm" variant={st.hover?.lift ? "primary" : "ghost"} disabled={readOnly} onClick={() => set({ hover: clean({ ...st.hover, lift: !st.hover?.lift || undefined }) })}>
            {st.hover?.lift ? "Lifts on hover" : "Lift on hover"}
          </Button>
        </div>
      </details>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant={st.hidden ? "primary" : "ghost"} disabled={readOnly} icon={st.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} onClick={() => set({ hidden: !st.hidden })}>
          {st.hidden ? "Hidden" : "Hide"}
        </Button>
        <Button size="sm" variant={st.tablet?.hidden ? "primary" : "ghost"} disabled={readOnly} icon={<Tablet className="size-3.5" />} onClick={() => set({ tablet: clean({ ...st.tablet, hidden: !st.tablet?.hidden || undefined }) })}>
          {st.tablet?.hidden ? "Hidden on tablets" : "Hide on tablets"}
        </Button>
        <Button size="sm" variant={st.hideMobile || st.mobile?.hidden ? "primary" : "ghost"} disabled={readOnly} icon={<Smartphone className="size-3.5" />} onClick={() => (st.hideMobile ? set({ hideMobile: false }) : set({ mobile: clean({ ...st.mobile, hidden: !st.mobile?.hidden || undefined }) }))}>
          {st.hideMobile || st.mobile?.hidden ? "Hidden on phones" : "Hide on phones"}
        </Button>
        {Object.keys(st).length > 0 && (
          <Button size="sm" variant="ghost" disabled={readOnly} icon={<RotateCcw className="size-3.5" />} onClick={() => edit((s) => { if (s.style.elements) delete s.style.elements[path]; })}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

/** Drops empty keys; an empty object becomes undefined so it isn't saved. */
function clean<T extends Record<string, unknown>>(o: T | undefined): T | undefined {
  if (!o) return undefined;
  const c = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== "")) as T;
  return Object.keys(c).length ? c : undefined;
}

/** On tablet or phone, an element's styles for that device only; the desktop look stays as it is. */
function DeviceElementPanel({ section, path, edit, onClose, device }: { section: Section; path: string; edit: Edit; onClose: () => void; device: "tablet" | "mobile" }) {
  const { readOnly, setViewport } = useBuilder();
  const base: ElementStyle = section.style.elements?.[path] ?? {};
  const d: DeviceElementStyle = base[device] ?? {};
  const name = device === "mobile" ? "phones" : "tablets";
  const set = (patch: Partial<DeviceElementStyle>) =>
    edit((s) => {
      const all = { ...(s.style.elements ?? {}) };
      const cur = { ...(all[path] ?? {}) } as ElementStyle;
      const next = clean({ ...(cur[device] ?? {}), ...patch } as Record<string, unknown>) as DeviceElementStyle | undefined;
      if (next) cur[device] = next;
      else delete cur[device];
      if (Object.keys(cur).length) all[path] = cur;
      else delete all[path];
      if (Object.keys(all).length) s.style.elements = all;
      else delete s.style.elements;
    }, `el.${section.id}.${path}.${device}`);
  const label = path.replace(/\.(\d+)\./, (_m, n) => ` #${Number(n) + 1} `).replace(/([A-Z])/g, " $1").toLowerCase();
  return (
    <div className="grid gap-4 border-b border-border bg-accent-soft/40 px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Element · {label}</p>
        <button type="button" onClick={onClose} className="text-subtle hover:text-fg" aria-label="Back to section">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="flex items-center gap-2 rounded-[10px] bg-warning-soft px-3 py-2 text-[12px]">
        {device === "mobile" ? <Smartphone className="size-3.5 shrink-0" /> : <Tablet className="size-3.5 shrink-0" />}
        <span className="flex-1">Changes here apply on {name} only. Empty fields use the desktop look.</span>
        <button type="button" className="font-medium underline" onClick={() => setViewport("desktop")}>Desktop</button>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <ColorField label="Colour" disabled={readOnly} value={d.color} placeholder={base.color ?? "Same"} onChange={(color) => set({ color })} />
        <ColorField label="Background" disabled={readOnly} value={d.bg} placeholder={base.bg ?? "Same"} onChange={(bg) => set({ bg })} />
      </div>
      <RangeField label="Size" min={10} max={200} disabled={readOnly} value={d.size ?? (device === "mobile" ? base.mobileSize : undefined)} onChange={(size) => set({ size })} hint={base.size ? `Desktop: ${base.size}px` : undefined} />
      <Chips label="Weight" disabled={readOnly} value={d.weight ? String(d.weight) : undefined} onChange={(w) => set({ weight: Number(w) as 400 })} options={WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))} />
      <div className="flex flex-wrap items-center gap-1">
        {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
          <Button key={a} size="sm" variant={d.align === a ? "primary" : "ghost"} disabled={readOnly} icon={<Icon className="size-3.5" />} aria-label={`Align ${a} on ${name}`} onClick={() => set({ align: d.align === a ? undefined : a })} />
        ))}
      </div>
      <RangeField label="Letter spacing" unit="em" step={0.01} min={-0.1} max={0.4} disabled={readOnly} value={d.letterSpacing} onChange={(letterSpacing) => set({ letterSpacing })} />
      <RangeField label="Line height" unit="×" step={0.05} min={0.8} max={2.4} disabled={readOnly} value={d.lineHeight} onChange={(lineHeight) => set({ lineHeight })} />
      <RangeField label="Max width" min={0} max={1600} step={10} disabled={readOnly} value={d.maxWidth} onChange={(maxWidth) => set({ maxWidth })} />
      <div className="grid gap-3">
        <RangeField label="Padding sides" min={0} max={80} disabled={readOnly} value={d.padX} onChange={(padX) => set({ padX })} />
        <RangeField label="Padding top/bottom" min={0} max={60} disabled={readOnly} value={d.padY} onChange={(padY) => set({ padY })} />
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant={d.hidden ? "primary" : "ghost"} disabled={readOnly} icon={d.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} onClick={() => set({ hidden: !d.hidden || undefined })}>
          {d.hidden ? `Hidden on ${name}` : `Hide on ${name}`}
        </Button>
        {base[device] && (
          <Button size="sm" variant="ghost" disabled={readOnly} icon={<RotateCcw className="size-3.5" />} onClick={() => edit((s) => { const e = s.style.elements?.[path]; if (e) delete e[device]; })}>
            Use the desktop look
          </Button>
        )}
      </div>
    </div>
  );
}

export function getPath(props: Record<string, unknown>, path: string): unknown {
  const [a, i, b] = path.split(".");
  const v = props[a];
  if (i === undefined) return v;
  const item = Array.isArray(v) ? (v[Number(i)] as Record<string, unknown> | undefined) : undefined;
  return item?.[b];
}

export function setPath(props: Record<string, unknown>, path: string, value: string) {
  const [a, i, b] = path.split(".");
  if (i === undefined) {
    props[a] = value;
    return;
  }
  const list = Array.isArray(props[a]) ? (props[a] as Record<string, unknown>[]) : null;
  if (list?.[Number(i)]) list[Number(i)][b] = value;
  delete props._example;
}

