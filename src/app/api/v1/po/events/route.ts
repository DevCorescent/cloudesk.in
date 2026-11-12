import { NextResponse } from "next/server";
import { suppressByEmail } from "@/server/outreach/core";
import { safeEqual } from "@/server/security/tokens";

// Bounces and spam complaints from the email service (Resend, Postmark or
// SendGrid webhooks), authenticated by ?key=OUTREACH_WEBHOOK_KEY. Whoever
// bounced or complained is never emailed again.
type Hit = { email: string; status: "bounced" | "complained"; detail: Record<string, unknown> };

function hits(body: unknown): Hit[] {
  const out: Hit[] = [];
  const add = (email: unknown, status: Hit["status"], detail: Record<string, unknown>) => {
    if (typeof email === "string" && email.includes("@")) out.push({ email, status, detail });
  };
  // SendGrid posts an array of events.
  for (const e of Array.isArray(body) ? body : [body]) {
    const o = (e ?? {}) as Record<string, unknown>;
    // Resend: { type: "email.bounced" | "email.complained", data: { to: [...] } }
    if (typeof o.type === "string" && o.data) {
      const d = o.data as { to?: string[] | string; bounce?: { type?: string; message?: string } };
      const to = Array.isArray(d.to) ? d.to : [d.to];
      if (o.type === "email.bounced" && d.bounce?.type !== "Transient") to.forEach((t) => add(t, "bounced", { provider: "resend", reason: d.bounce?.message ?? "" }));
      if (o.type === "email.complained") to.forEach((t) => add(t, "complained", { provider: "resend" }));
    }
    // Postmark: { RecordType: "Bounce" | "SpamComplaint", Email, Type }
    if (o.RecordType === "Bounce" && /HardBounce|BadEmailAddress|ManuallyDeactivated|SpamNotification/.test(String(o.Type))) add(o.Email, "bounced", { provider: "postmark", reason: String(o.Description ?? o.Type) });
    if (o.RecordType === "SpamComplaint") add(o.Email, "complained", { provider: "postmark" });
    // SendGrid: { event: "bounce" | "dropped" | "spamreport", email }
    if (o.event === "bounce" && o.type !== "blocked") add(o.email, "bounced", { provider: "sendgrid", reason: String(o.reason ?? "") });
    if (o.event === "dropped" && /bounce|invalid/i.test(String(o.reason))) add(o.email, "bounced", { provider: "sendgrid", reason: String(o.reason ?? "") });
    if (o.event === "spamreport") add(o.email, "complained", { provider: "sendgrid" });
  }
  return out.slice(0, 1000);
}

export async function POST(req: Request) {
  const key = process.env.OUTREACH_WEBHOOK_KEY;
  const given = new URL(req.url).searchParams.get("key") ?? "";
  if (!key || !given || !safeEqual(given, key)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  let changed = 0;
  for (const h of hits(body)) if (await suppressByEmail(h.email, h.status, h.detail)) changed++;
  return NextResponse.json({ ok: true, changed });
}
