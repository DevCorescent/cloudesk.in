"use client";

import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronRight, Component, Copy, Type, EyeOff, FileText, Globe, GripVertical, Languages, MoreHorizontal, Newspaper, Plus, Search, Trash2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { elementTree, type ElementNode } from "@/lib/site/advanced";
import { instancesOf } from "@/lib/site/globals";
import { createSection, newId, SECTION_DEFS, sectionDef, type Page, type Section, type SiteDoc } from "@/lib/site/model";
import { renderPage } from "@/lib/site/render";
import { reviewPage, type Finding } from "@/lib/site/review";
import { SitePreview } from "../site-preview";
import { DRAG_MIME } from "./canvas";
import { ConfirmDialog, Dialog, Menu } from "../ui/overlays";
import { Badge, Button, EmptyState, Field, IconButton, Input, Select } from "../ui/primitives";
import { useShortcuts } from "../ui/shortcut";

type Update = (mutate: (d: SiteDoc) => void, key?: string) => void;

/** HTML for a single section in the site's theme (motion off), for thumbnails. */
export function sectionPreviewHtml(doc: SiteDoc, s: Section, page?: Page) {
  const d: SiteDoc = { ...doc, theme: { ...doc.theme, motion: "none" } };
  const p: Page = { ...(page ?? doc.pages[0]), sections: [s] };
  return renderPage(d, p, { kind: "preview" });
}

export function moveSection(doc: SiteDoc, pageId: string, from: number, to: number) {
  const page = doc.pages.find((p) => p.id === pageId)!;
  if (to < 0 || to >= page.sections.length) return;
  const [s] = page.sections.splice(from, 1);
  page.sections.splice(to, 0, s);
}

export const cloneSection = (s: Section): Section => ({ ...structuredClone(s), id: newId() });

export function sectionTitle(s: Section) {
  const def = sectionDef(s.type);
  const label = String(s.props.heading ?? s.props.brand ?? s.props.text ?? "").trim();
  return { kind: def?.label ?? s.type, label };
}

// ─── Add ─────────────────────────────────────────────────────────────────────

const CATEGORIES = ["Structure", "Content", "Commerce", "Conversion"] as const;

