// Guests in Chat: people outside the workspace who join one conversation
// through an invite link with just their name. The rules shared by server and
// browser, and the share links for every app the invite can go out through.
import { z } from "zod";

/** Guests' hidden identities use this unroutable domain (RFC 2606), so no mail ever reaches them and nobody can sign in as them. */
export const GUEST_DOMAIN = "guest.cloudesk.invalid";
export const isGuestEmail = (email: string) => email.toLowerCase().endsWith(`@${GUEST_DOMAIN}`);

export const EXPIRY_CHOICES = [
  { value: "1h", label: "1 hour", ms: 3_600_000 },
  { value: "1d", label: "1 day", ms: 86_400_000 },
  { value: "7d", label: "7 days", ms: 7 * 86_400_000 },
  { value: "30d", label: "30 days", ms: 30 * 86_400_000 },
  { value: "never", label: "Never", ms: 0 },
] as const;
export type Expiry = (typeof EXPIRY_CHOICES)[number]["value"];
export const USES_CHOICES = [0, 1, 5, 10, 25, 50, 100] as const;

export const inviteSchema = z.object({
  label: z.string().trim().max(60).default(""),
  approval: z.boolean().default(true),
  history: z.boolean().default(false),
  files: z.boolean().default(true),
  expires: z.enum(EXPIRY_CHOICES.map((e) => e.value) as [Expiry, ...Expiry[]]).default("7d"),
  /** 0 = no limit. */
  maxUses: z.number().int().min(0).max(1000).default(0),
});
export const invitePatchSchema = z.object({ label: z.string().trim().max(60).optional(), approval: z.boolean().optional(), history: z.boolean().optional(), files: z.boolean().optional(), revoked: z.boolean().optional() });

const email = z.string().trim().toLowerCase().email("Not an email address").max(200);
export const inviteEmailSchema = z.object({ to: z.array(email).min(1, "Add an email address").max(25, "Up to 25 at a time"), message: z.string().trim().max(1000).default("") });

/** What someone types to ask to join. Only the name is needed. */
export const joinSchema = z.object({
  name: z.string().trim().min(2, "Your name, please").max(60).regex(/^[^<>@#\[\]()\n]+$/, "Letters, numbers and spaces only"),
  contact: z.string().trim().max(120).default("").refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^\+?[\d\s()-]{7,20}$/.test(v), "An email address or a phone number"),
  note: z.string().trim().max(300).default(""),
});
export const decideSchema = z.object({ approve: z.boolean(), reason: z.string().trim().max(300).default("") });

export const GUEST_STATUS_LABEL: Record<string, string> = { pending: "Waiting for approval", approved: "In the conversation", rejected: "Not let in", removed: "Removed", left: "Left" };

/** When an invite stops working, if it does: "never" or the moment. */
export function expiryFrom(choice: Expiry, now = Date.now()): Date | null {
  const ms = EXPIRY_CHOICES.find((e) => e.value === choice)?.ms ?? 0;
  return ms ? new Date(now + ms) : null;
}

/** Why an invite can't be used now, or null when it can. */
export function inviteProblem(i: { revokedAt: Date | string | null; expiresAt: Date | string | null; maxUses: number | null; uses: number }, now = Date.now()): string | null {
  if (i.revokedAt) return "This invite link was turned off.";
  if (i.expiresAt && new Date(i.expiresAt).getTime() <= now) return "This invite link has expired.";
  if (i.maxUses && i.uses >= i.maxUses) return "This invite link has been used as many times as it allows.";
  return null;
}

/** The message that goes with the link, ready for any app. */
export function inviteText(p: { inviter: string; where: string; workspace: string; url: string; approval: boolean }) {
  return `${p.inviter} invited you to chat in ${p.where} (${p.workspace}) on Cloudesk. No account needed — just open the link and type your name${p.approval ? "; an admin lets you in" : ""}.\n\n${p.url}`;
}

export type ShareTarget = { id: string; label: string; href: string; newTab: boolean };

const enc = encodeURIComponent;
/** Only digits (with the country code) go into wa.me links. */
export const waNumber = (phone: string) => phone.replace(/[^\d]/g, "").replace(/^0+/, "");

/** Every app the invite can go out through, as links that open it with the message filled in. */
export function shareTargets(p: { url: string; text: string; subject: string; phone?: string }): ShareTarget[] {
  const wa = p.phone && waNumber(p.phone).length >= 8 ? waNumber(p.phone) : "";
  return [
    { id: "whatsapp", label: wa ? `WhatsApp +${wa}` : "WhatsApp", href: `https://wa.me/${wa}?text=${enc(p.text)}`, newTab: true },
    { id: "email", label: "Email app", href: `mailto:?subject=${enc(p.subject)}&body=${enc(p.text)}`, newTab: false },
    { id: "sms", label: "Text message", href: `sms:${wa ? `+${wa}` : ""}?&body=${enc(p.text)}`, newTab: false },
    { id: "telegram", label: "Telegram", href: `https://t.me/share/url?url=${enc(p.url)}&text=${enc(p.text.replace(p.url, "").trim())}`, newTab: true },
    { id: "teams", label: "Microsoft Teams", href: `https://teams.microsoft.com/share?href=${enc(p.url)}&msgText=${enc(p.text.replace(p.url, "").trim())}`, newTab: true },
    { id: "linkedin", label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(p.url)}`, newTab: true },
    { id: "x", label: "X", href: `https://twitter.com/intent/tweet?text=${enc(p.text)}`, newTab: true },
    { id: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(p.url)}`, newTab: true },
  ];
}
