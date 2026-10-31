// Working out the visitor's address from the request headers, and matching
// addresses against lists. Which header to believe depends on what sits in
// front of the app (Admin → Security → Firewall → "Visitor address"): a header
// a visitor can set themselves must never be trusted on its own.
export type TrustProxy = "xff-first" | "xff-last" | "x-real-ip" | "cloudflare";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]+$/i;

/** A plain IPv4/IPv6 address, or null (ports and brackets removed; anything odd rejected). */
export function cleanIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (v.startsWith("[")) v = v.slice(1, v.indexOf("]") > 0 ? v.indexOf("]") : undefined);
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(v)) v = v.replace(/:\d+$/, "");
  if (v.toLowerCase().startsWith("::ffff:") && IPV4.test(v.slice(7))) v = v.slice(7);
  const m = IPV4.exec(v);
  if (m) return m.slice(1).every((x) => Number(x) <= 255) ? v : null;
  return IPV6.test(v) && v.includes(":") && v.length <= 45 ? v.toLowerCase() : null;
}

export function clientIpFrom(h: { get(name: string): string | null }, mode: TrustProxy): string | null {
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  switch (mode) {
    case "cloudflare":
      return cleanIp(h.get("cf-connecting-ip")) ?? cleanIp(xff[xff.length - 1]);
    case "x-real-ip":
      return cleanIp(h.get("x-real-ip")) ?? cleanIp(xff[xff.length - 1]);
    case "xff-last":
      return cleanIp(xff[xff.length - 1]) ?? cleanIp(h.get("x-real-ip"));
    default:
      return cleanIp(xff[0]) ?? cleanIp(h.get("x-real-ip"));
  }
}

const v4num = (ip: string) => ip.split(".").reduce((n, x) => (n << 8) + Number(x), 0) >>> 0;

/** Whether an address is in a list of addresses and IPv4 CIDR ranges. */
export function ipInList(ip: string | null, list: readonly string[]): boolean {
  if (!ip || !list.length) return false;
  const isV4 = IPV4.test(ip);
  for (const entry of list) {
    const [base, bitsRaw] = entry.split("/");
    if (!bitsRaw) {
      if (cleanIp(base) === ip) return true;
      continue;
    }
    if (!isV4 || !IPV4.test(base ?? "")) continue;
    const bits = Number(bitsRaw);
    if (!(bits >= 0 && bits <= 32)) continue;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((v4num(ip) & mask) === (v4num(base!) & mask)) return true;
  }
  return false;
}
