"use client";

// An approval request as people see it: what it is, the amount, the path of
// steps (done / now / later), who it's waiting on, its history, and — for the
// person whose turn it is — approve or send back with a note.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Clock, CornerUpLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Field, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { formatPrice } from "@/lib/store/money";

export type ApprovalView = {
  id: string;
  kind: string;
  kindLabel: string;
  refId: string;
  label: string;
  amount: number;
  link: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  policy: { name: string; version: number };
  requester: { id: string | null; name: string };
  createdAt: string;
  decidedAt: string | null;
  step: number;
  steps: { name: string; mode: string; slaHours: number | null; who: string; state: "done" | "current" | "rejected" | "later" }[];
  waitingOn: { who: string; people: string[]; done: boolean }[];
  overdue: boolean;
  canAct: boolean;
  history: { action: string; step: number; stepName: string; by: string; onBehalfOf: string | null; note: string; at: string }[];
};

const STATUS: Record<string, [string, string]> = {
  pending: ["bg-warning-soft text-warning", "Waiting for approval"],
  approved: ["bg-success-soft text-success", "Approved"],
  rejected: ["bg-danger-soft text-danger", "Sent back"],
  cancelled: ["bg-surface-2 text-muted", "Cancelled"],
};
const ACTION: Record<string, string> = { submitted: "Sent for approval", resubmitted: "Sent again", approved: "Approved", rejected: "Sent back", escalated: "Escalated", cancelled: "Cancelled", comment: "Note" };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Who it's waiting on, each person once ("all" steps list everyone still needed). */
function waitingText(a: ApprovalView) {
  const names = [...new Set(a.waitingOn.filter((w) => !w.done).flatMap((w) => (w.people.length ? w.people : [w.who])))];
  const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? ` and ${names.length - 4} more` : "");
  return a.steps[a.step]?.mode === "all" ? shown : names.length > 1 ? `any of ${shown}` : shown;
}

export function ApprovalStatus({ status }: { status: string }) {
  const [c, l] = STATUS[status] ?? ["bg-surface-2 text-muted", status];
  return <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", c)}>{l}</span>;
}

export function useDecide(onDone?: () => void) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: { id: string; approve: boolean; note: string }) => api<{ status: string }>(`/api/v1/orgs/${org.id}/approvals/requests/${b.id}/decide`, { method: "POST", body: { approve: b.approve, note: b.note } }),
    onSuccess: (r, b) => {
      // Everything that might show the document's state.
      qc.invalidateQueries();
      toast({ tone: "success", title: !b.approve ? "Sent back" : r.status === "approved" ? "Approved" : "Approved — on to the next step" });
      onDone?.();
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
}

