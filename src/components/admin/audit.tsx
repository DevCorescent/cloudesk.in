"use client";

// The audit log across the whole platform: who did what, in which workspace.
import { useState } from "react";
import { Card, ErrorState, Input, Select, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { useAdmin } from "./common";

type Entry = { id: string; action: string; targetType: string | null; targetId: string | null; metadata: unknown; ip: string | null; createdAt: string; org: string | null; actor: string | null };

export function AuditPanel() {
  const [f, setF] = useState({ action: "", org: "", actor: "", days: "30" });
  const q = useAdmin<{ entries: Entry[] }>(`audit?${new URLSearchParams(f)}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Action starts with" className="!w-52" placeholder="Action (e.g. platform.)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
        <Input aria-label="Workspace" className="!w-44" placeholder="Workspace" value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} />
        <Input aria-label="By" className="!w-52" placeholder="By (email)" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        <Select aria-label="Period" className="!w-36" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}><option value="1">Last day</option><option value="7">Last week</option><option value="30">Last 30 days</option><option value="365">Last year</option></Select>
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : !q.data ? <Skeleton className="h-60" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">When</th><th className="px-4 py-2.5 font-medium">Action</th><th className="px-4 py-2.5 font-medium">By</th><th className="px-4 py-2.5 font-medium">Workspace</th><th className="px-4 py-2.5 font-medium">Address</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.entries.map((e) => (
                <tr key={e.id} className="cursor-pointer align-top hover:bg-surface-2" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{dateTime(e.createdAt)}</td>
                  <td className="px-4 py-2"><code className="text-[12.5px]">{e.action}</code>{open === e.id && e.metadata != null && <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap rounded-[8px] bg-surface-2 p-2 text-[11.5px]">{JSON.stringify(e.metadata, null, 2)}</pre>}</td>
                  <td className="px-4 py-2">{e.actor ?? "—"}</td>
                  <td className="px-4 py-2">{e.org ?? <span className="text-muted">platform</span>}</td>
                  <td className="px-4 py-2 text-muted">{e.ip ?? ""}</td>
                </tr>
              ))}
              {!q.data.entries.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Nothing matches.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-[12px] text-muted">Showing up to 300 entries, newest first. Click a row for its details.</p>
    </div>
  );
}
