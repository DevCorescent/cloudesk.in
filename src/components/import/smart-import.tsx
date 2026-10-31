"use client";

// The smart importer, used for every list that can be imported. Four steps:
//   1. Drop a file (CSV, Excel, ODS, Numbers…) or paste; pick a sheet if there
//      are several. The header row is found for you, under any title rows.
//   2. Match columns: each field shows the column we picked and why, with
//      sample values; fields not in the file can take one value for everyone.
//   3. Review: every row cleaned and checked. Problems are highlighted with a
//      suggestion ("Maharashtra (MH)"), and empty or wrong cells can be typed
//      in right there — or a fix applied to every row like it.
//   4. Import, in batches, with a list of anything the server turned down,
//      ready to fix and send again or download.
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Download, FileSpreadsheet, Sparkles, Wand2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Button, Input, Notice, Select, Textarea, cx } from "@/components/ui/primitives";
import { useSession } from "@/components/shell/session-context";
import { api } from "@/lib/client/api";
import { buildRows, clean, matchColumns, plain, rowErrors, tableFrom, type Field, type Match, type Row, type Target } from "@/lib/import/engine";
import { ACCEPT, readSheets, type Sheet } from "@/lib/store/read-sheet";
import { parseDelimited } from "@/lib/store/import";
import { downloadRows } from "./export";

export type ImportResult = { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] };
type Props = {
  target: Target;
  onClose: () => void;
  /** Saves a batch of clean rows; `row` numbers in errors are positions in the batch. */
  onImport: (rows: Record<string, unknown>[], mode: string) => Promise<ImportResult>;
  /** Shown above the import button: anything the import also needs (a location, a date). */
  extra?: React.ReactNode;
  onDone?: (r: ImportResult) => void;
};

const BATCH = 300;
type Saved = { id: string; name: string; headers: string[]; mapping: Record<string, string | null>; constants: Record<string, string> };