export function AddPanel({ doc, page, onInsert, onInsertGlobal, readOnly }: { doc: SiteDoc; page: Page; onInsert: (type: string) => void; onInsertGlobal: (globalId: string) => void; readOnly: boolean }) {
  const [q, setQ] = useState("");
  const previews = useMemo(() => Object.fromEntries(SECTION_DEFS.map((d) => [d.type, sectionPreviewHtml(doc, createSection(d.type), page)])), [doc, page]);
  const needle = q.trim().toLowerCase();
  const defs = SECTION_DEFS.filter((d) => !needle || `${d.label} ${d.description} ${d.type}`.toLowerCase().includes(needle));
  return (
    <div className="grid gap-4 p-3">
      <p className="-mb-1 px-0.5 text-[12px] text-muted">Drag a section onto the page, or click to add it below the one you&apos;ve selected.</p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sections" aria-label="Search sections" className="pl-8" />
      </div>
      {(doc.globals ?? []).some((g) => !needle || g.name.toLowerCase().includes(needle)) && (
        <section>
          <h3 className="px-0.5 pb-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">Global components</h3>
          <div className="grid gap-1.5">
            {(doc.globals ?? [])
              .filter((g) => !needle || g.name.toLowerCase().includes(needle))
              .map((g) => {
                const uses = instancesOf(doc, g.id);
                const onPage = uses.some((u) => u.page.id === page.id);
                return (
                  <button
                    key={g.id}
                    disabled={readOnly || !uses.length}
                    onClick={() => onInsertGlobal(g.id)}
                    draggable={!readOnly && !!uses.length}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, `global:${g.id}`);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="glass-card cursor-grab active:cursor-grabbing flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-left transition-shadow hover:shadow-md disabled:opacity-50">
                    <Component className="size-4 shrink-0 text-accent" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{g.name}</span>
                      <span className="block text-xs text-muted">{uses.length ? `${sectionDef(uses[0].section.type)?.label ?? "Section"} · on ${new Set(uses.map((u) => u.page.id)).size} page${new Set(uses.map((u) => u.page.id)).size === 1 ? "" : "s"}${onPage ? " · already here" : ""}` : "No instances left"}</span>
                    </span>
                    <Plus className="size-4 shrink-0 text-subtle" aria-hidden />
                  </button>
                );
              })}
          </div>
        </section>
      )}
      {CATEGORIES.map((cat) => {
        const items = defs.filter((d) => d.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat}>
            <h3 className="px-0.5 pb-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">{cat}</h3>
            <div className="grid gap-2">
              {items.map((d) => (
                <button
                  key={d.type}
                  disabled={readOnly}
                  onClick={() => onInsert(d.type)}
                  draggable={!readOnly}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, `type:${d.type}`);
                    e.dataTransfer.setData("text/plain", d.label);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  title="Click to add below the selected section, or drag onto the page"
                  className="group cursor-grab overflow-hidden active:cursor-grabbing rounded-[var(--radius-lg)] border border-border bg-surface text-left shadow-sm transition-[border,box-shadow] hover:border-border-strong hover:shadow-md disabled:opacity-50">
                  <SitePreview html={previews[d.type]} title={`${d.label} preview`} width={860} height={["navbar", "banner", "footer"].includes(d.type) ? 56 : 120} className="border-b border-border" />
                  <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{d.label}</span>
                      <span className="block truncate text-xs text-muted">{d.description}</span>
                    </span>
                    <Plus className="size-4 shrink-0 text-subtle group-hover:text-accent" aria-hidden />
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {!defs.length && <EmptyState title={`Nothing matches “${q}”`} className="py-6" />}
    </div>
  );
}

// ─── Layers ──────────────────────────────────────────────────────────────────

export function LayersPanel({ page, selectedId, setSelectedId, update, readOnly, selectedEl, onElement }: { page: Page; selectedId: string | null; setSelectedId: (id: string | null) => void; update: Update; readOnly: boolean; selectedEl?: string | null; onElement?: (sectionId: string, path: string) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <div className="p-2">
      <p className="px-2 pt-1 pb-2 text-xs text-subtle">Drag to reorder · Alt + ↑/↓ with the keyboard</p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5" aria-label={`Sections on ${page.title}`}>
        {page.sections.map((s, i) => {
          const t = sectionTitle(s);
          return (
            <li
              key={s.id}
              draggable={!readOnly}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null && drag !== i) update((d) => moveSection(d, page.id, drag, i));
                setDrag(null);
                setOver(null);
              }}
              className={clsx("group relative rounded-[var(--radius-md)]", over === i && drag !== null && drag !== i && "ring-2 ring-accent/40")}
            >
              <div
                role="button"
                tabIndex={0}
                aria-pressed={selectedId === s.id}
                onClick={() => setSelectedId(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(s.id);
                  }
                  if (e.altKey && e.key === "ArrowUp" && !readOnly) update((d) => moveSection(d, page.id, i, i - 1));
                  if (e.altKey && e.key === "ArrowDown" && !readOnly) update((d) => moveSection(d, page.id, i, i + 1));
                }}
                className={clsx("flex h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent", selectedId === s.id ? "bg-accent-soft" : "hover:bg-surface-2")}
              >
                <GripVertical className={clsx("size-3.5 shrink-0 text-subtle", readOnly ? "opacity-0" : "cursor-grab")} aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{t.kind}</span>
                  {t.label && <span className="text-muted"> · {t.label}</span>}
                </span>
                {s.ab?.running && <Badge tone="accent">A/B</Badge>}
                {s.style.hideOn.length > 0 && <EyeOff className="size-3.5 shrink-0 text-subtle" aria-label={`Hidden on ${s.style.hideOn.join(", ")}`} />}
                {!readOnly && (
                  <Menu
                    label={`Actions for ${t.kind}`}
                    trigger={(p) => <IconButton {...p} label={`Actions for ${t.kind}`} size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100 aria-expanded:opacity-100" icon={<MoreHorizontal className="size-4" />} />}
                    items={[
                      { label: "Move up", icon: <ArrowUp />, disabled: i === 0, onSelect: () => update((d) => moveSection(d, page.id, i, i - 1)) },
                      { label: "Move down", icon: <ArrowDown />, disabled: i === page.sections.length - 1, onSelect: () => update((d) => moveSection(d, page.id, i, i + 1)) },
                      {
                        label: "Duplicate",
                        icon: <Copy />,
                        onSelect: () => {
                          const copy = cloneSection(s);
                          update((d) => d.pages.find((p) => p.id === page.id)!.sections.splice(i + 1, 0, copy));
                          setSelectedId(copy.id);
                        },
                      },
                      "separator",
                      { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => { update((d) => d.pages.find((p) => p.id === page.id)!.sections.splice(i, 1)); if (selectedId === s.id) setSelectedId(null); } },
                    ]}
                  />
                )}
              </div>
              {selectedId === s.id && onElement && <ElementTree nodes={elementTree(s.props)} selected={selectedEl ?? null} onPick={(path) => onElement(s.id, path)} />}
            </li>
          );
        })}
      </ul>
      {page.sections.length === 0 && <EmptyState title="This page is empty" description="Add your first section from the + panel." className="py-8" />}
    </div>
  );
}

/** The selected section's elements: click one to style it (as clicking it on the page does). */
function ElementTree({ nodes, selected, onPick, depth = 0 }: { nodes: ElementNode[]; selected: string | null; onPick: (path: string) => void; depth?: number }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(selected ? [selected.split(".")[0]!, selected.split(".").slice(0, 2).join(".")] : []));
  if (!nodes.length) return depth === 0 ? <p className="py-1.5 pl-8 text-[12px] text-subtle">No text elements in this section.</p> : null;
  return (
    <ul className={clsx("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-px", depth === 0 ? "mt-0.5 mb-1.5 ml-[18px] border-l border-border pl-1.5" : "ml-3")} aria-label={depth === 0 ? "Elements" : undefined}>
      {nodes.map((n) => {
        const isOpen = open.has(n.path);
        return (
          <li key={n.path}>
            {n.children ? (
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => { const x = new Set(o); if (x.has(n.path)) x.delete(n.path); else x.add(n.path); return x; })} className="flex h-7 w-full items-center gap-1 rounded-[7px] px-1.5 text-left text-[12px] text-muted hover:bg-surface-2 hover:text-fg">
                <ChevronRight className={clsx("size-3 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden />
                <span className="truncate">{n.label}</span>
              </button>
            ) : (
              <button type="button" aria-current={selected === n.path ? "true" : undefined} onClick={() => onPick(n.path)} className={clsx("flex h-7 w-full items-center gap-1.5 rounded-[7px] px-1.5 text-left text-[12px]", selected === n.path ? "bg-accent-soft font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                <Type className="size-3 shrink-0 text-subtle" aria-hidden />
                <span className="truncate">{n.label}</span>
              </button>
            )}
            {n.children && isOpen && <ElementTree nodes={n.children} selected={selected} onPick={onPick} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Pages ───────────────────────────────────────────────────────────────────

export const LANGUAGES: [string, string][] = [
  ["hi", "Hindi"], ["bn", "Bengali"], ["ta", "Tamil"], ["te", "Telugu"], ["mr", "Marathi"], ["gu", "Gujarati"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["ar", "Arabic"], ["ja", "Japanese"], ["zh", "Chinese"],
];
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "post";

export function PagesPanel({ doc, page, setPageId, update, readOnly, onTranslate }: { doc: SiteDoc; page: Page; setPageId: (id: string) => void; update: Update; readOnly: boolean; onTranslate: (lang: string) => void }) {
  const undo = useShortcuts().keys("mod+z");
  const [dialog, setDialog] = useState<"page" | "post" | "lang" | null>(null);
  const [form, setForm] = useState({ title: "", path: "", lang: "hi" });
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<Page | null>(null);
  const home = doc.pages.find((p) => p.path === "/") ?? doc.pages[0];
  const chrome = () => {
    const nav = home.sections.find((s) => s.type === "navbar");
    const footer = home.sections.find((s) => s.type === "footer");
    return { nav: nav ? [cloneSection(nav)] : [], footer: footer ? [cloneSection(footer)] : [] };
  };
  const languages = [...new Set(doc.pages.map((p) => p.lang ?? doc.lang))];
  const base = doc.pages.filter((p) => (p.lang ?? doc.lang) === doc.lang);

  const submit = () => {
    setError(undefined);
    const title = form.title.trim();
    if (dialog === "lang") {
      const code = form.lang;
      if (languages.includes(code)) return setError("This language already exists");
      const clones: Page[] = base.map((p) => ({
        ...structuredClone(p),
        id: newId("p"),
        path: p.path === "/" ? `/${code}` : `/${code}${p.path}`,
        lang: code,
        translationOf: p.id,
        needsTranslation: true,
        sections: p.sections.map(cloneSection),
      }));
      update((d) => void d.pages.push(...clones));
      setDialog(null);
      setPageId(clones[0].id);
      return;
    }
    if (!title) return setError("Enter a title");
    if (dialog === "post") {
      const path = `/blog/${slug(form.path || title)}`;
      if (doc.pages.some((p) => p.path === path)) return setError(`A page at ${path} already exists`);
      const { nav, footer } = chrome();
      const article = createSection("article");
      const id = newId("p");
      update((d) => {
        if (!d.pages.some((p) => p.path === "/blog")) {
          const hero = createSection("hero");
          Object.assign(hero.props, { eyebrow: "", heading: "Journal", subheading: "News, stories and ideas.", primaryLabel: "", secondaryLabel: "", image: "" });
          hero.variant = "minimal";
          const posts = createSection("posts");
          Object.assign(posts.props, { heading: "", limit: 24 });
          posts.variant = "list";
          const c = chrome();
          d.pages.push({ id: newId("p"), path: "/blog", title: "Journal", description: `Stories and news from ${d.name}.`, kind: "page", sections: [...c.nav, hero, posts, ...c.footer] });
        }
        d.pages.push({ id, path, title, description: "", kind: "post", meta: { date: today(), author: "" }, sections: [...nav, article, ...footer] });
      });
      setDialog(null);
      setPageId(id);
      return;
    }
    const path = "/" + (form.path.trim() || title).toLowerCase().replace(/^\/+/, "").replace(/[^a-z0-9/-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (path === "/" || doc.pages.some((p) => p.path === path)) return setError(`A page at ${path} already exists`);
    const { nav, footer } = chrome();
    const hero = createSection("hero");
    Object.assign(hero.props, { heading: title, subheading: "", primaryLabel: "", secondaryLabel: "", image: "" });
    hero.variant = "minimal";
    const id = newId("p");
    update((d) => void d.pages.push({ id, path, title, description: "", kind: "page", sections: [...nav, hero, createSection("text"), ...footer] }));
    setDialog(null);
    setPageId(id);
  };

  const groups: { label: string; pages: Page[] }[] = [
    { label: "Pages", pages: doc.pages.filter((p) => p.kind !== "post" && (p.lang ?? doc.lang) === doc.lang) },
    { label: "Blog posts", pages: doc.pages.filter((p) => p.kind === "post" && (p.lang ?? doc.lang) === doc.lang).sort((a, b) => (b.meta?.date ?? "").localeCompare(a.meta?.date ?? "")) },
    ...languages.filter((l) => l !== doc.lang).map((l) => ({ label: `${LANGUAGES.find(([c]) => c === l)?.[1] ?? l.toUpperCase()} (${l})`, pages: doc.pages.filter((p) => p.lang === l) })),
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-3">
      {!readOnly && (
        <div className="grid grid-cols-3 gap-1.5">
          <Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => { setForm({ ...form, title: "", path: "" }); setDialog("page"); }}>Page</Button>
          <Button size="sm" icon={<Newspaper className="size-3.5" />} onClick={() => { setForm({ ...form, title: "", path: "" }); setDialog("post"); }}>Post</Button>
          <Button size="sm" icon={<Languages className="size-3.5" />} onClick={() => setDialog("lang")}>Language</Button>
        </div>
      )}
      {groups.filter((g) => g.pages.length).map((g) => (
        <section key={g.label}>
          <h3 className="flex items-center justify-between px-1 pb-1.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">
            {g.label}
            {g.label.includes("(") && !readOnly && (
              <button className="flex items-center gap-1 font-normal tracking-normal normal-case text-accent hover:underline" onClick={() => onTranslate(g.pages[0]?.lang ?? "")}>
                <Wand2 className="size-3" /> Translate with AI
              </button>
            )}
          </h3>
          <ul className="grid gap-0.5">
            {g.pages.map((p) => (
              <li key={p.id} className="group flex items-center">
                <button onClick={() => setPageId(p.id)} aria-current={p.id === page.id} className={clsx("flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-2 text-left text-[13px]", p.id === page.id ? "bg-accent-soft font-medium" : "hover:bg-surface-2")}>
                  {p.kind === "post" ? <Newspaper className="size-3.5 shrink-0 text-muted" aria-hidden /> : p.lang ? <Globe className="size-3.5 shrink-0 text-muted" aria-hidden /> : <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  {p.needsTranslation && <Badge tone="warning">Untranslated</Badge>}
                  <span className="max-w-24 truncate font-mono text-[11px] text-subtle">{p.path}</span>
                </button>
                {p.path !== "/" && !readOnly && <IconButton label={`Delete ${p.title}`} size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(p)} />}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === "post" ? "New blog post" : dialog === "lang" ? "Add a language" : "Add a page"}
        description={dialog === "lang" ? "Copies every page under its own address (e.g. /hi). Translate them yourself or with AI." : dialog === "post" ? "Posts appear in the Journal page and in any “Blog posts” section." : "Starts with your navigation, a heading, a text block and the footer."}
        footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" onClick={submit}>{dialog === "lang" ? "Add language" : "Create"}</Button></>}
      >
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {dialog === "lang" ? (
            <Field label="Language" error={error}>
              {(p) => (
                <Select {...p} value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value })}>
                  {LANGUAGES.filter(([c]) => c !== doc.lang).map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
                </Select>
              )}
            </Field>
          ) : (
            <>
              <Field label="Title" error={error}>{(p) => <Input {...p} autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />}</Field>
              <Field label={dialog === "post" ? "URL slug" : "URL path"} hint={dialog === "post" ? "Optional, e.g. spring-menu → /blog/spring-menu" : "Optional, e.g. /our-team"}>
                {(p) => <Input {...p} value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} className="font-mono text-xs" />}
              </Field>
            </>
          )}
        </form>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        destructive
        title={`Delete “${deleting?.title}”?`}
        description={`Links to this page will break; Review lists them. Undo with ${undo ?? "the Undo button"} or restore from version history.`}
        confirmLabel="Delete page"
        onConfirm={() => {
          const id = deleting!.id;
          update((d) => void (d.pages = d.pages.filter((p) => p.id !== id)));
          if (page.id === id) setPageId(home.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

// ─── Review ──────────────────────────────────────────────────────────────────

const SEV = { high: "danger", medium: "warning", low: "neutral" } as const;

export function ReviewPanel({ doc, page, update, readOnly, onLocate, onAskAi }: { doc: SiteDoc; page: Page; update: Update; readOnly: boolean; onLocate: (sectionId: string) => void; onAskAi: () => void }) {
  const findings = useMemo(() => reviewPage(doc, page), [doc, page]);
  const fixable = findings.filter((f) => f.fix);
  const apply = (fs: Finding[]) => update((d) => fs.forEach((f) => f.fix?.(d, page.id)));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3">
      <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
        <p className="text-[13px] font-semibold">{findings.length ? `${findings.length} suggestion${findings.length === 1 ? "" : "s"} for “${page.title}”` : "This page looks great"}</p>
        <p className="mt-0.5 text-xs text-muted">Checks hierarchy, rhythm, conversion, restraint, readability, mobile and imagery. Rule-based, explained, never a made-up score.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {fixable.length > 1 && !readOnly && (
            <Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} onClick={() => apply(fixable)}>
              Fix all {fixable.length}
            </Button>
          )}
          <Button size="sm" onClick={onAskAi}>Ask AI for a critique</Button>
        </div>
      </div>
      {findings.map((f) => (
        <div key={f.id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
          <div className="flex items-center gap-2">
            <Badge tone={SEV[f.severity]}>{f.area}</Badge>
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.title}</p>
          </div>
          <p className="mt-1.5 text-xs text-muted">{f.detail}</p>
          <div className="mt-2 flex gap-2">
            {f.fix && !readOnly && <Button size="sm" onClick={() => apply([f])}>{f.fixLabel}</Button>}
            {f.sectionId && <Button size="sm" variant="ghost" onClick={() => onLocate(f.sectionId!)}>Show</Button>}
          </div>
        </div>
      ))}
    </div>
  );
}
