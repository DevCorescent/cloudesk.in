// Product catalogues: a saved choice of products plus a look, rendered live
// from the store's real products. One page serves every purpose: on screen it
// is a shoppable catalogue (quantities, checkout or WhatsApp order); printed,
// it lays out as A4 brochure pages, which is how "Download PDF" works.
import { z } from "zod";
import { esc, safeImageUrl } from "../site/html";
import { formatPrice } from "./money";
import type { Catalog, SfProduct } from "./storefront";

export const CATALOGUE_TEMPLATES = [
  { id: "studio", name: "Studio", blurb: "Clean white grid, product first" },
  { id: "editorial", name: "Editorial", blurb: "Magazine serif on warm paper" },
  { id: "noir", name: "Noir", blurb: "Dark, glossy and luxurious" },
  { id: "pricelist", name: "Price list", blurb: "Compact rows for wholesale" },
] as const;
export type CatalogueTemplate = (typeof CATALOGUE_TEMPLATES)[number]["id"];

const text = (max: number) => z.string().trim().max(max).default("");
const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .regex(/^(https?:\/\/|\/|$)/, "Use an https:// image link")
  .default("");

export const sourceSchema = z.object({
  /** all products | some collections | some tags | hand-picked */
  mode: z.enum(["all", "collections", "tags", "manual"]).default("all"),
  collectionIds: z.array(z.uuid()).max(50).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  /** Hand-picked products, in the order shown. */
  productIds: z.array(z.uuid()).max(2000).default([]),
  excludeIds: z.array(z.uuid()).max(2000).default([]),
  hideSoldOut: z.boolean().default(false),
  sort: z.enum(["manual", "featured", "newest", "title", "price_asc", "price_desc"]).default("featured"),
  groupByCollection: z.boolean().default(true),
});

export const designSchema = z.object({
  template: z.enum(["studio", "editorial", "noir", "pricelist"]).default("studio"),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#1d1d1f"),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
  subtitle: text(160),
  intro: text(600),
  coverImage: imageUrl,
  showPrice: z.boolean().default(true),
  showCompareAt: z.boolean().default(true),
  showStock: z.boolean().default(true),
  showSku: z.boolean().default(false),
  showDescription: z.boolean().default(true),
  showVariants: z.boolean().default(true),
  contactPhone: text(30),
  contactEmail: text(120),
  website: text(200),
  address: text(300),
  terms: text(600),
  /** The PDF's back page carries a QR code to order online. */
  showQr: z.boolean().default(true),
  /** Cover: a full photo, photo beside the title, or type only. */
  coverStyle: z.enum(["image", "split", "minimal"]).default("image"),
  /** Typeface: the look's own, or a modern sans, a classic serif, a rounded face. */
  font: z.enum(["theme", "modern", "classic", "rounded"]).default("theme"),
  /** "New" on products added in the last `newDays` days. */
  showNew: z.boolean().default(true),
  newDays: z.number().int().min(3).max(90).default(30),
  /** "Bestseller" on the store's top sellers of the last 90 days (from real orders). */
  showBestseller: z.boolean().default(true),
  /** Search box and section filters for buyers (catalogues with more than 6 products). */
  showSearch: z.boolean().default(true),
});

export const orderingSchema = z.object({
  /** Shoppers can check out through the store (needs a published store with payments). */
  checkout: z.boolean().default(true),
  /** WhatsApp number that receives orders; empty turns WhatsApp orders off. */
  whatsapp: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{0,20}$/, "Digits only, with country code")
    .default(""),
  /** A line shown above the order buttons, e.g. "Ships in 2 days". */
  note: text(200),
  /** Smallest order total accepted, in minor units (0 = none). */
  minOrder: z.number().int().min(0).max(1_000_000_000).default(0),
  /** Smallest quantity per item (wholesale MOQ). */
  moq: z.number().int().min(1).max(99).default(1),
  /** One of the store's discount codes, applied automatically at checkout. */
  offerCode: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9_-]*$/, "Letters, numbers, dashes and underscores only")
    .transform((v) => v.toUpperCase())
    .default(""),
  /** WhatsApp orders ask for the buyer's name and phone. */
  askBuyer: z.boolean().default(false),
  /** Hide prices; buyers send an enquiry on WhatsApp instead of checking out. */
  priceOnRequest: z.boolean().default(false),
});

export const catalogueInputSchema = z.object({
  title: z.string().trim().min(1, "Give the catalogue a name").max(120),
  source: sourceSchema.prefault({}),
  design: designSchema.prefault({}),
  ordering: orderingSchema.prefault({}),
  published: z.boolean().default(true),
  startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
  /** null keeps the current code, "" removes it, anything else sets a new one. */
  accessCode: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v === "" || v.length >= 4, "Use at least 4 characters")
    .nullable()
    .default(null),
  /** Let other websites show the catalogue in a frame. */
  allowEmbed: z.boolean().default(false),
});

