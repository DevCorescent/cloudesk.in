"use client";

// Earlier conversations with the AI: newest first, grouped by when, searchable
// (titles and everything said in them), and each one opens back where it was
// left. Deleting one removes it for good.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, MessageSquare, Search, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";

type Row = { id: string; title: string; updatedAt: string; match?: string };

const ist = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00+05:30` : d);
function groupOf(d: string) {
  const day = (x: Date) => new Date(x.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })).getTime();
  const diff = Math.round((day(new Date()) - day(ist(d))) / 86_400_000);
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? "This week" : diff < 31 ? "This month" : "Earlier";
}
const when = (d: string) => ist(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export function HistorySheet({ orgId, current, onOpen, onClose }: { orgId: string; current: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [error, setError] = useState("");
  // Searching inside conversations waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({ queryKey: ["copilot", orgId, "threads", term], queryFn: () => api<{ threads: Row[] }>(`/api/v1/orgs/${orgId}/copilot/threads${term ? `?q=${encodeURIComponent(term)}` : ""}`) });
  const rows = list.data?.threads ?? [];
  const groups = rows.reduce<{ name: string; rows: Row[] }[]>((acc, r) => {
    const g = term ? "Matches" : groupOf(r.updatedAt);
    const last = acc.at(-1);
    if (last?.name === g) last.rows.push(r);
    else acc.push({ name: g, rows: [r] });
    return acc;
  }, []);
  const remove = async (id: string) => {
    setError("");
    try {
      await api(`/api/v1/orgs/${orgId}/copilot/threads/${id}`, { method: "DELETE" });
      void qc.invalidateQueries({ queryKey: ["copilot", orgId, "threads"] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="ai-sheet" role="dialog" aria-modal="true" aria-label="Your conversations" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ai-sheet-in">
        <div className="ai-sheet-h">
          <b className="ai-hist-title"><History className="size-[18px]" aria-hidden /> Your conversations</b>
          <button type="button" className="ai-round" onClick={onClose} aria-label="Close">
            <X className="size-[18px]" />
          </button>
        </div>
        <p className="ai-sheet-sub">Pick up where you left off. I also remember these — say “like last time” and I’ll look back.</p>
        <label className="ai-hist-search">
          <Search className="size-4" aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and what was said" aria-label="Search conversations" />
        </label>
        {error && <p className="ai-sheet-sub" role="alert">{error}</p>}
        <div className="ai-kb-list ai-hist-list">
          {list.isLoading && <p className="ai-kb-empty">Loading…</p>}
          {!list.isLoading && !rows.length && <p className="ai-kb-empty">{term ? `Nothing mentions “${term}”.` : "No conversations yet. Ask anything to start one."}</p>}
          {groups.map((g) => (
            <section key={g.name} className="ai-hist-group">
              <h3>{g.name}</h3>
              {g.rows.map((r) => (
                <div key={r.id} className={r.id === current ? "ai-hist-row is-on" : "ai-hist-row"}>
                  <button type="button" className="ai-hist-open" onClick={() => onOpen(r.id)}>
                    <MessageSquare className="size-4 shrink-0" aria-hidden />
                    <span>
                      <b>{r.title || "Conversation"}</b>
                      {r.match ? <small>{r.match}</small> : <small>{when(r.updatedAt)}</small>}
                    </span>
                  </button>
                  <button type="button" className="ai-hist-del" aria-label={`Delete “${r.title}”`} title="Delete this conversation" onClick={() => void remove(r.id)}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
