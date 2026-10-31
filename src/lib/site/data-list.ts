// The "Data list" section: rows from a project data table, rendered on the
// server (published pages get live rows per request; no client script).
import { esc, safeImageUrl, safeUrl } from "./html";

export type DataListField = { key: string; name: string; type: string };
export type DataListTable = { name: string; fields: DataListField[] };
export type DataListRow = Record<string, unknown>;

export const DATA_LIST_CSS = `.dl-grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}.dl-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column}.dl-card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}.dl-card .dl-body{padding:16px 18px;display:grid;gap:6px}.dl-card h3{margin:0;font-family:var(--heading-font);font-size:1.1rem}.dl-meta{color:var(--muted);font-size:.9rem;margin:0}.dl-tag{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:.8rem;margin:2px 4px 0 0}.dl-table{width:100%;border-collapse:collapse;font-size:.95rem}.dl-table th{text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);padding:10px 12px}.dl-table td{border-bottom:1px solid var(--line);padding:10px 12px;vertical-align:top}.dl-scroll{overflow-x:auto}.dl-list{list-style:none;margin:0;padding:0;display:grid;gap:0}.dl-list li{display:flex;gap:16px;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--line);padding:14px 0}.dl-list li strong{font-family:var(--heading-font)}.dl-empty{color:var(--muted)}a.dl-link{color:inherit}`;

function cell(v: unknown, type: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.map((x) => `<span class="dl-tag">${esc(x)}</span>`).join("");
  if (type === "boolean") return v ? "✓" : "—";
  if (type === "url") return `<a class="dl-link" href="${esc(safeUrl(v) || "#")}" rel="noopener nofollow">${esc(String(v).replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>`;
  if (type === "email") return `<a class="dl-link" href="mailto:${esc(v)}">${esc(v)}</a>`;
  if (type === "date") return esc(new Date(`${v}T00:00:00Z`).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }));
  if (type === "datetime") return esc(new Date(String(v)).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC");
  if (type === "number") return esc(Number(v).toLocaleString("en"));
  if (typeof v === "object") {
    // An expanded link shows the linked row's first text value.
    const o = v as Record<string, unknown>;
    const first = Object.entries(o).find(([k, x]) => k !== "id" && typeof x === "string" && !/_at$/.test(k));
    return esc(first?.[1] ?? "");
  }
  return esc(v);
}

/** Props: table, titleField, imageField, linkField, fields (keys), filter, sort, limit, emptyText. */
export function dataListBody(p: Record<string, unknown>, variant: string, table: DataListTable | null, rows: DataListRow[], note?: string): string {
  const head = `${p.heading ? `<header class="sec-head"><h2>${esc(p.heading)}</h2>${p.subheading ? `<p class="lead">${esc(p.subheading)}</p>` : ""}</header>` : ""}`;
  if (!table) return `<div class="wrap">${head}<p class="dl-empty">${esc(note ?? "This list isn't connected to a table yet.")}</p></div>`;
  const byKey = new Map(table.fields.map((f) => [f.key, f]));
  const titleKey = String(p.titleField || table.fields.find((f) => f.type === "text")?.key || "");
  const shown = (Array.isArray(p.fields) ? (p.fields as unknown[]).map(String) : []).filter((k) => byKey.has(k) && k !== titleKey && k !== p.imageField && k !== p.linkField).slice(0, 8);
  if (!rows.length) return `<div class="wrap">${head}<p class="dl-empty">${esc(p.emptyText || note || "Nothing here yet.")}</p></div>`;
  const title = (r: DataListRow) => {
    const t = cell(r[titleKey], byKey.get(titleKey)?.type ?? "text");
    const link = p.linkField ? String(r[String(p.linkField)] ?? "") : "";
    return link && /^https?:\/\//.test(link) ? `<a class="dl-link" href="${esc(link)}" rel="noopener nofollow">${t}</a>` : t;
  };
  if (variant === "table") {
    const cols = [titleKey, ...shown].filter((k) => byKey.has(k));
    return `<div class="wrap">${head}<div class="dl-scroll reveal"><table class="dl-table"><thead><tr>${cols.map((k) => `<th>${esc(byKey.get(k)!.name)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${cols.map((k, i) => `<td>${i === 0 ? title(r) : cell(r[k], byKey.get(k)!.type)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div></div>`;
  }
  if (variant === "list") {
    return `<div class="wrap narrow">${head}<ul class="dl-list reveal">${rows
      .map((r) => `<li><strong>${title(r)}</strong><span class="dl-meta">${shown.map((k) => cell(r[k], byKey.get(k)!.type)).filter(Boolean).join(" · ")}</span></li>`)
      .join("")}</ul></div>`;
  }
  return `<div class="wrap">${head}<div class="dl-grid reveal">${rows
    .map((r) => {
      const img = p.imageField ? safeImageUrl(r[String(p.imageField)]) : "";
      return `<article class="dl-card">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}<div class="dl-body"><h3>${title(r)}</h3>${shown
        .map((k) => {
          const c = cell(r[k], byKey.get(k)!.type);
          return c ? `<p class="dl-meta">${esc(byKey.get(k)!.name)}: ${c}</p>` : "";
        })
        .join("")}</div></article>`;
    })
    .join("")}</div></div>`;
}
