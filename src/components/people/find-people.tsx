"use client";

// Find someone to invite: type a username (@kabir), an email address, a phone
// number or a name from the workspace's contacts. Accounts show their name and
// username only — never their email or phone. Picks one result at a time.
import { useQuery } from "@tanstack/react-query";
import { AtSign, BookUser, Check, Mail, Search, UserPlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { readQuery, type PersonHit } from "@/lib/people/model";

export function FindPeople({ orgId, onPick, contacts = true, hideMembers = false, exclude = [], placeholder = "Username, email, phone or contact", autoFocus }: { orgId: string; onPick: (hit: PersonHit) => void; contacts?: boolean; hideMembers?: boolean; exclude?: string[]; placeholder?: string; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useId();
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 220);
    return () => clearTimeout(t);
  }, [text]);
  const kind = readQuery(q).kind;
  const res = useQuery({
    queryKey: ["people", orgId, q, contacts],
    queryFn: () => api<{ results: PersonHit[] }>(`/api/v1/orgs/${orgId}/people?q=${encodeURIComponent(q)}${contacts ? "" : "&contacts=0"}`),
    enabled: kind !== "none",
    staleTime: 30_000,
  });
  const hits = (res.data?.results ?? []).filter((h) => !(h.kind === "account" && (exclude.includes(h.id) || (hideMembers && h.member))));
  const pick = (h: PersonHit) => {
    onPick(h);
    setText("");
    setQ("");
    setActive(0);
  };
  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <Input
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && hits[active]) {
              e.preventDefault();
              pick(hits[active]!);
            }
          }}
          placeholder={placeholder}
          className="pl-9"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={list}
          aria-autocomplete="list"
          aria-label="Find people"
        />
      </div>
      {kind !== "none" && (
        <ul id={list} role="listbox" className="grid gap-0.5 rounded-[12px] border border-border bg-surface p-1">
          {res.isLoading && <li className="px-3 py-2 text-[12.5px] text-muted">Looking…</li>}
          {!res.isLoading && hits.length === 0 && (
            <li className="px-3 py-2 text-[12.5px] text-muted">{kind === "username" ? "No one by that username. Try their email or phone number." : "No account matches exactly. Check it, or invite by email."}</li>
          )}
          {hits.map((h, k) => {
            const on = k === active;
            const base = `flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left ${on ? "bg-surface-2" : "hover:bg-surface-2"}`;
            if (h.kind === "account") {
              return (
                <li key={h.id} role="option" aria-selected={on}>
                  <button type="button" className={base} onMouseEnter={() => setActive(k)} onClick={() => pick(h)}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-fg text-[12px] font-semibold text-bg">{h.name.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{h.name}</span>
                      <span className="flex items-center gap-0.5 text-[12px] text-muted"><AtSign className="size-3" />{h.username}</span>
                    </span>
                    {h.member ? <span className="text-[11.5px] text-muted">In this workspace</span> : h.invited ? <span className="text-[11.5px] text-muted">Invited</span> : <span className="inline-flex items-center gap-1 text-[11.5px] text-muted"><Check className="size-3" /> On Cloudesk</span>}
                    <UserPlus className="size-4 text-subtle" aria-hidden />
                  </button>
                </li>
              );
            }
            if (h.kind === "contact") {
              return (
                <li key={h.key} role="option" aria-selected={on}>
                  <button type="button" className={base} onMouseEnter={() => setActive(k)} onClick={() => pick(h)}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"><BookUser className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{h.name}</span>
                      <span className="block truncate text-[12px] text-muted">{h.email}</span>
                    </span>
                    <span className="text-[11.5px] text-muted">{h.source} contact</span>
                  </button>
                </li>
              );
            }
            return (
              <li key={`email:${h.email}`} role="option" aria-selected={on}>
                <button type="button" className={base} onMouseEnter={() => setActive(k)} onClick={() => pick(h)}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"><Mail className="size-4" /></span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">Invite <span className="font-medium">{h.email}</span></span>
                  <span className="text-[11.5px] text-muted">By email</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
