import { lookup } from "node:dns";
import { lookup as lookupAsync } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { ApiError } from "../http/errors";

// Outbound fetching of user-supplied URLs with SSRF protection:
// - http(s) only, default ports only, no credentials in the URL;
// - every resolved address (including after redirects, and at connect time
//   via a pinned lookup) must be public — this also defeats DNS rebinding;
// - bounded redirects, time and response size.

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** An IPv6 address as eight 16-bit groups (handles "::" and a dotted IPv4 tail), or null. */
function ipv6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase().replace(/%.*$/, "");
  const dotted = v.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[2]) !== 4) return null;
    const n = ipv4ToInt(dotted[2]);
    v = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

const v4Of = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return !V4_BLOCKS.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (isIP(ip) === 6) {
    const g = ipv6Groups(ip);
    if (!g) return false;
    // IPv4 inside IPv6 — mapped (::ffff:a.b.c.d, in any spelling), IPv4-compatible (::a.b.c.d),
    // and 6to4 (2002:aabb:ccdd::) — is judged by the IPv4 address it reaches.
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return g[6] === 0 && g[7] <= 1 ? false : isPublicAddress(v4Of(g[6], g[7]));
    if (g[0] === 0x2002) return isPublicAddress(v4Of(g[1], g[2]));
    // Only global unicast (2000::/3) is public; within it, refuse NAT64-adjacent, Teredo,
    // documentation, ORCHID and benchmarking ranges.
    if ((g[0] & 0xe000) !== 0x2000) return false;
    if (g[0] === 0x2001 && (g[1] < 0x200 || g[1] === 0xdb8)) return false;
    if (g[0] === 0x3fff && g[1] < 0x1000) return false;
    return true;
  }
  return false;
}

const agent = new Agent({
  connect: {
    timeout: 5000,
    lookup(hostname, options, cb) {
      lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return cb(err, [] as never);
        const list = (Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }]) as { address: string; family: number }[];
        const bad = list.find((a) => !isPublicAddress(a.address));
        if (bad || !list.length) return cb(new Error("blocked address"), [] as never);
        cb(null, list as never);
      });
    },
  },
});

const LOCAL_NAME = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

export function validateUrl(raw: string): URL {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) && !/^https?:\/\//i.test(raw.trim())) {
    throw new ApiError("validation_failed", "Only http(s) addresses are allowed", { url: ["Not allowed"] });
  }
  let u: URL;
  try {
    u = new URL(raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new ApiError("validation_failed", "Enter a valid web address", { url: ["Invalid URL"] });
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || (u.port && !["80", "443"].includes(u.port))) {
    throw new ApiError("validation_failed", "Only public http(s) addresses on standard ports are allowed", { url: ["Not allowed"] });
  }
  if (isIP(u.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(u.hostname.replace(/^\[|\]$/g, ""))) {
    throw new ApiError("validation_failed", "That address is not publicly reachable", { url: ["Not allowed"] });
  }
  if (LOCAL_NAME.test(u.hostname.replace(/\.$/, ""))) throw new ApiError("validation_failed", "That address is not publicly reachable", { url: ["Not allowed"] });
  return u;
}

export async function safeFetchText(raw: string, opts: { maxBytes?: number; accept?: string } = {}): Promise<{ url: URL; text: string; contentType: string }> {
  const maxBytes = opts.maxBytes ?? 1_000_000;
  let url = validateUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    let res;
    try {
      res = await undiciFetch(url, {
        dispatcher: agent,
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Cloudesk-BrandImport/1.0 (+https://localhost)", Accept: opts.accept ?? "text/html,text/css;q=0.9,*/*;q=0.5" },
      });
    } catch {
      throw new ApiError("provider_error", "Could not reach that website (it may be private, offline or blocking requests).");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      url = validateUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new ApiError("provider_error", `The website responded with status ${res.status}.`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return { url, text: Buffer.concat(chunks).toString("utf8"), contentType: res.headers.get("content-type") ?? "" };
  }
  throw new ApiError("provider_error", "The website redirected too many times.");
}

export type SafeResponse = { status: number; headers: Record<string, string>; text: string; truncated: boolean };

/**
 * Any-method request to a user-supplied URL with the same protections.
 * Redirects are followed only for GET/HEAD (re-validated on every hop);
 * other methods return the redirect status as-is.
 */
export async function safeRequest(raw: string, opts: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number; timeoutMs?: number } = {}): Promise<SafeResponse> {
  const method = (opts.method ?? "GET").toUpperCase();
  const follow = method === "GET" || method === "HEAD";
  const maxBytes = opts.maxBytes ?? 64_000;
  let url = validateUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    let res;
    try {
      res = await undiciFetch(url, {
        dispatcher: agent,
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        headers: { "User-Agent": "Cloudesk-Automations/1.0", ...opts.headers },
        body: follow ? undefined : opts.body,
      });
    } catch (e) {
      throw new ApiError("provider_error", (e as Error).name === "TimeoutError" ? "The request timed out" : "Could not reach that address (it may be private, offline or blocking requests).");
    }
    if (follow && res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = validateUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, headers, text: Buffer.concat(chunks).toString("utf8"), truncated };
  }
  throw new ApiError("provider_error", "Too many redirects");
}

/**
 * For raw socket connections to a user-configured server (IMAP/SMTP): resolves
 * the host and returns one public address to connect to — refusing names that
 * resolve to private, loopback, link-local or metadata addresses. Connecting to
 * the returned IP (with the name as TLS servername) pins it, so a DNS answer
 * can't change between this check and the connection.
 */
export async function publicAddressOf(host: string, resolve: (h: string) => Promise<{ address: string }[]> = (h) => lookupAsync(h, { all: true })): Promise<string> {
  const h = host.trim().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  const blocked = () => new ApiError("validation_failed", `${host} isn't a public server — private, local and cloud-internal addresses can't be used`, { host: ["Not allowed"] });
  if (isIP(h)) {
    if (!isPublicAddress(h)) throw blocked();
    return h;
  }
  if (!h || LOCAL_NAME.test(h)) throw blocked();
  const list = await resolve(h);
  if (!list.length || list.some((a) => !isPublicAddress(a.address))) throw blocked();
  return list[0].address;
}
