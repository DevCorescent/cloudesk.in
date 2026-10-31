"use client";

// Menu: categories (station, serving hours), dishes and drinks with every
// detail the QR menu shows, add-on groups, and links to bar bottles.
import { Clock, Copy, Flame, ImageIcon, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog, Dialog, Menu, Tabs } from "@/components/ui/overlays";
import { Badge, Button, cx, EmptyState, Field, Input, PageHeader, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { DIET_LABEL, DIETS } from "@/lib/horeca/model";
import { cap, DietMark, Toggle, toMajor, toMinor, useH, useHAction, useHQuery, useMoney } from "./shared";

type Category = { id: string; name: string; station: string; availableFrom: string; availableTo: string; active: boolean; sort: number };
type Group = { id: string; name: string; minSelect: number; maxSelect: number; options: { id: string; name: string; price: number }[] };
type Item = { id: string; categoryId: string; name: string; description: string; price: number; image: string; diet: string; spice: number; tags: string[]; available: boolean; prepMinutes: number; taxBps: number | null; modifierGroupIds: string[]; barItemId: string | null; pourMl: number | null; recipe: { stockItemId: string; qty: number }[]; code: string; sort: number };
type StockItem = { id: string; name: string; unit: string; packSize: number; costPerPack: number };
type MenuData = { categories: Category[]; items: Item[]; modifiers: Group[] };
type BarItem = { id: string; name: string; bottleMl: number };

export function MenuView() {
  const money = useMoney();
  const q = useHQuery<MenuData>("menu");
  const [tab, setTab] = useState<"items" | "categories" | "addons">("items");
  const [cat, setCat] = useState("");
  const [search, setSearch] = useState("");
  const [editItem, setEditItem] = useState<Partial<Item> | null>(null);
  const [editCat, setEditCat] = useState<Partial<Category> | null>(null);
  const [editGroup, setEditGroup] = useState<Partial<Group> | null>(null);
  const [del, setDel] = useState<{ kind: "menu-items" | "categories" | "modifiers"; id: string; name: string } | null>(null);
  const avail = useHAction<{ id: string; available: boolean }>(({ id, available }) => ({ path: `menu-items/${id}/available`, body: { available } }));
  const remove = useHAction<void>(() => ({ path: `${del!.kind}/${del!.id}`, method: "DELETE" }), { success: "Deleted", onDone: () => setDel(null) });
  const items = useMemo(() => (q.data?.items ?? []).filter((i) => (!cat || i.categoryId === cat) && (!search || `${i.name} ${i.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()))), [q.data, cat, search]);
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  const { categories, modifiers } = q.data;
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";
  const soldOut = q.data.items.filter((i) => !i.available).length;
  return (
    <div>
      <PageHeader
        title="Menu"
        description={`${q.data.items.length} dishes and drinks in ${categories.length} categories${soldOut ? ` · ${soldOut} sold out` : ""}. Changes show on the QR menu straight away.`}
        actions={
          <>
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditCat({})}>
              Category
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} disabled={!categories.length} onClick={() => setEditItem({ categoryId: cat || categories[0]?.id })}>
              Dish or drink
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { value: "items", label: `Dishes & drinks` },
          { value: "categories", label: `Categories` },
          { value: "addons", label: `Add-ons & variants` },
        ]}
      />
      {tab === "items" &&
        (!categories.length ? (
          <EmptyState title="Start with a category" description="Starters, Mains, Coffee, Cocktails… then add dishes to each." action={<Button variant="primary" onClick={() => setEditCat({})}>Add a category</Button>} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
                <Input aria-label="Search dishes" className="!pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dishes or tags" />
              </div>
              <button type="button" onClick={() => setCat("")} aria-pressed={!cat} className={cx("h-8 rounded-full border px-3 text-[13px]", !cat ? "border-fg bg-fg text-bg" : "border-border")}>
                All
              </button>
              {categories.map((c) => (
                <button key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={cat === c.id} className={cx("h-8 rounded-full border px-3 text-[13px]", cat === c.id ? "border-fg bg-fg text-bg" : "border-border", !c.active && "opacity-50")}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm">
              {!items.length ? (
                <p className="p-10 text-center text-[13.5px] text-muted">Nothing here yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                      {i.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.image} alt="" className="size-12 shrink-0 rounded-[12px] object-cover" />
                      ) : (
                        <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-surface-2 text-subtle">
                          <ImageIcon className="size-4" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[14px] font-medium">
                          <DietMark diet={i.diet} />
                          <span className="truncate">{i.name}</span>
                          {i.spice > 0 && <span className="text-[11px] text-danger">{"🌶".repeat(i.spice)}</span>}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                          <span>{catName(i.categoryId)}</span>
                          <span className="flex items-center gap-0.5"><Clock className="size-3" />{i.prepMinutes}m</span>
                          {i.modifierGroupIds.length > 0 && <span>{i.modifierGroupIds.length} add-on group{i.modifierGroupIds.length > 1 ? "s" : ""}</span>}
                          {i.barItemId && <span>🍸 {i.pourMl} ml pour</span>}
                          {i.tags.map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                        </p>
                      </div>
                      <span className="text-[14px] font-semibold tabular-nums">{money(i.price)}</span>
                      <Switch checked={i.available} onChange={(v) => avail.mutate({ id: i.id, available: v })} label={i.available ? `${i.name} is available` : `${i.name} is sold out`} />
                      <Menu
                        label={`Actions for ${i.name}`}
                        trigger={(p) => (
                          <button {...p} aria-label={`Actions for ${i.name}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
                            <MoreHorizontal className="size-4" />
                          </button>
                        )}
                        items={[
                          { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditItem(i) },
                          { label: "Duplicate", icon: <Copy className="size-4" />, onSelect: () => setEditItem({ ...i, id: undefined, name: `${i.name} (copy)` }) },
                          "separator",
                          { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel({ kind: "menu-items", id: i.id, name: i.name }) },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ))}
      {tab === "categories" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {categories.map((c) => (
            <div key={c.id} className={cx("rounded-[18px] border border-border bg-surface p-4 shadow-sm", !c.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[15px] font-semibold">{c.name}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {cap(c.station)} station · {q.data!.items.filter((i) => i.categoryId === c.id).length} items
                  </p>
                </div>
                <Menu
                  label={`Actions for ${c.name}`}
                  trigger={(p) => (
                    <button {...p} aria-label={`Actions for ${c.name}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
                      <MoreHorizontal className="size-4" />
                    </button>
                  )}
                  items={[
                    { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditCat(c) },
                    { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel({ kind: "categories", id: c.id, name: c.name }) },
                  ]}
                />
              </div>
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12px]">
                <Clock className="size-3" />
                {c.availableFrom && c.availableTo ? `Served ${c.availableFrom}–${c.availableTo}` : "All day"}
              </p>
              {!c.active && <Badge className="ml-2">Hidden</Badge>}
            </div>
          ))}
          <button type="button" onClick={() => setEditCat({})} className="grid min-h-28 place-items-center rounded-[18px] border border-dashed border-border text-[13.5px] text-muted hover:bg-surface-2">
            + New category
          </button>
        </div>
      )}
      {tab === "addons" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modifiers.map((g) => (
            <div key={g.id} className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[15px] font-semibold">{g.name}</p>
                  <p className="text-[12.5px] text-muted">
                    {g.minSelect ? `Required · pick ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : `Optional · up to ${g.maxSelect}`} · used by {q.data!.items.filter((i) => i.modifierGroupIds.includes(g.id)).length}
                  </p>
                </div>
                <Menu
                  label={`Actions for ${g.name}`}
                  trigger={(p) => (
                    <button {...p} aria-label={`Actions for ${g.name}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
                      <MoreHorizontal className="size-4" />
                    </button>
                  )}
                  items={[
                    { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditGroup(g) },
                    { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel({ kind: "modifiers", id: g.id, name: g.name }) },
                  ]}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {g.options.map((o) => (
                  <span key={o.id} className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px]">
                    {o.name}
                    {o.price ? ` +${money(o.price)}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setEditGroup({})} className="grid min-h-28 place-items-center rounded-[18px] border border-dashed border-border p-4 text-center text-[13.5px] text-muted hover:bg-surface-2">
            + New add-on group
            <span className="block text-[12px]">Sizes, milk choices, extra toppings, spice level…</span>
          </button>
        </div>
      )}
      {editItem && <ItemDialog init={editItem} data={q.data} onClose={() => setEditItem(null)} />}
      {editCat && <CategoryDialog init={editCat} onClose={() => setEditCat(null)} />}
      {editGroup && <GroupDialog init={editGroup} onClose={() => setEditGroup(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} destructive title={`Delete ${del?.name}?`} description={del?.kind === "categories" ? "Every dish in this category is deleted too. Past orders keep their records." : "Past orders keep their records."} confirmLabel="Delete" />
    </div>
  );
}

function ItemDialog({ init, data, onClose }: { init: Partial<Item>; data: MenuData; onClose: () => void }) {
  const { venue } = useH();
  const money = useMoney();
  const bar = useHQuery<{ items: BarItem[] }>("bar");
  const [f, setF] = useState({
    categoryId: init.categoryId ?? data.categories[0]?.id ?? "",
    name: init.name ?? "",
    description: init.description ?? "",
    price: init.price !== undefined ? toMajor(init.price) : "",
    image: init.image ?? "",
    diet: init.diet ?? "veg",
    spice: init.spice ?? 0,
    tags: (init.tags ?? []).join(", "),
    available: init.available ?? true,
    prepMinutes: init.prepMinutes ?? 15,
    taxBps: init.taxBps === null || init.taxBps === undefined ? "" : String(init.taxBps / 100),
    modifierGroupIds: init.modifierGroupIds ?? [],
    barItemId: init.barItemId ?? "",
    pourMl: init.pourMl ? String(init.pourMl) : "",
    code: init.code ?? "",
    recipe: (init.recipe ?? []).map((l) => ({ stockItemId: l.stockItemId, qty: String(l.qty) })),
  });
  const stock = useHQuery<{ items: StockItem[] }>("stock");
  const stockItems = stock.data?.items ?? [];
  const recipeCost = f.recipe.reduce((a, l) => {
    const s = stockItems.find((x) => x.id === l.stockItemId);
    return a + (s ? (s.costPerPack * (Number(l.qty) || 0)) / s.packSize : 0);
  }, 0);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useHAction<void>(
    () => ({
      path: init.id ? `menu-items/${init.id}` : "menu-items",
      method: init.id ? "PUT" : "POST",
      body: {
        categoryId: f.categoryId,
        name: f.name,
        description: f.description,
        price: toMinor(f.price),
        image: f.image,
        diet: f.diet,
        spice: f.spice,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6),
        available: f.available,
        prepMinutes: Number(f.prepMinutes) || 0,
        taxBps: f.taxBps === "" ? null : Math.round(Number(f.taxBps) * 100),
        modifierGroupIds: f.modifierGroupIds,
        barItemId: f.barItemId || null,
        pourMl: f.barItemId ? Number(f.pourMl) || null : null,
        code: f.code.trim(),
        recipe: f.recipe.filter((l) => l.stockItemId && Number(l.qty) > 0).map((l) => ({ stockItemId: l.stockItemId, qty: Math.round(Number(l.qty)) })),
        sort: init.sort ?? 0,
      },
    }),
    { success: init.id ? "Saved" : "Added to the menu", onDone: onClose },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={init.id ? `Edit ${init.name}` : "New dish or drink"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || f.price === ""} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={100} placeholder="Truffle mushroom risotto" autoFocus />}</Field>
        <Field label="Description" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={400} placeholder="Arborio rice, wild mushrooms, parmesan, truffle oil" />}</Field>
        <Field label="Category">
          {(a) => (
            <Select {...a} value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`Price (${venue.currency}, before GST)`}>{(a) => <Input {...a} inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="450" />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-2 text-[13px] font-medium">Food type</p>
          <div className="flex flex-wrap gap-2">
            {DIETS.map((d) => (
              <button key={d} type="button" onClick={() => set("diet", d)} aria-pressed={f.diet === d} className={cx("flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px]", f.diet === d ? "border-fg bg-surface-2 font-semibold" : "border-border")}>
                <DietMark diet={d} />
                {DIET_LABEL[d] || "Not shown"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Spice level</p>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((s) => (
              <button key={s} type="button" onClick={() => set("spice", s)} aria-pressed={f.spice === s} aria-label={`Spice ${s}`} className={cx("flex h-9 min-w-10 items-center justify-center rounded-full border px-2 text-[13px]", f.spice === s ? "border-fg bg-surface-2" : "border-border")}>
                {s ? Array.from({ length: s }, (_, i) => <Flame key={i} className="size-3.5 text-danger" />) : "None"}
              </button>
            ))}
          </div>
        </div>
        <Field label="Ready in (minutes)">{(a) => <Input {...a} type="number" min={0} max={240} value={f.prepMinutes} onChange={(e) => set("prepMinutes", Number(e.target.value))} />}</Field>
        <Field label="Tags" hint="Comma separated — e.g. Chef's special, Bestseller, Jain" className="sm:col-span-2">{(a) => <Input {...a} value={f.tags} onChange={(e) => set("tags", e.target.value)} />}</Field>
        <Field label="POS code" hint="Type it on the POS and press Enter — e.g. BC for butter chicken.">{(a) => <Input {...a} value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase().slice(0, 12))} placeholder="BC" />}</Field>
        <div />
        <Field label="Photo link" hint="https:// image link — shows on the QR menu." className="sm:col-span-2">{(a) => <Input {...a} value={f.image} onChange={(e) => set("image", e.target.value)} placeholder="https://…" />}</Field>
        <Field label="GST override (%)" hint={`Blank uses the venue rate (${venue.taxBps / 100}%).`}>{(a) => <Input {...a} inputMode="decimal" value={f.taxBps} onChange={(e) => set("taxBps", e.target.value)} />}</Field>
        <div className="flex items-end pb-2">
          <Toggle checked={f.available} onChange={(v) => set("available", v)} label="Available to order" />
        </div>
        {data.modifiers.length > 0 && (
          <div className="sm:col-span-2">
            <p className="mb-2 text-[13px] font-medium">Add-ons & variants</p>
            <div className="flex flex-wrap gap-2">
              {data.modifiers.map((g) => {
                const on = f.modifierGroupIds.includes(g.id);
                return (
                  <button key={g.id} type="button" aria-pressed={on} onClick={() => set("modifierGroupIds", on ? f.modifierGroupIds.filter((x) => x !== g.id) : [...f.modifierGroupIds, g.id])} className={cx("h-8 rounded-full border px-3 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border")}>
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="rounded-[14px] bg-surface-2 p-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium">🥘 Recipe — ingredients per serve</p>
            {f.recipe.length > 0 && f.price !== "" && (
              <span className="text-[12px] text-muted">
                Cost {money(Math.round(recipeCost))} · food cost <b className={cx(toMinor(f.price) && recipeCost / toMinor(f.price) > 0.4 ? "text-danger" : "text-fg")}>{toMinor(f.price) ? ((recipeCost / toMinor(f.price)) * 100).toFixed(1) : "—"}%</b>
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted">Each one sent to the kitchen takes these out of Kitchen stock.</p>
          {!stockItems.length ? (
            <p className="mt-2 text-[12px] text-muted">Add ingredients under Kitchen stock first.</p>
          ) : (
            <div className="mt-2 grid gap-1.5">
              {f.recipe.map((l, i) => {
                const unit = stockItems.find((x) => x.id === l.stockItemId)?.unit ?? "";
                return (
                  <div key={i} className="grid grid-cols-[1fr_110px_32px] items-center gap-2">
                    <Select aria-label="Ingredient" value={l.stockItemId} onChange={(e) => set("recipe", f.recipe.map((x, j) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}>
                      {stockItems.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                    <Input aria-label={`Quantity (${unit})`} inputMode="numeric" value={l.qty} placeholder={unit} onChange={(e) => set("recipe", f.recipe.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                    <button type="button" aria-label="Remove ingredient" onClick={() => set("recipe", f.recipe.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-full text-muted hover:text-danger">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
              <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-4" />} onClick={() => set("recipe", [...f.recipe, { stockItemId: stockItems[0].id, qty: "" }])}>
                Add an ingredient
              </Button>
            </div>
          )}
        </div>
        <div className="rounded-[14px] bg-surface-2 p-3 sm:col-span-2">
          <p className="text-[13px] font-medium">🍸 Pour from a bar bottle</p>
          <p className="text-[12px] text-muted">Each one sold takes this many millilitres out of bar stock.</p>
          <div className="mt-2 grid grid-cols-[1fr_120px] gap-2">
            <Select aria-label="Bar bottle" value={f.barItemId} onChange={(e) => set("barItemId", e.target.value)}>
              <option value="">Not linked</option>
              {(bar.data?.items ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.bottleMl} ml)
                </option>
              ))}
            </Select>
            <Input aria-label="Pour (ml)" inputMode="numeric" value={f.pourMl} onChange={(e) => set("pourMl", e.target.value)} placeholder="60 ml" disabled={!f.barItemId} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function CategoryDialog({ init, onClose }: { init: Partial<Category>; onClose: () => void }) {
  const { venue } = useH();
  const [f, setF] = useState({ name: init.name ?? "", station: init.station ?? venue.settings.kitchen.stations[0], availableFrom: init.availableFrom ?? "", availableTo: init.availableTo ?? "", active: init.active ?? true, sort: init.sort ?? 0 });
  const save = useHAction<void>(() => ({ path: init.id ? `categories/${init.id}` : "categories", method: init.id ? "PUT" : "POST", body: f }), { success: "Saved", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "New category"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Breakfast" autoFocus />}</Field>
        <Field label="Sends tickets to" hint="Stations are set under Settings.">
          {(a) => (
            <Select {...a} value={f.station} onChange={(e) => setF({ ...f, station: e.target.value })}>
              {venue.settings.kitchen.stations.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Served from" hint="Blank = all day">{(a) => <Input {...a} type="time" value={f.availableFrom} onChange={(e) => setF({ ...f, availableFrom: e.target.value })} />}</Field>
          <Field label="Until">{(a) => <Input {...a} type="time" value={f.availableTo} onChange={(e) => setF({ ...f, availableTo: e.target.value })} />}</Field>
        </div>
        <Field label="Order on the menu">{(a) => <Input {...a} type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: Number(e.target.value) || 0 })} />}</Field>
        <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Show on the menu" />
      </div>
    </Dialog>
  );
}

function GroupDialog({ init, onClose }: { init: Partial<Group>; onClose: () => void }) {
  const [name, setName] = useState(init.name ?? "");
  const [min, setMin] = useState(init.minSelect ?? 0);
  const [max, setMax] = useState(init.maxSelect ?? 1);
  const [opts, setOpts] = useState((init.options ?? [{ id: "", name: "", price: 0 }]).map((o) => ({ ...o, priceText: o.price ? toMajor(o.price) : "" })));
  const clean = opts.filter((o) => o.name.trim()).map((o) => ({ id: o.id, name: o.name.trim(), price: toMinor(o.priceText) }));
  // New choices get a short id when saved; existing ones keep theirs so past orders still match.
  const save = useHAction<void>(() => ({ path: init.id ? `modifiers/${init.id}` : "modifiers", method: init.id ? "PUT" : "POST", body: { name, minSelect: min, maxSelect: Math.max(max, min, 1), options: clean.map((o) => ({ ...o, id: o.id || crypto.randomUUID().slice(0, 8) })) } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "New add-on group"}
      description="A group of choices — e.g. Size (pick 1), Milk (pick 1), Extra toppings (up to 4)."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !clean.length} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Group name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="Size" autoFocus />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Guests must pick at least" hint="0 = optional">{(a) => <Input {...a} type="number" min={0} max={10} value={min} onChange={(e) => setMin(Math.max(0, Number(e.target.value) || 0))} />}</Field>
          <Field label="At most">{(a) => <Input {...a} type="number" min={1} max={20} value={max} onChange={(e) => setMax(Math.max(1, Number(e.target.value) || 1))} />}</Field>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Choices</p>
          <div className="grid gap-2">
            {opts.map((o, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_auto] gap-2">
                <Input aria-label="Choice" value={o.name} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={i ? "Large" : "Regular"} />
                <Input aria-label="Extra price" inputMode="decimal" value={o.priceText} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, priceText: e.target.value } : x)))} placeholder="+ 0" />
                <button type="button" aria-label="Remove choice" onClick={() => setOpts(opts.filter((_, j) => j !== i))} className="grid size-8 place-items-center self-center rounded-full text-muted hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setOpts([...opts, { id: "", name: "", price: 0, priceText: "" }])}>
            Add a choice
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
