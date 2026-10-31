"use client";

// Promotions: pop-ups, announcement bars, floating buttons and cart upsells.
// Start from a preset, edit with a live preview on the site's own home page,
// schedule it, and see views, clicks and sign-ups.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, CalendarClock, Copy, Eye, Gift, Megaphone, MessageCircle, MousePointerClick, PanelBottom, PanelTop, Pencil, Plus, RotateCcw, ShoppingCart, Smartphone, Monitor, SquareStack, Trash2, Truck, UserPlus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog, Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, cx, ErrorState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { useProject } from "@/lib/client/use-project";
import { CONFIG_SCHEMAS, KIND_LABEL, PRESETS, PROMO_CSS, promoStatus, renderPromotions, shippingGoalHtml, STORE_ONLY, type Preset, type PromoKind, type Promotion } from "@/lib/promotions/model";
import { renderPage } from "@/lib/site/render";
import { parseSiteDoc, SITE_DOC_PATH } from "@/lib/site/model";
import { formatPrice } from "@/lib/store/money";

type Stats = { views: number; clicks: number; submits: number };
type Promo = Promotion & { stats: Stats };
type Data = { promotions: Promo[]; store: { currency: string; freeOver: number | null; discounts: { code: string; active: boolean }[] } | null; published: boolean };
type Draft = Omit<Promotion, "id"> & { id?: string };
type Cfg = Record<string, unknown>;

const KIND_ICON: Record<PromoKind, ReactNode> = { bar: <PanelTop className="size-4" />, popup: <SquareStack className="size-4" />, floating: <MousePointerClick className="size-4" />, shipping_goal: <Truck className="size-4" />, cart_upsell: <ShoppingCart className="size-4" /> };
const PRESET_ICON: Record<string, ReactNode> = { welcome: <UserPlus />, exit: <BadgePercent />, newsletter: <PanelBottom />, flash: <CalendarClock />, freeship: <Megaphone />, festive: <Gift />, tab: <MousePointerClick />, whatsapp: <MessageCircle />, goal: <Truck />, upsell: <ShoppingCart /> };
const TINT: Record<PromoKind, string> = { bar: "sky", popup: "lavender", floating: "peach", shipping_goal: "mint", cart_upsell: "butter" };
const STATUS: Record<ReturnType<typeof promoStatus>, { label: string; tone: "success" | "neutral" | "warning" }> = { live: { label: "Live", tone: "success" }, scheduled: { label: "Scheduled", tone: "warning" }, ended: { label: "Ended", tone: "neutral" }, off: { label: "Off", tone: "neutral" } };

