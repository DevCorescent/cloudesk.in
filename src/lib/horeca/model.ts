// Cloudesk for Horeca: shared rules for restaurants, cafés, bars and hotels.
// Settings, inputs and the bill maths live here so the dashboard, the QR menu
// and the server all agree.
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).default("");
const url = z
  .string()
  .trim()
  .max(1000)
  .regex(/^(https?:\/\/|\/|$)/, "Use an https:// link")
  .default("");
const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .default("#b4532a");
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^$/, "Use HH:MM")
  .default("");

export const VENUE_KINDS = [
  { id: "restaurant", label: "Restaurant" },
  { id: "cafe", label: "Café" },
  { id: "bar", label: "Bar & lounge" },
  { id: "hotel", label: "Hotel & resort" },
  { id: "cloud_kitchen", label: "Cloud kitchen" },
] as const;
export const DIETS = ["veg", "nonveg", "egg", "vegan", "none"] as const;
export const PAY_METHODS = ["cash", "upi", "card", "room", "points", "other"] as const;
export const STAFF_ROLES = ["owner", "manager", "cashier", "captain", "waiter", "chef", "bartender", "host", "housekeeping", "valet"] as const;
/** Roles that can approve voids, big discounts, comps and cash pay-outs. */
export const APPROVER_ROLES = ["owner", "manager"];
export const SECTIONS = ["pos", "rooms", "bar", "valet", "inventory", "reservations", "guests"] as const;
export const BAR_CATEGORIES = ["whisky", "vodka", "gin", "rum", "tequila", "brandy", "wine", "beer", "liqueur", "mixer", "other"] as const;

export const settingsSchema = z.object({
  qr: z
    .object({
      enabled: z.boolean().default(true),
      /** order: guests order from the menu · menu: view only */
      mode: z.enum(["order", "menu"]).default("order"),
      /** auto: orders go straight to the kitchen · staff: a waiter confirms first */
      approval: z.enum(["auto", "staff"]).default("auto"),
      theme: z.enum(["light", "dark", "warm"]).default("warm"),
      accent: hex,
      cover: url,
      logo: url,
      welcome: text(200).default("Welcome! Browse the menu and order right from your table."),
      showImages: z.boolean().default(true),
      showDiet: z.boolean().default(true),
      showSpice: z.boolean().default(true),
      showPrep: z.boolean().default(true),
      askName: z.boolean().default(false),
      askPhone: z.boolean().default(false),
      allowNotes: z.boolean().default(true),
      callWaiter: z.boolean().default(true),
      requestBill: z.boolean().default(true),
      /** Smallest order from the QR menu, in minor units (0 = none). */
      minOrder: z.number().int().min(0).default(0),
      /** Tip choices offered on the bill, in percent. */
      tipOptions: z.array(z.number().int().min(0).max(30)).max(5).default([0, 5, 10]),
      /** UPI ID shown with the bill so guests can pay from their phone. */
      upiId: z.string().trim().max(80).regex(/^$|^[\w.-]+@[\w.-]+$/, "Looks like name@bank").default(""),
      valetBooking: z.boolean().default(true),
      footer: text(300),
    })
    .prefault({}),
  kitchen: z
    .object({
      stations: z.array(z.string().trim().min(1).max(30)).min(1).max(8).default(["kitchen", "bar"]),
    })
    .prefault({}),
  rooms: z
    .object({
      checkInTime: hhmm.default("14:00"),
      checkOutTime: hhmm.default("11:00"),
      /** GST on room tariff (12% up to ₹7,500 a night in India). */
      taxBps: z.number().int().min(0).max(2800).default(1200),
    })
    .prefault({}),
  valet: z
    .object({
      enabled: z.boolean().default(true),
      fee: z.number().int().min(0).default(0),
      slots: z.number().int().min(0).max(2000).default(40),
    })
    .prefault({}),
  /** Which parts of Horeca this venue uses — a café can hide rooms, bar and valet. */
  sections: z
    .object({ pos: z.boolean().default(true), rooms: z.boolean().default(true), bar: z.boolean().default(true), valet: z.boolean().default(true), inventory: z.boolean().default(true), reservations: z.boolean().default(true), guests: z.boolean().default(true) })
    .prefault({}),
  pos: z
    .object({
      dineIn: z.boolean().default(true),
      takeaway: z.boolean().default(true),
      delivery: z.boolean().default(true),
      deliveryFee: z.number().int().min(0).default(0),
      /** Ask how many people are at the table. */
      askCovers: z.boolean().default(true),
      /** Round bills to the nearest whole rupee. */
      roundOff: z.boolean().default(true),
      /** Need an open till session to take cash. */
      requireShift: z.boolean().default(false),
    })
    .prefault({}),
  security: z
    .object({
      /** Lock the screen after this many idle minutes (0 = never). */
      autoLockMinutes: z.number().int().min(0).max(240).default(0),
      /** Discounts above this % need a manager's PIN. */
      discountLimitPct: z.number().int().min(0).max(100).default(15),
      /** Cancelling an item already sent to the kitchen needs a manager's PIN. */
      voidNeedsApproval: z.boolean().default(true),
      compNeedsApproval: z.boolean().default(true),
    })
    .prefault({}),
  loyalty: z
    .object({
      enabled: z.boolean().default(false),
      /** Points earned per 100 of the bill (₹100 → n points). */
      pointsPer100: z.number().int().min(0).max(100).default(5),
      /** What one point is worth, in minor units (100 = ₹1). */
      pointValue: z.number().int().min(1).max(10_000).default(100),
      minRedeem: z.number().int().min(0).default(100),
    })
    .prefault({}),
  receipt: z
    .object({
      header: text(200),
      footer: text(200).default("Thank you — see you again!"),
      gstin: z.string().trim().max(15).default(""),
      fssai: z.string().trim().max(20).default(""),
      address: text(200),
      phone: text(30),
    })
    .prefault({}),
  reservations: z
    .object({
      /** Guests can request a table from a public page. */
      online: z.boolean().default(true),
      durationMin: z.number().int().min(15).max(480).default(90),
      maxParty: z.number().int().min(1).max(100).default(12),
      openFrom: hhmm.default("12:00"),
      openTo: hhmm.default("23:00"),
    })
    .prefault({}),
  /** Happy hours and time-based offers, applied when items are ordered. */
  pricing: z
    .object({
      rules: z
        .array(
          z.object({
            id: z.string().min(1).max(40),
            name: z.string().trim().min(1).max(60),
            pct: z.number().int().min(1).max(100),
            /** 0 = Sunday … 6 = Saturday; empty = every day */
            days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
            from: hhmm,
            to: hhmm,
            /** empty = every category */
            categoryIds: z.array(z.string().max(40)).max(50).default([]),
            active: z.boolean().default(true),
          }),
        )
        .max(20)
        .default([]),
    })
    .prefault({}),
});
export type HorecaSettings = z.infer<typeof settingsSchema>;

