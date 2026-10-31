// HTML escaping and URL allow-listing shared by every renderer.
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** A path on this site — not "//host" or "/\host" (browsers read both, even with tabs or newlines inside, as another site). */
const isSitePath = (s: string) => s.startsWith("/") && !/^\/[/\\]/.test(s.replace(/[\t\n\r]/g, ""));

/** Allow only http(s), mailto, tel, in-page anchors and site-relative paths. */
export function safeUrl(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.startsWith("#") || isSitePath(s)) return s;
  try {
    const u = new URL(s);
    if (["http:", "https:", "mailto:", "tel:"].includes(u.protocol)) return u.toString();
  } catch {
    /* fall through */
  }
  return "";
}

export function safeImageUrl(v: unknown): string {
  const s = String(v ?? "").trim();
  if (isSitePath(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {
    /* ignore */
  }
  return "";
}

