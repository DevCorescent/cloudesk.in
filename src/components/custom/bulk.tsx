"use client";

// Bulk changes: set one field on the records picked (each checked like a
// single save, with rule failures listed), delete picked records of an
// object after typing how many, and the history of changes with undo.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, Field, Input, Notice, Select, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import type { Value } from "@/lib/custom/model";
import { CustomInput, type Def } from "./inputs";

type Result = { id: string; changed: number; skipped: { id: string; reason: string }[] };

export function BulkSetDialog({ entity, fields, ids, names, onClose }: { entity: string; fields: Def[]; ids: string[]; names: Record<string, string>; onClose: () => void }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const [key, setKey] = useState(fields[0]?.key ?? "");
  const [value, setValue] = useState<Value>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Result | null>(null);
  const f = fields.find((x) => x.key === key);
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<Result>(`/api/v1/orgs/${org.id}/custom/bulk`, { method: "POST", body: { action: "set", entity, ids, field: key, value } });
      setDone(r);
      qc.invalidateQueries({ queryKey: ["custom", org.id] });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Change ${ids.length} record${ids.length === 1 ? "" : "s"}`} description="Each record is checked like a single save; any your rules refuse are left as they are. You can undo this from the history." footer={done ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f} onClick={run}>Change {ids.length}</Button></>}>
      {done ? (
        <div className="space-y-2 text-[13.5px]">
          <Notice tone={done.skipped.length ? "warning" : "success"}>Changed {done.changed}{done.skipped.length ? `; ${done.skipped.length} left as they were` : ""}.</Notice>
          {done.skipped.length > 0 && <ul className="max-h-48 space-y-1 overflow-auto text-[12.5px]">{done.skipped.map((s) => <li key={s.id}><b className="font-medium">{names[s.id] ?? s.id}</b> — {s.reason}</li>)}</ul>}
        </div>
      ) : (
        <div className="grid gap-3">
          <Field label="Field">{(a) => <Select {...a} value={key} onChange={(e) => (setKey(e.target.value), setValue(null))}>{fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select>}</Field>
          {f && <Field label="Set it to" hint={f.required ? "This field is needed, so it can't be emptied" : "Leave empty to clear it"}>{(a) => <CustomInput key={f.key} def={f} a={a} value={value} titles={titles} onChange={(v, t) => (setValue(v), t && typeof v === "string" && setTitles({ ...titles, [v]: t }))} />}</Field>}
          {err && <Notice tone="danger">{err}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

export function BulkDeleteDialog({ objectId, ids, plural, onClose, onDone }: { objectId: string; ids: string[]; plural: string; onClose: () => void; onDone: () => void }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [n, setN] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<Result>(`/api/v1/orgs/${org.id}/custom/bulk`, { method: "POST", body: { action: "delete", entity: `obj:${objectId}`, ids, confirm: Number(n) } });
      toast({ tone: "success", title: `Deleted ${r.changed} — undo it from the history if you need to` });
      qc.invalidateQueries({ queryKey: ["custom", org.id] });
      qc.invalidateQueries({ queryKey: ["objects", org.id] });
      onDone();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title={`Delete ${ids.length} ${plural.toLowerCase()}?`} description={`Type ${ids.length} to confirm. They can be brought back from the history unless their numbers are reused.`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={Number(n) !== ids.length} onClick={run}>Delete</Button></>}>
      <Field label="How many">{(a) => <Input {...a} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} />}</Field>
    </Dialog>
  );
}

type Run = { id: string; entity: string; what: string; action: string; field: string | null; value: unknown; changed: number; skipped: { id: string; reason: string }[]; status: string; by: string | null; createdAt: string; undoneAt: string | null };

export function BulkHistory() {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["custom", org.id, "bulk"], queryFn: () => api<{ runs: Run[] }>(`/api/v1/orgs/${org.id}/custom/bulk`) });
  const [undo, setUndo] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  if (!q.data) return <Skeleton className="h-40" />;
  const go = async () => {
    if (!undo) return;
    setBusy(true);
    try {
      const r = await api<{ restored: number; left: { id: string; reason: string }[] }>(`/api/v1/orgs/${org.id}/custom/bulk/${undo.id}/undo`, { method: "POST" });
      toast({ tone: r.left.length ? "info" : "success", title: `Put back ${r.restored}${r.left.length ? `; ${r.left.length} left alone (${r.left[0]!.reason.toLowerCase()})` : ""}` });
      qc.invalidateQueries({ queryKey: ["custom", org.id] });
      qc.invalidateQueries({ queryKey: ["objects", org.id] });
      setUndo(null);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!q.data.runs.length ? <Card className="p-6 text-center text-[13px] text-muted">No bulk changes yet.</Card> : (
        <Card className="divide-y divide-border">
          {q.data.runs.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px]">
              <div>
                <b className="font-medium">{r.action === "delete" ? `Deleted ${r.changed} ${r.what.toLowerCase()}` : `${r.what}: set ${r.field} to ${r.value === null ? "empty" : Array.isArray(r.value) ? r.value.join(", ") : String(r.value)} on ${r.changed}`}</b>
                <span className="block text-[12px] text-muted">{dateTime(r.createdAt)} · {r.by ?? "—"}{r.skipped.length ? ` · ${r.skipped.length} left alone` : ""}</span>
              </div>
              {r.status === "undone" ? <Badge>Undone</Badge> : r.changed > 0 && <Button size="sm" onClick={() => setUndo(r)}>Undo</Button>}
            </div>
          ))}
        </Card>
      )}
      <ConfirmDialog open={!!undo} onClose={() => setUndo(null)} onConfirm={go} loading={busy} title="Undo this change?" description="Records changed again since are left as they are." confirmLabel="Undo" />
    </>
  );
}
