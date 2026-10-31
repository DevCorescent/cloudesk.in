"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Component, FlaskConical, Unlink, ImageIcon, Layers3, Monitor, Move, Plus, RotateCcw, Smartphone, Sparkles, Tablet, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { detach, instancesOf, makeGlobal, MAX_GLOBALS, syncGlobal } from "@/lib/site/globals";
import { iconSvg } from "@/lib/site/icons";
import { BREAKPOINTS, DECORATIONS, ICON_OPTIONS, sectionDef, variantOf, type Breakpoint, type FieldDef, type Page, type Section, type SiteDoc } from "@/lib/site/model";
import { safeImageUrl } from "@/lib/site/render";
import { Segmented, Tabs } from "../ui/overlays";
import { Badge, Button, Field, IconButton, Input, Notice, Select, Switch, Textarea } from "../ui/primitives";
import { useBuilder } from "./context";
import { AdvancedDesign, ElementPanel } from "./advanced-panel";
import { FreeformEditor } from "./freeform-editor";

type Json = Record<string, unknown>;

const GRID_TYPES = new Set(["features", "testimonials", "pricing", "gallery", "posts", "products"]);

function Group({ title, children, defaultOpen = true, aside }: { title: string; children: React.ReactNode; defaultOpen?: boolean; aside?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border last:border-0">
      <div className="flex items-center">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-11 flex-1 items-center gap-1.5 px-4 text-left text-[13px] font-semibold text-fg">
          {open ? <ChevronDown className="size-3.5 text-subtle" /> : <ChevronRight className="size-3.5 text-subtle" />}
          {title}
        </button>
        {aside && <div className="pr-3">{aside}</div>}
      </div>
      {open && <div className="grid gap-4 px-4 pb-5">{children}</div>}
    </section>
  );
}

// ─── Fields ──────────────────────────────────────────────────────────────────

