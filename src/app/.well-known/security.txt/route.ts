// RFC 9116 security.txt: where to report a vulnerability. The contact is the
// legal contact (Admin → Settings → Legal), else the support email, else the
// contact page; Expires is always a year ahead.
import { settings } from "@/server/platform/settings";

export async function GET(req: Request) {
  const s = await settings().catch(() => null);
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  const url = (p: string) => new URL(p, base).toString();
  const email = s?.legal.contactEmail || s?.general.supportEmail || "";
  const expires = new Date(Date.now() + 365 * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  const lines = [
    `# Security contact for ${s?.general.productName || "Cloudesk"}. Please read the policy before testing.`,
    email ? `Contact: mailto:${email}` : null,
    `Contact: ${url("/contact")}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${url("/.well-known/security.txt")}`,
    `Policy: ${url("/security#disclosure")}`,
  ].filter(Boolean);
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
