"use client";

// The page a customer opens from their ticket link: the conversation (the
// team's internal notes are never sent here), a reply box while it's open,
// and a 1–5 rating once it's resolved.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Notice, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

type View = { org: string; number: string; subject: string; status: string; statusLabel: string; createdAt: string; messages: { kind: "customer" | "reply"; body: string; fromName: string; createdAt: string }[]; canReply: boolean; canRate: boolean; csat: number | null; csatComment: string };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function SupportPage({ token }: { token: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["support", token], queryFn: () => api<View>(`/api/v1/support/${token}`), retry: false });
  const [body, setBody] = useState("");
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const post = async (path: "reply" | "rate", payload: unknown, done: () => void) => {
    setBusy(true);
    setError("");
    try {
      qc.setQueryData(["support", token], await api<View>(`/api/v1/support/${token}/${path}`, { method: "POST", body: payload }));
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (q.isError) return <Shell><Notice tone="danger" title="This link doesn't work">Check you copied the whole link from the email, or write to us again.</Notice></Shell>;
  if (!q.data) return <Shell><Skeleton className="h-80 rounded-[20px]" /></Shell>;
  const v = q.data;
  return (
    <Shell>
      <p className="text-[12px] font-semibold tracking-[0.14em] text-subtle uppercase">{v.org} · Support</p>
      <h1 className="mt-1 text-2xl font-semibold">{v.subject}</h1>
      <p className="mt-1 flex items-center gap-2 text-[13px] text-muted">{v.number} · opened {when(v.createdAt)} <Badge tone={v.status === "resolved" || v.status === "closed" ? "success" : "accent"}>{v.statusLabel}</Badge></p>
      <ol className="mt-6 space-y-3">
        {v.messages.map((m, i) => (
          <li key={i} className={cx("rounded-[16px] border px-4 py-3", m.kind === "reply" ? "border-transparent bg-accent-soft" : "border-border bg-surface")}>
            <p className="mb-1 text-[12px] text-muted"><b className="font-medium text-fg">{m.fromName}</b> · {when(m.createdAt)}</p>
            <p className="text-[14px] whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      {error && <div className="mt-4"><Notice tone="danger">{error}</Notice></div>}
      {v.canRate && (
        <section className="mt-6 space-y-3 rounded-[20px] border border-border bg-surface p-4">
          <h2 className="text-[15px] font-semibold">{v.csat ? "Thanks for your rating" : "How did we do?"}</h2>
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={(score || v.csat) === n} aria-label={`${n} out of 5`} onClick={() => setScore(n)} className="p-1">
                <Star className={cx("size-7", n <= (score || v.csat || 0) ? "fill-current text-warning" : "text-subtle")} />
              </button>
            ))}
          </div>
          <Textarea aria-label="Anything to add?" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={v.csatComment || "Anything to add? (optional)"} />
          <Button variant="primary" loading={busy} disabled={!score} onClick={() => post("rate", { score, comment }, () => (setScore(0), setComment("")))}>{v.csat ? "Update rating" : "Send rating"}</Button>
        </section>
      )}
      {v.canReply ? (
        <section className="mt-6 space-y-3">
          <Textarea aria-label="Your reply" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={v.status === "resolved" ? "Still not right? Reply and we'll reopen it." : "Add more details or reply to us"} />
          <Button variant="primary" loading={busy} disabled={!body.trim()} onClick={() => post("reply", { body }, () => setBody(""))}>Send</Button>
        </section>
      ) : (
        <p className="mt-6 text-[13px] text-muted">This request is closed. If you need more help, write to us again.</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-2xl bg-bg px-4 py-10 sm:px-6">{children}</main>;
}