export const venueSchema = z.object({
  name: z.string().trim().min(1, "Name your venue").max(120),
  kind: z.enum(["restaurant", "cafe", "bar", "hotel", "cloud_kitchen"]).default("restaurant"),
  currency: z.string().trim().length(3).toUpperCase().default("INR"),
  taxBps: z.number().int().min(0).max(2800).default(500),
  serviceChargeBps: z.number().int().min(0).max(2000).default(0),
  settings: settingsSchema.prefault({}),
});

export const areaSchema = z.object({ name: z.string().trim().min(1).max(60), sort: z.number().int().default(0) });
export const tableSchema = z.object({
  name: z.string().trim().min(1).max(30),
  areaId: z.uuid().nullable().default(null),
  seats: z.number().int().min(1).max(40).default(4),
  kind: z.enum(["table", "room", "counter"]).default("table"),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  station: z.string().trim().min(1).max(30).default("kitchen"),
  availableFrom: hhmm,
  availableTo: hhmm,
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
export const modifierGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  minSelect: z.number().int().min(0).max(10).default(0),
  maxSelect: z.number().int().min(1).max(20).default(1),
  options: z
    .array(z.object({ id: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(60), price: z.number().int().min(0).default(0) }))
    .min(1)
    .max(30),
});
export const itemSchema = z.object({
  categoryId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  description: text(400),
  price: z.number().int().min(0),
  image: url,
  diet: z.enum(DIETS).default("veg"),
  spice: z.number().int().min(0).max(3).default(0),
  tags: z.array(z.string().trim().min(1).max(30)).max(6).default([]),
  available: z.boolean().default(true),
  prepMinutes: z.number().int().min(0).max(240).default(15),
  taxBps: z.number().int().min(0).max(2800).nullable().default(null),
  modifierGroupIds: z.array(z.uuid()).max(8).default([]),
  barItemId: z.uuid().nullable().default(null),
  pourMl: z.number().int().min(1).max(1000).nullable().default(null),
  recipe: z.array(z.object({ stockItemId: z.uuid(), qty: z.number().int().min(1).max(1_000_000) })).max(40).default([]),
  code: z.string().trim().max(12).default(""),
  sort: z.number().int().default(0),
});

