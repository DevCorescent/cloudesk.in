"use client";

// Catalogues: shareable, printable selections of the store's products that
// stay in sync with them and take orders. List, editor with a live preview,
// and a share sheet (link, QR, WhatsApp, email, SMS, PDF, social, text).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BookOpen, Check, Code2, Copy, Download, Eye, ExternalLink, FileText, Layers, Link2, Lock, Mail, MessageCircle, MessageSquare, Monitor, MoreHorizontal, Plus, QrCode, RefreshCw, Search, Share2, ShoppingBag, Smartphone, Sparkles, Tag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, Dialog, Menu, Segmented, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, cx, ErrorState, Field, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { qrSvg } from "@/lib/store/barcode";
import { CATALOGUE_TEMPLATES, type CatalogueDesign, type CatalogueOrdering, type CatalogueSource } from "@/lib/store/catalogue";
import { MoneyInput, storeApi, SubHeader, useMoney, useStoreCtx, useStoreQuery } from "./shared";

type Catalogue = {
  id: string;
  title: string;
  token: string;
  url: string;
  source: CatalogueSource;
  design: CatalogueDesign;
  ordering: CatalogueOrdering;
  published: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  hasAccessCode: boolean;
  allowEmbed: boolean;
  origin: "manual" | "import";
  views: number;
  orderClicks: number;
  shares: Record<string, number>;
  createdAt: string;
  updatedAt: string;
};
type ListItem = Catalogue & { productCount: number; images: string[]; views30: number; orders30: number };
type Readiness = { base: string | null; ready: boolean; reason: string | null };
type Product = { id: string; title: string; status: "draft" | "active" | "archived"; images: string[]; tags: string[]; collectionIds: string[]; isSample: boolean; variants: { price: number }[] };
type Collection = { id: string; title: string; productCount: number };

const ended = (c: Catalogue) => !!c.expiresAt && Date.parse(c.expiresAt) < Date.now();
const scheduled = (c: Pick<Catalogue, "startsAt">) => !!c.startsAt && Date.parse(c.startsAt) > Date.now();
const status = (c: Pick<Catalogue, "published" | "startsAt" | "expiresAt">) =>
  !c.published ? { label: "Hidden", tone: "neutral" as const } : ended(c as Catalogue) ? { label: "Ended", tone: "warning" as const } : scheduled(c) ? { label: "Scheduled", tone: "accent" as const } : { label: "Live", tone: "success" as const };
const totalShares = (c: Catalogue) => Object.values(c.shares ?? {}).reduce((a, b) => a + b, 0);

// ─── List ────────────────────────────────────────────────────────────────────

