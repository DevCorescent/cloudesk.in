"use client";

// "Ask your notes": a question answered from every note you can read, with
// the notes it came from.
import { useMutation } from "@tanstack/react-query";
import { FileText, Sparkles } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Button, Input, Notice } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { useNotesApi } from "./api";

type Answer = { answer: string; found: boolean; sources: { id: string; title: string }[] };

export function AskNotes({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const n = useNotesApi();
  const [q, setQ] = useState("");
  const ask = useMutation({ mutationFn: () => n.call<Answer>("/ai", { method: "POST", body: { action: "ask_all", question: q } }) });
  return (
    <Dialog open onClose={onClose} size="lg" title="Ask your notes" description="AI answers from the notes you can read, and shows which ones it used.">
      <div className="grid gap-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) ask.mutate(); }}>
          <Input aria-label="Your question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What did we agree with Kiran Textiles about delivery?" autoFocus />
          <Button type="submit" variant="primary" icon={<Sparkles className="size-3.5" />} loading={ask.isPending} disabled={q.trim().length < 2}>Ask</Button>
        </form>
        {ask.error && <Notice tone="danger">{errorMessage(ask.error)}</Notice>}
        {ask.data && (
          <div className="grid gap-3 rounded-[14px] bg-surface-2 p-4">
            <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap">{ask.data.answer}</p>
            {ask.data.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ask.data.sources.map((s) => <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12.5px] ring-1 ring-border hover:bg-bg"><FileText className="size-3.5" />{s.title}</button>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
