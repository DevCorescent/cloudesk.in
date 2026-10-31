// Fills "Data list" markers in published HTML with live rows. The section's
// owner chose the table and fields, so this doesn't require the table to be public.
import { dataListBody } from "@/lib/site/data-list";
import { unb64 } from "@/lib/site/render";
import type { Filter } from "@/lib/data/model";
import { log } from "../log";
import { apiRows, getTable, queryRows } from "./tables";

const MARKER = /<!--cc:dataList:([a-z-]+):([A-Za-z0-9_-]*)-->/g;
const OPS: Record<string, Filter["op"]> = { "=": "eq", "!=": "neq", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte", "~": "contains" };

export function parseSimpleFilter(s: string): Filter[] {
  return s
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((part) => /^([a-z_][a-z0-9_]*)\s*(!=|>=|<=|=|>|<|~)\s*(.*)$/.exec(part.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .slice(0, 5)
    .map((m) => ({ field: m[1], op: OPS[m[2]], value: m[3].trim().replace(/^["']|["']$/g, "") }));
}

export async function fillDataLists(html: string, projectId: string) {
  if (!html.includes("<!--cc:dataList:")) return html;
  const parts: { m: string; out: Promise<string> }[] = [];
  for (const [m, variant, data] of html.matchAll(MARKER)) {
    parts.push({
      m,
      out: (async () => {
        let p: Record<string, unknown> = {};
        try {
          p = JSON.parse(unb64(data));
        } catch {
          return "";
        }
        try {
          const t = await getTable(projectId, String(p.table ?? ""));
          const sort = String(p.sort ?? "").trim();
          const { rows } = await queryRows(t, { filters: parseSimpleFilter(String(p.filter ?? "")), sort: sort ? [{ field: sort.replace(/^-/, ""), dir: sort.startsWith("-") ? "desc" : "asc" }] : [], q: "", limit: Math.min(48, Math.max(1, Number(p.limit) || 12)), offset: 0 });
          const expand = t.fields.filter((f) => f.type === "relation").map((f) => f.key);
          return dataListBody(p, variant, { name: t.name, fields: t.fields }, await apiRows(projectId, t, rows, expand));
        } catch (e) {
          log.warn("data_list_failed", { projectId, error: (e as Error).message });
          return dataListBody(p, variant, null, [], "This list is temporarily unavailable.");
        }
      })(),
    });
  }
  let out = html;
  for (const x of parts) {
    const body = await x.out;
    // A function replacement: row text may contain "$&" and similar patterns.
    out = out.replace(x.m, () => body);
  }
  return out;
}
