// Virtual business IDs: the designs, the fields, how a member's card and the
// company's template combine, and the contact file (vCard) people save.
// Shared by server and browser.
import { z } from "zod";
import type { BusinessCardData, BusinessCardStyle } from "@/db/schema";

export const DESIGNS = [
  { id: "classic", label: "Classic", note: "Clean and light" },
  { id: "band", label: "Band", note: "A colour band across the top" },
  { id: "bold", label: "Bold", note: "Full colour, white type" },
  { id: "night", label: "Night", note: "Dark, with a glow" },
  { id: "minimal", label: "Minimal", note: "Just the type" },
] as const;
export type Design = (typeof DESIGNS)[number]["id"];

export const SHAPES = [
  { id: "portrait", label: "Portrait" },
  { id: "landscape", label: "Landscape" },
] as const;

export const ACCENTS = ["#ff6a55", "#f5474e", "#f39a2e", "#1f7a55", "#2563a8", "#5b4bb7", "#a3355a", "#1d1d1f"] as const;

/** The fields, in the order they show, and which belong to the company. */
export const FIELDS: { id: keyof BusinessCardData; label: string; company?: boolean; long?: boolean }[] = [
  { id: "name", label: "Name" },
  { id: "title", label: "Title" },
  { id: "department", label: "Department" },
  { id: "company", label: "Company", company: true },
  { id: "tagline", label: "Company tagline", company: true },
  { id: "phone", label: "Phone" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
  { id: "website", label: "Website", company: true },
  { id: "address", label: "Address", company: true, long: true },
  { id: "bio", label: "About", long: true },
];
export const COMPANY_FIELDS = FIELDS.filter((f) => f.company).map((f) => f.id);

const text = (max: number) => z.string().trim().max(max).optional();
const url = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+/.test(v), "A web address like example.com")
  .optional();

export const dataSchema = z.object({
  name: text(120),
  title: text(120),
  department: text(120),
  company: text(120),
  tagline: text(160),
  phone: text(30),
  whatsapp: text(30),
  email: z.union([z.literal(""), z.email("An email address")]).optional(),
  website: url,
  address: text(300),
  bio: text(500),
  links: z.array(z.object({ label: z.string().trim().min(1).max(40), url: url.unwrap() })).max(6).optional(),
});
export const styleSchema = z.object({
  design: z.enum(DESIGNS.map((d) => d.id) as [Design, ...Design[]]).optional(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i, "A colour like #ff6a55").optional(),
  shape: z.enum(["portrait", "landscape"]).optional(),
});
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/, "3–40 letters, digits or dashes");

export const cardPatchSchema = z.object({
  data: dataSchema.optional(),
  style: styleSchema.optional(),
  hidden: z.array(z.string().max(20)).max(20).optional(),
  published: z.boolean().optional(),
  exchange: z.boolean().optional(),
  slug: slugSchema.optional(),
});
export const templateSchema = z.object({
  data: dataSchema.pick({ company: true, tagline: true, website: true, address: true }).optional(),
  style: styleSchema.optional(),
  lockStyle: z.boolean().optional(),
  lockCompany: z.boolean().optional(),
});
export const exchangeSchema = z
  .object({
    name: z.string().trim().min(1, "Your name").max(120),
    email: z.union([z.literal(""), z.email("An email address")]).default(""),
    phone: z.string().trim().max(30).default(""),
    company: z.string().trim().max(120).default(""),
    note: z.string().trim().max(500).default(""),
    /** A field people can't see: bots fill it in. */
    website: z.string().max(0).optional(),
  })
  .refine((v) => v.email || v.phone.replace(/\D/g, "").length >= 7, { message: "An email or a phone number, so they can reach you", path: ["email"] });

export type Template = { data: BusinessCardData; style: BusinessCardStyle; lockStyle: boolean; lockCompany: boolean };
export const DEFAULT_STYLE: Required<BusinessCardStyle> = { design: "band", accent: "#ff6a55", shape: "portrait" };

/** What a card actually shows: the member's own details, with the company's where the template fixes them. */
export function effective(card: { data: BusinessCardData; style: BusinessCardStyle; hidden: string[] }, t: Template | null) {
  const data: BusinessCardData = { ...card.data };
  for (const k of COMPANY_FIELDS) {
    const fixed = t?.data[k];
    if (t?.lockCompany && fixed !== undefined) (data as Record<string, unknown>)[k] = fixed;
    else if (!data[k] && fixed) (data as Record<string, unknown>)[k] = fixed;
  }
  const style = { ...DEFAULT_STYLE, ...(t?.style ?? {}), ...(t?.lockStyle ? {} : card.style) };
  const shown: BusinessCardData = {};
  for (const [k, v] of Object.entries(data)) if (!card.hidden.includes(k)) (shown as Record<string, unknown>)[k] = v;
  return { data: shown, style: style as Required<BusinessCardStyle> };
}

export const initials = (name: string) =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** A phone number as a link: tel:+919822055210 and wa.me/919822055210. */
export const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;
export const waHref = (p: string) => {
  const d = p.replace(/\D/g, "");
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
};

/** The contact file (vCard 3.0) that phones import with one tap. */
export function vcard(d: BusinessCardData, url: string) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
  const name = d.name ?? "";
  const [first, ...rest] = name.split(/\s+/);
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${esc(rest.join(" "))};${esc(first ?? "")};;;`, `FN:${esc(name)}`];
  if (d.company) lines.push(`ORG:${esc(d.company)}${d.department ? `;${esc(d.department)}` : ""}`);
  if (d.title) lines.push(`TITLE:${esc(d.title)}`);
  if (d.phone) lines.push(`TEL;TYPE=WORK,VOICE:${esc(d.phone)}`);
  if (d.whatsapp && d.whatsapp !== d.phone) lines.push(`TEL;TYPE=CELL:${esc(d.whatsapp)}`);
  if (d.email) lines.push(`EMAIL;TYPE=WORK,INTERNET:${esc(d.email)}`);
  if (d.website) lines.push(`URL:${esc(d.website)}`);
  if (d.address) lines.push(`ADR;TYPE=WORK:;;${esc(d.address)};;;;`);
  const note = [d.bio, `Business ID: ${url}`].filter(Boolean).join("\n");
  lines.push(`NOTE:${esc(note)}`, `URL;TYPE=CARD:${esc(url)}`, "END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/** An email signature in plain HTML that mail apps keep. */
export function signatureHtml(d: BusinessCardData, url: string, accent: string) {
  const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const row = (s?: string) => (s ? `<div style="color:#555;font-size:12px">${e(s)}</div>` : "");
  return [
    `<table cellpadding="0" cellspacing="0" style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><tr><td style="border-left:3px solid ${e(accent)};padding-left:10px">`,
    `<div style="font-size:14px;color:#111">${e(d.name ?? "")}</div>`,
    row([d.title, d.company].filter(Boolean).join(" · ")),
    row([d.phone, d.email].filter(Boolean).join(" · ")),
    `<div style="font-size:12px"><a href="${e(url)}" style="color:${e(accent)};text-decoration:none">My business ID</a></div>`,
    "</td></tr></table>",
  ].join("");
}