/** Where a visit came from: shared links carry ?via=<channel>. */
export const CATALOGUE_CHANNELS = ["direct", "link", "whatsapp", "qr", "email", "sms", "pdf", "facebook", "x", "linkedin", "telegram", "pinterest", "native", "embed", "text"] as const;
export type CatalogueChannel = (typeof CATALOGUE_CHANNELS)[number];
export const channelOf = (v: string | null | undefined): CatalogueChannel => ((CATALOGUE_CHANNELS as readonly string[]).includes(v ?? "") ? (v as CatalogueChannel) : "direct");
export const CHANNEL_LABEL: Record<CatalogueChannel, string> = { direct: "Direct", link: "Copied link", whatsapp: "WhatsApp", qr: "QR code", email: "Email", sms: "SMS", pdf: "PDF", facebook: "Facebook", x: "X", linkedin: "LinkedIn", telegram: "Telegram", pinterest: "Pinterest", native: "Phone share", embed: "Embedded", text: "Text list" };
export type CatalogueInput = z.infer<typeof catalogueInputSchema>;
export type CatalogueSource = z.infer<typeof sourceSchema>;
export type CatalogueDesign = z.infer<typeof designSchema>;
export type CatalogueOrdering = z.infer<typeof orderingSchema>;

export type CatalogueSection = { title: string; products: SfProduct[] };

const lowest = (p: SfProduct) => Math.min(...p.variants.map((v) => v.price));
const soldOut = (p: SfProduct) => p.variants.every((v) => v.available <= 0);

/** The products a catalogue shows right now, in order and in sections. */
export function selectProducts(catalog: Catalog, s: CatalogueSource): { sections: CatalogueSection[]; count: number } {
  let list = catalog.products.filter((p) => !p.isSample && p.variants.length);
  if (s.mode === "collections") {
    const want = new Set(s.collectionIds);
    list = list.filter((p) => p.collectionIds.some((c) => want.has(c)));
  } else if (s.mode === "tags") {
    const want = new Set(s.tags.map((t) => t.toLowerCase()));
    list = list.filter((p) => p.tags.some((t) => want.has(t.toLowerCase())));
  } else if (s.mode === "manual") {
    const at = new Map(s.productIds.map((id, i) => [id, i]));
    list = list.filter((p) => at.has(p.id));
    if (s.sort === "manual") list.sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  }
  if (s.excludeIds.length) {
    const out = new Set(s.excludeIds);
    list = list.filter((p) => !out.has(p.id));
  }
  if (s.hideSoldOut) list = list.filter((p) => !soldOut(p));
  const by: Record<string, (a: SfProduct, b: SfProduct) => number> = {
    featured: (a, b) => Number(b.featured) - Number(a.featured),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    title: (a, b) => a.title.localeCompare(b.title),
    price_asc: (a, b) => lowest(a) - lowest(b),
    price_desc: (a, b) => lowest(b) - lowest(a),
  };
  if (by[s.sort]) list = [...list].sort(by[s.sort]);

  if (!s.groupByCollection || !catalog.collections.length) return { sections: [{ title: "", products: list }], count: list.length };
  const order = s.mode === "collections" ? s.collectionIds : catalog.collections.map((c) => c.id);
  const sections: CatalogueSection[] = [];
  const placed = new Set<string>();
  for (const cid of order) {
    const c = catalog.collections.find((x) => x.id === cid);
    if (!c) continue;
    const items = list.filter((p) => !placed.has(p.id) && p.collectionIds.includes(cid));
    items.forEach((p) => placed.add(p.id));
    if (items.length) sections.push({ title: c.title, products: items });
  }
  const rest = list.filter((p) => !placed.has(p.id));
  if (rest.length) sections.push({ title: sections.length ? "More" : "", products: rest });
  return { sections, count: list.length };
}

/** The WhatsApp message for an order (or, with prices on request, an enquiry) from a catalogue. */
export function whatsappOrderText(o: { catalogue: string; url: string; lines: { qty: number; title: string; variant: string; price: number }[]; currency: string; name?: string; phone?: string; code?: string; enquiry?: boolean }) {
  const total = o.lines.reduce((a, l) => a + l.qty * l.price, 0);
  const label = (l: { title: string; variant: string }) => `${l.title}${l.variant && l.variant !== "Default" ? ` (${l.variant})` : ""}`;
  return [
    o.enquiry ? `Hi! I'd like a quote from your catalogue “${o.catalogue}”:` : `Hi! I'd like to order from your catalogue “${o.catalogue}”:`,
    "",
    ...o.lines.map((l) => (o.enquiry ? `• ${l.qty} × ${label(l)}` : `• ${l.qty} × ${label(l)} — ${formatPrice(l.price * l.qty, o.currency)}`)),
    "",
    ...(o.enquiry ? [] : [`Total: ${formatPrice(total, o.currency)}`]),
    ...(o.code && !o.enquiry ? [`Offer code: ${o.code}`] : []),
    ...(o.name ? [`Name: ${o.name}`] : []),
    ...(o.phone ? [`Phone: ${o.phone}`] : []),
    `Catalogue: ${o.url}`,
  ].join("\n");
}

// ─── Page ────────────────────────────────────────────────────────────────────

export type CataloguePageCtx = {
  title: string;
  storeName: string;
  currency: string;
  design: CatalogueDesign;
  ordering: { checkout: boolean; whatsapp: boolean; note: string; minOrder: number; moq: number; offerCode: string; askBuyer: boolean; priceOnRequest: boolean };
  /** Product ids that are the store's current bestsellers. */
  bestsellers: string[];
  /** Products created on or after this ISO date count as new. */
  newSince: string;
  /** Where this visit came from (kept with an order). */
  via: string;
  sections: CatalogueSection[];
  count: number;
  /** Absolute link to this catalogue (QR codes, sharing). */
  url: string;
  /** SVG of a QR code pointing at `url`. */
  qr: string;
  updatedAt: string;
  message?: { tone: "ok" | "bad"; text: string };
  /** Owner preview inside the editor: no counting, no ordering. */
  preview?: boolean;
};

