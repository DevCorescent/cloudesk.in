// Runs an import on the server: every row is checked again with the same rules
// the screen used, then saved one at a time, so one bad row never stops the
// rest. Returns what was added, updated or skipped, and why rows failed.
import { z } from "zod";
import { validateRow, type Target } from "@/lib/import/engine";
import { ApiError } from "../http/errors";

export const importBody = z.object({
  rows: z.array(z.record(z.string().max(60), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]))).min(1, "Nothing to import").max(1000, "Send at most 1,000 rows at a time"),
  mode: z.string().max(20).default("update"),
});

export type Outcome = "created" | "updated" | "skipped";
export type ImportResult = { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] };

export async function runImport(target: Target, raw: unknown, save: (values: Record<string, string | number | boolean | null>, mode: string, index: number) => Promise<Outcome>): Promise<ImportResult> {
  const parsed = importBody.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation_failed", parsed.error.issues[0]?.message ?? "Check the rows");
  const out: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  for (const [i, row] of parsed.data.rows.entries()) {
    const v = validateRow(row, target);
    if (!v.ok) {
      out.errors.push({ row: i, message: v.error });
      continue;
    }
    try {
      out[await save(v.values, parsed.data.mode, i)]++;
    } catch (e) {
      out.errors.push({ row: i, message: e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Couldn't save this row" });
    }
  }
  return out;
}

export const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
