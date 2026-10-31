// Reads spreadsheets (xlsx, xlsm, xlsb, xls, ods, numbers, csv, tsv, txt)
// into plain grids. Runs in the browser, so files never leave the device
// until the owner confirms the products.
import { parseDelimited, pickSheet } from "./import";

export const ACCEPT = ".xlsx,.xlsm,.xlsb,.xls,.ods,.numbers,.csv,.tsv,.txt";
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export type Sheet = { name: string; grid: unknown[][] };

/** `blankRows` keeps empty rows so row numbers match the spreadsheet. */
export async function readSheets(data: ArrayBuffer, fileName: string, opts: { blankRows?: boolean } = {}): Promise<Sheet[]> {
  if (data.byteLength > MAX_FILE_BYTES) throw new Error("Files up to 15 MB, please — split larger catalogues into parts.");
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["csv", "tsv", "txt"].includes(ext)) {
    // Try UTF-8 first; fall back to Windows-1252 for files saved by older Excel.
    let text = new TextDecoder("utf-8", { fatal: false }).decode(data);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(data);
    return [{ name: fileName, grid: parseDelimited(text) }];
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(data), { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: !!opts.blankRows });
    // Cells that are hyperlinks (e.g. "View image") carry the URL in .l.target.
    const links: Record<string, string> = {};
    for (const [addr, c] of Object.entries(ws as Record<string, { l?: { Target?: string } }>)) if (c && typeof c === "object" && c.l?.Target) links[addr] = c.l.Target;
    if (Object.keys(links).length) {
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      for (const [addr, url] of Object.entries(links)) {
        const { r, c } = XLSX.utils.decode_cell(addr);
        const row = grid[r - range.s.r];
        if (row && /^https?:\/\//i.test(url)) row[c - range.s.c] = url;
      }
    }
    return { name, grid: grid.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v))) };
  });
}

/** Reads a file and picks the sheet that looks most like a product list. */
export async function readProductSheet(file: File) {
  const sheets = await readSheets(await file.arrayBuffer(), file.name);
  const nonEmpty = sheets.filter((s) => s.grid.length > 1);
  if (!nonEmpty.length) throw new Error("This file has no rows we can read.");
  return { sheets: nonEmpty, best: pickSheet(nonEmpty) };
}
