"use client";

// QR menu & tables: areas and tables, a QR code per table (printable as table
// tents), and every option for how the guest QR menu looks and works.
import { Copy, Download, ExternalLink, MoreHorizontal, Pencil, Plus, Printer, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog, Dialog, Menu, Segmented, Tabs, useToast } from "@/components/ui/overlays";
import { Button, cx, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import type { HorecaSettings } from "@/lib/horeca/model";
import { qrSvg } from "@/lib/store/barcode";
import { sortTables, Toggle, toMajor, toMinor, useH, useHAction, useHQuery, useSaveVenue } from "./shared";

type Area = { id: string; name: string; sort: number };
type Table = { id: string; name: string; areaId: string | null; seats: number; kind: string; token: string; active: boolean; sort: number; url: string };

export function QrView() {
  const [tab, setTab] = useState<"tables" | "design">("tables");
  return (
    <div>
      <PageHeader title="QR menu & tables" description="Each table gets its own QR code. Guests scan it to see the menu, order, call a waiter and ask for the bill." />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-5"
        tabs={[
          { value: "tables", label: "Tables & QR codes" },
          { value: "design", label: "QR menu options" },
        ]}
      />
      {tab === "tables" ? <TablesTab /> : <DesignTab />}
    </div>
  );
}

function TablesTab() {
  const { venue } = useH();
  const toast = useToast();
  const q = useHQuery<{ areas: Area[]; tables: Table[] }>("tables");
  const [area, setArea] = useState("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState(false);
  const [editTable, setEditTable] = useState<Partial<Table> | null>(null);
  const [editArea, setEditArea] = useState<Partial<Area> | null>(null);
  const [del, setDel] = useState<{ kind: "tables" | "areas"; id: string; name: string } | null>(null);
  const [rotate, setRotate] = useState<Table | null>(null);
  const remove = useHAction<void>(() => ({ path: `${del!.kind}/${del!.id}`, method: "DELETE" }), { success: "Deleted", onDone: () => setDel(null) });
  const rot = useHAction<void>(() => ({ path: `tables/${rotate!.id}/rotate` }), { success: "New QR code made — print it again", onDone: () => setRotate(null) });
  const tables = useMemo(() => sortTables(q.data?.tables ?? [], q.data?.areas).filter((t) => (area === "all" ? true : area === "rooms" ? t.kind === "room" : t.areaId === area && t.kind !== "room")), [q.data, area]);
  if (!q.data) return <Skeleton className="h-96 rounded-[22px]" />;
  const { areas } = q.data;
  const hasRooms = q.data.tables.some((t) => t.kind === "room");
  const print = (list: Table[]) => printTents(venue.name, venue.settings.qr.accent, list);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[{ id: "all", name: "All" }, ...areas, ...(hasRooms ? [{ id: "rooms", name: "Rooms" }] : [])].map((a) => (
          <span key={a.id} className="inline-flex items-center">
            <button type="button" onClick={() => setArea(a.id)} aria-pressed={area === a.id} className={cx("h-8 rounded-full border px-3.5 text-[13px] font-medium", area === a.id ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
              {a.name}
            </button>
            {area === a.id && "sort" in a && (
              <Menu
                label={`Actions for ${a.name}`}
                trigger={(p) => (
                  <button {...p} aria-label={`Actions for ${a.name}`} type="button" className="ml-0.5 grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2">
                    <MoreHorizontal className="size-4" />
                  </button>
                )}
                items={[
                  { label: "Rename", icon: <Pencil className="size-4" />, onSelect: () => setEditArea(a as Area) },
                  { label: "Delete area", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel({ kind: "areas", id: a.id, name: a.name }) },
                ]}
              />
            )}
          </span>
        ))}
        <button type="button" onClick={() => setEditArea({})} className="h-8 rounded-full border border-dashed border-border px-3.5 text-[13px] text-muted hover:bg-surface-2">
          + Area
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" icon={<Printer className="size-4" />} disabled={!tables.length} onClick={() => print(picked.length ? tables.filter((t) => picked.includes(t.id)) : tables)}>
            {picked.length ? `Print ${picked.length} selected` : `Print all ${tables.length}`}
          </Button>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setBulk(true)}>
            Add many
          </Button>
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditTable({ areaId: area !== "all" && area !== "rooms" ? area : (areas[0]?.id ?? null) })}>
            Table
          </Button>
        </div>
      </div>
      {!tables.length ? (
        <EmptyState title="No tables here" description="Add your tables to get a QR code for each one." action={<Button variant="primary" onClick={() => setBulk(true)}>Add tables</Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {tables.map((t) => (
            <QrCard
              key={t.id}
              t={t}
              area={areas.find((a) => a.id === t.areaId)?.name}
              picked={picked.includes(t.id)}
              onPick={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))}
              onCopy={() => navigator.clipboard.writeText(t.url).then(() => toast({ tone: "success", title: "Link copied" }))}
              onPrint={() => print([t])}
              onEdit={() => setEditTable(t)}
              onRotate={() => setRotate(t)}
              onDelete={() => setDel({ kind: "tables", id: t.id, name: t.name })}
            />
          ))}
        </div>
      )}
      {bulk && <BulkDialog areas={areas} defaultArea={area !== "all" && area !== "rooms" ? area : (areas[0]?.id ?? null)} existing={q.data.tables.length} onClose={() => setBulk(false)} />}
      {editTable && <TableDialog init={editTable} areas={areas} onClose={() => setEditTable(null)} />}
      {editArea && <AreaDialog init={editArea} onClose={() => setEditArea(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} destructive title={`Delete ${del?.name}?`} description={del?.kind === "areas" ? "Tables in this area stay, without an area." : "Its QR code stops working. Past orders keep their records."} confirmLabel="Delete" />
      <ConfirmDialog open={!!rotate} onClose={() => setRotate(null)} onConfirm={() => rot.mutate()} loading={rot.isPending} title={`New QR code for ${rotate?.name}?`} description="The printed code stops working straight away — use this if a code was copied or misused. Print the new one after." confirmLabel="Make a new code" />
    </>
  );
}

function QrCard({ t, area, picked, onPick, onCopy, onPrint, onEdit, onRotate, onDelete }: { t: Table; area?: string; picked: boolean; onPick: () => void; onCopy: () => void; onPrint: () => void; onEdit: () => void; onRotate: () => void; onDelete: () => void }) {
  const svg = useMemo(() => qrSvg(t.url, { margin: 1, label: `QR code for ${t.name}` }), [t.url, t.name]);
  return (
    <div className={cx("group relative rounded-[20px] border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md", picked ? "border-fg ring-1 ring-fg" : "border-border", !t.active && "opacity-50")}>
      <label className="absolute top-3 left-3 z-10 flex cursor-pointer items-center">
        <input type="checkbox" checked={picked} onChange={onPick} className="size-4 accent-[var(--fg)]" aria-label={`Select ${t.name}`} />
      </label>
      <div className="absolute top-2 right-2 z-10">
        <Menu
          label={`Actions for ${t.name}`}
          trigger={(p) => (
            <button {...p} aria-label={`Actions for ${t.name}`} type="button" className="grid size-8 place-items-center rounded-full bg-surface/80 text-muted backdrop-blur-[6px] hover:bg-surface-2">
              <MoreHorizontal className="size-4" />
            </button>
          )}
          items={[
            { label: "Open guest menu", icon: <ExternalLink className="size-4" />, onSelect: () => window.open(t.url, "_blank", "noopener") },
            { label: "Copy link", icon: <Copy className="size-4" />, onSelect: onCopy },
            { label: "Print table tent", icon: <Printer className="size-4" />, onSelect: onPrint },
            { label: "Download SVG", icon: <Download className="size-4" />, onSelect: () => download(`${t.name}.svg`, qrSvg(t.url, { margin: 2 })) },
            ...(t.kind === "room" ? [] : [{ label: "Edit", icon: <Pencil className="size-4" />, onSelect: onEdit }]),
            { label: "New QR code", icon: <RefreshCw className="size-4" />, onSelect: onRotate },
            ...(t.kind === "room" ? [] : ["separator" as const, { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: onDelete }]),
          ]}
        />
      </div>
      <div className="mx-auto mt-6 aspect-square w-[70%] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="mt-3 text-center">
        <p className="text-[16px] font-bold tracking-[-0.01em]">{t.name}</p>
        <p className="text-[11.5px] text-muted">{t.kind === "room" ? "In-room dining" : `${area ?? "No area"} · ${t.seats} seats`}</p>
      </div>
    </div>
  );
}

function download(name: string, svg: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A sheet of A6 table tents, four to a page. */
function printTents(venue: string, accent: string, tables: Table[]) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const cards = tables.map((t) => `<div class="tent"><p class="v">${esc(venue)}</p><div class="qr">${qrSvg(t.url, { margin: 1 })}</div><p class="t">${esc(t.name)}</p><p class="s">Scan to see the menu &amp; order</p><p class="h">Call a waiter · Ask for the bill · Pay by UPI</p></div>`).join("");
  w.document.write(`<!doctype html><title>Table QR codes</title><style>@page{size:A4;margin:10mm}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;color:#111}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm}.tent{border:1px solid #ddd;border-radius:6mm;padding:8mm;text-align:center;break-inside:avoid;height:128mm;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;border-top:3mm solid ${esc(accent)}}.v{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#666;margin:0}.qr{width:62mm;margin:6mm 0}.qr svg{width:100%;height:auto}.t{font-size:30px;font-weight:800;margin:0;letter-spacing:-.02em}.s{font-size:15px;font-weight:600;margin:3mm 0 0}.h{font-size:11px;color:#777;margin:2mm 0 0}</style><div class="grid">${cards}</div>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

function BulkDialog({ areas, defaultArea, existing, onClose }: { areas: Area[]; defaultArea: string | null; existing: number; onClose: () => void }) {
  const [areaId, setAreaId] = useState(defaultArea ?? "");
  const [prefix, setPrefix] = useState("T");
  const [from, setFrom] = useState(existing + 1);
  const [count, setCount] = useState(6);
  const [seats, setSeats] = useState(4);
  const add = useHAction<void>(() => ({ path: "tables/bulk", body: { areaId: areaId || null, prefix, from, count, seats } }), { success: `${count} tables added`, onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add many tables"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={add.isPending} disabled={!prefix.trim() || count < 1} onClick={() => add.mutate()}>
            Add {count}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Area">
          {(a) => (
            <Select {...a} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">No area</option>
              {areas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Name starts with">{(a) => <Input {...a} value={prefix} maxLength={10} onChange={(e) => setPrefix(e.target.value)} />}</Field>
          <Field label="Number from">{(a) => <Input {...a} type="number" min={0} value={from} onChange={(e) => setFrom(Math.max(0, Number(e.target.value) || 0))} />}</Field>
          <Field label="How many">{(a) => <Input {...a} type="number" min={1} max={60} value={count} onChange={(e) => setCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />}</Field>
          <Field label="Seats each">{(a) => <Input {...a} type="number" min={1} max={40} value={seats} onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))} />}</Field>
        </div>
        <p className="text-[12.5px] text-muted">
          Makes {prefix}
          {from} to {prefix}
          {from + count - 1}.
        </p>
      </div>
    </Dialog>
  );
}

function TableDialog({ init, areas, onClose }: { init: Partial<Table>; areas: Area[]; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", areaId: init.areaId ?? "", seats: init.seats ?? 4, kind: init.kind ?? "table", active: init.active ?? true, sort: init.sort ?? 0 });
  const save = useHAction<void>(() => ({ path: init.id ? `tables/${init.id}` : "tables", method: init.id ? "PUT" : "POST", body: { ...f, areaId: f.areaId || null } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "New table"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} maxLength={30} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="T12 or Patio 3" autoFocus />}</Field>
        <Field label="Seats">{(a) => <Input {...a} type="number" min={1} max={40} value={f.seats} onChange={(e) => setF({ ...f, seats: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
        <Field label="Area">
          {(a) => (
            <Select {...a} value={f.areaId} onChange={(e) => setF({ ...f, areaId: e.target.value })}>
              <option value="">No area</option>
              {areas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Type">
          {(a) => (
            <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="table">Dine-in table</option>
              <option value="counter">Counter / bar seat</option>
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="QR code accepts orders" />
        </div>
      </div>
    </Dialog>
  );
}

function AreaDialog({ init, onClose }: { init: Partial<Area>; onClose: () => void }) {
  const [name, setName] = useState(init.name ?? "");
  const save = useHAction<void>(() => ({ path: init.id ? `areas/${init.id}` : "areas", method: init.id ? "PUT" : "POST", body: { name, sort: init.sort ?? 0 } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={init.id ? "Rename area" : "New area"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rooftop, Patio, Private dining…" autoFocus />}</Field>
    </Dialog>
  );
}

// ─── QR menu options ─────────────────────────────────────────────────────────

const THEMES: { id: HorecaSettings["qr"]["theme"]; label: string; bg: string; fg: string }[] = [
  { id: "warm", label: "Warm", bg: "#faf6f0", fg: "#2b2118" },
  { id: "light", label: "Light", bg: "#ffffff", fg: "#111111" },
  { id: "dark", label: "Dark", bg: "#121212", fg: "#f5f5f5" },
];
const ACCENTS = ["#b4532a", "#1f6f4a", "#1d4ed8", "#9d174d", "#a16207", "#111111"];

function DesignTab() {
  const { venue } = useH();
  const tables = useHQuery<{ tables: Table[] }>("tables");
  const [s, setS] = useState(venue.settings.qr);
  const [minOrder, setMinOrder] = useState(s.minOrder ? toMajor(s.minOrder) : "");
  const [tips, setTips] = useState(s.tipOptions.join(", "));
  const [stamp, setStamp] = useState(0);
  const save = useSaveVenue({ success: "QR menu updated", onDone: () => setStamp((n) => n + 1) });
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((x) => ({ ...x, [k]: v }));
  const preview = tables.data?.tables.find((t) => t.kind !== "room" && t.active) ?? tables.data?.tables[0];
  const dirty = JSON.stringify(s) !== JSON.stringify(venue.settings.qr) || toMinor(minOrder) !== venue.settings.qr.minOrder || tips !== venue.settings.qr.tipOptions.join(", ");
  const submit = () =>
    save.mutate({
      settings: {
        qr: {
          ...s,
          minOrder: toMinor(minOrder),
          tipOptions: [
            ...new Set(
              tips
                .split(/[,\s]+/)
                .map(Number)
                .filter((n) => Number.isInteger(n) && n >= 0 && n <= 30),
            ),
          ].slice(0, 5),
        },
      },
    });
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid gap-5">
        <Section title="Ordering" hint="How guests use the QR code at the table.">
          <Toggle checked={s.enabled} onChange={(v) => set("enabled", v)} label="QR menu is on" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[13px] font-medium">Guests can</p>
              <Segmented label="QR mode" value={s.mode} onChange={(v) => set("mode", v)} options={[{ value: "order", label: "Browse & order" }, { value: "menu", label: "Browse only" }]} />
            </div>
            <div>
              <p className="mb-2 text-[13px] font-medium">New QR orders</p>
              <Segmented label="Approval" value={s.approval} onChange={(v) => set("approval", v)} options={[{ value: "auto", label: "Straight to kitchen" }, { value: "staff", label: "Waiter confirms" }]} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Smallest order" hint="Blank = no minimum">{(a) => <Input {...a} inputMode="decimal" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="0" />}</Field>
            <Field label="Tip choices (%)" hint="Up to 5, e.g. 0, 5, 10">{(a) => <Input {...a} value={tips} onChange={(e) => setTips(e.target.value)} />}</Field>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Toggle checked={s.askName} onChange={(v) => set("askName", v)} label="Ask for the guest's name" />
            <Toggle checked={s.askPhone} onChange={(v) => set("askPhone", v)} label="Ask for a phone number" />
            <Toggle checked={s.allowNotes} onChange={(v) => set("allowNotes", v)} label="Cooking notes on dishes" />
            <Toggle checked={s.callWaiter} onChange={(v) => set("callWaiter", v)} label="“Call waiter” & “Water” buttons" />
            <Toggle checked={s.requestBill} onChange={(v) => set("requestBill", v)} label="“Ask for the bill” button" />
            <Toggle checked={s.valetBooking} onChange={(v) => set("valetBooking", v)} label="Show valet booking link" />
          </div>
        </Section>
        <Section title="Look & feel" hint="Match your brand.">
          <div className="flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <button key={t.id} type="button" onClick={() => set("theme", t.id)} aria-pressed={s.theme === t.id} className={cx("flex h-14 w-28 items-center justify-center rounded-[14px] border text-[13px] font-semibold", s.theme === t.id ? "ring-2 ring-fg ring-offset-2 ring-offset-bg" : "border-border")} style={{ background: t.bg, color: t.fg }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">Accent</span>
            {ACCENTS.map((c) => (
              <button key={c} type="button" aria-label={`Accent ${c}`} aria-pressed={s.accent === c} onClick={() => set("accent", c)} className={cx("size-8 rounded-full", s.accent === c && "ring-2 ring-fg ring-offset-2 ring-offset-bg")} style={{ background: c }} />
            ))}
            <input type="color" aria-label="Custom accent" value={s.accent} onChange={(e) => set("accent", e.target.value)} className="size-8 cursor-pointer rounded-full border border-border bg-transparent" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cover photo link" hint="Blank uses your first dish photo.">{(a) => <Input {...a} value={s.cover} onChange={(e) => set("cover", e.target.value)} placeholder="https://…" />}</Field>
            <Field label="Logo link">{(a) => <Input {...a} value={s.logo} onChange={(e) => set("logo", e.target.value)} placeholder="https://…" />}</Field>
          </div>
          <Field label="Welcome line">{(a) => <Textarea {...a} rows={2} maxLength={200} value={s.welcome} onChange={(e) => set("welcome", e.target.value)} />}</Field>
          <Field label="Footer" hint="Allergen note, FSSAI licence number, Wi-Fi password…">{(a) => <Textarea {...a} rows={2} maxLength={300} value={s.footer} onChange={(e) => set("footer", e.target.value)} />}</Field>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Toggle checked={s.showImages} onChange={(v) => set("showImages", v)} label="Dish photos" />
            <Toggle checked={s.showDiet} onChange={(v) => set("showDiet", v)} label="Veg / non-veg marks" />
            <Toggle checked={s.showSpice} onChange={(v) => set("showSpice", v)} label="Spice level" />
            <Toggle checked={s.showPrep} onChange={(v) => set("showPrep", v)} label="Preparation time" />
          </div>
        </Section>
        <Section title="Pay at the table" hint="Shown with the bill so guests can pay from their phone.">
          <Field label="UPI ID" hint="Guests get a pay button with the exact amount. You confirm payment on the floor screen.">{(a) => <Input {...a} value={s.upiId} onChange={(e) => set("upiId", e.target.value)} placeholder="cafe@okhdfc" />}</Field>
        </Section>
        <div className="sticky bottom-3 z-10 flex items-center justify-end gap-3 rounded-full border border-border bg-surface/90 p-2 pl-5 shadow-lg backdrop-blur-[12px]">
          <span className="mr-auto text-[13px] text-muted">{dirty ? "Unsaved changes" : "All changes saved"}</span>
          <Button disabled={!dirty} onClick={() => { setS(venue.settings.qr); setMinOrder(venue.settings.qr.minOrder ? toMajor(venue.settings.qr.minOrder) : ""); setTips(venue.settings.qr.tipOptions.join(", ")); }}>
            Reset
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={submit}>
            Save
          </Button>
        </div>
      </div>
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
          <Smartphone className="size-4" /> Live preview {preview ? `· ${preview.name}` : ""}
        </p>
        {preview ? (
          <>
            <div className="mx-auto w-[340px] max-w-full rounded-[46px] border-[10px] border-[#111] bg-[#111] shadow-2xl">
              <iframe key={stamp} title="QR menu preview" src={preview.url.replace(/^https?:\/\/[^/]+/, "")} className="h-[680px] w-full rounded-[36px] bg-white" />
            </div>
            <p className="mt-3 text-center text-[12px] text-muted">Shows saved settings. Orders placed here are real — cancel them on the floor.</p>
          </>
        ) : (
          <Notice>Add a table to preview the guest menu.</Notice>
        )}
      </aside>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-[22px] border border-border bg-surface p-5 shadow-sm">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {hint && <p className="text-[12.5px] text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
