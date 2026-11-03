// Finding people on Cloudesk: usernames (@kabir.shah), and how a search is
// read — an email or a phone number is matched exactly, anything else is a
// username (or, inside a workspace, a name). Shared by server and browser.
import { z } from "zod";

/** 3–30 lowercase letters, digits, dots and underscores; starts and ends with a letter or digit. */
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{1,28})[a-z0-9]$/;

/** Words no one may take as a username. */
const RESERVED = new Set(["admin", "administrator", "support", "help", "cloudesk", "root", "system", "staff", "team", "official", "security", "billing", "api", "www", "mail", "everyone", "here", "channel"]);

export const usernameSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, "").toLowerCase())
  .refine((v) => USERNAME_RE.test(v), "3–30 letters, digits, dots or underscores, starting and ending with a letter or digit")
  .refine((v) => !/[._]{2}/.test(v), "No two dots or underscores in a row")
  .refine((v) => !RESERVED.has(v), "That username is reserved");

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Your name").max(120).optional(),
  username: usernameSchema.optional(),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => !v || v.replace(/\D/g, "").length >= 7, "A phone number with at least 7 digits")
    .optional(),
  discoverable: z.boolean().optional(),
});

/** The digits that identify a phone number: the last ten (so +91 and a leading 0 don't matter). */
export function phoneDigits(v: string) {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
}

export type Query = { kind: "email"; value: string } | { kind: "phone"; value: string } | { kind: "username"; value: string } | { kind: "none"; value: "" };

/** How a search box's text is read. */
export function readQuery(raw: string): Query {
  const q = (raw ?? "").trim();
  if (q.length < 2) return { kind: "none", value: "" };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return { kind: "email", value: q.toLowerCase() };
  if (/^\+?[\d\s()-]{7,}$/.test(q) && phoneDigits(q)) return { kind: "phone", value: phoneDigits(q) };
  return { kind: "username", value: q.replace(/^@/, "").toLowerCase() };
}

/** A starting username from a name or email: "Kabir Shah" → "kabir.shah". */
export function suggestUsername(name: string, email: string) {
  const from = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^[._]+|[._]+$/g, "")
      .replace(/[._]{2,}/g, ".")
      .slice(0, 24)
      .replace(/[._]+$/, "");
  const base = from(name) || from((email ?? "").split("@")[0] ?? "") || "member";
  const padded = base.length < 3 ? `${base}user` : base;
  return RESERVED.has(padded) ? `${padded}.cd` : padded;
}

/** One search result. Accounts never carry their email or phone back to the person searching. */
export type PersonHit =
  | { kind: "account"; id: string; name: string; username: string; member: boolean; invited: boolean }
  | { kind: "contact"; key: string; name: string; email: string; source: "CRM" | "Mail" | "Team" }
  | { kind: "email"; email: string };