export const lineSchema = z.object({
  itemId: z.uuid(),
  qty: z.number().int().min(1).max(50),
  /** Chosen modifier option ids. */
  options: z.array(z.string().max(40)).max(30).default([]),
  notes: text(200),
});
export const guestOrderSchema = z.object({
  lines: z.array(lineSchema).min(1, "Your order is empty").max(40),
  name: text(80),
  phone: text(20),
  notes: text(300),
});
export const paymentSchema = z.object({ method: z.enum(PAY_METHODS), amount: z.number().int().min(1), ref: text(80) });

/** Who is at the till: the staff member who unlocked the screen, and (when needed) a manager's PIN. */
export const actorSchema = z.object({ staffId: z.uuid().nullable().default(null), staffTicket: z.string().max(200).nullable().default(null), approvalPin: z.string().regex(/^\d{4,6}$/).nullable().default(null) });
export const staffSchema = z.object({
  name: z.string().trim().min(1).max(60),
  role: z.enum(STAFF_ROLES).default("waiter"),
  /** Required when adding; leave out to keep the current PIN. */
  pin: z.string().regex(/^\d{4,6}$/, "4 to 6 digits").optional(),
  active: z.boolean().default(true),
});
export const reservationSchema = z.object({
  kind: z.enum(["reservation", "waitlist"]).default("reservation"),
  guestName: z.string().trim().min(1, "Add the guest's name").max(80),
  guestPhone: text(20),
  partySize: z.number().int().min(1).max(100).default(2),
  at: z.iso.datetime({ offset: true }),
  durationMin: z.number().int().min(15).max(480).default(90),
  tableId: z.uuid().nullable().default(null),
  source: z.enum(["staff", "online", "phone", "walk_in"]).default("staff"),
  notes: text(300),
});
export const STOCK_UNITS = ["g", "ml", "pcs"] as const;
export const stockItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().max(40).default("other"),
  unit: z.enum(STOCK_UNITS).default("g"),
  packSize: z.number().int().min(1).max(1_000_000).default(1000),
  costPerPack: z.number().int().min(0).default(0),
  reorderAt: z.number().int().min(0).default(0),
  supplierId: z.uuid().nullable().default(null),
  active: z.boolean().default(true),
});
export const supplierSchema = z.object({ name: z.string().trim().min(1).max(80), phone: text(30), email: z.string().trim().max(120).default(""), gstin: z.string().trim().max(15).default(""), notes: text(300) });
export const purchaseSchema = z.object({
  supplierId: z.uuid().nullable().default(null),
  invoiceNo: text(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** qty in packs, cost of the line in minor units */
  lines: z.array(z.object({ stockItemId: z.uuid(), packs: z.number().min(0.001).max(100_000), cost: z.number().int().min(0) })).min(1).max(100),
});
export const guestSchema = z.object({ name: text(80), phone: z.string().trim().min(7, "Add a phone number").max(20), email: z.string().trim().max(120).default(""), birthday: text(10), notes: text(500), tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]) });