export function SmartImport({ target, onClose, onImport, extra, onDone }: Props) {
  const [step, setStep] = useState<"file" | "match" | "review" | "done">("file");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [fileName, setFileName] = useState("");
  const [problem, setProblem] = useState("");
  const [paste, setPaste] = useState("");
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [why, setWhy] = useState<Match[]>([]);
  const [constants, setConstants] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [only, setOnly] = useState(false);
  const [mode, setMode] = useState(target.defaultMode ?? target.modes?.[0]?.value ?? "add");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { org } = useSession();
  const hub = `/api/v1/orgs/${org.id}/masterdata`;
  const [saved, setSaved] = useState<Saved[]>([]);
  const [using, setUsing] = useState<string | null>(null);
  const [mapName, setMapName] = useState("");
  const [mapSaved, setMapSaved] = useState(false);

  const table = useMemo(() => (sheets[sheetIdx] ? tableFrom(sheets[sheetIdx].grid, target) : null), [sheets, sheetIdx, target]);

  const load = async (list: Sheet[], name: string) => {
    const usable = list.filter((s) => s.grid.length > 1);
    if (!usable.length) return setProblem("We couldn't find any rows in that file.");
    // The sheet with the most matching headings wins.
    const scored = usable.map((s, i) => {
      const t = tableFrom(s.grid, target);
      return { i, score: matchColumns(t.headers, t.rows, target).filter((m) => m.field).length * 1000 + t.rows.length };
    });
    const best = scored.sort((a, b) => b.score - a.score)[0].i;
    setSheets(usable);
    setFileName(name);
    setProblem("");
    // Column mappings saved for this kind of file before (when there's a workspace to ask).
    const known = await api<{ mappings: Saved[] }>(`${hub}/mappings?target=${encodeURIComponent(target.id)}`).then((r) => r.mappings).catch(() => [] as Saved[]);
    setSaved(known);
    pickSheet(usable, best, known);
  };
  const pickSheet = (list: Sheet[], i: number, known = saved) => {
    setSheetIdx(i);
    const t = tableFrom(list[i].grid, target);
    const m = matchColumns(t.headers, t.rows, target);
    setWhy(m);
    // The same headings as a saved mapping: use it.
    const key = (h: string) => h.trim().toLowerCase();
    const heads = t.headers.map((h) => key(String(h ?? "")));
    const same = known.find((k) => k.headers.length === heads.length && k.headers.every((h) => heads.includes(key(h))));
    const fields = new Set(target.fields.map((f) => f.key));
    if (same) {
      const by = new Map(Object.entries(same.mapping).map(([h, f]) => [key(h), f]));
      setMapping(heads.map((h, j) => { const f = by.get(h); return f && fields.has(f) ? f : f === null ? null : m[j].field; }));
      setConstants(Object.fromEntries(Object.entries(same.constants).filter(([k]) => fields.has(k))));
      setUsing(same.name);
    } else {
      setMapping(m.map((x) => x.field));
      setUsing(null);
    }
    setMapSaved(false);
    setStep("match");
  };
  const saveMapping = async () => {
    if (!table || !mapName.trim()) return;
    try {
      await api(`${hub}/mappings`, { method: "POST", body: { target: target.id, name: mapName.trim(), headers: table.headers.map((h) => String(h ?? "")), mapping: Object.fromEntries(table.headers.map((h, j) => [String(h ?? ""), mapping[j] ?? null])), constants } });
      setMapSaved(true);
      setUsing(mapName.trim());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't save the columns");
    }
  };
  const onFile = async (f: File) => {
    try {
      await load(await readSheets(await f.arrayBuffer(), f.name, { blankRows: true }), f.name);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "We couldn't read that file.");
    }
  };

  const review = () => {
    if (!table) return;
    setRows(buildRows(table.rows, mapping, target, constants));
    setSkip(new Set());
    setStep("review");
  };

  const setCell = (r: number, key: string, value: string) => {
    const f = target.fields.find((x) => x.key === key)!;
    setRows((rs) => rs.map((row, i) => (i === r ? { ...row, [key]: clean(value, f) } : row)));
  };
  /** Use a suggestion everywhere the same value appears. */
  const fixAll = (key: string, raw: string, value: string | number | boolean) => {
    const f = target.fields.find((x) => x.key === key)!;
    setRows((rs) => rs.map((row) => (row[key].raw === raw && row[key].error ? { ...row, [key]: clean(String(value), f) } : row)));
  };

  const live = rows.map((r, i) => ({ r, i })).filter(({ i }) => !skip.has(i));
  const bad = live.filter(({ r }) => rowErrors(r) > 0);
  const missingRequired = target.fields.filter((f) => f.required && !mapping.includes(f.key) && !constants[f.key]);

  const run = async () => {
    setBusy(true);
    const total: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    const ready = live.filter(({ r }) => rowErrors(r) === 0);
    // Totals of number and money columns, to reconcile what was in the file with what was saved.
    const numeric = target.fields.filter((f) => f.type === "money" || f.type === "number" || f.type === "int");
    const sum = (list: { r: Row }[], key: string) => list.reduce((n, { r }) => n + (typeof r[key]?.value === "number" ? (r[key].value as number) : 0), 0);
    const fileTotals = Object.fromEntries(numeric.filter((f) => mapping.includes(f.key) || constants[f.key]).map((f) => [f.key, { label: f.label, file: sum(live, f.key), saved: 0, money: f.type === "money" }]));
    // Every import is kept in the workspace's history (if that can't be reached, the import still runs).
    const runId = await api<{ id: string }>(`${hub}/imports`, { method: "POST", body: { target: target.id, fileName, mode, rows: live.length, totals: fileTotals } }).then((r) => r.id).catch(() => null);
    try {
      for (let b = 0; b < ready.length; b += BATCH) {
        const part = ready.slice(b, b + BATCH);
        const r = await onImport(part.map(({ r }) => plain(r)), mode);
        total.created += r.created;
        total.updated += r.updated;
        total.skipped += r.skipped;
        total.errors.push(...r.errors.map((e) => ({ row: part[e.row]?.i ?? e.row, message: e.message })));
        setProgress(Math.min(ready.length, b + BATCH) / ready.length);
      }
      setResult(total);
      setStep("done");
      onDone?.(total);
      if (runId) {
        const failed = new Set(total.errors.map((e) => e.row));
        const savedRows = ready.filter(({ i }) => !failed.has(i));
        const errs = [...total.errors.map((e) => ({ row: rowNo(e.row), message: e.message, data: plain(rows[e.row]) })), ...bad.map(({ r, i }) => ({ row: rowNo(i), message: "Not sent: fix the highlighted cells", data: plain(r) }))].slice(0, 500);
        await api(`${hub}/imports/${runId}/finish`, { method: "POST", body: { created: total.created, updated: total.updated, skipped: total.skipped, errors: errs, totals: Object.fromEntries(Object.entries(fileTotals).map(([k, t]) => [k, { ...t, saved: sum(savedRows, k) }])) } }).catch(() => {});
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The import stopped part-way.");
    } finally {
      setBusy(false);
    }
  };

  const rowNo = (i: number) => table?.rowNumbers[i] ?? i + 2;
  const failedRows = result ? result.errors.map((e) => ({ row: rowNo(e.row), problem: e.message, ...Object.fromEntries(target.fields.map((f) => [f.label, rows[e.row]?.[f.key]?.raw ?? ""])) })) : [];
  const template = () => downloadRows(`${target.id.replace(".", "-")}-template`, target.fields.map((f) => ({ key: f.key, label: f.label })), [Object.fromEntries(target.fields.map((f) => [f.key, f.example ?? ""]))], "xlsx");

  const footer =
    step === "file" ? (
      <>
        <Button variant="ghost" className="mr-auto" icon={<Download className="size-4" />} onClick={template}>
          Download a template
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!paste.trim()} onClick={() => void load([{ name: "Pasted", grid: parseDelimited(paste) }], "Pasted rows")}>
          Use pasted rows
        </Button>
      </>
    ) : step === "match" ? (
      <>
        <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("file")}>
          Another file
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<ArrowRight className="size-4" />} disabled={!!missingRequired.length} onClick={review}>
          Check {table?.rows.length ?? 0} row{table?.rows.length === 1 ? "" : "s"}
        </Button>
      </>
    ) : step === "review" ? (
      <>
        <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("match")}>
          Columns
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!live.length || live.length === bad.length} onClick={run}>
          {busy ? `Importing… ${Math.round(progress * 100)}%` : `Import ${live.length - bad.length} ${target.noun}${live.length - bad.length === 1 ? "" : "s"}`}
        </Button>
      </>
    ) : (
      <>
        {result && result.errors.length > 0 && (
          <Button variant="ghost" className="mr-auto" icon={<Download className="size-4" />} onClick={() => downloadRows(`${target.id.replace(".", "-")}-not-imported`, Object.keys(failedRows[0] ?? {}).map((k) => ({ key: k, label: k })), failedRows, "xlsx")}>
            Rows not imported
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </>
    );

  return (
    <Dialog open onClose={busy ? () => {} : onClose} size="2xl" title={`Import ${target.label.toLowerCase()}`} description={step === "file" ? "Any spreadsheet works — we'll find the right columns and show you what needs fixing before anything is saved." : fileName} footer={footer}>
      {problem && (
        <div className="mb-3">
          <Notice tone="danger">{problem}</Notice>
        </div>
      )}
      {step === "file" && (
        <div className="grid gap-4">
          <button
            type="button"
            onClick={() => file.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onFile(f);
            }}
            className="grid place-items-center gap-2 rounded-[20px] border-2 border-dashed border-border px-6 py-10 text-center hover:bg-surface-2"
          >
            <FileSpreadsheet className="size-8 text-muted" />
            <b className="text-[15px]">Drop a file here, or choose one</b>
            <span className="text-[12.5px] text-muted">Excel (.xlsx, .xls), CSV, TSV, OpenDocument or Numbers — exports from Tally, Zoho, Busy, Shopify or your own sheet</span>
          </button>
          <input ref={file} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          <Textarea aria-label="Or paste rows" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste rows copied from a spreadsheet, with the headings" className="font-mono text-[12px]" />
          <div>
            <p className="mb-1.5 text-[12px] font-semibold tracking-[0.12em] text-subtle uppercase">What we look for</p>
            <ul className="flex flex-wrap gap-1.5">
              {target.fields.map((f) => (
                <li key={f.key} className={cx("rounded-full px-2.5 py-1 text-[12px]", f.required ? "bg-accent-soft font-medium text-accent" : "bg-surface-2 text-muted")}>
                  {f.label}
                  {f.required ? " *" : ""}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {step === "match" && table && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            {sheets.length > 1 && (
              <Select aria-label="Sheet" className="!w-auto" value={String(sheetIdx)} onChange={(e) => pickSheet(sheets, Number(e.target.value))}>
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    Sheet: {s.name}
                  </option>
                ))}
              </Select>
            )}
            <span>
              {table.rows.length} rows · headings found on row {table.headerRow + 1} · {mapping.filter(Boolean).length} of {table.headers.length} columns matched
            </span>
            {using && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-fg">Using saved columns “{using}”</span>}
            <span className="ml-auto flex items-center gap-1.5">
              <Input aria-label="Name for these columns" className="!h-7 !w-44 text-[12.5px]" placeholder="Save these columns as…" value={mapName} onChange={(e) => (setMapName(e.target.value), setMapSaved(false))} />
              <Button size="sm" variant="ghost" disabled={!mapName.trim()} onClick={() => void saveMapping()}>{mapSaved ? "Saved" : "Save"}</Button>
            </span>
          </div>
          <div className="max-h-[52vh] overflow-y-auto rounded-[16px] border border-border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface text-left text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">From column</th>
                  <th className="px-3 py-2 font-medium">Sample</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {target.fields.map((f) => {
                  const col = mapping.indexOf(f.key);
                  const samples = col >= 0 ? table.rows.slice(0, 3).map((r) => String(r[col] ?? "")).filter(Boolean) : [];
                  return (
                    <tr key={f.key} className={cx(f.required && col < 0 && !constants[f.key] && "bg-danger-soft/40")}>
                      <td className="px-3 py-2 align-top">
                        <b className="font-medium">
                          {f.label}
                          {f.required && <span className="text-danger"> *</span>}
                        </b>
                        {f.hint && <span className="block text-[11.5px] text-muted">{f.hint}</span>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Select
                          aria-label={`Column for ${f.label}`}
                          value={col >= 0 ? String(col) : ""}
                          onChange={(e) => {
                            const next = mapping.map((m) => (m === f.key ? null : m));
                            if (e.target.value !== "") next[Number(e.target.value)] = f.key;
                            setMapping(next);
                          }}
                        >
                          <option value="">Not in my file</option>
                          {table.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                              {mapping[i] && mapping[i] !== f.key ? ` (used for ${target.fields.find((x) => x.key === mapping[i])?.label})` : ""}
                            </option>
                          ))}
                        </Select>
                        {col >= 0 && why[col]?.field === f.key && why[col].why && (
                          <span className="mt-1 flex items-center gap-1 text-[11.5px] text-muted">
                            <Sparkles className="size-3 text-accent" /> {why[col].why}
                          </span>
                        )}
                        {col < 0 && (
                          <ConstantInput field={f} value={constants[f.key] ?? ""} onChange={(v) => setConstants({ ...constants, [f.key]: v })} />
                        )}
                        {col >= 0 && f.type !== "longtext" && (
                          <ConstantInput field={f} blanks value={constants[f.key] ?? ""} onChange={(v) => setConstants({ ...constants, [f.key]: v })} />
                        )}
                      </td>
                      <td className="max-w-[220px] px-3 py-2 align-top text-[12px] text-muted">{samples.length ? samples.map((s) => <span key={s} className="block truncate">{s}</span>) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {table.headers.some((_, i) => !mapping[i]) && (
            <p className="text-[12px] text-muted">
              Not imported: {table.headers.filter((_, i) => !mapping[i]).join(", ")}
            </p>
          )}
          {missingRequired.length > 0 && <p className="text-[12.5px] text-danger">Pick a column (or give one value for everyone) for {missingRequired.map((f) => f.label).join(", ")}.</p>}
        </div>
      )}

      {step === "review" && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[13px]">
              {bad.length ? <AlertTriangle className="size-4 text-warning" /> : <Check className="size-4 text-success" />}
              <span>
                <b>{live.length - bad.length}</b> ready{bad.length ? (
                  <>
                    {" "}
                    · <b className="text-warning">{bad.length}</b> need a fix (fix them below or they&apos;re left out)
                  </>
                ) : null}
                {skip.size ? ` · ${skip.size} skipped` : ""}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {target.modes && (
                <Select aria-label="Rows that already exist" className="!w-auto" value={mode} onChange={(e) => setMode(e.target.value)}>
                  {target.modes.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              )}
              <label className="flex items-center gap-1.5 text-[12.5px]">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only rows to fix
              </label>
            </div>
          </div>
          {extra}
          <ReviewGrid target={target} rows={rows} rowNo={rowNo} skip={skip} only={only} setSkip={setSkip} setCell={setCell} fixAll={fixAll} />
        </div>
      )}

      {step === "done" && result && (
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Tile n={result.created} label="added" good />
            <Tile n={result.updated} label="updated" />
            <Tile n={result.skipped + skip.size + bad.length} label="left out" />
          </div>
          {result.errors.length > 0 && (
            <div className="rounded-[16px] border border-border">
              <p className="border-b border-border px-3 py-2 text-[13px] font-medium">Not imported</p>
              <ul className="max-h-60 divide-y divide-border overflow-y-auto text-[12.5px]">
                {result.errors.slice(0, 200).map((e, i) => (
                  <li key={i} className="flex gap-3 px-3 py-1.5">
                    <span className="w-16 shrink-0 text-muted">Row {rowNo(e.row)}</span>
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Tile({ n, label, good }: { n: number; label: string; good?: boolean }) {
  return (
    <div className="rounded-[16px] bg-surface-2 p-4">
      <b className={cx("block text-[26px] tabular-nums", good && n > 0 && "text-success")}>{n}</b>
      <span className="text-[12.5px] text-muted">{label}</span>
    </div>
  );
}

/** One value for every row (when the file doesn't have the column), or for blank cells. */
function ConstantInput({ field, value, onChange, blanks }: { field: Field; value: string; onChange: (v: string) => void; blanks?: boolean }) {
  const label = blanks ? `Fill blanks in ${field.label} with` : `${field.label} for every row`;
  if (blanks && !field.required && !field.fallback) return null;
  return (
    <div className="mt-1.5">
      {field.type === "enum" || field.type === "bool" ? (
        <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="!h-8 text-[12.5px]">
          <option value="">{blanks ? "Leave blanks empty" : field.fallback ? `Use the usual (${field.fallback})` : "Leave empty"}</option>
          {(field.type === "bool" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <input
          aria-label={label}
          type={field.type === "date" ? "date" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={blanks ? "Fill blanks with…" : field.fallback ? `Usual: ${field.fallback}` : "Same value for every row…"}
          className="h-8 w-full rounded-[10px] border border-border bg-surface px-2.5 text-[12.5px] placeholder:text-subtle"
        />
      )}
    </div>
  );
}

const PAGE = 60;

function ReviewGrid({ target, rows, rowNo, skip, only, setSkip, setCell, fixAll }: { target: Target; rows: Row[]; rowNo: (i: number) => number; skip: Set<number>; only: boolean; setSkip: (s: Set<number>) => void; setCell: (r: number, k: string, v: string) => void; fixAll: (k: string, raw: string, v: string | number | boolean) => void }) {
  const [page, setPage] = useState(0);
  const cols = target.fields.filter((f) => rows.some((r) => r[f.key].value !== null || r[f.key].error));
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !only || rowErrors(r) > 0);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="grid gap-2">
      <div className="max-h-[50vh] overflow-auto rounded-[16px] border border-border">
        <table className="w-max min-w-full text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-surface text-left text-[11.5px] text-muted">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              {cols.map((f) => (
                <th key={f.key} className="px-2 py-2 font-medium whitespace-nowrap">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {slice.map(({ r, i }) => (
              <tr key={i} className={cx(skip.has(i) && "opacity-40")}>
                <td className="px-2 py-1 align-top">
                  <label className="flex items-center gap-1 text-muted">
                    <input
                      type="checkbox"
                      aria-label={`Import row ${rowNo(i)}`}
                      className="size-3.5 accent-[var(--accent)]"
                      checked={!skip.has(i)}
                      onChange={(e) => {
                        const n = new Set(skip);
                        if (e.target.checked) n.delete(i);
                        else n.add(i);
                        setSkip(n);
                      }}
                    />
                    {rowNo(i)}
                  </label>
                </td>
                {cols.map((f) => {
                  const c = r[f.key];
                  return (
                    <td key={f.key} className={cx("min-w-[120px] px-1 py-1 align-top", c.error && "bg-danger-soft/50")}>
                      <input
                        aria-label={`${f.label}, row ${rowNo(i)}`}
                        defaultValue={c.error ? c.raw : display(c.value, f)}
                        key={`${c.raw}|${String(c.value)}`}
                        onBlur={(e) => e.target.value !== (c.error ? c.raw : display(c.value, f)) && setCell(i, f.key, e.target.value)}
                        placeholder={f.required ? "Needed" : ""}
                        className={cx("h-7 w-full rounded-[8px] border bg-transparent px-1.5", c.error ? "border-danger/60" : "border-transparent hover:border-border focus:border-border")}
                      />
                      {c.error && (
                        <span className="mt-0.5 block max-w-[220px] text-[11px] leading-tight text-danger">
                          {c.error}
                          {c.suggestion && (
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              <button type="button" className="rounded-full bg-accent-soft px-1.5 py-0.5 font-medium text-accent" onClick={() => setCell(i, f.key, String(c.suggestion!.value))}>
                                <Wand2 className="mr-0.5 inline size-3" />
                                {c.suggestion.label}
                              </button>
                              <button type="button" className="rounded-full bg-surface-2 px-1.5 py-0.5 text-muted" onClick={() => fixAll(f.key, c.raw, c.suggestion!.value)}>
                                everywhere
                              </button>
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12.5px] text-muted">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          {page + 1} of {pages}
          <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function display(v: unknown, f: Field) {
  if (v === null || v === undefined) return "";
  if (f.type === "money" && typeof v === "number") return String(v / 100);
  if (f.type === "bool") return v ? "yes" : "no";
  if (f.type === "duration" && typeof v === "number") return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  if (f.type === "enum") return f.options?.find((o) => o.value === v)?.label ?? String(v);
  return String(v);
}