function ImageField({ label, value, onChange, disabled }: { label: string; value: unknown; onChange: (v: string, alt?: string) => void; disabled: boolean }) {
  const { openMedia } = useBuilder();
  const url = safeImageUrl(value);
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="flex items-center gap-2.5">
        <button type="button" disabled={disabled} onClick={() => openMedia((u, alt) => onChange(u, alt))} className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2 hover:ring-2 hover:ring-accent/30" aria-label={url ? `Replace ${label}` : `Choose ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- user-chosen image thumbnail */}
          {url ? <img src={url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-5 text-subtle" aria-hidden />}
        </button>
        <div className="flex flex-col items-start gap-1">
          <Button size="sm" disabled={disabled} onClick={() => openMedia((u, alt) => onChange(u, alt))}>
            {url ? "Replace" : "Choose image"}
          </Button>
          {url && !disabled && (
            <button className="text-xs text-muted hover:text-danger" onClick={() => onChange("")}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldEditor({ def, value, onChange, onImage, disabled }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; onImage?: (url: string, alt?: string) => void; disabled: boolean }) {
  switch (def.kind) {
    case "image":
      // Image + description change together in one update.
      return <ImageField label={def.label} value={value} disabled={disabled} onChange={(u, alt) => (onImage ? onImage(u, alt) : onChange(u))} />;
    case "text":
    case "url":
      return (
        <Field label={def.label}>
          {(p) => <Input {...p} disabled={disabled} value={String(value ?? "")} maxLength={"max" in def ? def.max : undefined} placeholder={def.kind === "url" ? "/page, #section or https://…" : undefined} className={def.kind === "url" ? "font-mono text-xs" : undefined} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    case "textarea":
      return <Field label={def.label}>{(p) => <Textarea {...p} disabled={disabled} rows={def.max && def.max > 2000 ? 12 : 3} value={String(value ?? "")} maxLength={def.max} onChange={(e) => onChange(e.target.value)} />}</Field>;
    case "number":
      return <Field label={def.label}>{(p) => <Input {...p} disabled={disabled} type="number" min={def.min} max={def.max} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />}</Field>;
    case "boolean":
      return (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">{def.label}</span>
          <Switch label={def.label} disabled={disabled} checked={!!value} onChange={onChange} />
        </div>
      );
    case "select":
      return (
        <Field label={def.label}>
          {(p) => (
            <Select {...p} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
              {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
        </Field>
      );
    case "icon":
      return (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{def.label}</span>
          <div role="radiogroup" aria-label={def.label} className="grid grid-cols-8 gap-1">
            {ICON_OPTIONS.map((name) => (
              <button key={name} type="button" role="radio" aria-checked={value === name} aria-label={name} title={name} disabled={disabled} onClick={() => onChange(name)} className={clsx("flex aspect-square items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-4", value === name && "bg-accent-soft text-accent ring-1 ring-accent/40")} dangerouslySetInnerHTML={{ __html: iconSvg(name, 16) }} />
            ))}
          </div>
        </div>
      );
    case "strings": {
      const items = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{def.label}</span>
          {items.map((it, i) => (
            <div key={i} className="flex gap-1">
              <Input aria-label={`${def.itemLabel} ${i + 1}`} disabled={disabled} value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
              <IconButton label={`Remove ${def.itemLabel} ${i + 1}`} disabled={disabled} size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => onChange(items.filter((_, j) => j !== i))} />
            </div>
          ))}
          {(!def.maxItems || items.length < def.maxItems) && (
            <Button size="sm" variant="ghost" disabled={disabled} className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => onChange([...items, ""])}>
              Add {def.itemLabel.toLowerCase()}
            </Button>
          )}
        </div>
      );
    }
    case "list":
      return <ListEditor def={def} value={value} onChange={onChange} disabled={disabled} />;
  }
}

function emptyItem(fields: FieldDef[]): Json {
  return Object.fromEntries(fields.map((f) => [f.key, f.kind === "list" || f.kind === "strings" ? [] : f.kind === "boolean" ? false : f.kind === "number" ? 0 : ""]));
}

function ListEditor({ def, value, onChange, disabled }: { def: Extract<FieldDef, { kind: "list" }>; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const items = Array.isArray(value) ? (value as Json[]) : [];
  const [open, setOpen] = useState<number | null>(null);
  const label = (it: Json, i: number) => String(it.title ?? it.name ?? it.label ?? it.question ?? it.author ?? it.alt ?? it.value ?? "").trim() || `${def.itemLabel} ${i + 1}`;
  const thumb = (it: Json) => safeImageUrl(it.src ?? it.image ?? it.photo);
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium">{def.label}</span>
      <div className="grid gap-1">
        {items.map((it, i) => (
          <div key={i} className={clsx("rounded-[var(--radius-md)] border", open === i ? "border-border-strong bg-surface" : "border-border")}>
            <div className="flex items-center">
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex h-9 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[13px]">
                {open === i ? <ChevronDown className="size-3.5 shrink-0 text-subtle" /> : <ChevronRight className="size-3.5 shrink-0 text-subtle" />}
                {/* eslint-disable-next-line @next/next/no-img-element -- list item thumbnail */}
                {thumb(it) && <img src={thumb(it)} alt="" className="size-6 shrink-0 rounded object-cover" />}
                <span className="truncate">{label(it, i)}</span>
              </button>
              <IconButton label={`Move ${label(it, i)} up`} size="sm" disabled={disabled || i === 0} icon={<ChevronDown className="size-3.5 rotate-180" />} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }} />
              <IconButton label={`Remove ${label(it, i)}`} size="sm" disabled={disabled} icon={<Trash2 className="size-3.5" />} onClick={() => onChange(items.filter((_, j) => j !== i))} />
            </div>
            {open === i && (
              <div className="grid gap-3 border-t border-border p-2.5">
                {def.fields.map((f) => (
                  <FieldEditor
                    key={f.key}
                    def={f}
                    disabled={disabled}
                    value={it[f.key]}
                    onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)))}
                    onImage={(url, alt) => onChange(items.map((x, j) => (j === i ? { ...x, [f.key]: url, ...(alt && "alt" in x ? { alt } : {}) } : x)))}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {(!def.maxItems || items.length < def.maxItems) && (
        <Button size="sm" variant="ghost" disabled={disabled} className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => { onChange([...items, emptyItem(def.fields)]); setOpen(items.length); }}>
          Add {def.itemLabel.toLowerCase()}
        </Button>
      )}
    </div>
  );
}

// ─── Section inspector ───────────────────────────────────────────────────────

const BG = [
  { value: "default", label: "Page", swatch: "var(--site-bg)" },
  { value: "surface", label: "Subtle", swatch: "var(--site-surface)" },
  { value: "accent", label: "Accent", swatch: "var(--site-accent)" },
  { value: "inverse", label: "Inverted", swatch: "var(--site-text)" },
] as const;

const DEVICE_ICON = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };

function SectionInspector({ doc, section, page, element, onElementClose, onClose, onVariations }: { doc: SiteDoc; section: Section; page: Page; element: string | null; onElementClose: () => void; onClose: () => void; onVariations: () => void }) {
  const { update, readOnly, viewport, setViewport, projectId } = useBuilder();
  const def = sectionDef(section.type)!;
  const [tab, setTab] = useState<"content" | "design" | "test">("content");
  const [freeformOpen, setFreeformOpen] = useState(false);
  const edit = (fn: (s: Section) => void, key?: string) =>
    update((d) => {
      const s = d.pages.find((p) => p.id === page.id)?.sections.find((x) => x.id === section.id);
      if (!s) return;
      fn(s);
      // Global component: every instance gets the same content and design.
      syncGlobal(d, s);
    }, key);
  const global = section.globalId ? doc.globals?.find((g) => g.id === section.globalId) : undefined;
  const globalUses = section.globalId ? instancesOf(doc, section.globalId) : [];
  const [naming, setNaming] = useState<string | null>(null);
  // Editing content means the user is supplying real information.
  const editContent = (k: string, v: unknown) =>
    edit((s) => {
      s.props[k] = v;
      delete s.props._example;
    }, `${section.id}.${k}`);
  const st = section.style;
  const variants = def.variants ?? [];
  const current = variantOf(section);
  const device = viewport;
  const ov = device === "desktop" ? undefined : st.overrides?.[device];
  const setResp = (key: "align" | "paddingY" | "textScale", value: string) =>
    edit((s) => {
      if (device === "desktop") (s.style as Record<string, unknown>)[key] = value;
      else s.style.overrides = { ...s.style.overrides, [device]: { ...s.style.overrides?.[device], [key]: value } };
    });
  const resetResp = () => edit((s) => { if (s.style.overrides) delete s.style.overrides[device as "tablet" | "mobile"]; });
  const eff = { align: ov?.align ?? st.align, paddingY: ov?.paddingY ?? st.paddingY, textScale: ov?.textScale ?? st.textScale };
  const inherited = (k: keyof typeof eff) => device !== "desktop" && ov?.[k] === undefined;
  const altKey = def.fields.find((f) => f.key === "imageAlt") ? "imageAlt" : null;

  const stats = useQuery({
    queryKey: ["analytics", projectId],
    queryFn: () => api<{ experiments: { path: string; A: { views: number; submits: number }; B: { views: number; submits: number }; rateA: number; rateB: number; confidence: number | null; verdict: string }[] }>(`/api/v1/projects/${projectId}/analytics`),
    enabled: tab === "test",
  });
  const exp = stats.data?.experiments.find((e) => e.path === page.path);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{def.label}</p>
          <p className="truncate text-xs text-muted">{def.description}</p>
        </div>
        <IconButton label="Close (Esc)" size="sm" icon={<X className="size-4" />} onClick={onClose} />
      </div>
      <div className="border-b border-border px-4 py-2.5 text-[12px]">
        {section.globalId ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent"><Component className="size-3" /> {global?.name ?? "Global component"}</Badge>
            <span className="text-muted">Edits apply to {globalUses.length} instance{globalUses.length === 1 ? "" : "s"} on {new Set(globalUses.map((u) => u.page.id)).size} page{new Set(globalUses.map((u) => u.page.id)).size === 1 ? "" : "s"}</span>
            {!readOnly && (
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" icon={<Unlink className="size-3.5" />} onClick={() => update((d) => { const s = d.pages.find((p) => p.id === page.id)?.sections.find((x) => x.id === section.id); if (s) detach(s); })}>
                  Detach
                </Button>
              </span>
            )}
          </div>
        ) : naming !== null ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              update((d) => {
                const s = d.pages.find((p) => p.id === page.id)?.sections.find((x) => x.id === section.id);
                if (s) makeGlobal(d, s, naming);
              });
              setNaming(null);
            }}
          >
            <Input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} maxLength={60} placeholder="Component name" aria-label="Component name" />
            <Button size="sm" type="submit" variant="primary" disabled={!naming.trim()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>Cancel</Button>
          </form>
        ) : (
          !readOnly && (
            <button type="button" className="inline-flex items-center gap-1.5 text-muted hover:text-fg" onClick={() => setNaming(`${def.label}${section.props.heading ? ` — ${String(section.props.heading).slice(0, 30)}` : ""}`)} disabled={(doc.globals?.length ?? 0) >= MAX_GLOBALS}>
              <Component className="size-3.5" /> Make this a global component
            </button>
          )
        )}
      </div>
      <Tabs
        className="px-2"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "content", label: "Content" },
          { value: "design", label: "Design" },
          { value: "test", label: <>A/B test {section.ab?.running && <span className="size-1.5 rounded-full bg-success" />}</> },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {element && <ElementPanel key={element} section={section} path={element} edit={edit} onClose={onElementClose} />}
        {!element && tab !== "test" && <p className="border-b border-border px-4 py-2 text-[11px] text-subtle">Tip: click any text on the canvas to style it; double-click to edit it in place.</p>}
        {tab === "content" && (
          <div className="grid gap-4 p-4">
            {!!section.props._example && (
              <Notice tone="warning" title="Example content">
                Replace these figures, names or logos with real ones. Production deploys stay blocked until you do.
              </Notice>
            )}
            {section.type === "freeform" && (
              <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2 p-3 text-[13px]">
                <p>Place text, images, buttons and shapes anywhere, with a separate phone layout.</p>
                <Button variant="primary" icon={<Move className="size-3.5" />} onClick={() => setFreeformOpen(true)}>
                  Open free-form editor
                </Button>
                <FreeformEditor open={freeformOpen} onClose={() => setFreeformOpen(false)} doc={doc} section={section} edit={edit} />
              </div>
            )}
            {def.fields
              .filter((f) => f.key !== "imageAlt" && !(section.type === "freeform" && f.key === "items"))
              .map((f) => (
                <div key={f.key} className="grid gap-2">
                  <FieldEditor
                    def={f}
                    disabled={readOnly}
                    value={section.props[f.key]}
                    onChange={(v) => editContent(f.key, v)}
                    onImage={(url, alt) =>
                      edit((s) => {
                        s.props[f.key] = url;
                        if (alt && altKey && f.key === "image") s.props[altKey] = alt;
                        delete s.props._example;
                      })
                    }
                  />
                  {f.key === "image" && altKey && safeImageUrl(section.props.image) && (
                    <Field label="Image description" hint="Read aloud by screen readers and used by search engines.">
                      {(p) => <Input {...p} disabled={readOnly} value={String(section.props[altKey] ?? "")} maxLength={160} onChange={(e) => editContent(altKey, e.target.value)} />}
                    </Field>
                  )}
                </div>
              ))}
          </div>
        )}

        {tab === "design" && (
          <>
            {variants.length > 1 && (
              <Group title="Layout" aside={<Button size="sm" variant="ghost" icon={<Layers3 className="size-3.5" />} onClick={onVariations}>Compare</Button>}>
                <div role="radiogroup" aria-label="Layout" className="grid grid-cols-2 gap-1.5">
                  {variants.map((v) => (
                    <button key={v.value} role="radio" aria-checked={current === v.value} disabled={readOnly} onClick={() => edit((s) => void (s.variant = v.value))} className={clsx("rounded-[var(--radius-md)] border px-2.5 py-2 text-left text-[13px] disabled:opacity-50", current === v.value ? "border-accent bg-accent-soft font-medium" : "border-border hover:border-border-strong")}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </Group>
            )}
            <Group title="Background">
              <div
                role="radiogroup"
                aria-label="Background"
                className="grid grid-cols-4 gap-1.5"
                style={{ ["--site-bg" as string]: doc.theme.palette.background, ["--site-surface" as string]: doc.theme.palette.surface, ["--site-accent" as string]: doc.theme.palette.accent, ["--site-text" as string]: doc.theme.palette.text }}
              >
                {BG.map((b) => (
                  <button key={b.value} role="radio" aria-checked={st.background === b.value} disabled={readOnly} onClick={() => edit((s) => void (s.style.background = b.value))} className={clsx("grid justify-items-center gap-1 rounded-[var(--radius-md)] border p-1.5 text-[11px]", st.background === b.value ? "border-accent ring-2 ring-accent/25" : "border-border hover:border-border-strong")}>
                    <span className="h-6 w-full rounded-[4px] ring-1 ring-black/10" style={{ background: b.swatch }} />
                    {b.label}
                  </button>
                ))}
              </div>
              <Field label="Decoration">
                {(p) => (
                  <Select {...p} disabled={readOnly} value={st.decor} onChange={(e) => edit((s) => void (s.style.decor = e.target.value as Section["style"]["decor"]))}>
                    {DECORATIONS.map((d) => <option key={d} value={d}>{{ none: "None", gradient: "Soft gradient", mesh: "Colour mesh", glow: "Glow", grid: "Grid lines", dots: "Dot pattern", grain: "Film grain" }[d]}</option>)}
                  </Select>
                )}
              </Field>
            </Group>
            <Group title="Motion">
              {(() => {
                const mo = st.motion ?? { entrance: "theme" as const, speed: "normal" as const, stagger: true, hover: "none" as const, parallax: false };
                const setMo = (patch: Partial<NonNullable<Section["style"]["motion"]>>) => edit((s) => void (s.style.motion = { ...mo, ...patch }));
                return (
                  <>
                    <Field label="Entrance" hint="Plays as the section scrolls into view. Visitors who prefer reduced motion see it without animation.">
                      {(p) => (
                        <Select {...p} disabled={readOnly} value={mo.entrance} onChange={(e) => setMo({ entrance: e.target.value as typeof mo.entrance })}>
                          {[["theme", "Site default"], ["none", "None"], ["fade", "Fade in"], ["up", "Rise up"], ["zoom", "Zoom in"], ["left", "Slide from left"], ["right", "Slide from right"], ["blur", "Un-blur"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Select>
                      )}
                    </Field>
                    {mo.entrance !== "none" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Speed">
                          {(p) => (
                            <Select {...p} disabled={readOnly} value={mo.speed} onChange={(e) => setMo({ speed: e.target.value as typeof mo.speed })}>
                              <option value="fast">Quick</option>
                              <option value="normal">Normal</option>
                              <option value="slow">Gentle</option>
                            </Select>
                          )}
                        </Field>
                        <label className="flex items-end justify-between gap-2 pb-1.5 text-[13px]">
                          One by one
                          <Switch label="Stagger items" disabled={readOnly} checked={mo.stagger} onChange={(v) => setMo({ stagger: v })} />
                        </label>
                      </div>
                    )}
                    <Field label="Hover effect on cards">
                      {(p) => (
                        <Select {...p} disabled={readOnly} value={mo.hover} onChange={(e) => setMo({ hover: e.target.value as typeof mo.hover })}>
                          <option value="none">None</option>
                          <option value="lift">Lift</option>
                          <option value="glow">Glow</option>
                          <option value="scale">Grow</option>
                        </Select>
                      )}
                    </Field>
                    {["hero", "split"].includes(section.type) && (
                      <label className="flex items-center justify-between gap-2 text-[13px]">
                        Parallax image
                        <Switch label="Parallax image" disabled={readOnly} checked={mo.parallax} onChange={(v) => setMo({ parallax: v })} />
                      </label>
                    )}
                    <p className="text-xs text-subtle">Motion shows on the published site and in Preview, not while editing.</p>
                  </>
                );
              })()}
            </Group>
            <Group
              title="Spacing & text"
              aside={
                <Segmented
                  label="Device being edited"
                  value={device}
                  onChange={(v: Breakpoint) => setViewport(v)}
                  options={BREAKPOINTS.map((b) => {
                    const I = DEVICE_ICON[b];
                    return { value: b, label: <I className="size-3.5" />, title: `Edit for ${b}` };
                  })}
                />
              }
            >
              {device !== "desktop" && (
                <div className="-mt-1 flex items-center justify-between text-xs text-muted">
                  <span>Changes here apply to {device} only.</span>
                  {ov && Object.keys(ov).length > 0 && <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={resetResp}><RotateCcw className="size-3" /> Reset</button>}
                </div>
              )}
              {([
                ["align", "Alignment", [{ value: "left", label: "Left" }, { value: "center", label: "Center" }]],
                ["paddingY", "Vertical space", [{ value: "sm", label: "Compact" }, { value: "md", label: "Regular" }, { value: "lg", label: "Spacious" }]],
                ["textScale", "Text size", [{ value: "sm", label: "Small" }, { value: "md", label: "Regular" }, { value: "lg", label: "Large" }]],
              ] as const).map(([key, label, options]) => (
                <div key={key} className="grid gap-1.5">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    {label}
                    {inherited(key) && <span className="text-xs font-normal text-subtle">inherits desktop</span>}
                  </span>
                  <Segmented label={label} value={eff[key]} onChange={(v: string) => !readOnly && setResp(key, v)} options={[...options]} />
                </div>
              ))}
            </Group>
            <Group title="Visibility">
              {BREAKPOINTS.map((b) => (
                <div key={b} className="flex items-center justify-between">
                  <span className="text-[13px]">Show on {b}</span>
                  <Switch label={`Show on ${b}`} disabled={readOnly} checked={!st.hideOn.includes(b)} onChange={(show) => edit((s) => void (s.style.hideOn = show ? s.style.hideOn.filter((x) => x !== b) : [...s.style.hideOn, b]))} />
                </div>
              ))}
              {GRID_TYPES.has(section.type) && (
                <div className="grid grid-cols-3 gap-2">
                  {(["desktop", "tablet", "mobile"] as const).map((b) => {
                    const max = b === "desktop" ? 4 : b === "tablet" ? 3 : 2;
                    const cols = st.columns ?? { desktop: 3, tablet: 2, mobile: 1 };
                    return (
                      <Field key={b} label={`${b[0].toUpperCase()}${b.slice(1)} cols`}>
                        {(p) => (
                          <Select {...p} disabled={readOnly} value={cols[b]} onChange={(e) => edit((s) => void (s.style.columns = { ...cols, [b]: Number(e.target.value) }))}>
                            {Array.from({ length: max }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                          </Select>
                        )}
                      </Field>
                    );
                  })}
                </div>
              )}
            </Group>
            <div className="border-t-4 border-surface-2">
              <p className="px-4 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Advanced design</p>
              <AdvancedDesign section={section} edit={edit} doc={doc} />
            </div>
          </>
        )}

        {tab === "test" && (
          <div className="grid gap-4 p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent-soft text-accent"><FlaskConical className="size-4" /></span>
              <p className="text-xs text-muted">Show half of your visitors a different layout for this section and measure which one gets more form submissions. Runs on the live production site; counts are anonymous (no cookies, no IP addresses stored).</p>
            </div>
            {section.ab?.experimentId ? (
              <Notice tone="accent" title="Growth is testing this section" action={<a href={`/projects/${projectId}/growth`} className="text-[13px] font-medium text-accent hover:underline">Open Growth →</a>}>
                Results, stopping and applying the winner are handled on the Growth page.
              </Notice>
            ) : variants.length < 2 ? (
              <Notice>This section has only one layout, so it cannot be A/B tested.</Notice>
            ) : (
              <>
                <Field label="Variant B layout" hint={`Visitors in group A keep “${variants.find((v) => v.value === current)?.label}”.`}>
                  {(p) => (
                    <Select {...p} disabled={readOnly} value={section.ab?.variant ?? variants.find((v) => v.value !== current)!.value} onChange={(e) => edit((s) => void (s.ab = { variant: e.target.value, running: s.ab?.running ?? false }))}>
                      {variants.filter((v) => v.value !== current).map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </Select>
                  )}
                </Field>
                <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-border p-3">
                  <div>
                    <p className="text-[13px] font-medium">{section.ab?.running ? "Test is on" : "Test is off"}</p>
                    <p className="text-xs text-muted">Takes effect on the next production deploy.</p>
                  </div>
                  <Switch label="Run A/B test" disabled={readOnly} checked={!!section.ab?.running} onChange={(on) => edit((s) => void (s.ab = { variant: s.ab?.variant ?? variants.find((v) => v.value !== current)!.value, running: on }))} />
                </div>
                {exp ? (
                  <div className="grid gap-2 rounded-[var(--radius-md)] border border-border p-3">
                    <p className="text-[13px] font-semibold">Results for {page.path}</p>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      {(["A", "B"] as const).map((k) => (
                        <div key={k} className="rounded-[var(--radius-md)] bg-surface-2 p-2">
                          <p className="text-xs text-muted">Variant {k}</p>
                          <p className="text-lg font-semibold tabular-nums">{((k === "A" ? exp.rateA : exp.rateB) * 100).toFixed(1)}%</p>
                          <p className="text-[11px] text-subtle tabular-nums">{exp[k].submits} of {exp[k].views} visits</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted">{exp.verdict}{exp.confidence !== null ? ` · ${(exp.confidence * 100).toFixed(0)}% confidence` : ""}</p>
                  </div>
                ) : (
                  <p className="text-xs text-subtle">No results yet. Deploy to production with the test on, then results appear here and on the project’s Analytics tab.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page inspector ──────────────────────────────────────────────────────────

function PageInspector({ doc, page, onOpenStyle, onAskAi }: { doc: SiteDoc; page: Page; onOpenStyle: () => void; onAskAi: () => void }) {
  const { update, readOnly } = useBuilder();
  const edit = (fn: (p: Page) => void, key: string) => update((d) => fn(d.pages.find((p) => p.id === page.id)!), key);
  const pathTaken = page.path !== "/" && doc.pages.some((p) => p.id !== page.id && p.path === page.path);
  const desc = page.description || "Add a description to control what search engines show here.";
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-border px-4 py-4">
        <p className="text-[13px] font-semibold">{page.kind === "post" ? "Blog post" : "Page"} settings</p>
        <p className="mt-0.5 text-xs text-muted">Click any section on the canvas to edit it.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={onAskAi}>Ask AI</Button>
          <Button size="sm" onClick={onOpenStyle}>Site style</Button>
        </div>
      </div>
      <Group title="Basics">
        <Field label="Title">{(p) => <Input {...p} disabled={readOnly} value={page.title} maxLength={120} onChange={(e) => edit((x) => void (x.title = e.target.value), `${page.id}.title`)} />}</Field>
        {page.path !== "/" && (
          <Field label="URL" error={pathTaken ? "Another page uses this address" : undefined}>
            {(p) => <Input {...p} disabled={readOnly} className="font-mono text-xs" value={page.path} onChange={(e) => edit((x) => void (x.path = "/" + e.target.value.replace(/^\/+/, "").toLowerCase().replace(/[^a-z0-9/-]/g, "-")), `${page.id}.path`)} />}
          </Field>
        )}
        {page.path !== "/" && (
          <label className="flex items-start justify-between gap-3 text-[13px]">
            <span>
              Members only
              <span className="block text-xs text-muted">Only signed-in members with an active membership can see this page. Sell memberships as products in your store.</span>
            </span>
            <Switch label="Members only" disabled={readOnly} checked={!!page.membersOnly} onChange={(v) => edit((x) => void (v ? (x.membersOnly = true) : delete x.membersOnly), `${page.id}.members`)} />
          </label>
        )}
        {page.needsTranslation && (
          <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs">
            <span>This page has not been translated yet.</span>
            <button className="font-medium underline" onClick={() => edit((x) => void delete x.needsTranslation, `${page.id}.tr`)} disabled={readOnly}>Mark done</button>
          </div>
        )}
      </Group>
      {page.kind === "post" && (
        <Group title="Post details">
          <Field label="Publish date">{(p) => <Input {...p} type="date" disabled={readOnly} value={page.meta?.date ?? ""} onChange={(e) => edit((x) => void (x.meta = { ...x.meta, date: e.target.value || undefined }), `${page.id}.date`)} />}</Field>
          <Field label="Author">{(p) => <Input {...p} disabled={readOnly} value={page.meta?.author ?? ""} maxLength={80} onChange={(e) => edit((x) => void (x.meta = { ...x.meta, author: e.target.value }), `${page.id}.author`)} />}</Field>
          <ImageField label="Cover image" value={page.meta?.image} disabled={readOnly} onChange={(u) => edit((x) => void (x.meta = { ...x.meta, image: u || undefined }), `${page.id}.image`)} />
        </Group>
      )}
      <Group title="Search & sharing">
        <Field label="Description" hint={`${page.description.length}/160 characters`}>
          {(p) => <Textarea {...p} disabled={readOnly} rows={3} value={page.description} maxLength={300} onChange={(e) => edit((x) => void (x.description = e.target.value), `${page.id}.description`)} />}
        </Field>
        <div className="rounded-[var(--radius-md)] border border-border bg-white p-3 text-left" aria-label="Search result preview">
          <p className="truncate text-[12px] text-[#4d5156]">yoursite.com{page.path === "/" ? "" : page.path.replace(/\//g, " › ")}</p>
          <p className="truncate text-[16px] leading-snug text-[#1a0dab]">{page.path === "/" ? page.title : `${page.title} · ${doc.name}`}</p>
          <p className="line-clamp-2 text-[13px] leading-snug text-[#4d5156]">{desc.length > 160 ? desc.slice(0, 157) + "…" : desc}</p>
        </div>
        <p className="text-[11px] text-subtle">Approximate preview of a search result.</p>
        <label className="flex items-start justify-between gap-3 text-[13px]">
          <span>
            Hide from search engines
            <span className="block text-xs text-muted">Asks Google and others not to list this page, and leaves it out of the sitemap.</span>
          </span>
          <Switch label="Hide from search engines" disabled={readOnly} checked={!!page.seo?.noindex} onChange={(v) => edit((x) => void (x.seo = { ...x.seo, noindex: v || undefined }), `${page.id}.noindex`)} />
        </label>
        <Field label="Canonical address" hint="Only if this content also lives at another address — the full https:// link to the main one.">
          {(p) => <Input {...p} disabled={readOnly} value={page.seo?.canonical ?? ""} placeholder="https://" onChange={(e) => edit((x) => void (x.seo = { ...x.seo, canonical: e.target.value.trim() || undefined }), `${page.id}.canonical`)} />}
        </Field>
      </Group>
      <SiteSeo doc={doc} readOnly={readOnly} />
      {page.lang && <Group title="Language"><Badge>{page.lang.toUpperCase()}</Badge></Group>}
    </div>
  );
}

export function Inspector(props: { doc: SiteDoc; page: Page; selected: Section | null; element?: string | null; onElementClose?: () => void; onClose: () => void; onVariations: () => void; onOpenStyle: () => void; onAskAi: () => void }) {
  if (props.selected) return <SectionInspector key={props.selected.id} doc={props.doc} section={props.selected} page={props.page} element={props.element ?? null} onElementClose={props.onElementClose ?? (() => {})} onClose={props.onClose} onVariations={props.onVariations} />;
  return <PageInspector doc={props.doc} page={props.page} onOpenStyle={props.onOpenStyle} onAskAi={props.onAskAi} />;
}

/** Site-wide search and sharing: favicon, search console codes, and structured data about the business. */
function SiteSeo({ doc, readOnly }: { doc: SiteDoc; readOnly: boolean }) {
  const { update } = useBuilder();
  const seo = doc.seo ?? {};
  const org = seo.org;
  const set = (patch: Partial<NonNullable<SiteDoc["seo"]>>, key: string) => update((d) => void (d.seo = { ...d.seo, ...patch }), `seo.${key}`);
  const setOrg = (patch: Partial<NonNullable<NonNullable<SiteDoc["seo"]>["org"]>>, key: string) => update((d) => void (d.seo = { ...d.seo, org: { type: "Organization", sameAs: [], ...d.seo?.org, ...patch } }), `seo.org.${key}`);
  return (
    <Group title="Whole site · search & sharing">
      <ImageField label="Favicon (browser tab icon)" value={seo.favicon} disabled={readOnly} onChange={(u) => set({ favicon: u || undefined }, "favicon")} />
      <Field label="Google Search Console code" hint="Only the code from their verification meta tag.">{(p) => <Input {...p} disabled={readOnly} value={seo.googleVerify ?? ""} onChange={(e) => set({ googleVerify: e.target.value.trim() || undefined }, "google")} />}</Field>
      <Field label="Bing Webmaster code">{(p) => <Input {...p} disabled={readOnly} value={seo.bingVerify ?? ""} onChange={(e) => set({ bingVerify: e.target.value.trim() || undefined }, "bing")} />}</Field>
      <label className="flex items-start justify-between gap-3 text-[13px]">
        <span>
          Business details for search results
          <span className="block text-xs text-muted">Adds structured data (schema.org) to the home page and posts, so search engines know who you are.</span>
        </span>
        <Switch label="Business details for search results" disabled={readOnly} checked={!!org} onChange={(v) => update((d) => void (d.seo = { ...d.seo, org: v ? { type: "Organization", sameAs: [] } : undefined }), "seo.org")} />
      </label>
      {org && (
        <>
          <Field label="Kind of business">
            {(p) => (
              <Select {...p} disabled={readOnly} value={org.type} onChange={(e) => setOrg({ type: e.target.value as "Organization" }, "type")}>
                <option value="Organization">Company or organisation</option>
                <option value="LocalBusiness">Local business</option>
                <option value="Restaurant">Restaurant or café</option>
                <option value="Store">Shop</option>
                <option value="MedicalClinic">Clinic</option>
                <option value="School">School or institute</option>
              </Select>
            )}
          </Field>
          <Field label="Phone">{(p) => <Input {...p} disabled={readOnly} value={org.phone ?? ""} onChange={(e) => setOrg({ phone: e.target.value || undefined }, "phone")} />}</Field>
          <Field label="Email">{(p) => <Input {...p} disabled={readOnly} value={org.email ?? ""} onChange={(e) => setOrg({ email: e.target.value || undefined }, "email")} />}</Field>
          <Field label="Address">{(p) => <Input {...p} disabled={readOnly} value={org.address ?? ""} onChange={(e) => setOrg({ address: e.target.value || undefined }, "address")} />}</Field>
          <Field label="Social profiles" hint="One https:// link per line">
            {(p) => <Textarea {...p} rows={3} disabled={readOnly} value={org.sameAs.join("\n")} onChange={(e) => setOrg({ sameAs: e.target.value.split("\n").map((x) => x.trim()).filter((x) => /^https:\/\//.test(x)).slice(0, 10) }, "sameAs")} />}
          </Field>
        </>
      )}
    </Group>
  );
}