export function ApprovalCard({ a, compact }: { a: ApprovalView; compact?: boolean }) {
  const decide = useDecide();
  const [history, setHistory] = useState(!compact);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  return (
    <article className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold tracking-wide text-subtle uppercase">{a.kindLabel}</p>
          <p className="mt-0.5 text-[15px] font-semibold">
            {a.link ? (
              <Link href={a.link} className="inline-flex items-center gap-1 hover:underline">
                {a.label} <ExternalLink className="size-3.5 text-muted" />
              </Link>
            ) : (
              a.label
            )}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {a.requester.name} · {when(a.createdAt)} · {a.policy.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <b className="text-[16px] tabular-nums">{formatPrice(a.amount, "INR")}</b>
          <ApprovalStatus status={a.status} />
        </div>
      </div>
      <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]" aria-label="Steps">
        {a.steps.map((s, i) => (
          <li key={i} className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1", s.state === "done" && "bg-success-soft text-success", s.state === "current" && "bg-warning-soft font-semibold text-warning", s.state === "rejected" && "bg-danger-soft text-danger", s.state === "later" && "bg-surface-2 text-muted")}>
            {s.state === "done" ? <Check className="size-3" /> : s.state === "current" ? <Clock className="size-3" /> : null}
            {s.name}
            <span className="font-normal opacity-80">· {s.who}</span>
          </li>
        ))}
      </ol>
      {a.status === "pending" && a.waitingOn.length > 0 && (
        <p className={cx("mt-2 text-[12.5px]", a.overdue ? "font-semibold text-danger" : "text-muted")}>
          {a.overdue ? "Overdue — " : ""}Waiting on {waitingText(a)}
        </p>
      )}
      <button type="button" onClick={() => setHistory((h) => !h)} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg" aria-expanded={history}>
        History <ChevronDown className={cx("size-3.5 transition-transform", history && "rotate-180")} />
      </button>
      {history && (
        <ul className="mt-2 grid gap-1.5 border-l-2 border-border pl-3 text-[12.5px]">
          {a.history.map((h, i) => (
            <li key={i}>
              <b className="font-semibold">{ACTION[h.action] ?? h.action}</b>
              <span className="text-muted">
                {" "}
                by {h.by}
                {h.onBehalfOf ? ` for ${h.onBehalfOf}` : ""}
                {h.stepName && !["submitted", "resubmitted"].includes(h.action) ? ` · ${h.stepName}` : ""} · {when(h.at)}
              </span>
              {h.note && <span className="block text-fg">“{h.note}”</span>}
            </li>
          ))}
        </ul>
      )}
      {a.canAct && (
        <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" icon={<CornerUpLeft className="size-3.5" />} onClick={() => setSending(true)}>
            Send back
          </Button>
          <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: true, note: "" })}>
            Approve
          </Button>
        </div>
      )}
      {sending && (
        <Dialog
          open
          onClose={() => setSending(false)}
          title={`Send back: ${a.label}`}
          description="They'll see your note and can change it and send it again."
          footer={
            <>
              <Button onClick={() => setSending(false)}>Cancel</Button>
              <Button variant="primary" disabled={!note.trim()} loading={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: false, note }, { onSuccess: () => setSending(false) })}>
                Send back
              </Button>
            </>
          }
        >
          <Field label="What needs changing?">{(p) => <Textarea {...p} rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </Dialog>
      )}
    </article>
  );
}

/** The approval state of one document, for its own page. Shows nothing when it never needed approval. */
export function ApprovalPanel({ kind, refId }: { kind: string; refId: string }) {
  const { org } = useSession();
  const q = useQuery({ queryKey: ["approvals", org.id, "doc", kind, refId], queryFn: () => api<{ requests: ApprovalView[] }>(`/api/v1/orgs/${org.id}/approvals/doc?kind=${kind}&refId=${refId}`) });
  const latest = q.data?.requests[0];
  if (!latest) return null;
  return (
    <section aria-label="Approval" className="grid gap-2">
      <ApprovalCard a={latest} compact={latest.status !== "pending"} />
      {q.data!.requests.length > 1 && <p className="text-[12px] text-muted">Sent for approval {q.data!.requests.length} times; the latest is shown.</p>}
    </section>
  );
}

/** Requests of one kind still waiting that this person sent or can act on (e.g. journals not yet in the books). */
export function PendingOfKind({ kind, title }: { kind: string; title: string }) {
  const { org } = useSession();
  const mine = useQuery({ queryKey: ["approvals", org.id, "mine"], queryFn: () => api<{ requests: ApprovalView[] }>(`/api/v1/orgs/${org.id}/approvals/mine`) });
  const queue = useQuery({ queryKey: ["approvals", org.id, "queue"], queryFn: () => api<{ requests: ApprovalView[] }>(`/api/v1/orgs/${org.id}/approvals/queue`) });
  const all = new Map([...(queue.data?.requests ?? []), ...(mine.data?.requests ?? [])].filter((r) => r.kind === kind && r.status === "pending").map((r) => [r.id, r]));
  if (!all.size) return null;
  return (
    <section aria-label={title} className="mb-5 grid gap-2">
      <h2 className="text-[14px] font-semibold">{title} · {all.size}</h2>
      {[...all.values()].map((a) => (
        <ApprovalCard key={a.id} a={a} compact />
      ))}
    </section>
  );
}
