// Downloads for any list: CSV (opens anywhere) or Excel (.xlsx), built in the
// browser from rows already on screen. Money columns are written as rupees.
import { csvEscape } from "@/lib/data/model";

export type Column = { key: string; label: string; money?: boolean; format?: (v: unknown, row: Record<string, unknown>) => unknown };

const valueOf = (c: Column, row: Record<string, unknown>) => {
  const v = c.format ? c.format(row[c.key], row) : row[c.key];
  if (c.money && typeof v === "number") return Math.round(v) / 100;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object") return JSON.stringify(v);
  return v ?? "";
};

// Quoted when needed; a leading = + - @ would run as a formula in Excel, so it's kept as text.
const cell = (v: unknown) => csvEscape(String(v ?? ""));

export async function downloadRows(name: string, columns: Column[], rows: Record<string, unknown>[], format: "csv" | "xlsx") {
  const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const file = `${name}-${stamp}.${format}`;
  if (format === "csv") {
    const text = [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell(valueOf(c, r))).join(","))].join("\n");
    save(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }), file);
    return;
  }
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => valueOf(c, r)))]);
  ws["!cols"] = columns.map((c) => ({ wch: Math.min(40, Math.max(c.label.length + 2, ...rows.slice(0, 200).map((r) => String(valueOf(c, r)).length + 1))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  save(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), file);
}

function save(blob: Blob, file: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