export function CataloguesView() {
  const { base, projectId } = useStoreCtx();
  const q = useStoreQuery<{ catalogues: ListItem[]; checkout: Readiness }>("catalogues");
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState<ListItem | null>(null);
  const [deleting, setDeleting] = useState<ListItem | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const refresh = () => qc.invalidateQueries({ queryKey: ["store", projectId] });
  const dup = useMutation({ mutationFn: (id: string) => api<{ catalogue: Catalogue }>(storeApi(projectId, `catalogues/${id}/duplicate`), { method: "POST" }), onSuccess: (r) => { refresh(); router.push(`${base}/catalogues/${r.catalogue.id}`); }, onError: (e) => toast({ tone: "error", title: "Couldn't duplicate", description: errorMessage(e) }) });
  const del = useMutation({ mutationFn: (id: string) => api(storeApi(projectId, `catalogues/${id}`), { method: "DELETE" }), onSuccess: () => { refresh(); setDeleting(null); toast({ tone: "success", title: "Catalogue deleted", description: "Its link no longer works." }); }, onError: (e) => toast({ tone: "error", title: "Couldn't delete", description: errorMessage(e) }) });

  const list = q.data?.catalogues ?? [];
  return (
    <div>
      <SubHeader
        title="Catalogues"
        description="Beautiful product catalogues that stay in sync with your products. Share them as a link, QR code or PDF — and take orders straight from them."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New catalogue
          </Button>
        }
      />
      {q.isError ? (
        <ErrorState title="Couldn't load catalogues" message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-[22px]" />)}</div>
      ) : !list.length ? (
        <CatalogueIntro onCreate={() => setCreating(true)} />
      ) : (
        <>
        <dl className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Catalogues", list.length, `${list.filter((c) => status(c).label === "Live").length} live`],
            ["Views", list.reduce((a, c) => a + c.views30, 0), "last 30 days"],
            ["Orders started", list.reduce((a, c) => a + c.orders30, 0), "last 30 days"],
            ["Shares", list.reduce((a, c) => a + totalShares(c), 0), "all time"],
          ].map(([k, v, sub]) => (
            <div key={k} className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
              <dt className="text-[12px] font-medium text-muted">{k}</dt>
              <dd className="mt-1 text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{Number(v).toLocaleString("en-IN")}</dd>
              <p className="mt-1.5 text-[11.5px] text-subtle">{sub}</p>
            </div>
          ))}
        </dl>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const st = status(c);
            return (
              <li key={c.id} className="group overflow-hidden rounded-[22px] border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
                <Link href={`${base}/catalogues/${c.id}`} className="block">
                  <Collage images={c.images} title={c.title} template={c.design.template} accent={c.design.accent} />
                </Link>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`${base}/catalogues/${c.id}`} className="block truncate text-[15px] font-semibold hover:underline">
                        {c.title}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {c.productCount} product{c.productCount === 1 ? "" : "s"}
                        {c.hasAccessCode && (
                          <Badge>
                            <Lock className="size-3" /> Private
                          </Badge>
                        )}
                        {c.origin === "import" && <Badge tone="accent">From import</Badge>}
                      </p>
                    </div>
                    <Menu
                      label={`More for ${c.title}`}
                      trigger={(p) => <button {...p} aria-label={`More for ${c.title}`} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><MoreHorizontal className="size-4" /></button>}
                      items={[
                        { label: "Open public page", icon: <ExternalLink className="size-4" />, onSelect: () => window.open(c.url, "_blank", "noopener") },
                        { label: "Duplicate", icon: <Copy className="size-4" />, onSelect: () => dup.mutate(c.id) },
                        "separator",
                        { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDeleting(c) },
                      ]}
                    />
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {[
                      ["Views · 30d", c.views30],
                      ["Orders · 30d", c.orders30],
                      ["Shares", totalShares(c)],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-[12px] bg-surface-2 py-2">
                        <dt className="text-[11px] text-muted">{k}</dt>
                        <dd className="text-[15px] font-semibold tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 flex gap-2">
                    <Button className="flex-1" variant="primary" size="sm" icon={<Share2 className="size-3.5" />} onClick={() => setSharing(c)}>
                      Share
                    </Button>
                    <ButtonLink className="flex-1" size="sm" href={`${base}/catalogues/${c.id}`}>
                      Customise
                    </ButtonLink>
                  </div>
                  <p className="mt-2.5 text-[11.5px] text-subtle">Updated {timeAgo(c.updatedAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
        </>
      )}
      <NewCatalogueDialog open={creating} onClose={() => setCreating(false)} />
      {sharing && <ShareDialog catalogue={sharing} onClose={() => setSharing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.id)} loading={del.isPending} destructive title={`Delete “${deleting?.title ?? ""}”?`} description="Its link and QR code stop working. Your products aren't affected." confirmLabel="Delete catalogue" />
    </div>
  );
}

function CatalogueIntro({ onCreate }: { onCreate: () => void }) {
  const points: [ReactNode, string, string][] = [
    [<RefreshCw key="a" className="size-4" />, "Always up to date", "Prices, stock and photos come live from your products — change a product and every catalogue follows."],
    [<ShoppingBag key="b" className="size-4" />, "Takes orders", "Customers pick quantities and check out, or send you the order on WhatsApp."],
    [<Share2 key="c" className="size-4" />, "Share anywhere", "A short link, QR code, print-ready PDF, WhatsApp, email, SMS and social."],
  ];
  return (
    <div className="overflow-hidden rounded-[26px] border border-border bg-surface shadow-sm">
      <div className="grid grid-cols-1 items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[12px] font-semibold text-accent">
            <Sparkles className="size-3.5" /> New
          </span>
          <h2 className="mt-4 text-[clamp(1.5rem,3vw,2.1rem)] leading-[1.1] font-semibold tracking-[-0.03em]">Your products, as a catalogue people can order from.</h2>
          <p className="mt-3 max-w-lg text-[14.5px] text-muted">Pick products by collection, tag or by hand — or import a spreadsheet and get a catalogue automatically. Choose a look, then share it.</p>
          <ul className="mt-6 grid gap-3">
            {points.map(([icon, t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">{icon}</span>
                <span className="text-[13.5px]">
                  <b className="font-semibold">{t}.</b> <span className="text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ul>
          <Button className="mt-7" variant="primary" icon={<Plus className="size-4" />} onClick={onCreate}>
            Create your first catalogue
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3" aria-hidden>
          {CATALOGUE_TEMPLATES.map((t) => (
            <TemplateSwatch key={t.id} id={t.id} name={t.name} />
          ))}
        </div>
      </div>
    </div>
  );
}

const SWATCH: Record<string, { bg: string; ink: string; card: string; serif?: boolean }> = {
  studio: { bg: "#ffffff", ink: "#111114", card: "#f1f1f4" },
  editorial: { bg: "#f6f1ea", ink: "#1f1a17", card: "#e8dfd3", serif: true },
  noir: { bg: "#0d0d10", ink: "#f4f1ea", card: "#22222a", serif: true },
  pricelist: { bg: "#f4f4f6", ink: "#111114", card: "#ffffff" },
};

function TemplateSwatch({ id, name, active }: { id: string; name: string; active?: boolean }) {
  const s = SWATCH[id];
  return (
    <div className={cx("overflow-hidden rounded-[16px] border p-3 transition-all", active ? "border-fg ring-2 ring-fg" : "border-border")} style={{ background: s.bg, color: s.ink }}>
      <div className="text-[13px] font-semibold" style={{ fontFamily: s.serif ? "Georgia, serif" : undefined }}>{name}</div>
      {id === "pricelist" ? (
        <div className="mt-2 grid gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-[6px] p-1" style={{ background: s.card }}>
              <span className="size-4 rounded-[4px]" style={{ background: s.ink, opacity: 0.15 }} />
              <span className="h-1.5 flex-1 rounded-full" style={{ background: s.ink, opacity: 0.2 }} />
              <span className="h-1.5 w-5 rounded-full" style={{ background: s.ink, opacity: 0.35 }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="aspect-[4/5] rounded-[6px]" style={{ background: s.card }} />
              <div className="mt-1 h-1 w-3/4 rounded-full" style={{ background: s.ink, opacity: 0.25 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Collage({ images, title, template, accent }: { images: string[]; title: string; template: string; accent: string }) {
  const s = SWATCH[template] ?? SWATCH.studio;
  return (
    <div className="relative aspect-[16/10] overflow-hidden" style={{ background: s.bg }}>
      {images.length ? (
        <div className="absolute inset-0 grid grid-cols-[1.3fr_1fr] grid-rows-2 gap-0.5">
          {images.slice(0, 3).map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src + i} src={src} alt="" className={cx("size-full object-cover transition-transform duration-700 group-hover:scale-[1.04]", i === 0 && "row-span-2")} />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted">
          <BookOpen className="size-8 opacity-40" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
      <div className="absolute inset-x-4 bottom-3 text-white">
        <span className="mb-1.5 block h-1 w-8 rounded-full" style={{ background: accent }} />
        <p className="line-clamp-2 text-[17px] leading-tight font-semibold tracking-[-0.02em]">{title}</p>
      </div>
    </div>
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────

function NewCatalogueDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { base, projectId, store } = useStoreCtx();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const collections = useStoreQuery<{ collections: Collection[] }>("collections", { enabled: open });
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<CatalogueSource["mode"]>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [template, setTemplate] = useState<CatalogueDesign["template"]>("studio");
  const create = useMutation({
    mutationFn: () =>
      api<{ catalogue: Catalogue }>(storeApi(projectId, "catalogues"), {
        method: "POST",
        body: { title: title.trim() || "New catalogue", source: { mode, collectionIds: mode === "collections" ? picked : [] }, design: { template, contactEmail: store?.email ?? "", contactPhone: store?.phone ?? "" }, ordering: { whatsapp: store?.phone ?? "" } },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      onClose();
      router.push(`${base}/catalogues/${r.catalogue.id}`);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't create the catalogue", description: errorMessage(e) }),
  });
  const modes: { v: CatalogueSource["mode"]; t: string; d: string; icon: ReactNode }[] = [
    { v: "all", t: "All products", d: "New products join automatically", icon: <Layers className="size-4" /> },
    { v: "collections", t: "Collections", d: "One or more collections", icon: <BookOpen className="size-4" /> },
    { v: "tags", t: "Tags", d: "Products with certain tags", icon: <Tag className="size-4" /> },
    { v: "manual", t: "Hand-pick", d: "Choose products one by one", icon: <Check className="size-4" /> },
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="New catalogue"
      description="You can change everything afterwards."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={mode === "collections" && !picked.length} onClick={() => create.mutate()}>
            Create catalogue
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label="Name">{(a) => <Input {...a} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Festive collection 2026" maxLength={120} />}</Field>
        <div>
          <p className="mb-2 text-[13px] font-medium">What goes in it</p>
          <div className="grid grid-cols-2 gap-2">
            {modes.map((m) => (
              <button key={m.v} type="button" onClick={() => setMode(m.v)} aria-pressed={mode === m.v} className={cx("flex gap-3 rounded-[14px] border p-3 text-left transition-colors", mode === m.v ? "border-fg bg-surface-2" : "border-border hover:bg-surface-2")}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3">{m.icon}</span>
                <span>
                  <span className="block text-[13.5px] font-semibold">{m.t}</span>
                  <span className="block text-[12px] text-muted">{m.d}</span>
                </span>
              </button>
            ))}
          </div>
          {mode === "collections" && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(collections.data?.collections ?? []).map((c) => (
                <Chip key={c.id} on={picked.includes(c.id)} onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>
                  {c.title} <span className="opacity-60">{c.productCount}</span>
                </Chip>
              ))}
              {collections.data && !collections.data.collections.length && <p className="text-[12.5px] text-muted">No collections yet — create some under Collections, or pick another option.</p>}
            </div>
          )}
          {(mode === "tags" || mode === "manual") && <p className="mt-2 text-[12.5px] text-muted">You&apos;ll choose {mode === "tags" ? "the tags" : "the products"} in the editor next.</p>}
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Look</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CATALOGUE_TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => setTemplate(t.id)} aria-pressed={template === t.id} aria-label={`${t.name}: ${t.blurb}`} className="text-left">
                <TemplateSwatch id={t.id} name={t.name} active={template === t.id} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors", on ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
      {on && <Check className="size-3.5" />}
      {children}
    </button>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

type Draft = Pick<Catalogue, "title" | "source" | "design" | "ordering" | "published" | "startsAt" | "expiresAt" | "allowEmbed"> & { accessCode: string | null };
type Insights = { series: { day: string; views: number; orders: number }[]; sources: { source: string; views: number; orders: number }[]; topProducts: { id: string; title: string; qty: number }[] };
type Detail = { catalogue: Catalogue; productCount: number; sections: { title: string; count: number }[]; items: { title: string; price: number; soldOut: boolean }[]; waiting: number; checkout: Readiness; insights: Insights };

export function CatalogueEditor({ id }: { id: string }) {
  const { base, projectId } = useStoreCtx();
  const q = useStoreQuery<Detail>(`catalogues/${id}`);
  if (q.isError) return <ErrorState title="Couldn't load this catalogue" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  return <EditorBody key={q.data.catalogue.id} detail={q.data} base={base} projectId={projectId} />;
}

function EditorBody({ detail, base, projectId }: { detail: Detail; base: string; projectId: string }) {
  const c = detail.catalogue;
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({ title: c.title, source: c.source, design: c.design, ordering: c.ordering, published: c.published, startsAt: c.startsAt, expiresAt: c.expiresAt, allowEmbed: c.allowEmbed, accessCode: null });
  const [tab, setTab] = useState<"products" | "design" | "ordering" | "access" | "insights">("products");
  const skip = useRef(false);
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [rev, setRev] = useState(0);
  const [saved, setSaved] = useState<"saved" | "saving" | "dirty">("saved");
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const first = useRef(true);
  const frame = useRef<HTMLIFrameElement>(null);

  const save = useMutation({
    mutationFn: (d: Draft) => api<{ catalogue: Catalogue }>(storeApi(projectId, `catalogues/${c.id}`), { method: "PUT", body: d }),
    onSuccess: (_r, sent) => {
      setSaved("saved");
      setRev((r) => r + 1);
      qc.invalidateQueries({ queryKey: ["store", projectId, `catalogues/${c.id}`] });
      // A new access code is sent once; after that, "keep the current code".
      if (sent.accessCode !== null) {
        skip.current = true;
        setDraft((d) => ({ ...d, accessCode: null }));
        toast({ tone: "success", title: sent.accessCode ? "Access code set" : "Access code removed", description: sent.accessCode ? "Buyers now need the code to open this catalogue." : "Anyone with the link can open it." });
      }
    },
    onError: (e) => {
      setSaved("dirty");
      toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) });
    },
  });
  // Changes save themselves a moment after you stop editing; the preview follows.
  useEffect(() => {
    if (first.current || skip.current) {
      first.current = false;
      skip.current = false;
      return;
    }
    setSaved("dirty");
    const t = setTimeout(() => {
      setSaved("saving");
      save.mutate(draft);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSource = (p: Partial<CatalogueSource>) => setDraft((d) => ({ ...d, source: { ...d.source, ...p } }));
  const setDesign = (p: Partial<CatalogueDesign>) => setDraft((d) => ({ ...d, design: { ...d.design, ...p } }));
  const setOrdering = (p: Partial<CatalogueOrdering>) => setDraft((d) => ({ ...d, ordering: { ...d.ordering, ...p } }));

  const del = useMutation({ mutationFn: () => api(storeApi(projectId, `catalogues/${c.id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["store", projectId] }); router.push(`${base}/catalogues`); } });
  const rotate = useMutation({ mutationFn: () => api(storeApi(projectId, `catalogues/${c.id}/rotate`), { method: "POST" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["store", projectId] }); toast({ tone: "success", title: "New link created", description: "The old link and QR code no longer work." }); } });
  const st = status({ published: draft.published, startsAt: draft.startsAt, expiresAt: draft.expiresAt });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`${base}/catalogues`} className="text-[13px] text-muted hover:text-fg">
            ← Catalogues
          </Link>
          <Badge tone={st.tone}>{st.label}</Badge>
          <span className="text-[12px] text-subtle" aria-live="polite">
            {saved === "saving" ? "Saving…" : saved === "dirty" ? "Unsaved changes" : "All changes saved"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink size="sm" href={c.url} external icon={<Eye className="size-3.5" />}>
            Open
          </ButtonLink>
          <Button size="sm" variant="primary" icon={<Share2 className="size-3.5" />} onClick={() => setSharing(true)}>
            Share
          </Button>
        </div>
      </div>
      <input aria-label="Catalogue name" value={draft.title} onChange={(e) => set("title", e.target.value.slice(0, 120))} className="mb-5 w-full bg-transparent text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.03em] outline-none placeholder:text-subtle" placeholder="Catalogue name" />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="min-w-0 rounded-[22px] border border-border bg-surface p-4 shadow-sm sm:p-5">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "products", label: "Products" },
              { value: "design", label: "Design" },
              { value: "ordering", label: "Orders" },
              { value: "access", label: "Access" },
              { value: "insights", label: "Insights" },
            ]}
          />
          <div className="mt-5">
            {tab === "products" && <ProductsTab source={draft.source} set={setSource} detail={detail} />}
            {tab === "design" && <DesignTab design={draft.design} set={setDesign} />}
            {tab === "ordering" && <OrderingTab ordering={draft.ordering} set={setOrdering} readiness={detail.checkout} />}
            {tab === "access" && <AccessTab draft={draft} set={set} catalogue={c} onRotate={() => rotate.mutate()} rotating={rotate.isPending} onDelete={() => setDeleting(true)} />}
            {tab === "insights" && <InsightsTab detail={detail} />}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted">
              <b className="font-semibold text-fg">{detail.productCount}</b> product{detail.productCount === 1 ? "" : "s"} · live preview
            </p>
            <div className="flex items-center gap-2">
              <Segmented
                label="Preview size"
                value={device}
                onChange={setDevice}
                options={[
                  { value: "desktop", label: <Monitor className="size-3.5" />, title: "Desktop" },
                  { value: "phone", label: <Smartphone className="size-3.5" />, title: "Phone" },
                ]}
              />
              <Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => frame.current?.contentWindow?.print()}>
                PDF
              </Button>
            </div>
          </div>
          <div className={cx("mx-auto overflow-hidden rounded-[22px] border border-border bg-surface-2 shadow-sm transition-[max-width] duration-500", device === "phone" ? "max-w-[400px]" : "max-w-none")}>
            <iframe ref={frame} key={rev} title="Catalogue preview" src={`/c/${c.token}?preview=1&v=${rev}`} className="block h-[78vh] w-full bg-white" />
          </div>
        </div>
      </div>
      {sharing && <ShareDialog catalogue={{ ...c, title: draft.title }} onClose={() => setSharing(false)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title={`Delete “${draft.title}”?`} description="Its link and QR code stop working. Your products aren't affected." confirmLabel="Delete catalogue" />
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[13.5px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function ProductsTab({ source, set, detail }: { source: CatalogueSource; set: (p: Partial<CatalogueSource>) => void; detail: Detail }) {
  const products = useStoreQuery<{ products: Product[] }>("products");
  const collections = useStoreQuery<{ collections: Collection[] }>("collections");
  const money = useMoney();
  const [q, setQ] = useState("");
  const all = useMemo(() => (products.data?.products ?? []).filter((p) => !p.isSample && p.status !== "archived"), [products.data]);
  const tags = useMemo(() => [...new Set(all.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b)), [all]);
  const shown = all.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()));
  const picked = source.mode === "manual";
  const toggle = (id: string) => {
    if (picked) set({ productIds: source.productIds.includes(id) ? source.productIds.filter((x) => x !== id) : [...source.productIds, id] });
    else set({ excludeIds: source.excludeIds.includes(id) ? source.excludeIds.filter((x) => x !== id) : [...source.excludeIds, id] });
  };
  const move = (id: string, by: number) => {
    const list = [...source.productIds];
    const i = list.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ productIds: list, sort: "manual" });
  };
  const inCatalogue = (p: Product) => (picked ? source.productIds.includes(p.id) : !source.excludeIds.includes(p.id) && (source.mode === "all" || (source.mode === "collections" && p.collectionIds.some((c) => source.collectionIds.includes(c))) || (source.mode === "tags" && p.tags.some((t) => source.tags.includes(t)))));
  const ordered = picked ? [...source.productIds.map((id) => shown.find((p) => p.id === id)).filter(Boolean) as Product[], ...shown.filter((p) => !source.productIds.includes(p.id))] : shown;

  return (
    <div className="grid gap-5">
      <Notice tone="accent" title="Always in sync">
        Prices, stock and photos come live from your products. {source.mode === "all" ? "New products appear automatically." : "Edit a product and this catalogue updates instantly."}
      </Notice>
      {detail.waiting > 0 && <Notice tone="warning">{detail.waiting} chosen product{detail.waiting === 1 ? " is a draft" : "s are drafts"} and will appear once {detail.waiting === 1 ? "it's" : "they're"} active.</Notice>}
      <Field label="Show">
        {(a) => (
          <Select {...a} value={source.mode} onChange={(e) => set({ mode: e.target.value as CatalogueSource["mode"], sort: e.target.value === "manual" ? "manual" : source.sort === "manual" ? "featured" : source.sort })}>
            <option value="all">All products</option>
            <option value="collections">Products in collections…</option>
            <option value="tags">Products with tags…</option>
            <option value="manual">Hand-picked products</option>
          </Select>
        )}
      </Field>
      {source.mode === "collections" && (
        <div className="flex flex-wrap gap-1.5">
          {(collections.data?.collections ?? []).map((c) => (
            <Chip key={c.id} on={source.collectionIds.includes(c.id)} onClick={() => set({ collectionIds: source.collectionIds.includes(c.id) ? source.collectionIds.filter((x) => x !== c.id) : [...source.collectionIds, c.id] })}>
              {c.title}
            </Chip>
          ))}
        </div>
      )}
      {source.mode === "tags" && (
        <div className="flex flex-wrap gap-1.5">
          {tags.length ? tags.map((t) => <Chip key={t} on={source.tags.includes(t)} onClick={() => set({ tags: source.tags.includes(t) ? source.tags.filter((x) => x !== t) : [...source.tags, t].slice(0, 30) })}>{t}</Chip>) : <p className="text-[12.5px] text-muted">Your products don&apos;t have tags yet.</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order">
          {(a) => (
            <Select {...a} value={source.sort} onChange={(e) => set({ sort: e.target.value as CatalogueSource["sort"] })}>
              {picked && <option value="manual">As arranged</option>}
              <option value="featured">Featured first</option>
              <option value="newest">Newest first</option>
              <option value="title">A–Z</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </Select>
          )}
        </Field>
        <div className="grid gap-2 pt-6">
          <Switch checked={source.groupByCollection} onChange={(v) => set({ groupByCollection: v })} label="Sections by collection" />
        </div>
      </div>
      <Row label="Hide sold-out products" hint="They come back by themselves when restocked.">
        <Switch checked={source.hideSoldOut} onChange={(v) => set({ hideSoldOut: v })} label="Hide sold-out products" />
      </Row>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-medium">{picked ? "Choose and arrange products" : "Leave products out"}</p>
          <span className="text-[12px] text-muted">{detail.productCount} shown</span>
        </div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
          <Input aria-label="Search products" className="!pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" />
        </div>
        <ul className="max-h-[44vh] divide-y divide-border overflow-y-auto rounded-[14px] border border-border">
          {products.isLoading && <li className="p-3"><Skeleton className="h-10" /></li>}
          {ordered.map((p) => {
            const on = inCatalogue(p);
            const at = source.productIds.indexOf(p.id);
            return (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={on} disabled={!picked && !on && source.excludeIds.indexOf(p.id) < 0} onChange={() => toggle(p.id)} aria-label={`${on ? "Remove" : "Add"} ${p.title}`} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.images[0] ? <img src={p.images[0]} alt="" className="size-9 rounded-[8px] object-cover" /> : <span className="size-9 rounded-[8px] bg-surface-2" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.title}</span>
                  <span className="text-[11.5px] text-muted">
                    {p.variants[0] ? money(Math.min(...p.variants.map((v) => v.price))) : "—"}
                    {p.status === "draft" && " · draft"}
                  </span>
                </span>
                {picked && at >= 0 && (
                  <span className="flex">
                    <button type="button" className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30" onClick={() => move(p.id, -1)} disabled={at === 0} aria-label={`Move ${p.title} up`}>
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30" onClick={() => move(p.id, 1)} disabled={at === source.productIds.length - 1} aria-label={`Move ${p.title} down`}>
                      <ArrowDown className="size-3.5" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
          {products.data && !ordered.length && <li className="p-4 text-center text-[12.5px] text-muted">No products match.</li>}
        </ul>
      </div>
    </div>
  );
}

const ACCENTS = ["#1d1d1f", "#b4532a", "#2f6b4f", "#2d4fa3", "#8a3ffc", "#c2185b", "#c9a227"];

function DesignTab({ design: d, set }: { design: CatalogueDesign; set: (p: Partial<CatalogueDesign>) => void }) {
  const products = useStoreQuery<{ products: Product[] }>("products");
  const photos = useMemo(() => [...new Set((products.data?.products ?? []).filter((p) => p.status === "active").flatMap((p) => p.images.slice(0, 1)))].slice(0, 12), [products.data]);
  const toggles: [keyof CatalogueDesign, string][] = [
    ["showPrice", "Prices"],
    ["showCompareAt", "MRP and % off"],
    ["showStock", "“Only a few left” alerts"],
    ["showVariants", "Sizes and options"],
    ["showDescription", "Descriptions"],
    ["showSku", "SKU codes"],
    ["showQr", "QR code to order online (PDF)"],
  ];
  return (
    <div className="grid gap-5">
      <div>
        <p className="mb-2 text-[13px] font-medium">Look</p>
        <div className="grid grid-cols-2 gap-2">
          {CATALOGUE_TEMPLATES.map((t) => (
            <button key={t.id} type="button" onClick={() => set({ template: t.id })} aria-pressed={d.template === t.id} aria-label={`${t.name}: ${t.blurb}`} className="text-left">
              <TemplateSwatch id={t.id} name={t.name} active={d.template === t.id} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium">Accent colour</p>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENTS.map((a) => (
            <button key={a} type="button" onClick={() => set({ accent: a })} aria-label={`Accent ${a}`} aria-pressed={d.accent === a} className={cx("size-8 rounded-full ring-offset-2 ring-offset-surface transition-shadow", d.accent === a && "ring-2 ring-fg")} style={{ background: a }} />
          ))}
          <label className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full border border-border text-[10px] font-semibold text-muted" title="Custom colour">
            <input type="color" value={d.accent} onChange={(e) => set({ accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom accent colour" />+
          </label>
        </div>
      </div>
      {d.template !== "pricelist" && (
        <Field label="Products per row">
          {() => <Segmented label="Products per row" value={String(d.columns) as "2" | "3" | "4"} onChange={(v) => set({ columns: Number(v) as 2 | 3 | 4 })} options={[{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }]} />}
        </Field>
      )}
      <Field label="Subtitle">{(a) => <Input {...a} value={d.subtitle} maxLength={160} onChange={(e) => set({ subtitle: e.target.value })} placeholder="Handmade in small batches, delivered across India" />}</Field>
      <Field label="Introduction">{(a) => <Textarea {...a} rows={3} value={d.intro} maxLength={600} onChange={(e) => set({ intro: e.target.value })} placeholder="A few words about this collection" />}</Field>
      <div>
        <p className="mb-2 text-[13px] font-medium">Cover</p>
        <div className="grid grid-cols-6 gap-1.5">
          <button type="button" onClick={() => set({ coverImage: "" })} aria-pressed={!d.coverImage} className={cx("grid aspect-square place-items-center rounded-[10px] border text-[10.5px] font-medium", !d.coverImage ? "border-fg ring-2 ring-fg" : "border-border")}>
            Auto
          </button>
          {photos.map((src) => (
            <button key={src} type="button" onClick={() => set({ coverImage: src })} aria-pressed={d.coverImage === src} aria-label="Use this photo as the cover" className={cx("overflow-hidden rounded-[10px] border", d.coverImage === src ? "border-fg ring-2 ring-fg" : "border-border")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
        <Input className="mt-2" aria-label="Cover image link" value={d.coverImage} onChange={(e) => set({ coverImage: e.target.value.trim() })} placeholder="…or paste an image link (https://)" />
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium">Show</p>
        <div className="grid gap-2.5">
          {toggles.map(([k, label]) => (
            <Row key={k} label={label}>
              <Switch checked={!!d[k]} onChange={(v) => set({ [k]: v } as Partial<CatalogueDesign>)} label={label} />
            </Row>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium">Cover</p>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["image", "Full photo"],
              ["split", "Photo beside"],
              ["minimal", "Type only"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" onClick={() => set({ coverStyle: v })} aria-pressed={d.coverStyle === v} className={cx("rounded-[14px] border p-2 text-left transition-colors", d.coverStyle === v ? "border-fg ring-2 ring-fg" : "border-border hover:bg-surface-2")}>
              <span className="relative block h-14 overflow-hidden rounded-[9px] bg-surface-3">
                {v === "image" && <span className="absolute inset-0 bg-gradient-to-br from-[#c7b8a3] to-[#6b5a48]" />}
                {v === "split" && <span className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-br from-[#c7b8a3] to-[#6b5a48]" />}
                {v === "minimal" && <span className="absolute inset-0" style={{ background: `radial-gradient(120% 140% at 0 0, ${d.accent}55, transparent 60%)` }} />}
                <span className={cx("absolute bottom-2 left-2 h-1.5 w-10 rounded-full", v === "image" ? "bg-white" : "bg-fg/70")} />
                <span className={cx("absolute bottom-5 left-2 h-2.5 w-14 rounded-full", v === "image" ? "bg-white" : "bg-fg")} />
              </span>
              <span className="mt-1.5 block text-[12px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <Field label="Typeface">
        {() => (
          <Segmented
            label="Typeface"
            value={d.font}
            onChange={(v) => set({ font: v })}
            options={[
              { value: "theme", label: "Look's own" },
              { value: "modern", label: <span style={{ fontFamily: "-apple-system, sans-serif" }}>Modern</span> },
              { value: "classic", label: <span style={{ fontFamily: "Didot, Georgia, serif" }}>Classic</span> },
              { value: "rounded", label: <span style={{ fontFamily: "ui-rounded, 'SF Pro Rounded', sans-serif" }}>Rounded</span> },
            ]}
          />
        )}
      </Field>
      <div className="grid gap-2.5 rounded-[16px] border border-border p-4">
        <p className="text-[13px] font-medium">Smart badges &amp; browsing</p>
        <Row label="“Bestseller” on top sellers" hint="Your 3 best-selling products of the last 90 days, from real orders.">
          <Switch checked={d.showBestseller} onChange={(v) => set({ showBestseller: v })} label="Bestseller badges" />
        </Row>
        <Row label="“New” on recent products" hint={`Added in the last ${d.newDays} days.`}>
          <Switch checked={d.showNew} onChange={(v) => set({ showNew: v })} label="New badges" />
        </Row>
        {d.showNew && (
          <Segmented label="New for" value={String(d.newDays) as "7" | "14" | "30" | "60"} onChange={(v) => set({ newDays: Number(v) })} options={[{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }, { value: "60", label: "60 days" }]} />
        )}
        <Row label="Search and section filters" hint="Shown to buyers when there are more than 6 products.">
          <Switch checked={d.showSearch} onChange={(v) => set({ showSearch: v })} label="Search and filters" />
        </Row>
      </div>
      <div className="grid gap-3">
        <p className="text-[13px] font-medium">Contact &amp; terms</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone / WhatsApp">{(a) => <Input {...a} value={d.contactPhone} maxLength={30} onChange={(e) => set({ contactPhone: e.target.value })} />}</Field>
          <Field label="Email">{(a) => <Input {...a} type="email" value={d.contactEmail} maxLength={120} onChange={(e) => set({ contactEmail: e.target.value })} />}</Field>
        </div>
        <Field label="Website">{(a) => <Input {...a} value={d.website} maxLength={200} onChange={(e) => set({ website: e.target.value })} placeholder="www.yourbrand.in" />}</Field>
        <Field label="Address">{(a) => <Input {...a} value={d.address} maxLength={300} onChange={(e) => set({ address: e.target.value })} />}</Field>
        <Field label="Terms" hint="Delivery times, minimum order, payment terms — shown at the end.">{(a) => <Textarea {...a} rows={3} value={d.terms} maxLength={600} onChange={(e) => set({ terms: e.target.value })} />}</Field>
      </div>
    </div>
  );
}

function OrderingTab({ ordering: o, set, readiness }: { ordering: CatalogueOrdering; set: (p: Partial<CatalogueOrdering>) => void; readiness: Readiness }) {
  const { base, store } = useStoreCtx();
  const discounts = useStoreQuery<{ discounts: { id: string; code: string; kind: string; value: number; active: boolean; endsAt: string | null }[] }>("discounts");
  const [now] = useState(() => Date.now());
  const live = (discounts.data?.discounts ?? []).filter((x) => x.active && (!x.endsAt || Date.parse(x.endsAt) > now));
  const currency = store?.currency ?? "INR";
  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-muted">Buyers choose quantities right in the catalogue, then order one of these ways.</p>
      <div className="rounded-[16px] border border-border p-4">
        <Row label="Checkout on your store" hint="Cart, payment, delivery and GST invoice — a real order in Orders.">
          <Switch checked={o.checkout && !o.priceOnRequest} onChange={(v) => set({ checkout: v })} label="Checkout on your store" disabled={o.priceOnRequest} />
        </Row>
        {o.checkout && !o.priceOnRequest && !readiness.ready && (
          <div className="mt-3">
            <Notice tone="warning" action={<ButtonLink size="sm" href={readiness.base ? `${base}/payments` : `${base.replace(/\/store$/, "")}/deployments`}>Fix it</ButtonLink>}>
              {readiness.reason} Until then, the checkout button is hidden.
            </Notice>
          </div>
        )}
      </div>
      <div className="rounded-[16px] border border-border p-4">
        <Row label="Order on WhatsApp" hint="Opens WhatsApp with the order written out — items, quantities and total.">
          <Switch checked={!!o.whatsapp} onChange={(v) => set({ whatsapp: v ? o.whatsapp || "+91 " : "" })} label="Order on WhatsApp" />
        </Row>
        {o.whatsapp !== "" && (
          <div className="mt-3 grid gap-3">
            <Field label="Your WhatsApp number" hint="With country code, e.g. +91 98765 43210.">
              {(a) => <Input {...a} value={o.whatsapp} inputMode="tel" maxLength={20} onChange={(e) => set({ whatsapp: e.target.value.replace(/[^\d+ ]/g, "") })} />}
            </Field>
            <Row label="Ask for the buyer's name and phone" hint="Added to the WhatsApp message, so you know who's ordering.">
              <Switch checked={o.askBuyer} onChange={(v) => set({ askBuyer: v })} label="Ask for buyer details" />
            </Row>
          </div>
        )}
      </div>
      <div className="grid gap-3 rounded-[16px] border border-border p-4">
        <p className="text-[13px] font-medium">Wholesale rules</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum order" hint="0 for none.">
            {(a) => <MoneyInput {...a} value={o.minOrder || null} onChange={(v) => set({ minOrder: v ?? 0 })} currency={currency} placeholder="0" />}
          </Field>
          <Field label="Minimum per item" hint="Wholesale MOQ.">
            {(a) => <Input {...a} type="number" min={1} max={99} value={o.moq} onChange={(e) => set({ moq: Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 1))) })} />}
          </Field>
        </div>
        <Row label="Prices on request" hint="Hide prices. Buyers pick items and ask for a quote on WhatsApp.">
          <Switch checked={o.priceOnRequest} onChange={(v) => set({ priceOnRequest: v, ...(v && !o.whatsapp ? { whatsapp: store?.phone || "+91 " } : {}) })} label="Prices on request" />
        </Row>
      </div>
      <div className="grid gap-2 rounded-[16px] border border-border p-4">
        <p className="text-[13px] font-medium">Offer code</p>
        <p className="text-[12px] text-muted">Shown on the catalogue and applied automatically at checkout. Only your live discount codes can be used.</p>
        <Select aria-label="Offer code" value={o.offerCode} onChange={(e) => set({ offerCode: e.target.value })}>
          <option value="">No offer</option>
          {live.map((x) => (
            <option key={x.id} value={x.code.toUpperCase()}>
              {x.code.toUpperCase()} · {x.kind === "percent" ? `${x.value}% off` : x.kind === "fixed" ? "amount off" : "free delivery"}
            </option>
          ))}
        </Select>
        {discounts.data && !live.length && <p className="text-[12px] text-muted">No live discount codes yet — create one under Discounts.</p>}
      </div>
      <Field label="Note above the order buttons (optional)">{(a) => <Input {...a} value={o.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} placeholder="Ships in 2 days · Free delivery over ₹999" />}</Field>
    </div>
  );
}

function AccessTab({ draft, set, catalogue: c, onRotate, rotating, onDelete }: { draft: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; catalogue: Catalogue; onRotate: () => void; rotating: boolean; onDelete: () => void }) {
  const [code, setCode] = useState("");
  const toast = useToast();
  const day = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");
  const embed = `<iframe src="${c.url}?via=embed" width="100%" height="900" style="border:0;border-radius:16px" loading="lazy" title="${c.title.replace(/"/g, "&quot;")}"></iframe>`;
  return (
    <div className="grid gap-4">
      <div className="rounded-[16px] border border-border p-4">
        <Row label="Visible to buyers" hint="When off, the link says the catalogue isn't available.">
          <Switch checked={draft.published} onChange={(v) => set("published", v)} label="Visible to buyers" />
        </Row>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Opens on" hint="Optional — schedule a launch.">
            {(a) => <Input {...a} type="date" value={day(draft.startsAt)} onChange={(e) => set("startsAt", e.target.value ? new Date(`${e.target.value}T00:00:00+05:30`).toISOString() : null)} />}
          </Field>
          <Field label="Ends on" hint="Optional — great for seasonal offers.">
            {(a) => <Input {...a} type="date" value={day(draft.expiresAt)} onChange={(e) => set("expiresAt", e.target.value ? new Date(`${e.target.value}T23:59:59+05:30`).toISOString() : null)} />}
          </Field>
        </div>
      </div>
      <div className="grid gap-3 rounded-[16px] border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[13.5px] font-medium">
              <Lock className="size-3.5" /> Private catalogue
            </p>
            <p className="mt-0.5 text-[12px] text-muted">Buyers enter an access code before they can see prices or order — ideal for wholesale and trade.</p>
          </div>
          <Badge tone={c.hasAccessCode ? "success" : "neutral"}>{c.hasAccessCode ? "Code on" : "Open"}</Badge>
        </div>
        <div className="flex gap-2">
          <Input aria-label="New access code" value={code} onChange={(e) => setCode(e.target.value.slice(0, 40))} placeholder={c.hasAccessCode ? "Type a new code to change it" : "e.g. TRADE2026"} />
          <Button
            disabled={code.trim().length < 4}
            onClick={() => {
              set("accessCode", code.trim());
              setCode("");
            }}
          >
            {c.hasAccessCode ? "Change" : "Set code"}
          </Button>
        </div>
        {c.hasAccessCode && (
          <Button className="justify-self-start" size="sm" variant="ghost" onClick={() => set("accessCode", "")}>
            Remove the code
          </Button>
        )}
        <p className="text-[11.5px] text-subtle">Codes are stored scrambled — we can&apos;t show them again, so note yours down. Changing it signs everyone out.</p>
      </div>
      <div className="grid gap-3 rounded-[16px] border border-border p-4">
        <Row label="Allow embedding on other websites" hint="Show this catalogue inside your blog, Linktree-style page or another site.">
          <Switch checked={draft.allowEmbed} onChange={(v) => set("allowEmbed", v)} label="Allow embedding" />
        </Row>
        {draft.allowEmbed && (
          <div className="grid gap-2">
            <pre className="overflow-x-auto rounded-[10px] bg-surface-2 p-3 font-mono text-[11.5px] whitespace-pre-wrap text-muted">{embed}</pre>
            <Button
              className="justify-self-start"
              size="sm"
              icon={<Code2 className="size-3.5" />}
              onClick={() => {
                void navigator.clipboard.writeText(embed);
                toast({ tone: "success", title: "Embed code copied" });
              }}
            >
              Copy embed code
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-2 rounded-[16px] bg-surface-2 p-4 text-[13px]">
        <p className="font-medium">Link</p>
        <p className="truncate font-mono text-[12px] text-muted">{c.url}</p>
        <Button className="justify-self-start" size="sm" icon={<RefreshCw className="size-3.5" />} loading={rotating} onClick={onRotate}>
          New link
        </Button>
        <p className="text-[12px] text-muted">Shared it too widely? A new link stops the old one, its QR codes and unlocked visitors.</p>
      </div>
      <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={onDelete}>
        Delete catalogue
      </Button>
    </div>
  );
}

const CHANNEL_NAMES: Record<string, string> = { direct: "Direct", link: "Copied link", whatsapp: "WhatsApp", qr: "QR code", email: "Email", sms: "SMS", pdf: "PDF", facebook: "Facebook", x: "X", linkedin: "LinkedIn", telegram: "Telegram", pinterest: "Pinterest", native: "Phone share", embed: "Embedded", text: "Text list" };

function InsightsTab({ detail }: { detail: Detail }) {
  const { series, sources, topProducts } = detail.insights;
  const views = series.reduce((a, d) => a + d.views, 0);
  const orders = series.reduce((a, d) => a + d.orders, 0);
  const max = Math.max(1, ...series.map((d) => d.views));
  const srcMax = Math.max(1, ...sources.map((x) => x.views));
  const label = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-3 gap-2">
        {[
          ["Views", views.toLocaleString("en-IN")],
          ["Orders started", orders.toLocaleString("en-IN")],
          ["Order rate", views ? `${((orders / views) * 100).toFixed(1)}%` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[14px] bg-surface-2 p-3">
            <dt className="text-[11.5px] text-muted">{k}</dt>
            <dd className="mt-0.5 text-[20px] font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[13px] font-medium">Last 14 days</p>
          <p className="flex items-center gap-3 text-[11.5px] text-muted">
            <span className="flex items-center gap-1">
              <i className="size-2 rounded-[2px] bg-accent/35" /> Views
            </span>
            <span className="flex items-center gap-1">
              <i className="size-2 rounded-[2px] bg-accent" /> Orders started
            </span>
          </p>
        </div>
        <div className="flex h-36 items-end gap-[3px] rounded-[14px] border border-border p-3" role="img" aria-label={`Views and orders started over the last 14 days: ${views} views, ${orders} orders started`}>
          {series.map((d) => (
            <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${label(d.day)}: ${d.views} views, ${d.orders} orders started`}>
              <div className="relative w-full rounded-t-[4px] bg-accent/35 transition-colors group-hover:bg-accent/50" style={{ height: `${(d.views / max) * 100}%`, minHeight: d.views ? 3 : 0 }}>
                {d.orders > 0 && <div className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-accent" style={{ height: `${Math.min(100, (d.orders / Math.max(1, d.views)) * 100)}%`, minHeight: 3 }} />}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10.5px] text-subtle">
          <span>{label(series[0].day)}</span>
          <span>Today</span>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium">Where views came from · 30 days</p>
        {sources.length ? (
          <ul className="grid gap-1.5">
            {sources.map((x) => (
              <li key={x.source} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-[12.5px]">
                <span className="truncate">{CHANNEL_NAMES[x.source] ?? x.source}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(x.views / srcMax) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums text-muted">
                  {x.views} · {x.orders} order{x.orders === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">No views yet. Share links from here are tagged, so you&apos;ll see which channels work best.</p>
        )}
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium">Most ordered from this catalogue</p>
        {topProducts.length ? (
          <ol className="grid gap-1.5 text-[13px]">
            {topProducts.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between rounded-[10px] bg-surface-2 px-3 py-2">
                <span className="truncate">
                  <b className="mr-2 text-muted tabular-nums">{i + 1}</b>
                  {p.title}
                </span>
                <span className="tabular-nums text-muted">{p.qty} units</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-muted">Nothing ordered yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Share ───────────────────────────────────────────────────────────────────

type ShareTab = "link" | "whatsapp" | "email" | "sms" | "pdf" | "embed" | "more";

export function ShareDialog({ catalogue: c, onClose }: { catalogue: Pick<Catalogue, "id" | "title" | "url" | "design" | "allowEmbed">; onClose: () => void }) {
  const { projectId, store } = useStoreCtx();
  const toast = useToast();
  const [tab, setTab] = useState<ShareTab>("link");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const name = store?.name ?? "our store";
  const [message, setMessage] = useState(`Hi! Here's our latest catalogue “${c.title}” from ${name}. You can see prices and order right from it:\n${c.url}`);
  // Every channel gets its own tagged link, so Insights can show what works.
  const at = (via: string) => `${c.url}?via=${via}`;
  const tagged = (text: string, via: string) => text.split(c.url).join(at(via));
  const qr = useMemo(() => qrSvg(`${c.url}?via=qr`, { margin: 2 }), [c.url]);
  const log = (via: string) => void api(storeApi(projectId, `catalogues/${c.id}/shared`), { method: "POST", body: { via } }).catch(() => {});
  const copy = async (text: string, what: string, via: string) => {
    await navigator.clipboard.writeText(text);
    toast({ tone: "success", title: `${what} copied` });
    log(via);
  };
  const open = (url: string, via: string) => {
    window.open(url, "_blank", "noopener");
    log(via);
  };
  const downloadQr = (kind: "svg" | "png") => {
    const blob = new Blob([qr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const save = (href: string, ext: string) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = `${c.title.replace(/[^\w-]+/g, "-").toLowerCase()}-qr.${ext}`;
      a.click();
    };
    if (kind === "svg") {
      save(url, "svg");
      log("qr");
      return;
    }
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1024;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1024, 1024);
      ctx.drawImage(img, 0, 0, 1024, 1024);
      save(cv.toDataURL("image/png"), "png");
      URL.revokeObjectURL(url);
      log("qr");
    };
    img.src = url;
  };
  const enc = encodeURIComponent;
  const social: { label: string; via: string; href: string; tone: string }[] = [
    { label: "Facebook", via: "facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(at("facebook"))}`, tone: "#1877f2" },
    { label: "X", via: "x", href: `https://x.com/intent/post?text=${enc(`${c.title} — ${name}`)}&url=${enc(at("x"))}`, tone: "#111" },
    { label: "LinkedIn", via: "linkedin", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(at("linkedin"))}`, tone: "#0a66c2" },
    { label: "Telegram", via: "telegram", href: `https://t.me/share/url?url=${enc(at("telegram"))}&text=${enc(c.title)}`, tone: "#229ed9" },
    { label: "Pinterest", via: "pinterest", href: `https://pinterest.com/pin/create/button/?url=${enc(at("pinterest"))}&description=${enc(c.title)}`, tone: "#e60023" },
  ];
  const digits = phone.replace(/\D/g, "");
  return (
    <Dialog open onClose={onClose} size="lg" title={`Share “${c.title}”`} description="Everyone sees today's prices and stock, and can order right from it.">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "link", label: <span className="inline-flex items-center gap-1.5"><Link2 className="size-3.5" /> Link &amp; QR</span> },
          { value: "whatsapp", label: <span className="inline-flex items-center gap-1.5"><MessageCircle className="size-3.5" /> WhatsApp</span> },
          { value: "email", label: <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" /> Email</span> },
          { value: "sms", label: <span className="inline-flex items-center gap-1.5"><MessageSquare className="size-3.5" /> SMS</span> },
          { value: "pdf", label: <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" /> PDF</span> },
          { value: "embed", label: <span className="inline-flex items-center gap-1.5"><Code2 className="size-3.5" /> Embed</span> },
          { value: "more", label: <span className="inline-flex items-center gap-1.5"><Share2 className="size-3.5" /> More</span> },
        ]}
      />
      <div className="mt-5 min-h-[260px]">
        {tab === "link" && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_180px]">
            <div className="grid content-start gap-3">
              <Field label="Catalogue link">{(a) => <Input {...a} readOnly value={c.url} className="font-mono text-[12.5px]" onFocus={(e) => e.target.select()} />}</Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<Copy className="size-4" />} onClick={() => copy(at("link"), "Link", "link")}>
                  Copy link
                </Button>
                <ButtonLink href={c.url} external icon={<ExternalLink className="size-4" />}>
                  Open
                </ButtonLink>
              </div>
              <p className="text-[12.5px] text-muted">Short, private link — catalogues aren&apos;t listed on search engines.</p>
            </div>
            <div className="text-center">
              <div className="rounded-[16px] border border-border bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="mt-2 flex justify-center gap-1.5">
                <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => downloadQr("png")}>
                  PNG
                </Button>
                <Button size="sm" icon={<QrCode className="size-3.5" />} onClick={() => downloadQr("svg")}>
                  SVG
                </Button>
              </div>
              <p className="mt-1.5 text-[11.5px] text-muted">Print it on bills, bags and counters.</p>
            </div>
          </div>
        )}
        {tab === "whatsapp" && (
          <div className="grid gap-3">
            <Field label="Customer's number (optional)" hint="Leave empty to choose a chat or group in WhatsApp.">{(a) => <Input {...a} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />}</Field>
            <Field label="Message">{(a) => <Textarea {...a} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
            <Button className="justify-self-start" variant="primary" icon={<MessageCircle className="size-4" />} onClick={() => open(`https://wa.me/${digits.length >= 10 ? (digits.length === 10 ? `91${digits}` : digits) : ""}?text=${enc(tagged(message, "whatsapp"))}`, "whatsapp")}>
              Open WhatsApp
            </Button>
          </div>
        )}
        {tab === "email" && (
          <div className="grid gap-3">
            <Field label="To (optional)">{(a) => <Input {...a} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" />}</Field>
            <Field label="Message">{(a) => <Textarea {...a} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
            <Button className="justify-self-start" variant="primary" icon={<Mail className="size-4" />} onClick={() => { window.location.href = `mailto:${email}?subject=${enc(`${c.title} — ${name}`)}&body=${enc(tagged(message, "email"))}`; log("email"); }}>
              Open email
            </Button>
          </div>
        )}
        {tab === "sms" && (
          <div className="grid gap-3">
            <Field label="Number (optional)">{(a) => <Input {...a} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
            <Field label="Message">{(a) => <Textarea {...a} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
            <Button className="justify-self-start" variant="primary" icon={<MessageSquare className="size-4" />} onClick={() => { window.location.href = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${enc(tagged(message, "sms"))}`; log("sms"); }}>
              Open messages
            </Button>
          </div>
        )}
        {tab === "pdf" && (
          <div className="grid gap-4">
            <div className="flex gap-4 rounded-[16px] bg-surface-2 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-surface text-fg">
                <FileText className="size-5" />
              </span>
              <div className="text-[13.5px]">
                <p className="font-semibold">A print-ready A4 brochure</p>
                <p className="mt-1 text-muted">Cover page, products laid out in your design, contact details and a QR code to order online. Choose “Save as PDF” in the print window to download it, then send it anywhere.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<Download className="size-4" />} onClick={() => open(`${c.url}?preview=1`, "pdf")}>
                Open and save as PDF
              </Button>
            </div>
            <p className="text-[12px] text-muted">On the catalogue page, press “PDF”. A PDF is a snapshot — the link always shows today&apos;s prices.</p>
          </div>
        )}
        {tab === "embed" && (
          <div className="grid gap-3">
            {c.allowEmbed ? (
              <>
                <p className="text-[13.5px] text-muted">Paste this into any website builder or blog to show the catalogue there — buyers can order without leaving the page.</p>
                <pre className="overflow-x-auto rounded-[12px] bg-surface-2 p-3 font-mono text-[11.5px] whitespace-pre-wrap text-muted">{`<iframe src="${at("embed")}" width="100%" height="900" style="border:0;border-radius:16px" loading="lazy" title="${c.title.replace(/"/g, "&quot;")}"></iframe>`}</pre>
                <Button className="justify-self-start" variant="primary" icon={<Copy className="size-4" />} onClick={() => copy(`<iframe src="${at("embed")}" width="100%" height="900" style="border:0;border-radius:16px" loading="lazy" title="${c.title.replace(/"/g, "&quot;")}"></iframe>`, "Embed code", "embed")}>
                  Copy embed code
                </Button>
              </>
            ) : (
              <Notice title="Embedding is off">Turn on “Allow embedding on other websites” in the catalogue&apos;s Access tab, then copy the code from here.</Notice>
            )}
          </div>
        )}
        {tab === "more" && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {social.map((s) => (
                <button key={s.via} type="button" onClick={() => open(s.href, s.via)} className="flex items-center gap-2.5 rounded-[14px] border border-border px-3 py-2.5 text-[13.5px] font-medium hover:bg-surface-2">
                  <span className="size-2.5 rounded-full" style={{ background: s.tone }} />
                  {s.label}
                </button>
              ))}
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button type="button" onClick={() => { void navigator.share({ title: c.title, text: tagged(message, "native"), url: at("native") }).then(() => log("native")).catch(() => {}); }} className="flex items-center gap-2.5 rounded-[14px] border border-border px-3 py-2.5 text-[13.5px] font-medium hover:bg-surface-2">
                  <Share2 className="size-3.5" /> Other apps…
                </button>
              )}
            </div>
            <TextList catalogueId={c.id} title={c.title} url={at("text")} onCopy={(t) => copy(t, "Product list", "text")} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** The catalogue as plain text — for broadcasts, notes or anywhere links aren't enough. */
function TextList({ catalogueId, title, url, onCopy }: { catalogueId: string; title: string; url: string; onCopy: (text: string) => void }) {
  const money = useMoney();
  const detail = useStoreQuery<Detail>(`catalogues/${catalogueId}`);
  const text = useMemo(() => {
    const list = detail.data?.items ?? [];
    return [`*${title}*`, "", ...list.slice(0, 60).map((p) => `• ${p.title} — ${money(p.price)}${p.soldOut ? " (sold out)" : ""}`), ...(list.length > 60 ? [`…and ${list.length - 60} more`] : []), "", `See photos and order: ${url}`].join("\n");
  }, [detail.data, title, url, money]);
  return (
    <div className="rounded-[16px] border border-border p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13.5px] font-semibold">Product list as text</p>
        <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => onCopy(text)}>
          Copy
        </Button>
      </div>
      <pre className="max-h-40 overflow-auto rounded-[10px] bg-surface-2 p-3 font-sans text-[12px] whitespace-pre-wrap text-muted">{text}</pre>
    </div>
  );
}
