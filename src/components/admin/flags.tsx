"use client";

// Release flags: switch a feature on for everyone, or only for some workspaces.
import { useState } from "react";
import { Button, Card, ErrorState, Field, Input, Skeleton, Switch } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { useAdmin, useCan, useRun } from "./common";

type Flag = { key: string; description: string; enabled: boolean; orgIds: string[]; updatedAt: string };

export function FlagsPanel() {
  const q = useAdmin<{ flags: Flag[] }>("flags");
  const run = useRun();
  const can = useCan();
  const write = can("flags:write");
  const [f, setF] = useState({ key: "", description: "", orgIds: "" });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (!q.data) return <Skeleton className="h-40" />;
  const save = (x: { key: string; description: string; enabled: boolean; orgIds: string[] }, done: string) => run("flags", "PUT", x, done);
  return (
    <div className="space-y-3">
      <Card className="divide-y divide-border">
        {!q.data.flags.length && <p className="p-6 text-center text-[13px] text-muted">No flags yet.</p>}
        {q.data.flags.map((x) => (
          <div key={x.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
            <span><code className="text-[12.5px]">{x.key}</code> <span className="text-muted">— {x.description || "no description"} · {x.enabled ? "on for everyone" : `${x.orgIds.length} workspace(s)`}</span></span>
            {write && <span className="flex items-center gap-2"><Switch checked={x.enabled} onChange={(v) => void save({ ...x, enabled: v }, v ? "On for everyone" : "Off for everyone")} label={`${x.key} for everyone`} /><Button size="sm" variant="ghost" onClick={() => void run(`flags?key=${encodeURIComponent(x.key)}`, "DELETE", undefined, "Flag deleted")}>Delete</Button></span>}
          </div>
        ))}
      </Card>
      {write && (
        <Card className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Key">{(a) => <Input {...a} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="new-ledger" />}</Field>
          <Field label="Description">{(a) => <Input {...a} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          <Field label="On for these workspace IDs (comma separated)" className="sm:col-span-2">{(a) => <Input {...a} value={f.orgIds} onChange={(e) => setF({ ...f, orgIds: e.target.value })} />}</Field>
          <Button onClick={async () => { if (await save({ key: f.key, description: f.description, enabled: false, orgIds: f.orgIds.split(/[\s,]+/).filter(Boolean) }, "Flag saved")) setF({ key: "", description: "", orgIds: "" }); }}>Save flag</Button>
        </Card>
      )}
    </div>
  );
}
