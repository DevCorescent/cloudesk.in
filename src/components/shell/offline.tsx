"use client";

// Offline: a strip saying the connection is down, the writes waiting in the
// outbox (sent automatically when it's back), and the service worker that
// lets the app open without a connection.
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { discard, flush, pending, retry, subscribe, type Queued } from "@/lib/client/outbox";

const onlineSub = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};

let snapshot: Queued[] = [];
let snapshotKey = "";
const outboxSnapshot = () => {
  const now = pending();
  const k = JSON.stringify(now);
  if (k !== snapshotKey) {
    snapshotKey = k;
    snapshot = now;
  }
  return snapshot;
};
const empty: Queued[] = [];

export function OfflineBar() {
  const online = useSyncExternalStore(onlineSub, () => navigator.onLine, () => true);
  const items = useSyncExternalStore(subscribe, outboxSnapshot, () => empty);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (quiet = false) => {
    setBusy(true);
    const r = await flush();
    setBusy(false);
    if (r.sent) {
      qc.invalidateQueries();
      toast({ tone: "success", title: `Sent ${r.sent} change${r.sent === 1 ? "" : "s"} made offline` });
    } else if (!quiet && r.failed) toast({ tone: "error", title: "Some changes were refused — open them to see why" });
  };

  // Send what's waiting when the app opens and whenever the connection comes back.
  useEffect(() => {
    const go = () => void send(true);
    if (navigator.onLine && pending().length) go();
    window.addEventListener("online", go);
    return () => window.removeEventListener("online", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  if (online && !items.length) return null;
  const refused = items.filter((i) => i.error).length;
  return (
    <>
      <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-warning-soft px-4 py-1.5 text-[12.5px]">
        {!online && <span className="flex items-center gap-1.5 font-medium"><CloudOff className="size-3.5" />You&apos;re offline — what&apos;s on screen stays; entries on screens that work offline are kept and sent later.</span>}
        {items.length > 0 && (
          <button type="button" className="underline underline-offset-2" onClick={() => setOpen(true)}>
            {items.length} change{items.length === 1 ? "" : "s"} waiting{refused ? ` (${refused} refused)` : ""}
          </button>
        )}
        {online && items.length > 0 && <Button size="sm" variant="ghost" loading={busy} icon={<RefreshCw className="size-3.5" />} onClick={() => send()}>Send now</Button>}
      </div>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title="Changes made offline" description="They're kept in this browser until they're sent. Refused ones stay until you discard them." footer={<Button variant="primary" onClick={() => setOpen(false)}>Close</Button>}>
          {!items.length ? <p className="text-[13px] text-muted">All sent.</p> : (
            <ul className="divide-y divide-border text-[13px]">
              {items.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b className="font-medium">{i.label}</b> <span className="text-muted">· {new Date(i.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                    {i.error && <span className="block text-danger">{i.error}</span>}
                  </span>
                  <span className="flex gap-1">
                    {i.error && <Button size="sm" variant="ghost" onClick={() => retry(i.key)}>Try again</Button>}
                    <Button size="sm" variant="ghost" onClick={() => discard(i.key)}>Discard</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </>
  );
}
