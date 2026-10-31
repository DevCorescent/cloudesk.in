// Promotions: announcement bars, pop-ups, floating buttons and cart upsells.
// Shared by the dashboard (editing and preview) and the server (rendering
// into published pages). Countdowns only ever count to a real end date, and a
// discount code shown to visitors must exist in the store — nothing fake.
import { z } from "zod";
import { esc } from "../site/html";

export const PROMO_KINDS = ["bar", "popup", "floating", "shipping_goal", "cart_upsell"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];
export const KIND_LABEL: Record<PromoKind, string> = { bar: "Announcement bar", popup: "Pop-up", floating: "Floating button", shipping_goal: "Free-delivery progress", cart_upsell: "Cart upsell" };
/** Cart extras need a store; the rest work on any site. */
export const STORE_ONLY: PromoKind[] = ["shipping_goal", "cart_upsell"];

const text = (max: number) => z.string().trim().max(max).default("");
const link = z.string().trim().max(500).regex(/^(\/|#|https:\/\/|mailto:|tel:|$)/, "Use a page path like /shop, or a full https:// link").default("");
const code = z.string().trim().toUpperCase().max(40).regex(/^[A-Z0-9_-]*$/, "Codes use letters, numbers, - and _").default("");

export const targetingSchema = z
  .object({
    /** all | home | shop (shop, products, cart) | paths */
    pages: z.enum(["all", "home", "shop", "paths"]).default("all"),
    paths: z.array(z.string().trim().max(200)).max(20).default([]),
    device: z.enum(["all", "desktop", "mobile"]).default("all"),
  })
  .prefault({});

export const barSchema = z.object({
  messages: z.array(z.string().trim().min(1).max(140)).min(1).max(5),
  linkLabel: text(40),
  linkHref: link,
  tone: z.enum(["accent", "dark", "gradient", "soft"]).default("accent"),
  /** Count down to the promotion's end date. */
  countdown: z.boolean().default(false),
  dismissible: z.boolean().default(true),
  targeting: targetingSchema,
});

export const popupSchema = z.object({
  layout: z.enum(["center", "corner", "sheet"]).default("center"),
  eyebrow: text(60),
  heading: z.string().trim().min(1).max(120),
  body: text(400),
  image: z.string().trim().max(1000).regex(/^(https:\/\/|\/|$)/, "Use an https:// image link").default(""),
  /** What the visitor can do: follow a link, leave an email, or copy a code. */
  action: z.enum(["link", "email", "code"]).default("link"),
  buttonLabel: z.string().trim().min(1).max(40).default("Shop now"),
  buttonHref: link,
  code,
  /** Shown after an email sign-up (and with the code, if any). */
  successHeading: text(120),
  successBody: text(300),
  countdown: z.boolean().default(false),
  trigger: z
    .object({ type: z.enum(["delay", "scroll", "exit", "click"]).default("delay"), delay: z.number().int().min(0).max(120).default(6), scroll: z.number().int().min(5).max(95).default(50) })
    .prefault({}),
  frequency: z.enum(["always", "session", "day", "week", "once"]).default("week"),
  targeting: targetingSchema,
});

export const floatingSchema = z.object({
  label: z.string().trim().min(1).max(40),
  icon: z.enum(["gift", "tag", "chat", "sparkles", "bag"]).default("gift"),
  position: z.enum(["left", "right"]).default("left"),
  /** Open a pop-up (by id) or follow a link. */
  opens: z.string().uuid().nullable().default(null),
  href: link,
  targeting: targetingSchema,
});

export const shippingGoalSchema = z.object({
  /** {amount} is replaced with what's left to spend. */
  progress: z.string().trim().min(1).max(120).default("You're {amount} away from free delivery"),
  reached: z.string().trim().min(1).max(120).default("You've unlocked free delivery 🎉"),
});

export const cartUpsellSchema = z.object({
  heading: z.string().trim().min(1).max(80).default("Complete your order"),
  source: z.enum(["related", "featured"]).default("related"),
  limit: z.number().int().min(1).max(4).default(3),
});

export const CONFIG_SCHEMAS = { bar: barSchema, popup: popupSchema, floating: floatingSchema, shipping_goal: shippingGoalSchema, cart_upsell: cartUpsellSchema } as const;
export type BarConfig = z.infer<typeof barSchema>;
export type PopupConfig = z.infer<typeof popupSchema>;
export type FloatingConfig = z.infer<typeof floatingSchema>;
export type ShippingGoalConfig = z.infer<typeof shippingGoalSchema>;
export type CartUpsellConfig = z.infer<typeof cartUpsellSchema>;

export const promotionInputSchema = z
  .object({
    kind: z.enum(PROMO_KINDS),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(false),
    config: z.record(z.string(), z.unknown()),
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const r = CONFIG_SCHEMAS[v.kind].safeParse(v.config);
    if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", path: ["config", ...i.path.map(String)], message: i.message });
    if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start" });
    const c = v.config as { countdown?: boolean };
    if (c.countdown && !v.endsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "A countdown needs a real end date" });
  });
export type PromotionInput = z.infer<typeof promotionInputSchema>;

export type Promotion = { id: string; kind: PromoKind; name: string; enabled: boolean; config: Record<string, unknown>; startsAt: string | null; endsAt: string | null };

/** live | scheduled | ended | off */
export function promoStatus(p: Pick<Promotion, "enabled" | "startsAt" | "endsAt">, now = Date.now()) {
  if (!p.enabled) return "off" as const;
  if (p.endsAt && Date.parse(p.endsAt) <= now) return "ended" as const;
  if (p.startsAt && Date.parse(p.startsAt) > now) return "scheduled" as const;
  return "live" as const;
}

const SHOP_PATH = /^\/(shop|product|cart|collections?)(\/|$)/;
/** Does a promotion's page targeting include this path? */
export function targets(t: z.infer<typeof targetingSchema>, path: string) {
  if (t.pages === "all") return true;
  if (t.pages === "home") return path === "/";
  if (t.pages === "shop") return SHOP_PATH.test(path);
  return t.paths.some((p) => (p.endsWith("*") ? path.startsWith(p.slice(0, -1)) : path === p));
}

// ── Presets: a fast start for the most common promotions ───────────────────

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
export type Preset = { id: string; title: string; blurb: string; kind: PromoKind; name: string; config: Record<string, unknown>; endsInDays?: number; store?: boolean };
export const PRESETS: Preset[] = [
  { id: "welcome", title: "Welcome offer", blurb: "Collect emails with a first-order discount.", kind: "popup", name: "Welcome offer", config: { layout: "center", eyebrow: "Welcome", heading: "Get 10% off your first order", body: "Join our list for new arrivals and members-only offers.", action: "email", buttonLabel: "Unlock my discount", code: "WELCOME10", successHeading: "You're in! Here's your code", successBody: "Use it at checkout.", trigger: { type: "delay", delay: 6 }, frequency: "week" } },
  { id: "exit", title: "Exit-intent offer", blurb: "A last-chance offer when visitors move to leave.", kind: "popup", name: "Before you go", config: { layout: "center", eyebrow: "Before you go", heading: "Take 15% off today", body: "Use this code at checkout — today only.", action: "code", buttonLabel: "Shop now", buttonHref: "/shop", code: "STAY15", trigger: { type: "exit" }, frequency: "day" } },
  { id: "newsletter", title: "Newsletter slide-in", blurb: "A gentle corner card halfway down the page.", kind: "popup", name: "Newsletter", config: { layout: "corner", heading: "Stay in the loop", body: "New arrivals, restocks and tips. No spam — unsubscribe anytime.", action: "email", buttonLabel: "Subscribe", successHeading: "Thanks for subscribing!", trigger: { type: "scroll", scroll: 50 }, frequency: "week" } },
  { id: "flash", title: "Flash-sale countdown", blurb: "A bar that counts down to a real end date.", kind: "bar", name: "Flash sale", config: { messages: ["Flash sale — up to 30% off ends in"], linkLabel: "Shop the sale", linkHref: "/shop", tone: "gradient", countdown: true }, endsInDays: 2 },
  { id: "freeship", title: "Free-delivery bar", blurb: "Rotate your best offers at the top of every page.", kind: "bar", name: "Announcement", config: { messages: ["Free delivery on orders over ₹999", "Easy 7-day returns", "Cash on delivery available"], linkLabel: "Shop now", linkHref: "/shop", tone: "dark" } },
  { id: "festive", title: "Festive sale pop-up", blurb: "A big seasonal announcement with an image.", kind: "popup", name: "Festive sale", config: { layout: "sheet", eyebrow: "Festive sale", heading: "Up to 40% off everything", body: "Our biggest sale of the year — while stocks last.", action: "link", buttonLabel: "Shop the sale", buttonHref: "/shop", countdown: true, trigger: { type: "delay", delay: 3 }, frequency: "day" }, endsInDays: 5 },
  { id: "tab", title: "Floating offer tab", blurb: "An always-visible button that opens your offer.", kind: "floating", name: "Offer tab", config: { label: "Get 10% off", icon: "gift", position: "left", opens: null } },
  { id: "whatsapp", title: "WhatsApp chat button", blurb: "Let shoppers message you in one tap.", kind: "floating", name: "WhatsApp", config: { label: "Chat with us", icon: "chat", position: "right", href: "https://wa.me/910000000000" } },
  { id: "goal", title: "Free-delivery progress", blurb: "Show shoppers how close they are to free delivery.", kind: "shipping_goal", name: "Free-delivery progress", config: {}, store: true },
  { id: "upsell", title: "Cart upsell", blurb: "Suggest products that go with what's in the cart.", kind: "cart_upsell", name: "Complete your order", config: { heading: "Complete your order", source: "related", limit: 3 }, store: true },
];

export function presetInput(p: Preset): PromotionInput {
  return { kind: p.kind, name: p.name, enabled: false, config: CONFIG_SCHEMAS[p.kind].parse(p.config) as Record<string, unknown>, startsAt: null, endsAt: p.endsInDays ? inDays(p.endsInDays) : null };
}

// ── Rendering into a page ───────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  gift: '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  bag: '<path d="M6 7h12l1 14H5zM9 7a3 3 0 0 1 6 0"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const icon = (n: string, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const deviceCls = (d: string) => (d === "desktop" ? " ccp-hide-m" : d === "mobile" ? " ccp-hide-d" : "");
const countdownHtml = (endsAt: string | null) => (endsAt ? `<span class="ccp-cd" data-cc-end="${esc(endsAt)}" aria-label="Time left">--:--:--</span>` : "");

export type RenderCtx = { base: string; /** POST target for the newsletter form; absent in previews. */ formAction?: (promoId: string) => string; ping?: string };
const hrefOf = (base: string, h: string) => (h.startsWith("/") ? `${base}${h}` : h);

function bar(p: Promotion, c: BarConfig, ctx: RenderCtx) {
  const msgs = c.messages.map((m, i) => `<span class="ccp-msg"${i ? " hidden" : ""}>${esc(m)}${c.countdown && i === 0 ? ` ${countdownHtml(p.endsAt)}` : ""}</span>`).join("");
  const cta = c.linkLabel && c.linkHref ? `<a class="ccp-bar-link" href="${esc(hrefOf(ctx.base, c.linkHref))}" data-cc-click>${esc(c.linkLabel)} →</a>` : "";
  const close = c.dismissible ? `<button type="button" class="ccp-x" data-cc-close aria-label="Dismiss">${icon("close", 14)}</button>` : "";
  return `<div class="ccp-bar ccp-tone-${c.tone}${deviceCls(c.targeting.device)}" data-cc-promo="${p.id}" data-cc-kind="bar" role="region" aria-label="Announcement"><div class="ccp-bar-in"><span class="ccp-rot">${msgs}</span>${cta}</div>${close}</div>`;
}

function popup(p: Promotion, c: PopupConfig, ctx: RenderCtx) {
  const img = c.image ? `<div class="ccp-media"><img src="${esc(c.image)}" alt="" loading="lazy"></div>` : "";
  const codeBox = c.code ? `<div class="ccp-code"><code>${esc(c.code)}</code><button type="button" class="ccp-copy" data-cc-copy="${esc(c.code)}">Copy</button></div>` : "";
  let action = "";
  if (c.action === "email") {
    const form = ctx.formAction ? `<form class="ccp-form" method="post" action="${esc(ctx.formAction(p.id))}" data-cc-form>` : `<form class="ccp-form" data-cc-form onsubmit="return false">`;
    action = `${form}<input type="text" name="_hp" tabindex="-1" autocomplete="off" class="ccp-hp" aria-hidden="true"><label class="ccp-sr" for="ccp-e-${p.id}">Email</label><input id="ccp-e-${p.id}" name="email" type="email" required placeholder="you@example.com" autocomplete="email"><button type="submit" class="ccp-btn">${esc(c.buttonLabel)}</button></form>`;
  } else if (c.action === "code") {
    action = `${codeBox}${c.buttonHref ? `<a class="ccp-btn" href="${esc(hrefOf(ctx.base, c.buttonHref))}" data-cc-click>${esc(c.buttonLabel)}</a>` : ""}`;
  } else {
    action = `<a class="ccp-btn" href="${esc(hrefOf(ctx.base, c.buttonHref || "/"))}" data-cc-click>${esc(c.buttonLabel)}</a>`;
  }
  const success = c.action === "email" ? `<div class="ccp-done" hidden><h2>${esc(c.successHeading || "Thank you!")}</h2>${c.successBody ? `<p>${esc(c.successBody)}</p>` : ""}${codeBox}</div>` : "";
  const cfg = JSON.stringify({ id: p.id, t: c.trigger.type, d: c.trigger.delay, s: c.trigger.scroll, f: c.frequency, v: c.targeting.device });
  return `<div class="ccp-pop ccp-${c.layout}${c.image ? " ccp-has-img" : ""}" data-cc-promo="${p.id}" data-cc-kind="popup" data-cc-cfg="${esc(cfg)}" hidden role="dialog" aria-modal="${c.layout === "center"}" aria-labelledby="ccp-h-${p.id}">
${c.layout === "center" ? `<div class="ccp-scrim" data-cc-close></div>` : ""}<div class="ccp-card">${img}<div class="ccp-body"><button type="button" class="ccp-x" data-cc-close aria-label="Close">${icon("close", 16)}</button>
<div class="ccp-main">${c.eyebrow ? `<p class="ccp-eyebrow">${esc(c.eyebrow)}</p>` : ""}<h2 id="ccp-h-${p.id}">${esc(c.heading)}</h2>${c.body ? `<p>${esc(c.body)}</p>` : ""}${c.countdown ? `<p class="ccp-ends">Ends in ${countdownHtml(p.endsAt)}</p>` : ""}${action}</div>${success}</div></div></div>`;
}

function floating(p: Promotion, c: FloatingConfig, ctx: RenderCtx) {
  const inner = `${icon(c.icon)}<span>${esc(c.label)}</span>`;
  const cls = `ccp-float ccp-float-${c.position}${deviceCls(c.targeting.device)}`;
  return c.opens
    ? `<button type="button" class="${cls}" data-cc-promo="${p.id}" data-cc-kind="floating" data-cc-open="${c.opens}">${inner}</button>`
    : `<a class="${cls}" data-cc-promo="${p.id}" data-cc-kind="floating" href="${esc(hrefOf(ctx.base, c.href || "/"))}" data-cc-click${c.href.startsWith("https://") ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`;
}

/**
 * The page-level promotions (bars, pop-ups, floating buttons) for a path, as
 * HTML to insert after <body> and before </body>. Cart extras render in the
 * cart page itself.
 */
export function renderPromotions(promos: Promotion[], path: string, ctx: RenderCtx, now = Date.now()) {
  const live = promos.filter((p) => promoStatus(p, now) === "live" && !STORE_ONLY.includes(p.kind));
  const top: string[] = [];
  const end: string[] = [];
  const here = live.filter((p) => {
    const t = (p.config as { targeting?: z.infer<typeof targetingSchema> }).targeting;
    return !t || targets(t, path);
  });
  const popupIds = new Set(here.filter((p) => p.kind === "popup").map((p) => p.id));
  for (const p of here) {
    if (p.kind === "bar") top.push(bar(p, barSchema.parse(p.config), ctx));
    else if (p.kind === "popup") end.push(popup(p, popupSchema.parse(p.config), ctx));
    else if (p.kind === "floating") {
      const c = floatingSchema.parse(p.config);
      // A tab that opens a pop-up only appears when that pop-up is live.
      if (c.opens && !popupIds.has(c.opens)) continue;
      end.push(floating(p, c, ctx));
    }
  }
  if (!top.length && !end.length) return null;
  return { top: top.slice(0, 1).join(""), end: `<div id="ccp-root" data-ping="${esc(ctx.ping ?? "")}"></div>${end.join("")}<style>${PROMO_CSS}</style><script>${PROMO_SCRIPT}</script>` };
}

/** "You're ₹420 away from free delivery" — or the reached message. */
export function shippingGoalHtml(c: ShippingGoalConfig, subtotal: number, threshold: number, money: (n: number) => string) {
  const left = Math.max(0, threshold - subtotal);
  const pct = Math.min(100, Math.round((subtotal / threshold) * 100));
  const msg = left > 0 ? esc(c.progress).replace("{amount}", `<strong>${esc(money(left))}</strong>`) : esc(c.reached);
  return `<div class="ccp-goal${left ? "" : " ccp-goal-done"}" role="status"><p>${msg}</p><div class="ccp-goal-track" aria-hidden="true"><span style="width:${pct}%"></span></div></div>`;
}

export const PROMO_CSS = `.ccp-hide-m{}.ccp-sr,.ccp-hp{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:767px){.ccp-hide-m{display:none!important}}@media (min-width:768px){.ccp-hide-d{display:none!important}}
.ccp-bar{position:relative;z-index:60;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 44px;font:500 14px/1.4 var(--font,system-ui);text-align:center}
.ccp-bar-in{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 14px}.ccp-bar-link{color:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.ccp-tone-accent{background:var(--accent,#111);color:var(--accent-text,#fff)}.ccp-tone-dark{background:#0b0b0f;color:#fff}.ccp-tone-soft{background:color-mix(in srgb,var(--accent,#111) 12%,var(--bg,#fff));color:var(--text,#111)}
.ccp-tone-gradient{background:linear-gradient(90deg,color-mix(in srgb,var(--accent,#6d28d9) 92%,#000),var(--accent,#6d28d9),color-mix(in srgb,var(--accent,#6d28d9) 70%,#ff7a59));color:var(--accent-text,#fff)}
.ccp-bar .ccp-x{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:inherit;opacity:.75}
.ccp-cd{display:inline-flex;font-variant-numeric:tabular-nums;font-weight:700;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,currentColor 14%,transparent);letter-spacing:.02em}
.ccp-x{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer}.ccp-x:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.ccp-pop{position:fixed;z-index:1000;font-family:var(--font,system-ui);color:var(--text,#111)}.ccp-pop[hidden]{display:none}
.ccp-scrim{position:absolute;inset:0;background:rgba(10,10,20,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:ccp-fade .3s ease both}
.ccp-card{position:relative;display:grid;overflow:hidden;background:var(--bg,#fff);border-radius:calc(var(--radius,16px) + 8px);box-shadow:0 40px 90px -30px rgba(10,10,30,.55),0 0 0 1px color-mix(in srgb,var(--text,#111) 8%,transparent)}
.ccp-body{position:relative;padding:clamp(24px,4vw,40px)}.ccp-body>.ccp-x{position:absolute;right:12px;top:12px;color:var(--muted,#666)}
.ccp-main h2,.ccp-done h2{font-family:var(--heading-font,inherit);font-size:clamp(1.5rem,3vw,2.1rem);line-height:1.1;letter-spacing:-.02em;margin:0 0 10px;padding-right:28px}
.ccp-main p,.ccp-done p{margin:0 0 16px;color:var(--muted,#555);line-height:1.55}.ccp-eyebrow{font-size:.78rem!important;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent,#111)!important;margin-bottom:8px!important}
.ccp-btn{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 22px;border:0;border-radius:999px;background:var(--accent,#111);color:var(--accent-text,#fff);font:600 15px/1 var(--font,system-ui);text-decoration:none;cursor:pointer;box-shadow:0 10px 24px -12px var(--accent,#111)}
.ccp-form{display:flex;gap:8px;flex-wrap:wrap}.ccp-form input[type=email]{flex:1 1 200px;min-height:46px;padding:0 16px;border-radius:999px;border:1px solid color-mix(in srgb,var(--text,#111) 18%,transparent);background:var(--bg,#fff);color:inherit;font:inherit}
.ccp-code{display:flex;align-items:center;gap:8px;margin:0 0 16px;padding:8px 8px 8px 16px;border:1.5px dashed color-mix(in srgb,var(--accent,#111) 60%,transparent);border-radius:14px;background:color-mix(in srgb,var(--accent,#111) 7%,transparent)}
.ccp-code code{flex:1;font:700 1.15rem/1 ui-monospace,monospace;letter-spacing:.08em}.ccp-copy{border:0;border-radius:999px;padding:8px 14px;background:var(--text,#111);color:var(--bg,#fff);font:600 13px/1 var(--font,system-ui);cursor:pointer}
.ccp-ends{font-size:.95rem}
.ccp-center{inset:0;display:grid;place-items:center;padding:16px}.ccp-center .ccp-card{width:min(560px,100%);animation:ccp-pop .45s cubic-bezier(.16,1,.3,1) both}
.ccp-center.ccp-has-img .ccp-card{width:min(860px,100%);grid-template-columns:1fr 1.1fr}.ccp-media{position:relative;min-height:200px}.ccp-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ccp-corner{right:20px;bottom:20px;width:min(380px,calc(100vw - 32px))}.ccp-corner .ccp-card{animation:ccp-up .5s cubic-bezier(.16,1,.3,1) both}.ccp-corner .ccp-media{min-height:150px}
.ccp-sheet{left:0;right:0;bottom:0}.ccp-sheet .ccp-card{border-radius:calc(var(--radius,16px) + 8px) calc(var(--radius,16px) + 8px) 0 0;animation:ccp-up .5s cubic-bezier(.16,1,.3,1) both}
.ccp-sheet .ccp-body{max-width:1100px;margin:0 auto;width:100%}.ccp-sheet.ccp-has-img .ccp-card{grid-template-columns:minmax(0,320px) 1fr}
.ccp-float{position:fixed;bottom:22px;z-index:900;display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 18px;border:0;border-radius:999px;background:var(--accent,#111);color:var(--accent-text,#fff);font:600 14px/1 var(--font,system-ui);text-decoration:none;cursor:pointer;box-shadow:0 18px 40px -16px rgba(0,0,0,.45);animation:ccp-up .5s cubic-bezier(.16,1,.3,1) .6s both}
.ccp-float-left{left:20px}.ccp-float-right{right:20px}.ccp-float:hover{transform:translateY(-2px)}
.ccp-goal{margin:0 0 20px;padding:14px 16px;border-radius:var(--radius,14px);background:color-mix(in srgb,var(--accent,#111) 7%,var(--bg,#fff));border:1px solid color-mix(in srgb,var(--accent,#111) 20%,transparent)}.ccp-goal p{margin:0 0 10px}
.ccp-goal-track{height:8px;border-radius:999px;background:color-mix(in srgb,var(--text,#111) 10%,transparent);overflow:hidden}.ccp-goal-track span{display:block;height:100%;border-radius:inherit;background:var(--accent,#111);transition:width .6s ease}
.ccp-upsell{margin-top:40px}.ccp-upsell h2{font-size:1.3rem;margin:0 0 16px}.ccp-up-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;list-style:none;padding:0;margin:0}
.ccp-up-item{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:center;padding:10px;border-radius:var(--radius,14px);border:1px solid var(--line,rgba(0,0,0,.08))}.ccp-up-item img{width:64px;height:64px;object-fit:cover;border-radius:calc(var(--radius,14px) * .6)}
.ccp-up-item a{color:inherit;text-decoration:none;font-weight:600}.ccp-up-item form{margin-top:6px}.ccp-up-item button{border:0;border-radius:999px;padding:6px 12px;background:var(--text,#111);color:var(--bg,#fff);font:600 12px/1 var(--font,system-ui);cursor:pointer}
@keyframes ccp-fade{from{opacity:0}}@keyframes ccp-pop{from{opacity:0;transform:translateY(16px) scale(.97)}}@keyframes ccp-up{from{opacity:0;transform:translateY(24px)}}
@media (max-width:767px){.ccp-center.ccp-has-img .ccp-card,.ccp-sheet.ccp-has-img .ccp-card{grid-template-columns:1fr}.ccp-media{min-height:160px}.ccp-corner{right:12px;left:12px;bottom:12px;width:auto}.ccp-bar{padding:9px 40px;font-size:13px}.ccp-float{bottom:14px}}
@media (prefers-reduced-motion:reduce){.ccp-pop *,.ccp-float{animation:none!important}}`;

/**
 * The only script a published page may run (allowed by its hash in the site's
 * security policy). It opens pop-ups on their trigger, respects frequency caps,
 * runs countdowns to real end dates, copies codes and counts views and clicks.
 */
export const PROMO_SCRIPT = `(function(){var d=document,w=window,root=d.getElementById("ccp-root");if(!root)return;var ping=root.getAttribute("data-ping");
function S(k){try{return w.localStorage.getItem(k)}catch(e){return null}}function SS(k,v){try{w.localStorage.setItem(k,v)}catch(e){}}
function sess(k,v){try{if(v===undefined)return w.sessionStorage.getItem(k);w.sessionStorage.setItem(k,v)}catch(e){return null}}
function hit(id,e){if(!ping)return;var i=new Image();i.src=ping+"?id="+id+"&e="+e+"&r="+Math.random().toString(36).slice(2)}
var mobile=w.matchMedia&&w.matchMedia("(max-width: 767px)").matches;var waits={always:0,session:-1,day:864e5,week:6048e5,once:-2};
function ok(c){if(c.v==="desktop"&&mobile||c.v==="mobile"&&!mobile)return false;var wait=waits[c.f];if(!wait)return true;if(wait===-1)return !sess("ccp-"+c.id);var t=+S("ccp-"+c.id)||0;if(!t)return true;return wait>0&&Date.now()-t>wait}
function mark(c){SS("ccp-"+c.id,String(Date.now()));sess("ccp-"+c.id,"1")}
var openEl=null,last=null;function show(el,done){if(openEl)return;openEl=el;last=d.activeElement;el.hidden=false;if(done){var m=el.querySelector(".ccp-main"),k=el.querySelector(".ccp-done");if(m&&k){m.hidden=true;k.hidden=false}}var f=el.querySelector("input[type=email],.ccp-btn,.ccp-copy,.ccp-x");if(f)f.focus({preventScroll:true});hit(el.getAttribute("data-cc-promo"),"view")}
function hide(el){el.hidden=true;if(openEl===el){openEl=null;if(last&&last.focus)last.focus()}}
d.addEventListener("keydown",function(e){if(e.key==="Escape"&&openEl)hide(openEl)});
d.addEventListener("click",function(e){var t=e.target.closest?e.target:null;if(!t)return;
var x=t.closest("[data-cc-close]");if(x){var p=x.closest("[data-cc-promo]");if(p){if(p.getAttribute("data-cc-kind")==="bar"){p.remove();sess("ccp-bar-"+p.getAttribute("data-cc-promo"),"1")}else hide(p)}return}
var o=t.closest("[data-cc-open]");if(o){var pop=d.querySelector('[data-cc-promo="'+o.getAttribute("data-cc-open")+'"]');hit(o.getAttribute("data-cc-promo"),"click");if(pop)show(pop);return}
var c=t.closest("[data-cc-copy]");if(c){var code=c.getAttribute("data-cc-copy");var done=function(){c.textContent="Copied ✓"};if(navigator.clipboard)navigator.clipboard.writeText(code).then(done,done);else done();return}
var k=t.closest("[data-cc-click]");if(k){var q=k.closest("[data-cc-promo]")||k;hit(q.getAttribute("data-cc-promo"),"click")}});
d.querySelectorAll("[data-cc-form]").forEach(function(f){f.addEventListener("submit",function(){var p=f.closest("[data-cc-promo]");if(p)sess("ccp-sub",p.getAttribute("data-cc-promo"))})});
d.querySelectorAll('[data-cc-kind="bar"]').forEach(function(b){if(sess("ccp-bar-"+b.getAttribute("data-cc-promo")))return b.remove();hit(b.getAttribute("data-cc-promo"),"view");var m=b.querySelectorAll(".ccp-msg");if(m.length>1){var i=0;setInterval(function(){m[i].hidden=true;i=(i+1)%m.length;m[i].hidden=false},4000)}});
d.querySelectorAll('[data-cc-kind="floating"]').forEach(function(f){hit(f.getAttribute("data-cc-promo"),"view")});
function tick(){d.querySelectorAll("[data-cc-end]").forEach(function(el){var s=Math.floor((Date.parse(el.getAttribute("data-cc-end"))-Date.now())/1e3);if(s<=0){var p=el.closest("[data-cc-promo]");if(p)p.remove();return}var dd=Math.floor(s/86400),h=Math.floor(s%86400/3600),mm=Math.floor(s%3600/60),ss=s%60;var z=function(n){return(n<10?"0":"")+n};el.textContent=(dd?dd+"d ":"")+z(h)+":"+z(mm)+":"+z(ss)})}tick();setInterval(tick,1000);
var sub=sess("ccp-sub");var url=new URL(w.location.href);
d.querySelectorAll('[data-cc-kind="popup"]').forEach(function(el){var c;try{c=JSON.parse(el.getAttribute("data-cc-cfg"))}catch(e){return}
if(sub===c.id&&url.searchParams.get("submitted")==="1"){sess("ccp-sub","");mark(c);return show(el,true)}
if(c.t==="click"||!ok(c))return;var fire=function(){if(!openEl&&ok(c)){mark(c);show(el)}};
if(c.t==="delay")setTimeout(fire,c.d*1e3);
else if(c.t==="scroll"){var on=function(){var h=d.documentElement;if((h.scrollTop+w.innerHeight)/h.scrollHeight*100>=c.s){w.removeEventListener("scroll",on);fire()}};w.addEventListener("scroll",on,{passive:true})}
else if(c.t==="exit"){if(mobile)setTimeout(fire,20000);else d.addEventListener("mouseout",function ex(e){if(!e.relatedTarget&&e.clientY<=0){d.removeEventListener("mouseout",ex);fire()}})}})})();`;
