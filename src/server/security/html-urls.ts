// Defence in depth for third-party HTML we show inside a sandboxed frame (email
// bodies): links that would run script when followed — javascript:, vbscript:,
// data: — are replaced with "#". The frame's CSP already forbids script, but a
// link opened in a new window (allow-popups-to-escape-sandbox) leaves that
// sandbox, so the URL itself must be harmless.

const NAMED: Record<string, string> = { colon: ":", tab: "\t", newline: "\n", sol: "/", lpar: "(", rpar: ")", amp: "&", quot: '"', apos: "'" };

/** Decodes the entities a browser would decode in an attribute value. */
function decode(v: string) {
  return v.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** True when a URL attribute value would run script (after the browser decodes and strips it). */
export function isScriptUrl(raw: string): boolean {
  const v = decode(raw)
    .replace(/[\u0000- \u007f-\u009f]/g, "")
    .toLowerCase();
  return /^(javascript|vbscript|data|livescript):/.test(v);
}

const URL_ATTR = /(\s(?:href|action|formaction|xlink:href|src|data)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi;

/** Replaces script-running URLs in href/action/src-like attributes with "#". `data:` images stay. */
export function neutralizeScriptUrls(html: string): string {
  return html.replace(URL_ATTR, (m, pre: string, quoted: string) => {
    const value = /^["']/.test(quoted) ? quoted.slice(1, -1) : quoted;
    if (!isScriptUrl(value)) return m;
    // Inline images (data:image/…) are fine where they load as images.
    if (/^\s*src/i.test(pre.trimStart()) && /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(decode(value).trim())) return m;
    return `${pre}"#"`;
  });
}
