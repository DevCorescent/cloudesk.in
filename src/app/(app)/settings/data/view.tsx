"use client";

// Data & migration: every import with what failed and totals to reconcile,
// duplicates across suppliers, items and customers (and merging suppliers),
// saved column mappings, and who may download lists.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { downloadRows } from "@/components/import/export";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Notice, Select, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { TARGETS } from "@/lib/import/targets";

type Meta = { me: { manage: boolean; auditor: boolean }; settings: { exports: "everyone" | "team" | "managers" } };
type Run = { id: string; target: string; fileName: string; mode: string; rows: number; created: number; updated: number; skipped: number; failed: number; status: string; by: string | null; startedAt: string; finishedAt: string | null; hasErrors: boolean };
type RunDetail = Run & { errors: { row: number; message: string; data: Record<string, unknown> }[]; totals: Record<string, { label: string; file: number; saved: number; money: boolean }> };
type Group = { kind: "suppliers" | "items" | "customers"; reason: string; records: { id: string; label: string; detail: string; link: string }[] };

const label = (t: string) => (TARGETS as Record<string, { label: string }>)[t]?.label ?? t;
const num = (v: number, money: boolean) => (money ? `₹${(v / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : v.toLocaleString("en-IN"));

export function DataView() {
  const { org } = useSession();
  const base = `/api/v1/orgs/${org.id}/masterdata`;
  const meta = useQuery({ queryKey: ["masterdata", org.id, "meta"], queryFn: () => api<Meta>(`${base}/meta`) });
  const [tab, setTab] = useState<"imports" | "duplicates" | "mappings" | "exports">("imports");
  if (meta.isError) return <ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} />;
  if (!meta.data) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "imports", label: "Imports" }, { value: "duplicates", label: "Duplicates" }, { value: "mappings", label: "Saved columns" }, { value: "exports", label: "Downloads" }]} />
      {tab === "imports" && <Imports base={base} auditor={meta.data.me.auditor} />}
      {tab === "duplicates" && <Duplicates base={base} manage={meta.data.me.manage} />}
      {tab === "mappings" && <Mappings base={base} />}
      {tab === "exports" && <Exports base={base} meta={meta.data} />}
    </div>
  );
}

function Imports({ base, auditor }: { base: string; auditor: boolean }) {
  const { org } = useSession();
  const q = useQuery({ queryKey: ["masterdata", org.id, "imports"], queryFn: () => api<{ imports: Run[] }>(`${base}/imports`) });
  const [open, setOpen] = useState<string | null>(null);
  if (!q.data) return <Skeleton className="h-40" />;
  return (
    <>
      <p className="text-[13px] text-muted">{auditor ? "Every import in this workspace." : "Your imports."} Open one to see rows that didn&apos;t go in and whether the totals match the file.</p>
      {!q.data.imports.length ? <Card className="p-6 text-center text-[13px] text-muted">No imports yet.</Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">When</th><th className="px-4 py-2.5 font-medium">What</th><th className="px-4 py-2.5 font-medium">Who</th><th className="px-4 py-2.5 text-right font-medium">Added</th><th className="px-4 py-2.5 text-right font-medium">Updated</th><th className="px-4 py-2.5 text-right font-medium">Skipped</th><th className="px-4 py-2.5 text-right font-medium">Not imported</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.imports.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setOpen(r.id)}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted">{dateTime(r.startedAt)}</td>
                  <td className="px-4 py-2.5"><b className="font-medium">{label(r.target)}</b><span className="block text-[12px] text-muted">{r.fileName} · {r.rows} rows{r.status === "running" ? " · didn't finish" : ""}</span></td>
                  <td className="px-4 py-2.5">{r.by ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.created}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.updated}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.skipped}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.failed ? <Badge tone="warning">{r.failed}</Badge> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {open && <RunDialog base={base} id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function RunDialog({ base, id, onClose }: { base: string; id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["masterdata", base, "import", id], queryFn: () => api<{ import: RunDetail }>(`${base}/imports/${id}`) });
  const r = q.data?.import;
  const totals = r ? Object.values(r.totals) : [];
  return (
    <Dialog open onClose={onClose} size="lg" title={r ? `${label(r.target)} · ${r.fileName}` : "Import"} footer={<>{r && r.errors.length > 0 && <Button className="mr-auto" onClick={() => downloadRows(`${r.target.replace(".", "-")}-not-imported`, [{ key: "row", label: "Row" }, { key: "message", label: "Problem" }, ...Object.keys(r.errors[0].data).map((k) => ({ key: k, label: k }))], r.errors.map((e) => ({ row: e.row, message: e.message, ...e.data })), "xlsx")}>Download rows not imported</Button>}<Button variant="primary" onClick={onClose}>Close</Button></>}>
      {!r ? <Skeleton className="h-40" /> : (
        <div className="space-y-4 text-[13.5px]">
          <p>{r.rows} rows: {r.created} added, {r.updated} updated, {r.skipped} skipped, {r.failed} not imported. {r.status === "running" && "The import didn't finish — some batches may not have been sent."}</p>
          {totals.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Totals</p>
              <table className="w-full text-[13px]">
                <thead className="text-left text-muted"><tr><th className="py-1 font-medium">Column</th><th className="py-1 text-right font-medium">In the file</th><th className="py-1 text-right font-medium">Saved</th><th className="py-1 text-right font-medium">Difference</th></tr></thead>
                <tbody>{totals.map((t) => <tr key={t.label}><td className="py-1">{t.label}</td><td className="py-1 text-right tabular-nums">{num(t.file, t.money)}</td><td className="py-1 text-right tabular-nums">{num(t.saved, t.money)}</td><td className={`py-1 text-right tabular-nums ${t.file - t.saved ? "font-medium text-danger" : ""}`}>{num(t.file - t.saved, t.money)}</td></tr>)}</tbody>
              </table>
              <p className="mt-1 text-[12px] text-muted">Skipped rows (already there) count as saved; the difference is rows that weren&apos;t imported.</p>
            </div>
          )}
          {r.errors.length > 0 && <ul className="max-h-60 space-y-1 overflow-y-auto">{r.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>}
        </div>
      )}
    </Dialog>
  );
}

function Duplicates({ base, manage }: { base: string; manage: boolean }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["masterdata", org.id, "duplicates"], queryFn: () => api<{ groups: Group[] }>(`${base}/duplicates`) });
  const [merge, setMerge] = useState<{ group: Group; keep: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!q.data) return <Skeleton className="h-40" />;
  const doMerge = async () => {
    if (!merge) return;
    setBusy(true);
    try {
      for (const r of merge.group.records.filter((x) => x.id !== merge.keep)) await api(`${base}/merge/suppliers`, { method: "POST", body: { keepId: merge.keep, dropId: r.id, confirm: true } });
      toast({ tone: "success", title: "Suppliers merged" });
      setMerge(null);
      setConfirm(false);
      await qc.invalidateQueries({ queryKey: ["masterdata", org.id] });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="text-[13px] text-muted">Records that look like the same thing. Suppliers can be merged: everything that pointed at one moves to the other. For items and customers, mark the extra one inactive (or archived) where it lives.</p>
      {!q.data.groups.length ? <Card className="p-6 text-center text-[13px] text-muted">No duplicates found.</Card> : (
        <div className="space-y-3">
          {q.data.groups.map((g, i) => (
            <Card key={i} className="space-y-2 p-4 text-[13.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><Badge>{g.kind}</Badge><b className="font-medium">{g.reason}</b></span>{g.kind === "suppliers" && manage && <Button size="sm" onClick={() => setMerge({ group: g, keep: g.records[0].id })}>Merge…</Button>}</div>
              <ul className="space-y-0.5">{g.records.map((r) => <li key={r.id}><a className="underline" href={r.link}>{r.label}</a> <span className="text-muted">{r.detail}</span></li>)}</ul>
            </Card>
          ))}
        </div>
      )}
      {merge && (
        <Dialog open onClose={() => setMerge(null)} title="Merge suppliers" description="Purchase orders, receipts, bills, quotes, rates and everything else move to the one you keep; its blank details are filled from the others, which are then removed." footer={<><Button onClick={() => setMerge(null)}>Cancel</Button><Button variant="danger" onClick={() => setConfirm(true)}>Merge</Button></>}>
          <Select aria-label="Keep" value={merge.keep} onChange={(e) => setMerge({ ...merge, keep: e.target.value })}>{merge.group.records.map((r) => <option key={r.id} value={r.id}>Keep {r.label} {r.detail && `(${r.detail})`}</option>)}</Select>
          <div className="mt-3"><Notice tone="warning">This can&apos;t be undone.</Notice></div>
        </Dialog>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={doMerge} loading={busy} destructive title="Merge these suppliers for good?" description="The other suppliers are removed once their records move. This can't be undone." confirmLabel="Merge" />
    </>
  );
}

function Mappings({ base }: { base: string }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["masterdata", org.id, "mappings"], queryFn: () => api<{ mappings: { id: string; target: string; name: string; headers: string[]; updatedAt: string }[] }>(`${base}/mappings`) });
  if (!q.data) return <Skeleton className="h-40" />;
  return (
    <>
      <p className="text-[13px] text-muted">Columns saved while importing. When a file with the same headings comes back, they&apos;re used again.</p>
      {!q.data.mappings.length ? <Card className="p-6 text-center text-[13px] text-muted">None saved yet — use “Save these columns” when importing.</Card> : (
        <Card className="divide-y divide-border">
          {q.data.mappings.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
              <span><b className="font-medium">{m.name}</b> <span className="text-muted">· {label(m.target)} · {m.headers.length} columns · {dateTime(m.updatedAt)}</span></span>
              <Button size="sm" variant="ghost" onClick={async () => { await api(`${base}/mappings/${m.id}`, { method: "DELETE" }); await qc.invalidateQueries({ queryKey: ["masterdata", org.id, "mappings"] }); }}>Delete</Button>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function Exports({ base, meta }: { base: string; meta: Meta }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [rule, setRule] = useState(meta.settings.exports);
  const save = async () => {
    try {
      await api(`${base}/settings`, { method: "PUT", body: { exports: rule } });
      toast({ tone: "success", title: "Saved" });
      await qc.invalidateQueries({ queryKey: ["masterdata", org.id, "meta"] });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  return (
    <Card className="space-y-3 p-5">
      <p className="text-[14px] font-medium">Who can download lists (Excel and CSV)</p>
      <Select aria-label="Who can download lists" value={rule} disabled={!meta.me.manage} onChange={(e) => setRule(e.target.value as Meta["settings"]["exports"])}>
        <option value="everyone">Everyone who can see the list</option>
        <option value="team">The team (not viewers or employees)</option>
        <option value="managers">Only owners and admins</option>
      </Select>
      <p className="text-[12.5px] text-muted">Every download is written to the audit log with who, what and how many rows. This stops the download buttons; it can&apos;t stop someone copying what&apos;s on their screen.</p>
      {meta.me.manage && <Button variant="primary" onClick={save}>Save</Button>}
    </Card>
  );
}