export const roomTypeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: text(400),
  rate: z.number().int().min(0),
  maxGuests: z.number().int().min(1).max(20).default(2),
  amenities: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  image: url,
  sort: z.number().int().default(0),
});
export const roomSchema = z.object({ typeId: z.uuid(), number: z.string().trim().min(1).max(20), floor: text(20) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
export const roomBookingSchema = z
  .object({
    roomId: z.uuid(),
    guestName: z.string().trim().min(1, "Add the guest's name").max(100),
    guestPhone: text(20),
    guestEmail: z.string().trim().max(120).regex(/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Check the email").default(""),
    checkIn: day,
    checkOut: day,
    adults: z.number().int().min(1).max(20).default(2),
    children: z.number().int().min(0).max(20).default(0),
    rate: z.number().int().min(0).nullable().default(null),
    source: z.enum(["direct", "walk_in", "phone", "ota", "corporate"]).default("direct"),
    notes: text(500),
  })
  .refine((b) => b.checkOut > b.checkIn, { message: "Check-out must be after check-in", path: ["checkOut"] });

export const barItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(BAR_CATEGORIES).default("other"),
  bottleMl: z.number().int().min(50).max(20000).default(750),
  costPerBottle: z.number().int().min(0).default(0),
  reorderMl: z.number().int().min(0).default(750),
  active: z.boolean().default(true),
});
export const barMoveSchema = z.object({
  barItemId: z.uuid(),
  kind: z.enum(["purchase", "wastage", "adjust"]),
  /** Purchases may be given as bottles; everything is stored in ml. */
  bottles: z.number().min(0).max(1000).default(0),
  ml: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  note: text(200),
});
export const barCountSchema = z.object({
  lines: z.array(z.object({ barItemId: z.uuid(), countedMl: z.number().int().min(0).max(10_000_000) })).min(1).max(500),
  note: text(300),
});

export const valetSchema = z.object({
  plate: z.string().trim().max(20).toUpperCase().default(""),
  car: text(60),
  color: text(30),
  guestName: text(80),
  guestPhone: text(20),
  slot: text(20),
  keyTag: text(20),
  notes: text(200),
  tableId: z.uuid().nullable().default(null),
  roomBookingId: z.uuid().nullable().default(null),
  /** For a pre-booking: when the guest arrives. */
  expectedAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export const valetBookingSchema = z.object({
  guestName: z.string().trim().min(1, "Add your name").max(80),
  guestPhone: z.string().trim().min(7, "Add your phone number").max(20),
  plate: z.string().trim().max(20).toUpperCase().default(""),
  car: text(60),
  expectedAt: z.iso.datetime({ offset: true }),
});

// ─── Bill maths ──────────────────────────────────────────────────────────────

export type BillLine = { qty: number; unitPrice: number; taxBps: number; status?: string; comp?: boolean };
/**
 * GST is added to menu prices (the usual practice in Indian restaurants).
 * A discount reduces each line proportionally before tax; the service charge
 * and delivery fee are on the discounted food and taxed at the venue's rate.
 * Comped items show on the bill at no charge. With round-off, the total is
 * rounded to the nearest whole unit and the difference shown.
 */
export function billTotals(lines: BillLine[], o: { discount: number; serviceChargeBps: number; venueTaxBps: number; tip: number; paid?: number; deliveryFee?: number; roundOff?: boolean }) {
  const live = lines.filter((l) => l.status !== "void" && l.status !== "pending");
  const comps = live.filter((l) => l.comp).reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const charged = live.filter((l) => !l.comp);
  const subtotal = charged.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const discount = Math.min(Math.max(0, o.discount), subtotal);
  const keep = subtotal ? (subtotal - discount) / subtotal : 0;
  const net = subtotal - discount;
  const service = Math.round((net * o.serviceChargeBps) / 10_000);
  const delivery = Math.max(0, o.deliveryFee ?? 0);
  const tax = Math.round(charged.reduce((a, l) => a + (l.qty * l.unitPrice * keep * l.taxBps) / 10_000, 0) + ((service + delivery) * o.venueTaxBps) / 10_000);
  const raw = net + service + delivery + tax + Math.max(0, o.tip);
  const total = o.roundOff ? Math.round(raw / 100) * 100 : raw;
  const paid = o.paid ?? 0;
  return { subtotal, discount, comps, service, delivery, tax, tip: Math.max(0, o.tip), roundOff: total - raw, total, paid, due: Math.max(0, total - paid) };
}

/** Today's happy-hour cut for an item, in percent (the best matching rule wins). */
export function offerFor(rules: HorecaSettings["pricing"]["rules"], categoryId: string, at: { day: number; hhmm: string }) {
  let best: { pct: number; name: string } | null = null;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.days.length && !r.days.includes(at.day)) continue;
    if (!servedNow(r.from, r.to, at.hhmm)) continue;
    if (r.categoryIds.length && !r.categoryIds.includes(categoryId)) continue;
    if (!best || r.pct > best.pct) best = { pct: r.pct, name: r.name };
  }
  return best;
}

/** CGST + SGST for sales within the state (split equally). */
export const splitGst = (tax: number) => ({ cgst: Math.floor(tax / 2), sgst: tax - Math.floor(tax / 2) });

/** Nights between two YYYY-MM-DD dates. */
export const nights = (checkIn: string, checkOut: string) => Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));

/** Whether a category is served right now (HH:MM in venue time); windows may cross midnight. */
export function servedNow(from: string, to: string, nowHHMM: string) {
  if (!from || !to) return true;
  return from <= to ? nowHHMM >= from && nowHHMM < to : nowHHMM >= from || nowHHMM < to;
}

export const DIET_LABEL: Record<string, string> = { veg: "Veg", nonveg: "Non-veg", egg: "Contains egg", vegan: "Vegan", none: "" };

/**
 * Tap an add-on option. A required single choice (portion, spice) works like a
 * radio — tapping the chosen one keeps it, so the dish can't be left without one.
 */
export function toggleOption(picked: string[], g: { minSelect: number; maxSelect: number; options: { id: string }[] }, id: string) {
  const on = picked.includes(id);
  if (on) return g.maxSelect === 1 && g.minSelect >= 1 ? picked : picked.filter((x) => x !== id);
  if (g.maxSelect === 1) return [...picked.filter((x) => !g.options.some((y) => y.id === x)), id];
  return g.options.filter((o) => picked.includes(o.id)).length >= g.maxSelect ? picked : [...picked, id];
}