const THEMES: Record<CatalogueTemplate, string> = {
  studio: "--bg:#fff;--paper:#fff;--ink:#111114;--muted:#6e6e76;--line:#ececf0;--card:#f6f6f8;--font:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;--display:var(--font);--dw:650;--dls:-.035em",
  editorial: "--bg:#f6f1ea;--paper:#fbf8f3;--ink:#1f1a17;--muted:#7a6f66;--line:#e6ddd2;--card:#efe7dc;--font:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;--display:'Didot','Bodoni 72','Iowan Old Style',Georgia,serif;--dw:500;--dls:-.02em",
  noir: "--bg:#0d0d10;--paper:#121216;--ink:#f4f1ea;--muted:#9a978f;--line:#26262c;--card:#1a1a20;--font:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;--display:'Didot','Bodoni 72',Georgia,serif;--dw:500;--dls:-.02em",
  pricelist: "--bg:#f4f4f6;--paper:#fff;--ink:#111114;--muted:#6e6e76;--line:#e4e4e9;--card:#f6f6f8;--font:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;--display:var(--font);--dw:650;--dls:-.03em",
};

const FONTS: Record<CatalogueDesign["font"], string> = {
  theme: "",
  modern: "--font:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;--display:var(--font);--dw:650;--dls:-.04em",
  classic: "--font:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;--display:'Didot','Bodoni 72','Iowan Old Style',Georgia,serif;--dw:500;--dls:-.02em",
  rounded: "--font:ui-rounded,'SF Pro Rounded','Nunito','Varela Round',-apple-system,sans-serif;--display:var(--font);--dw:700;--dls:-.03em",
};

const CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--font);-webkit-font-smoothing:antialiased}
a{color:inherit}img{display:block;max-width:100%}
.bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px clamp(16px,4vw,40px);background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border-bottom:1px solid var(--line)}
.bar b{font-size:15px;letter-spacing:-.01em}.bar small{color:var(--muted);font-size:12.5px}
.tools{display:flex;gap:8px}.tbtn{appearance:none;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:999px;padding:8px 14px;font:600 13px/1 var(--font);cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.tbtn svg{width:15px;height:15px}
.wrap{max-width:1240px;margin:0 auto;padding:0 clamp(16px,4vw,40px)}
.cover{position:relative;margin:clamp(16px,3vw,28px) auto 0;max-width:1240px;padding:0 clamp(16px,4vw,40px)}
.cover-in{position:relative;overflow:hidden;border-radius:28px;min-height:clamp(320px,52vw,560px);display:flex;align-items:flex-end;background:var(--card)}
.cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.collage{position:absolute;inset:0;display:grid;grid-template-columns:1.3fr 1fr;grid-template-rows:1fr 1fr;gap:4px}.collage img{width:100%;height:100%;object-fit:cover}.collage img:first-child{grid-row:span 2}
.cover-in:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgb(0 0 0/0) 35%,rgb(0 0 0/.62))}
.cover-text{position:relative;z-index:1;padding:clamp(22px,4vw,48px);color:#fff;max-width:760px}
.eyebrow{font:600 11.5px/1 var(--font);letter-spacing:.18em;text-transform:uppercase;opacity:.8}
.cover h1{margin:14px 0 0;font:var(--dw) clamp(2.2rem,6vw,4.6rem)/1 var(--display);letter-spacing:var(--dls)}
.cover p{margin:14px 0 0;font-size:clamp(15px,1.6vw,18px);opacity:.88;max-width:560px}
.meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px;font-size:13px;opacity:.85}
.intro{max-width:720px;margin:clamp(28px,5vw,56px) auto 0;text-align:center;color:var(--muted);font-size:17px;padding:0 20px}
.chips{display:flex;gap:8px;overflow-x:auto;padding:22px clamp(16px,4vw,40px) 0;max-width:1240px;margin:0 auto;scrollbar-width:none}.chips::-webkit-scrollbar{display:none}
.chips a{flex:none;text-decoration:none;border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:8px 14px;font-size:13px;font-weight:600}
.sec{padding:clamp(28px,5vw,56px) 0 0}.sec h2{font:var(--dw) clamp(1.5rem,3vw,2.2rem)/1.1 var(--display);letter-spacing:var(--dls);margin:0 0 18px;display:flex;align-items:baseline;gap:12px}
.sec h2 small{font:500 13px var(--font);color:var(--muted);letter-spacing:0}
.grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:clamp(14px,2vw,26px)}
@media(max-width:900px){.grid{--cols:2!important}}@media(max-width:420px){.grid{gap:12px}}
.card{display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden;break-inside:avoid}
.ph{position:relative;aspect-ratio:4/5;background:var(--card);overflow:hidden}.ph img{width:100%;height:100%;object-fit:cover;transition:transform .8s cubic-bezier(.2,.8,.2,1)}.card:hover .ph img{transform:scale(1.04)}
.badge{position:absolute;top:12px;left:12px;padding:5px 9px;border-radius:999px;font:700 11px/1 var(--font);background:var(--accent);color:var(--accent-ink)}.badge.out{background:rgb(0 0 0/.72);color:#fff}
.body{padding:16px 16px 18px;display:flex;flex-direction:column;gap:6px;flex:1}
.body h3{margin:0;font:600 15.5px/1.3 var(--font);letter-spacing:-.01em}
.desc{margin:0;color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.price{display:flex;align-items:baseline;gap:8px;font-weight:650;font-variant-numeric:tabular-nums}.price s{color:var(--muted);font-weight:400;font-size:13px}
.sku,.stock{font-size:12px;color:var(--muted)}.stock.low{color:#c2410c;font-weight:600}
.vars{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px}
.var{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:10px;font-size:13px;padding-top:6px;border-top:1px solid var(--line)}
.var .vp{font-variant-numeric:tabular-nums;font-weight:600}.var.off{opacity:.45}
.qty{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;background:var(--bg)}
.qty button{appearance:none;border:0;background:none;width:30px;height:30px;font:600 16px/1 var(--font);color:var(--ink);cursor:pointer}
.qty input{width:34px;border:0;background:none;text-align:center;font:600 13px var(--font);color:var(--ink);-moz-appearance:textfield}.qty input::-webkit-outer-spin-button,.qty input::-webkit-inner-spin-button{-webkit-appearance:none}
.rows{background:var(--paper);border:1px solid var(--line);border-radius:20px;overflow:hidden}
.row{display:grid;grid-template-columns:64px 1fr auto auto;gap:16px;align-items:center;padding:12px 16px;border-top:1px solid var(--line);break-inside:avoid}.row:first-child{border-top:0}
.row img,.row .noimg{width:64px;height:64px;border-radius:12px;object-fit:cover;background:var(--card)}
.row h3{margin:0;font:600 14.5px/1.3 var(--font)}.row .sub{font-size:12px;color:var(--muted)}
@media(max-width:640px){.row{grid-template-columns:52px 1fr;}.row img,.row .noimg{width:52px;height:52px}.row .rp,.row .rq{grid-column:2}}
.contact{margin:clamp(40px,7vw,80px) auto 0;max-width:1240px;padding:0 clamp(16px,4vw,40px)}
.contact-in{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;background:var(--paper);border:1px solid var(--line);border-radius:24px;padding:clamp(20px,3vw,32px)}
.contact h2{margin:0;font:var(--dw) 1.4rem/1.2 var(--display)}.contact ul{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:4px;color:var(--muted);font-size:14px}
.terms{margin-top:12px;font-size:12.5px;color:var(--muted);white-space:pre-line}
.qr{width:120px;height:120px;background:#fff;border-radius:14px;padding:6px}.qr svg{width:100%;height:100%}
.qrcap{font-size:11.5px;color:var(--muted);text-align:center;margin-top:6px}
.foot{text-align:center;color:var(--muted);font-size:12px;padding:36px 16px 140px}
.order{position:fixed;left:50%;bottom:16px;z-index:30;transform:translate(-50%,140%);opacity:0;transition:transform .45s cubic-bezier(.2,.9,.2,1),opacity .3s;width:min(760px,calc(100% - 24px));display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 14px;padding:10px 10px 10px 20px;border-radius:999px;background:rgb(20 20 24/.88);color:#fff;backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);box-shadow:0 24px 60px -24px rgb(0 0 0/.6)}
.order.on{transform:translate(-50%,0);opacity:1}.order .sum{font-size:14px}.order .sum b{font-size:16px;font-variant-numeric:tabular-nums}.order .note{display:block;font-size:11.5px;opacity:.7}
.order .acts{display:flex;gap:8px}.obtn{appearance:none;border:0;border-radius:999px;padding:12px 18px;font:650 14px/1 var(--font);cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.obtn.primary{background:#fff;color:#111}.obtn.wa{background:#25d366;color:#06290f}.obtn:disabled{opacity:.45;cursor:not-allowed}
@media(max-width:560px){.order{border-radius:22px;padding:12px}.order .acts{width:100%}.obtn{flex:1;justify-content:center;padding:12px 10px}.obtn .lg{display:none}}@media(prefers-reduced-motion:reduce){.order{transition:none}}
.msg{max-width:1240px;margin:16px auto 0;padding:0 clamp(16px,4vw,40px)}.msg div{padding:12px 16px;border-radius:14px;font-size:14px}.msg .ok{background:#dcfce7;color:#14532d}.msg .bad{background:#fee2e2;color:#7f1d1d}
.empty{text-align:center;padding:80px 20px;color:var(--muted)}
.cover-split .cover-in{display:grid;grid-template-columns:1.05fr 1fr;align-items:stretch;background:var(--paper);border:1px solid var(--line)}
.cover-split .cover-in:after{display:none}.cover-split .cover-text{color:var(--ink);align-self:center}.cover-split .media{position:relative;min-height:clamp(260px,40vw,520px)}
.cover-split .media img,.cover-split .media .collage{position:absolute;inset:0}
.cover-minimal .cover-in{min-height:clamp(240px,34vw,400px);background:radial-gradient(120% 140% at 0% 0%,color-mix(in srgb,var(--accent) 22%,var(--paper)),var(--paper) 60%);border:1px solid var(--line)}
.cover-minimal .cover-in:after{display:none}.cover-minimal .cover-text{color:var(--ink)}
@media(max-width:760px){.cover-split .cover-in{grid-template-columns:1fr}.cover-split .media{min-height:260px;order:-1}}
.badges{position:absolute;top:12px;left:12px;display:flex;flex-wrap:wrap;gap:6px}.badges .badge{position:static}
.badge.new{background:var(--paper);color:var(--ink);box-shadow:0 0 0 1px var(--line)}.badge.best{background:#111;color:#ffd166}
.offer{max-width:1240px;margin:18px auto 0;padding:0 clamp(16px,4vw,40px)}.offer div{display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:16px;background:color-mix(in srgb,var(--accent) 12%,var(--paper));border:1px dashed color-mix(in srgb,var(--accent) 60%,transparent);font-size:14px}
.offer code{font:700 14px ui-monospace,Menlo,monospace;padding:4px 10px;border-radius:8px;background:var(--accent);color:var(--accent-ink);letter-spacing:.06em}
.tools2{position:sticky;top:57px;z-index:15;max-width:1240px;margin:22px auto 0;padding:10px clamp(16px,4vw,40px);display:flex;gap:10px;align-items:center;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.search{flex:1;max-width:360px;display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;border:1px solid var(--line);background:var(--paper)}.search input{flex:1;border:0;outline:0;background:none;font:inherit;color:var(--ink);min-width:0}
.filters{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}.filters::-webkit-scrollbar{display:none}
.filters button{flex:none;appearance:none;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:999px;padding:9px 14px;font:600 13px var(--font);cursor:pointer}.filters button[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.noresult{display:none;text-align:center;color:var(--muted);padding:40px 0}
.buyer{display:none;width:100%;gap:8px}.order.on .buyer{display:flex}.buyer input{flex:1;min-width:0;border:0;border-radius:999px;padding:11px 14px;font:inherit;font-size:14px;background:rgb(255 255 255/.12);color:#fff;outline:0}.buyer input::placeholder{color:rgb(255 255 255/.55)}
.order .hint{display:block;font-size:11.5px;color:#ffd166}
.lock{min-height:100vh;display:grid;place-items:center;padding:24px}.lock-card{width:min(440px,100%);background:var(--paper);border:1px solid var(--line);border-radius:28px;padding:36px;text-align:center;box-shadow:0 30px 80px -40px rgb(0 0 0/.35)}
.lock-card h1{font:var(--dw) 2rem/1.1 var(--display);letter-spacing:var(--dls);margin:14px 0 6px}.lock-card p{color:var(--muted);margin:0 0 20px}
.lock-card input{width:100%;border:1px solid var(--line);border-radius:14px;padding:14px 16px;font:600 18px var(--font);text-align:center;letter-spacing:.2em;background:var(--bg);color:var(--ink)}
.lock-card button{margin-top:12px;width:100%;appearance:none;border:0;border-radius:14px;padding:14px;font:700 15px var(--font);background:var(--accent);color:var(--accent-ink);cursor:pointer}
.print-only{display:none}
@page{size:A4;margin:12mm}
@media print{
  body{background:var(--paper);font-size:11.5px}
  .bar,.order,.chips,.qty,.msg,.tools2,.no-print{display:none!important}.print-only{display:block}
  .cover{padding:0;margin:0}.cover-in{border-radius:0;min-height:0;height:273mm;break-after:page}
  .cover h1{font-size:44pt}.intro{margin:0 auto 8mm;font-size:12pt}
  .wrap{padding:0;max-width:none}.sec{padding-top:6mm;break-before:auto}.sec h2{font-size:18pt;margin-bottom:5mm;break-after:avoid;page-break-after:avoid}
  .grid{gap:5mm;--cols:var(--pcols)!important}.card{border-radius:4mm}.ph{aspect-ratio:1/1}.body{padding:3mm}.body h3{font-size:10.5pt}.card:hover .ph img{transform:none}
  .row{padding:2.5mm 4mm}.rows{border-radius:4mm}
  .contact{break-before:page;margin-top:0;padding:0}.contact-in{border:0;padding:0}
  .foot{padding:6mm 0 0}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;

/** The small script for steppers, the running total, printing and sharing. */
export const CATALOGUE_SCRIPT = `(function(){var f=document.getElementById("cat-order"),B=document.body,cur=B.dataset.cur||"INR",dig=Number(B.dataset.dig||2),moq=Number(B.dataset.moq||1),min=Number(B.dataset.min||0);var loc=cur==="INR"?"en-IN":undefined;var f0=new Intl.NumberFormat(loc,{style:"currency",currency:cur,maximumFractionDigits:0}),f2=new Intl.NumberFormat(loc,{style:"currency",currency:cur});var fmt=function(v){return Math.round(v*100)%100?f2.format(v):f0.format(v)};
function total(){if(!f)return;var n=0,s=0;f.querySelectorAll("input[data-p]").forEach(function(i){var q=Math.max(0,Math.min(Number(i.max)||999,parseInt(i.value)||0));n+=q;s+=q*Number(i.dataset.p)});var c=document.getElementById("cat-count"),t=document.getElementById("cat-total"),h=document.getElementById("cat-hint");if(c)c.textContent=n+" item"+(n===1?"":"s");if(t)t.textContent=fmt(s/Math.pow(10,dig));var short=min>0&&s<min;if(h)h.textContent=short&&n>0?"Add "+fmt((min-s)/Math.pow(10,dig))+" more to order":"";f.querySelectorAll("button[data-need]").forEach(function(b){b.disabled=n===0||(short&&b.dataset.need!=="enquiry")});var bar=document.getElementById("cat-bar");if(bar)bar.classList.toggle("on",n>0)}
function filter(){var q=(document.getElementById("cat-q")||{}).value||"";q=q.trim().toLowerCase();var sec=(document.querySelector(".filters [aria-pressed=true]")||{}).dataset;sec=sec&&sec.sec||"";var any=0;document.querySelectorAll(".sec").forEach(function(s){var show=0;s.querySelectorAll("[data-q]").forEach(function(it){var ok=(!q||it.dataset.q.indexOf(q)>-1)&&(!sec||s.id===sec);it.style.display=ok?"":"none";if(ok)show++});s.style.display=show?"":"none";any+=show});var nr=document.getElementById("cat-none");if(nr)nr.style.display=any?"none":"block"}
document.addEventListener("click",function(e){var b=e.target.closest("[data-step]");if(b){var i=b.parentNode.querySelector("input"),v=parseInt(i.value)||0,d=Number(b.dataset.step),mx=Number(i.max)||999;v=d>0?(v<moq?moq:v+1):(v-1<moq?0:v-1);i.value=Math.max(0,Math.min(mx,v));total();return}
var fb=e.target.closest(".filters button");if(fb){var on=fb.getAttribute("aria-pressed")==="true";document.querySelectorAll(".filters button").forEach(function(x){x.setAttribute("aria-pressed","false")});fb.setAttribute("aria-pressed",on?"false":"true");filter();return}
if(e.target.closest("[data-print]")){window.print();return}
var sh=e.target.closest("[data-share]");if(sh){var u=sh.dataset.share;if(navigator.share){navigator.share({title:document.title,url:u}).catch(function(){})}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){sh.textContent="Link copied"})}}});
document.addEventListener("input",function(e){if(e.target.matches("input[data-p]"))total();if(e.target.id==="cat-q")filter()});total()})();`;

const ICON = {
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  wa: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.2.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.5.4.1.2.1.8-.1 1.4Z"/></svg>',
};

function variantLabel(p: SfProduct, v: SfProduct["variants"][number]) {
  return p.variants.length > 1 ? v.title : "";
}

const digitsOf = (currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
};
const rootStyle = (d: CatalogueDesign) => `:root{${THEMES[d.template]};${FONTS[d.font]};--accent:${d.accent};--accent-ink:${luminance(d.accent) > 0.55 ? "#111" : "#fff"};--cols:${d.columns};--pcols:${Math.min(d.columns, 3)}}`;
const head = (title: string, extra = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>${esc(title)}</title>${extra}`;

/** A private catalogue's door: buyers enter the access code the store gave them. */
export function catalogueLockPage(c: { title: string; storeName: string; design: CatalogueDesign; error?: string; via: string }) {
  return `${head(`${c.title} — ${c.storeName}`)}<style>${rootStyle(c.design)}${CSS}</style></head><body>
<main class="lock"><form class="lock-card" method="post"><div class="eyebrow" style="opacity:.6">${esc(c.storeName)} · Private catalogue</div><h1>${esc(c.title)}</h1><p>Enter the access code you were given to see prices and order.</p>
${c.error ? `<div class="msg" style="padding:0;margin:0 0 12px"><div class="bad">${esc(c.error)}</div></div>` : ""}
<input type="hidden" name="intent" value="unlock"><input type="hidden" name="via" value="${esc(c.via)}"><input name="code" autocomplete="off" required maxlength="40" aria-label="Access code" placeholder="Access code" autofocus><button type="submit">Open catalogue</button></form></main></body></html>`;
}

/** A full HTML document for a catalogue. */
export function cataloguePage(c: CataloguePageCtx, opts: { scriptNonce?: string } = {}) {
  const d = { ...c.design, showPrice: c.design.showPrice && !c.ordering.priceOnRequest };
  const o = c.ordering;
  const tpl = d.template;
  const money = (n: number) => formatPrice(n, c.currency);
  const digits = digitsOf(c.currency);
  const ordering = !c.preview && (o.checkout || o.whatsapp);
  const all = c.sections.flatMap((s) => s.products);
  const best = new Set(d.showBestseller ? c.bestsellers : []);
  const isNew = (p: SfProduct) => d.showNew && p.createdAt >= c.newSince;
  const cover = safeImageUrl(d.coverImage);
  const coverImgs = cover ? [cover] : all.flatMap((p) => p.images.slice(0, 1)).map(safeImageUrl).filter(Boolean).slice(0, 3);
  const searchable = d.showSearch && c.count > 6;
  const q = (p: SfProduct) => esc([p.title, p.vendor, ...p.tags].join(" ").toLowerCase());

  const qty = (v: SfProduct["variants"][number], name: string) =>
    ordering && v.available > 0
      ? `<span class="qty no-print"><button type="button" data-step="-1" aria-label="One less ${esc(name)}">−</button><input type="number" inputmode="numeric" min="0" max="${Math.min(99, v.available)}" value="0" name="q_${esc(v.id)}" data-p="${v.price}" aria-label="Quantity of ${esc(name)}"><button type="button" data-step="1" aria-label="One more ${esc(name)}">+</button></span>`
      : "";
  const priceHtml = (v: SfProduct["variants"][number]) =>
    d.showPrice ? `<span class="price">${esc(money(v.price))}${d.showCompareAt && v.compareAt && v.compareAt > v.price ? ` <s>${esc(money(v.compareAt))}</s>` : ""}</span>` : o.priceOnRequest ? `<span class="price" style="font-weight:500;color:var(--muted)">Price on request</span>` : "";
  const badges = (p: SfProduct, out: boolean, off: number) => {
    const b = [out ? `<span class="badge out">Sold out</span>` : "", !out && best.has(p.id) ? `<span class="badge best">★ Bestseller</span>` : "", !out && off >= 5 && d.showPrice ? `<span class="badge">${off}% off</span>` : "", !out && isNew(p) ? `<span class="badge new">New</span>` : ""].filter(Boolean);
    return b.length ? `<span class="badges">${b.slice(0, 2).join("")}</span>` : "";
  };

  const card = (p: SfProduct) => {
    const v0 = p.variants[0];
    const img = safeImageUrl(p.images[0] ?? "");
    const out = p.variants.every((v) => v.available <= 0);
    const off = d.showCompareAt && v0.compareAt && v0.compareAt > v0.price ? Math.round(((v0.compareAt - v0.price) / v0.compareAt) * 100) : 0;
    const stockLeft = p.variants.reduce((a, v) => a + Math.max(0, v.available), 0);
    const multi = d.showVariants && p.variants.length > 1;
    return `<article class="card" id="p-${esc(p.slug)}" data-q="${q(p)}">
<div class="ph">${img ? `<img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy">` : ""}${badges(p, out, off)}</div>
<div class="body"><h3>${esc(p.title)}</h3>
${d.showDescription && p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
${multi ? "" : `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:6px">${priceHtml(v0)}${qty(v0, p.title)}</div>`}
${d.showSku && !multi && v0.sku ? `<span class="sku">SKU ${esc(v0.sku)}</span>` : ""}
${d.showStock && !out && stockLeft > 0 && stockLeft <= 5 ? `<span class="stock low">Only ${stockLeft} left</span>` : ""}
${multi ? `<ul class="vars">${p.variants.slice(0, 12).map((v) => `<li class="var${v.available <= 0 ? " off" : ""}"><span>${esc(variantLabel(p, v))}${v.available <= 0 ? " · sold out" : ""}</span>${d.showPrice ? `<span class="vp">${esc(money(v.price))}</span>` : "<span></span>"}${qty(v, `${p.title} ${v.title}`) || "<span></span>"}</li>`).join("")}</ul>` : ""}
</div></article>`;
  };
  const row = (p: SfProduct) => {
    const img = safeImageUrl(p.images[0] ?? "");
    return p.variants
      .slice(0, 12)
      .map(
        (v, i) => `<div class="row" data-q="${q(p)}"${v.available <= 0 ? ' style="opacity:.5"' : ""}>${i === 0 && img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
<div><h3>${esc(p.title)}${p.variants.length > 1 ? ` <span class="sub">· ${esc(v.title)}</span>` : ""}${i === 0 && best.has(p.id) ? ` <span class="sub" style="color:#b45309">★ Bestseller</span>` : ""}</h3><div class="sub">${[d.showSku && v.sku ? `SKU ${v.sku}` : "", v.available <= 0 ? "Sold out" : d.showStock && v.available <= 5 ? `Only ${v.available} left` : "", i === 0 && isNew(p) ? "New" : ""].filter(Boolean).map(esc).join(" · ")}</div></div>
<div class="rp">${priceHtml(v)}</div><div class="rq">${qty(v, `${p.title} ${v.title}`)}</div></div>`,
      )
      .join("");
  };

  const sections = c.sections
    .map(
      (s, i) => `<section class="sec" id="s-${i}">${s.title ? `<h2>${esc(s.title)} <small>${s.products.length} item${s.products.length === 1 ? "" : "s"}</small></h2>` : ""}${
        tpl === "pricelist" ? `<div class="rows">${s.products.map(row).join("")}</div>` : `<div class="grid">${s.products.map(card).join("")}</div>`
      }</section>`,
    )
    .join("");

  const contactLines = [d.contactPhone && `Phone / WhatsApp: ${d.contactPhone}`, d.contactEmail && `Email: ${d.contactEmail}`, d.website && d.website.replace(/^https?:\/\//, ""), d.address].filter(Boolean) as string[];
  const media = coverImgs.length > 1 ? `<div class="collage">${coverImgs.map((u) => `<img src="${esc(u)}" alt="">`).join("")}</div>` : coverImgs[0] ? `<img class="cover-img" src="${esc(coverImgs[0])}" alt="">` : "";
  const coverText = `<div class="cover-text"><div class="eyebrow">${esc(c.storeName)} · Catalogue</div><h1>${esc(c.title)}</h1>${d.subtitle ? `<p>${esc(d.subtitle)}</p>` : ""}<div class="meta"><span>${c.count} product${c.count === 1 ? "" : "s"}</span>${o.minOrder ? `<span>Minimum order ${esc(money(o.minOrder))}</span>` : ""}${o.moq > 1 ? `<span>Minimum ${o.moq} per item</span>` : ""}<span>Updated ${esc(c.updatedAt)}</span></div></div>`;
  const coverHtml =
    d.coverStyle === "minimal" ? `<div class="cover cover-minimal"><div class="cover-in">${coverText}</div></div>` : d.coverStyle === "split" ? `<div class="cover cover-split"><div class="cover-in">${coverText}<div class="media">${media}</div></div></div>` : `<div class="cover"><div class="cover-in">${media}${coverText}</div></div>`;
  const bar =
    ordering && c.count
      ? `<div class="order" id="cat-bar" role="region" aria-label="Your order"><div class="sum"><span id="cat-count">0 items</span>${o.priceOnRequest ? "" : ` · <b id="cat-total">${esc(money(0))}</b>`}${o.note ? `<span class="note">${esc(o.note)}</span>` : ""}<span class="hint" id="cat-hint"></span></div><div class="acts">${
          o.whatsapp ? `<button class="obtn wa" type="submit" name="intent" value="whatsapp" data-need="${o.priceOnRequest ? "enquiry" : "order"}" disabled>${ICON.wa}<span>${o.priceOnRequest ? `<span class="lg">Ask for a </span>quote` : `<span class="lg">Order on </span>WhatsApp`}</span></button>` : ""
        }${o.checkout && !o.priceOnRequest ? `<button class="obtn primary" type="submit" name="intent" value="checkout" data-need="order" disabled>Checkout →</button>` : ""}</div>${
          o.askBuyer && o.whatsapp ? `<div class="buyer"><input name="buyer_name" maxlength="80" placeholder="Your name" aria-label="Your name" autocomplete="name"><input name="buyer_phone" maxlength="20" inputmode="tel" placeholder="Phone" aria-label="Your phone" autocomplete="tel"></div>` : ""
        }</div>`
      : "";

  return `${head(`${c.title} — ${c.storeName}`, `<meta property="og:title" content="${esc(c.title)} — ${esc(c.storeName)}"><meta property="og:description" content="${esc(d.subtitle || `${c.count} products from ${c.storeName}`)}">${coverImgs[0] ? `<meta property="og:image" content="${esc(coverImgs[0])}">` : ""}`)}
<style>${rootStyle(d)}${CSS}</style></head>
<body data-cur="${esc(c.currency)}" data-dig="${digits}" data-moq="${o.moq}" data-min="${o.minOrder}">
<header class="bar"><div><b>${esc(c.storeName)}</b> <small>· ${c.count} product${c.count === 1 ? "" : "s"}</small></div>
<div class="tools"><button class="tbtn" type="button" data-print>${ICON.pdf} PDF</button>${c.preview ? "" : `<button class="tbtn" type="button" data-share="${esc(c.url)}">${ICON.share} Share</button>`}</div></header>
${c.message ? `<div class="msg"><div class="${c.message.tone}">${esc(c.message.text)}</div></div>` : ""}
${coverHtml}
${o.offerCode && o.checkout && !o.priceOnRequest ? `<div class="offer"><div><span>🎁 Use <code>${esc(o.offerCode)}</code> — applied automatically when you check out.</span></div></div>` : ""}
${d.intro ? `<p class="intro">${esc(d.intro)}</p>` : ""}
${
  searchable
    ? `<div class="tools2 no-print"><label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="cat-q" type="search" placeholder="Search ${c.count} products" aria-label="Search products"></label>${c.sections.length > 1 ? `<div class="filters" role="group" aria-label="Sections">${c.sections.map((s, i) => (s.title ? `<button type="button" data-sec="s-${i}" aria-pressed="false">${esc(s.title)}</button>` : "")).join("")}</div>` : ""}</div>`
    : c.sections.length > 1
      ? `<nav class="chips" aria-label="Sections">${c.sections.map((s, i) => (s.title ? `<a href="#s-${i}">${esc(s.title)}</a>` : "")).join("")}</nav>`
      : ""
}
<form id="cat-order" method="post"><input type="hidden" name="via" value="${esc(c.via)}"><div class="wrap">${c.count ? sections + `<p class="noresult" id="cat-none">Nothing matches your search.</p>` : `<div class="empty">No products to show yet. Products appear here as soon as they're active in the store.</div>`}</div>
${bar}</form>
${
  contactLines.length || d.terms || d.showQr
    ? `<section class="contact"><div class="contact-in"><div><h2>Order &amp; enquiries</h2>${contactLines.length ? `<ul>${contactLines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}${d.terms ? `<div class="terms">${esc(d.terms)}</div>` : ""}</div>${d.showQr ? `<div><div class="qr">${c.qr}</div><div class="qrcap">Scan to order online</div></div>` : ""}</div></section>`
    : ""
}
<div class="foot">${esc(c.storeName)} · ${esc(c.title)} · Prices and stock as of ${esc(c.updatedAt)}<span class="print-only">${esc(c.url)}</span></div>
<script${opts.scriptNonce ? ` nonce="${esc(opts.scriptNonce)}"` : ""}>${CATALOGUE_SCRIPT}</script>
</body></html>`;
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