const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function PromotionsView({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const project = useProject(projectId);
  const q = useQuery({ queryKey: ["promotions", projectId], queryFn: () => api<Data>(`/api/v1/projects/${projectId}/promotions`) });
  const site = useQuery({ queryKey: ["promo-site", projectId], queryFn: () => api<{ content: string }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(SITE_DOC_PATH)}`), staleTime: 60_000 });
  const [gallery, setGallery] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Promo | null>(null);
  const canEdit = project.data?.permissions.includes("project:update") ?? false;
  const refresh = () => qc.invalidateQueries({ queryKey: ["promotions", projectId] });

  const create = useMutation({
    mutationFn: (preset: string) => api<{ promotion: Promotion }>(`/api/v1/projects/${projectId}/promotions`, { method: "POST", body: { preset } }),
    onSuccess: (r) => {
      refresh();
      setGallery(false);
      setDraft(r.promotion);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't create it", description: errorMessage(e) }),
  });
  const toggle = useMutation({
    mutationFn: (p: Promo) => api(`/api/v1/projects/${projectId}/promotions/${p.id}`, { method: "PUT", body: { ...p, stats: undefined, enabled: !p.enabled } }),
    onSuccess: refresh,
    onError: (e) => toast({ tone: "error", title: "Couldn't turn it on", description: errorMessage(e) }),
  });
  const duplicate = useMutation({ mutationFn: (p: Promo) => api(`/api/v1/projects/${projectId}/promotions/${p.id}/duplicate`, { method: "POST" }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (p: Promo) => api(`/api/v1/projects/${projectId}/promotions/${p.id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      setRemoving(null);
    },
  });

  if (q.isPending) return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8"><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-48" /></div>;
  if (q.isError) return <ErrorState title="Promotions unavailable" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { promotions, store, published } = q.data;
  const total = promotions.reduce((a, p) => ({ views: a.views + p.stats.views, clicks: a.clicks + p.stats.clicks, submits: a.submits + p.stats.submits }), { views: 0, clicks: 0, submits: 0 });
  const liveCount = promotions.filter((p) => promoStatus(p) === "live").length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Promotions"
        description="Pop-ups, announcement bars, floating buttons and cart upsells that help visitors find your offers — and buy a little more."
        actions={canEdit && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setGallery(true)}>New promotion</Button>}
      />
      {!published && <div className="mb-6"><Notice title="Not published yet">Promotions appear on your live site. Publish it from Deployments to see them in action — you can set everything up now.</Notice></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Live now", liveCount, "sky"],
          ["Views · 30 days", total.views, "lavender"],
          ["Clicks · 30 days", total.clicks, "peach"],
          ["Sign-ups · 30 days", total.submits, "mint"],
        ].map(([l, v, t]) => (
          <Card key={l as string} className={cx("stat-tint p-4", `tint-${t}`)}>
            <p className="text-xs text-muted">{l}</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">{(v as number).toLocaleString()}</p>
          </Card>
        ))}
      </div>

      {promotions.length === 0 ? (
        <Card className="p-6 sm:p-8">
          <h2 className="text-[17px] font-semibold">Start with a ready-made promotion</h2>
          <p className="mt-1 text-[13px] text-muted">Pick one, adjust the words, and switch it on. Nothing goes live until you do.</p>
          <div className="mt-6"><PresetGrid hasStore={!!store} onPick={(id) => create.mutate(id)} busy={create.isPending} disabled={!canEdit} /></div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {promotions.map((p) => {
            const st = STATUS[promoStatus(p)];
            const ctr = p.stats.views ? Math.round((p.stats.clicks / p.stats.views) * 1000) / 10 : 0;
            return (
              <Card key={p.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                <span className={cx("tint-chip grid size-11 shrink-0 place-items-center rounded-[14px]", `tint-${TINT[p.kind]}`)}>{KIND_ICON[p.kind]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[15px] font-semibold">{p.name}</p>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="text-[12px] text-muted">{KIND_LABEL[p.kind]}</span>
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">
                    {p.startsAt && promoStatus(p) === "scheduled" ? `Starts ${when(p.startsAt)}` : p.endsAt ? (promoStatus(p) === "ended" ? `Ended ${when(p.endsAt)}` : `Ends ${when(p.endsAt)}`) : "No end date"}
                  </p>
                </div>
                <dl className="grid grid-cols-4 gap-4 text-center sm:w-[320px]">
                  {[["Views", p.stats.views], ["Clicks", p.stats.clicks], ["CTR", `${ctr}%`], ["Sign-ups", p.stats.submits]].map(([l, v]) => (
                    <div key={l as string}><dt className="text-[11px] text-muted">{l}</dt><dd className="text-[15px] font-semibold tabular-nums">{v}</dd></div>
                  ))}
                </dl>
                <div className="flex items-center gap-1.5">
                  {canEdit && <Switch checked={p.enabled} onChange={() => toggle.mutate(p)} label={p.enabled ? "Turn off" : "Turn on"} />}
                  {canEdit && <Button variant="ghost" size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setDraft(p)}>Edit</Button>}
                  {canEdit && <Button variant="ghost" size="sm" aria-label="Duplicate" icon={<Copy className="size-3.5" />} onClick={() => duplicate.mutate(p)} />}
                  {canEdit && <Button variant="ghost" size="sm" aria-label="Delete" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(p)} />}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        Countdowns only count to a real end date, and codes must exist in your store&apos;s Discounts — so every promise works at checkout. Views and clicks come from your live site; your own preview visits aren&apos;t counted.
      </p>

      <Dialog open={gallery} onClose={() => setGallery(false)} size="2xl" title="New promotion" description="Start from a ready-made design — you can change every word.">
        <PresetGrid hasStore={!!store} onPick={(id) => create.mutate(id)} busy={create.isPending} disabled={!canEdit} />
      </Dialog>

      {draft && <Editor key={draft.id ?? "new"} projectId={projectId} initial={draft} data={q.data} siteJson={site.data?.content ?? null} onClose={() => setDraft(null)} onSaved={refresh} />}

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title={`Delete “${removing?.name}”?`} description="It disappears from your site straight away, along with its stats. This can't be undone." confirmLabel="Delete" destructive loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} />
    </div>
  );
}

function PresetGrid({ hasStore, onPick, busy, disabled }: { hasStore: boolean; onPick: (id: string) => void; busy: boolean; disabled: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {PRESETS.map((p: Preset) => {
        const off = disabled || busy || (p.store && !hasStore);
        return (
          <button key={p.id} type="button" disabled={off} onClick={() => onPick(p.id)} className={cx("tint-card group flex flex-col items-start gap-3 rounded-[18px] p-4 text-left transition-transform", `tint-${TINT[p.kind]}`, off ? "cursor-not-allowed opacity-50" : "hover:-translate-y-0.5")}>
            <span className="tint-chip grid size-10 place-items-center rounded-[12px] [&>svg]:size-[18px]">{PRESET_ICON[p.id]}</span>
            <span>
              <span className="block text-[14px] font-semibold">{p.title}</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{p.blurb}</span>
              {p.store && !hasStore && <span className="mt-1.5 block text-[11.5px] font-medium text-warning">Needs an online store</span>}
            </span>
            <span className="mt-auto text-[11px] font-medium tracking-wide text-muted uppercase">{KIND_LABEL[p.kind]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

function Editor({ projectId, initial, data, siteJson, onClose, onSaved }: { projectId: string; initial: Draft; data: Data; siteJson: string | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [replay, setReplay] = useState(0);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const c = d.config as Cfg;
  const set = (patch: Cfg) => setD({ ...d, config: { ...c, ...patch } });
  const t = (c.targeting ?? { pages: "all", paths: [], device: "all" }) as { pages: string; paths: string[]; device: string };
  const err = (k: string) => errors[k]?.[0];

  const save = useMutation({
    mutationFn: (enabled: boolean) => api<{ promotion: Promotion }>(`/api/v1/projects/${projectId}/promotions${d.id ? `/${d.id}` : ""}`, { method: d.id ? "PUT" : "POST", body: { ...d, enabled, stats: undefined } }),
    onSuccess: (r) => {
      onSaved();
      toast({ tone: "success", title: r.promotion.enabled ? "Saved — it's on" : "Saved" });
      onClose();
    },
    onError: (e) => {
      setErrors(((e as { details?: Record<string, string[]> }).details ?? {}) as Record<string, string[]>);
      toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) });
    },
  });

  const html = useMemo(() => previewHtml(d, siteJson, data), [d, siteJson, data]);
  const popups = data.promotions.filter((p) => p.kind === "popup" && p.id !== d.id);
  const codes = data.store?.discounts ?? [];

  const targeting = d.kind !== "shipping_goal" && d.kind !== "cart_upsell" && (
    <fieldset className="grid gap-3 rounded-[14px] border border-border p-3">
      <legend className="px-1 text-[12px] font-medium text-muted">Where it shows</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pages">{(a) => <Select {...a} value={t.pages} onChange={(e) => set({ targeting: { ...t, pages: e.target.value } })}><option value="all">Every page</option><option value="home">Home page only</option><option value="shop">Shop, products and cart</option><option value="paths">Specific pages…</option></Select>}</Field>
        <Field label="Devices">{(a) => <Select {...a} value={t.device} onChange={(e) => set({ targeting: { ...t, device: e.target.value } })}><option value="all">Desktop and phone</option><option value="desktop">Desktop only</option><option value="mobile">Phone only</option></Select>}</Field>
      </div>
      {t.pages === "paths" && <Field label="Page paths" hint="One per line, like /about or /shop/* for a whole section.">{(a) => <Textarea {...a} rows={2} value={t.paths.join("\n")} onChange={(e) => set({ targeting: { ...t, paths: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 20) } })} />}</Field>}
    </fieldset>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      size="2xl"
      title={d.id ? `Edit ${KIND_LABEL[d.kind].toLowerCase()}` : `New ${KIND_LABEL[d.kind].toLowerCase()}`}
      description="Changes reach your live site as soon as you save — no republishing needed."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(false)}>Save as draft</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(true)}>Save and turn on</Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="grid content-start gap-3 lg:max-h-[62vh] lg:overflow-y-auto lg:pr-1">
          <Field label="Name (only you see this)" error={err("name")}>{(a) => <Input {...a} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={80} />}</Field>

          {d.kind === "bar" && (
            <>
              <Field label="Messages" hint="One per line — up to five rotate every few seconds." error={err("config.messages")}>{(a) => <Textarea {...a} rows={3} value={((c.messages as string[]) ?? []).join("\n")} onChange={(e) => set({ messages: e.target.value.split("\n").slice(0, 5) })} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Link text">{(a) => <Input {...a} value={String(c.linkLabel ?? "")} onChange={(e) => set({ linkLabel: e.target.value })} />}</Field>
                <Field label="Link to" error={err("config.linkHref")}>{(a) => <Input {...a} value={String(c.linkHref ?? "")} placeholder="/shop" onChange={(e) => set({ linkHref: e.target.value })} />}</Field>
              </div>
              <Field label="Style">{(a) => <Select {...a} value={String(c.tone)} onChange={(e) => set({ tone: e.target.value })}><option value="accent">Brand colour</option><option value="dark">Dark</option><option value="gradient">Gradient</option><option value="soft">Soft tint</option></Select>}</Field>
              <Switch checked={!!c.countdown} onChange={(v) => set({ countdown: v })} label="Show a countdown to the end date" />
              <Switch checked={c.dismissible !== false} onChange={(v) => set({ dismissible: v })} label="Visitors can close it" />
            </>
          )}

          {d.kind === "popup" && (
            <>
              <Field label="Layout">{(a) => <Select {...a} value={String(c.layout)} onChange={(e) => set({ layout: e.target.value })}><option value="center">Centre pop-up</option><option value="corner">Corner slide-in</option><option value="sheet">Bottom banner</option></Select>}</Field>
              <Field label="Small heading">{(a) => <Input {...a} value={String(c.eyebrow ?? "")} onChange={(e) => set({ eyebrow: e.target.value })} maxLength={60} />}</Field>
              <Field label="Headline" error={err("config.heading")}>{(a) => <Input {...a} value={String(c.heading ?? "")} onChange={(e) => set({ heading: e.target.value })} maxLength={120} />}</Field>
              <Field label="Message">{(a) => <Textarea {...a} rows={2} value={String(c.body ?? "")} onChange={(e) => set({ body: e.target.value })} maxLength={400} />}</Field>
              <Field label="Image link (optional)" hint="An https:// image — product or lifestyle photos work best." error={err("config.image")}>{(a) => <Input {...a} value={String(c.image ?? "")} placeholder="https://…" onChange={(e) => set({ image: e.target.value })} />}</Field>
              <Field label="What visitors can do">{(a) => <Select {...a} value={String(c.action)} onChange={(e) => set({ action: e.target.value })}><option value="link">Follow a button</option><option value="email">Join your email list</option><option value="code">Copy a discount code</option></Select>}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Button text" error={err("config.buttonLabel")}>{(a) => <Input {...a} value={String(c.buttonLabel ?? "")} onChange={(e) => set({ buttonLabel: e.target.value })} maxLength={40} />}</Field>
                {c.action !== "email" && <Field label="Button link" error={err("config.buttonHref")}>{(a) => <Input {...a} value={String(c.buttonHref ?? "")} placeholder="/shop" onChange={(e) => set({ buttonHref: e.target.value })} />}</Field>}
              </div>
              {(c.action === "code" || c.action === "email") && (
                <Field label={c.action === "email" ? "Code to reveal after sign-up (optional)" : "Discount code"} hint={data.store ? (codes.length ? `From your store: ${codes.map((x) => x.code).join(", ")}` : "Create codes under Store → Discounts.") : undefined} error={err("config.code")}>
                  {(a) => <Input {...a} value={String(c.code ?? "")} onChange={(e) => set({ code: e.target.value.toUpperCase() })} maxLength={40} list="promo-codes" />}
                </Field>
              )}
              <datalist id="promo-codes">{codes.map((x) => <option key={x.code} value={x.code} />)}</datalist>
              {c.action === "email" && (
                <>
                  <Field label="Thank-you headline">{(a) => <Input {...a} value={String(c.successHeading ?? "")} onChange={(e) => set({ successHeading: e.target.value })} />}</Field>
                  <Field label="Thank-you message">{(a) => <Input {...a} value={String(c.successBody ?? "")} onChange={(e) => set({ successBody: e.target.value })} />}</Field>
                </>
              )}
              <fieldset className="grid gap-3 rounded-[14px] border border-border p-3">
                <legend className="px-1 text-[12px] font-medium text-muted">When it opens</legend>
                <Field label="Trigger">{(a) => (
                  <Select {...a} value={String((c.trigger as Cfg)?.type ?? "delay")} onChange={(e) => set({ trigger: { ...(c.trigger as Cfg), type: e.target.value } })}>
                    <option value="delay">After a few seconds</option><option value="scroll">After scrolling down</option><option value="exit">When they move to leave (desktop)</option><option value="click">Only from a floating button</option>
                  </Select>
                )}</Field>
                {(c.trigger as Cfg)?.type === "delay" && <Field label="Seconds after the page opens">{(a) => <Input {...a} type="number" min={0} max={120} value={Number((c.trigger as Cfg)?.delay ?? 6)} onChange={(e) => set({ trigger: { ...(c.trigger as Cfg), delay: Math.max(0, Math.min(120, Number(e.target.value) || 0)) } })} />}</Field>}
                {(c.trigger as Cfg)?.type === "scroll" && <Field label="Percent of the page scrolled">{(a) => <Input {...a} type="number" min={5} max={95} value={Number((c.trigger as Cfg)?.scroll ?? 50)} onChange={(e) => set({ trigger: { ...(c.trigger as Cfg), scroll: Math.max(5, Math.min(95, Number(e.target.value) || 50)) } })} />}</Field>}
                {(c.trigger as Cfg)?.type === "exit" && <p className="text-[12px] text-muted">On phones, where there&apos;s no cursor, it opens after 20 seconds instead.</p>}
                <Field label="Show it at most">{(a) => <Select {...a} value={String(c.frequency)} onChange={(e) => set({ frequency: e.target.value })}><option value="session">Once per visit</option><option value="day">Once a day</option><option value="week">Once a week</option><option value="once">Only once</option><option value="always">Every page view</option></Select>}</Field>
              </fieldset>
              <Switch checked={!!c.countdown} onChange={(v) => set({ countdown: v })} label="Show a countdown to the end date" />
            </>
          )}

          {d.kind === "floating" && (
            <>
              <Field label="Button text" error={err("config.label")}>{(a) => <Input {...a} value={String(c.label ?? "")} onChange={(e) => set({ label: e.target.value })} maxLength={40} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Icon">{(a) => <Select {...a} value={String(c.icon)} onChange={(e) => set({ icon: e.target.value })}><option value="gift">Gift</option><option value="tag">Tag</option><option value="chat">Chat</option><option value="sparkles">Sparkles</option><option value="bag">Bag</option></Select>}</Field>
                <Field label="Side">{(a) => <Select {...a} value={String(c.position)} onChange={(e) => set({ position: e.target.value })}><option value="left">Bottom left</option><option value="right">Bottom right</option></Select>}</Field>
              </div>
              <Field label="When clicked" error={err("config.opens")}>{(a) => (
                <Select {...a} value={c.opens ? String(c.opens) : ""} onChange={(e) => set({ opens: e.target.value || null })}>
                  <option value="">Go to a link</option>
                  {popups.map((p) => <option key={p.id} value={p.id}>Open pop-up: {p.name}</option>)}
                </Select>
              )}</Field>
              {!c.opens && <Field label="Link" hint="A page like /shop, or a full link such as https://wa.me/91XXXXXXXXXX" error={err("config.href")}>{(a) => <Input {...a} value={String(c.href ?? "")} onChange={(e) => set({ href: e.target.value })} />}</Field>}
            </>
          )}

          {d.kind === "shipping_goal" && (
            <>
              <Notice title={data.store?.freeOver ? `Uses your free-delivery rate: ${formatPrice(data.store.freeOver, data.store.currency)}` : "Needs a free-delivery rate"}>
                {data.store?.freeOver ? "Shown in the cart, with a progress bar that fills as shoppers add items." : "Add a “free over” shipping rate under Store → Shipping first, so the promise matches what checkout charges."}
              </Notice>
              <Field label="Progress message" hint="{amount} becomes what's left to spend.">{(a) => <Input {...a} value={String(c.progress ?? "")} onChange={(e) => set({ progress: e.target.value })} maxLength={120} />}</Field>
              <Field label="When they've reached it">{(a) => <Input {...a} value={String(c.reached ?? "")} onChange={(e) => set({ reached: e.target.value })} maxLength={120} />}</Field>
            </>
          )}

          {d.kind === "cart_upsell" && (
            <>
              <Field label="Heading">{(a) => <Input {...a} value={String(c.heading ?? "")} onChange={(e) => set({ heading: e.target.value })} maxLength={80} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Suggest">{(a) => <Select {...a} value={String(c.source)} onChange={(e) => set({ source: e.target.value })}><option value="related">From the same collections</option><option value="featured">Featured products</option></Select>}</Field>
                <Field label="How many">{(a) => <Select {...a} value={String(c.limit)} onChange={(e) => set({ limit: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</Select>}</Field>
              </div>
              <p className="text-[12px] text-muted">Shown under the cart. Products with one option get an “Add” button; others link to their page.</p>
            </>
          )}

          {targeting}

          <fieldset className="grid gap-3 rounded-[14px] border border-border p-3">
            <legend className="px-1 text-[12px] font-medium text-muted">Schedule (optional)</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">{(a) => <Input {...a} type="datetime-local" value={toLocal(d.startsAt)} onChange={(e) => setD({ ...d, startsAt: fromLocal(e.target.value) })} />}</Field>
              <Field label="Ends" error={err("endsAt")}>{(a) => <Input {...a} type="datetime-local" value={toLocal(d.endsAt)} onChange={(e) => setD({ ...d, endsAt: fromLocal(e.target.value) })} />}</Field>
            </div>
          </fieldset>
        </div>

        <div className="grid content-start gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted"><Eye className="size-3.5" /> Live preview{d.kind === "shipping_goal" || d.kind === "cart_upsell" ? " · cart" : " · your home page"}</span>
            <div className="flex items-center gap-1.5">
              <Segmented value={device} onChange={(v) => setDevice(v as "desktop" | "mobile")} options={[{ value: "desktop", label: <Monitor className="size-3.5" />, title: "Desktop" }, { value: "mobile", label: <Smartphone className="size-3.5" />, title: "Phone" }]} label="Preview size" />
              <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => setReplay((n) => n + 1)}>Replay</Button>
            </div>
          </div>
          <Preview key={`${replay}-${device}`} html={html} device={device} />
        </div>
      </div>
    </Dialog>
  );
}

function Preview({ html, device }: { html: string; device: "desktop" | "mobile" }) {
  const w = device === "desktop" ? 1280 : 390;
  const h = device === "desktop" ? 800 : 760;
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const scale = box ? Math.min(1, box.clientWidth / w, 470 / h) : 0.4;
  return (
    <div ref={setBox} className="relative overflow-hidden rounded-[14px] border border-border bg-surface-2" style={{ height: h * scale }}>
      {box && (
        <iframe
          title="Promotion preview"
          srcDoc={html}
          sandbox="allow-scripts"
          style={{ width: w, height: h, transform: `scale(${scale})`, left: (box.clientWidth - w * scale) / 2 }}
          className="absolute top-0 origin-top-left border-0"
        />
      )}
    </div>
  );
}

/** The promotion drawn on the site's own home page (or a cart sample), opening immediately. */
function previewHtml(d: Draft, siteJson: string | null, data: Data) {
  const parsed = siteJson ? parseSiteDoc(siteJson) : null;
  const doc = parsed?.ok ? parsed.doc : null;
  let page = doc ? renderPage(doc, doc.pages[0], { kind: "preview" }) : `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font:16px system-ui;background:#f6f6f7"><div style="padding:120px 40px;text-align:center"><h1>Your site</h1><p>Your pages appear here.</p></div></body></html>`;
  const schema = CONFIG_SCHEMAS[d.kind];
  const ok = schema.safeParse(d.config);
  if (!ok.success) return page;
  const cfg = ok.data as Cfg;
  if (STORE_ONLY.includes(d.kind)) {
    const money = (n: number) => formatPrice(n, data.store?.currency ?? "INR");
    const threshold = data.store?.freeOver ?? 99900;
    const body =
      d.kind === "shipping_goal"
        ? shippingGoalHtml(cfg as never, Math.round(threshold * 0.62), threshold, money)
        : `<section class="ccp-upsell"><h2>${String(cfg.heading).replace(/</g, "&lt;")}</h2><ul class="ccp-up-list">${["Your product", "Another favourite", "A small add-on", "Gift wrap"].slice(0, Number(cfg.limit)).map((n) => `<li class="ccp-up-item"><span style="width:64px;height:64px;border-radius:10px;background:color-mix(in srgb,var(--accent,#111) 15%,#eee)"></span><div><a>${n}</a><div class="muted">${money(49900)}</div><form><button type="button">Add</button></form></div></li>`).join("")}</ul></section>`;
    const cart = `<main style="max-width:880px;margin:0 auto;padding:56px 28px"><h1 style="margin:0 0 20px">Your cart</h1>${d.kind === "shipping_goal" ? body : ""}<div style="padding:18px;border-radius:14px;border:1px solid rgba(0,0,0,.08)">1 × Item in the cart · ${money(Math.round(threshold * 0.62))}</div>${d.kind === "cart_upsell" ? body : ""}</main>`;
    return page.replace(/<main[\s\S]*<\/main>/, cart).replace("</head>", `<style>${PROMO_CSS}</style></head>`);
  }
  // In the preview it opens straight away, every time, everywhere.
  const now = new Date();
  const preview: Promotion = {
    id: "00000000-0000-4000-8000-000000000000",
    kind: d.kind,
    name: d.name,
    enabled: true,
    startsAt: null,
    endsAt: d.endsAt && Date.parse(d.endsAt) > now.getTime() ? d.endsAt : new Date(now.getTime() + 2 * 86_400_000).toISOString(),
    config: { ...cfg, targeting: { pages: "all", paths: [], device: "all" }, ...(d.kind === "popup" ? { trigger: { type: "delay", delay: 0, scroll: 50 }, frequency: "always" } : {}), ...(d.kind === "floating" ? { opens: null, href: "#" } : {}) },
  };
  const out = renderPromotions([preview], "/", { base: "" });
  if (!out) return page;
  // Backdrop blur inside a scaled-down frame renders as smeared tiles in Chromium; the live site keeps it.
  const calm = `<style>.ccp-scrim{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:rgba(10,10,20,.5)!important}</style>`;
  page = page.replace(/<body([^>]*)>/, (m) => `${m}${out.top}`).replace("</body>", `${out.end}${calm}</body>`);
  return page;
}
