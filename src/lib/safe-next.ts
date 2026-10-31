// Where to go after signing in (?next=…): only a path on this site. A plain
// "starts with / but not //" check isn't enough — browsers and the URL parser
// read "/\evil.com" and "/<tab>/evil.com" as "//evil.com", another site.
export function safeNextPath(next: string | null | undefined, fallback = "/home"): string {
  if (!next || next.length > 300 || !next.startsWith("/")) return fallback;
  // Backslashes and control characters (tabs and newlines are dropped by the URL parser) are never needed in a path.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  if (next.startsWith("//")) return fallback;
  try {
    const base = "http://same.invalid";
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
