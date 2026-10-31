"use client";

// Minutes of meeting (MOM): who was there, a summary, the discussion,
// decisions and action items (owner, due date, done) — then shared by email
// to the organiser and anyone else, from your mailbox, with a preview of
// exactly what they'll get.
import { useQuery } from "@tanstack/react-query";
import { Check, ClipboardList, Copy, FileText, Plus, Printer, Send, Trash2, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Button, Field, IconButton, Input, Notice, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { CalMetaOut, NotesOut } from "@/lib/calendar/api";
import { providerName } from "@/lib/calendar/detect";
import { minutesHtml, minutesText, type Notes } from "@/lib/calendar/model";
import { calKey, useCalApi, useCalRefresh, whenLocal } from "./shared";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function MinutesDialog({ meta, eventId, occurrence, onClose, startOnShare }: { meta: CalMetaOut; eventId: string; occurrence: string; onClose: () => void; startOnShare?: boolean }) {
  const { orgId, call } = useCalApi();
  const q = useQuery({ queryKey: calKey(orgId, "notes", eventId, occurrence), queryFn: () => call<NotesOut>(`notes?event=${eventId}&occurrence=${encodeURIComponent(occurrence)}`) });
  return (
    <Dialog open onClose={onClose} size="2xl" title="Minutes of meeting" description={q.data ? `${q.data.event.title} · ${whenLocal(new Date(q.data.event.start), new Date(q.data.event.end), q.data.event.allDay)}` : undefined}>
      {q.isError ? <Notice tone="danger" title="Couldn't open the minutes">{errorMessage(q.error)}</Notice> : !q.data ? <Skeleton className="h-80" /> : <MinutesBody meta={meta} data={q.data} startOnShare={startOnShare} onDone={onClose} />}
    </Dialog>
  );
}

function MinutesBody({ meta, data, startOnShare, onDone }: { meta: CalMetaOut; data: NotesOut; startOnShare?: boolean; onDone: () => void }) {
  const { call } = useCalApi();
  const refresh = useCalRefresh();
  const toast = useToast();
  const [tab, setTab] = useState<"write" | "share">(startOnShare && data.id ? "share" : "write");
  const [f, setF] = useState<Notes>(data.fields);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [decision, setDecision] = useState("");
  const [person, setPerson] = useState("");
  const set = (patch: Partial<Notes>) => {
    setF((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const ev = data.event;
  const invited = useMemo(() => [...new Map([...(ev.organizer ? [ev.organizer] : []), ...ev.attendees].map((p) => [p.email, p])).values()], [ev]);
  const people = useMemo(() => [...new Set([meta.me.name, ...invited.map((p) => p.name || p.email)])].filter(Boolean), [invited, meta.me.name]);
  const iOrganised = !ev.organizer || meta.accounts.some((a) => a.address === ev.organizer?.email) || ev.organizer.email === meta.me.email.toLowerCase();

  // Sharing
  const [accountId, setAccountId] = useState(ev.mailAccountId && meta.accounts.some((a) => a.id === ev.mailAccountId) ? ev.mailAccountId : (meta.accounts[0]?.id ?? ""));
  const mine = new Set(meta.accounts.map((a) => a.address));
  const others = invited.map((p) => p.email).filter((e) => !mine.has(e) && e !== meta.me.email.toLowerCase());
  const [to, setTo] = useState<string[]>(!iOrganised && ev.organizer ? [ev.organizer.email] : others);
  const [cc, setCc] = useState<string[]>(!iOrganised ? others.filter((e) => e !== ev.organizer?.email) : []);
  const [message, setMessage] = useState(`Hi all,\n\nThanks for your time. Here are the minutes from "${ev.title}" — please reply if I've missed anything.`);

  const meta2 = { title: ev.title, when: whenLocal(new Date(ev.start), new Date(ev.end), ev.allDay), organizer: ev.organizer ? ev.organizer.name || ev.organizer.email : meta.me.name, where: ev.location || (ev.meetingUrl ? providerName(null) || "Online" : "") };
  const html = minutesHtml(meta2, f, "#2563eb", message);

  const save = async (quiet = false) => {
    setBusy("save");
    try {
      await call("notes", "PUT", { event: data.eventId, occurrence: data.occurrence, fields: f });
      setDirty(false);
      if (!quiet) toast({ tone: "success", title: "Minutes saved" });
      refresh();
      return true;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    if (!to.length) return toast({ tone: "error", title: "Who should get the minutes?" });
    if (!(await save(true))) return;
    setBusy("send");
    try {
      const r = await call<{ sharedTo: string[] }>("notes/share", "POST", { event: data.eventId, occurrence: data.occurrence, accountId, to, cc, message });
      toast({ tone: "success", title: "Minutes sent", description: `To ${r.sharedTo.length} ${r.sharedTo.length === 1 ? "person" : "people"}, from ${meta.accounts.find((a) => a.id === accountId)?.address}.` });
      refresh();
      onDone();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const printable = () => {
    const url = URL.createObjectURL(new Blob([`<!doctype html><meta charset="utf-8"><title>Minutes — ${ev.title.replace(/</g, "&lt;")}</title><body style="margin:32px">${minutesHtml(meta2, f)}</body>`], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(minutesText(meta2, f)).catch(() => {});
    toast({ tone: "success", title: "Copied as text" });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onChange={(t) => { if (t === "share" && dirty) void save(true); setTab(t); }} tabs={[{ value: "write", label: "Write" }, { value: "share", label: "Share by email" }]} />
        <div className="flex items-center gap-1">
          {data.sharedAt && <span className="mr-2 inline-flex items-center gap-1 text-[12px] text-success"><Check className="size-3.5" />Shared {new Date(data.sharedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} with {data.sharedTo.length}</span>}
          <IconButton size="sm" label="Copy as text" icon={<Copy className="size-4" />} onClick={() => void copy()} />
          <IconButton size="sm" label="Printable copy (save as PDF)" icon={<Printer className="size-4" />} onClick={printable} />
        </div>
      </div>

      {tab === "write" ? (
        <div className="grid gap-5">
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Present</p>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...people, ...f.present])].map((p) => {
                const on = f.present.includes(p);
                return <button key={p} type="button" aria-pressed={on} onClick={() => set({ present: on ? f.present.filter((x) => x !== p) : [...f.present, p] })} className={cx("inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12.5px] font-medium ring-1 transition-colors", on ? "bg-sky-600 text-white ring-sky-600" : "text-muted ring-border hover:text-fg")}>{on && <Check className="size-3.5" />}{p}</button>;
              })}
              <form className="flex items-center" onSubmit={(e) => { e.preventDefault(); if (person.trim()) { set({ present: [...f.present, person.trim()] }); setPerson(""); } }}>
                <input aria-label="Add someone" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="+ Add someone" className="h-8 w-36 rounded-full bg-surface-2 px-3 text-[12.5px] outline-none" style={{ outline: "none" }} />
              </form>
            </div>
          </div>
          <Field label="Summary" hint="The outcome in a few lines">{(p) => <Textarea {...p} rows={3} value={f.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="We agreed the Q4 order and the new delivery dates." />}</Field>
          <Field label="Discussion">{(p) => <Textarea {...p} rows={5} value={f.points} onChange={(e) => set({ points: e.target.value })} placeholder={"• Pricing for 400+ units\n• Packaging options\n• Delivery to the new wing"} />}</Field>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium"><Check className="size-4 text-muted" />Decisions</p>
            <ol className="grid gap-1.5">
              {f.decisions.map((d, i) => (
                <li key={i} className="flex items-center gap-2 rounded-[10px] bg-surface-2 px-3 py-1.5 text-[13.5px]">
                  <span className="text-muted tabular-nums">{i + 1}.</span><span className="flex-1">{d}</span>
                  <IconButton size="sm" label="Remove" icon={<X className="size-3.5" />} onClick={() => set({ decisions: f.decisions.filter((_, j) => j !== i) })} />
                </li>
              ))}
            </ol>
            <form className="mt-1.5 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (decision.trim()) { set({ decisions: [...f.decisions, decision.trim()] }); setDecision(""); } }}>
              <Input aria-label="Add a decision" value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Add a decision and press Enter" />
              <Button type="submit" icon={<Plus className="size-4" />} disabled={!decision.trim()}>Add</Button>
            </form>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium"><ClipboardList className="size-4 text-muted" />Action items</p>
            <datalist id="mom-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
            <div className="grid gap-1.5">
              {f.actions.map((a, i) => (
                <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-[12px] border border-border p-2 sm:grid-cols-[auto_minmax(0,1fr)_160px_150px_auto]">
                  <input type="checkbox" aria-label="Done" checked={a.done} onChange={(e) => set({ actions: f.actions.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} className="size-4 accent-sky-600" />
                  <Input aria-label="Action" value={a.text} onChange={(e) => set({ actions: f.actions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder="What needs doing" className={cx(a.done && "line-through opacity-60")} />
                  <Input aria-label="Owner" list="mom-people" value={a.owner} onChange={(e) => set({ actions: f.actions.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)) })} placeholder="Who" className="col-start-2 sm:col-start-auto" />
                  <Input aria-label="Due" type="date" value={a.due} onChange={(e) => set({ actions: f.actions.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)) })} className="col-start-2 sm:col-start-auto" />
                  <IconButton size="sm" label="Remove action" className="col-start-2 justify-self-end sm:col-start-auto" icon={<Trash2 className="size-3.5" />} onClick={() => set({ actions: f.actions.filter((_, j) => j !== i) })} />
                </div>
              ))}
            </div>
            <Button className="mt-1.5" size="sm" icon={<Plus className="size-3.5" />} onClick={() => set({ actions: [...f.actions, { text: "", owner: "", due: "", done: false }] })}>Add an action</Button>
          </div>

          <Field label="Next meeting" hint="Optional">{(p) => <Input {...p} type="date" value={f.nextMeeting} onChange={(e) => set({ nextMeeting: e.target.value })} className="!w-auto" />}</Field>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            {dirty && <span className="mr-auto text-[12px] text-muted">Unsaved changes</span>}
            <Button loading={busy === "save"} icon={<FileText className="size-4" />} onClick={() => void save()}>Save draft</Button>
            <Button variant="primary" icon={<Send className="size-4" />} disabled={!meta.accounts.length} onClick={() => { void save(true); setTab("share"); }}>Next: share</Button>
          </div>
        </div>
      ) : !meta.accounts.length ? (
        <Notice tone="warning" title="Connect a mailbox to share">Minutes are sent from your own mailbox. Connect one in Mail, then come back.</Notice>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="grid content-start gap-4">
            <Field label="From">{(p) => <Select {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>{meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.address}</option>)}</Select>}</Field>
            <People label="To" value={to} onChange={setTo} suggest={!iOrganised && ev.organizer ? [ev.organizer.email] : others} hint={!iOrganised && ev.organizer ? `${ev.organizer.name || ev.organizer.email} sent the invite` : undefined} />
            <People label="Cc" value={cc} onChange={setCc} suggest={others.filter((e) => !to.includes(e))} />
            <Field label="Message">{(p) => <Textarea {...p} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
            <p className="text-[12px] text-muted">{ev.mailThreadId ? "Sent as a reply in the invite's email conversation, with your signature." : "Sent with your signature."}</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setTab("write")}>Back</Button>
              <Button variant="primary" icon={<Send className="size-4" />} loading={busy === "send"} disabled={!to.length} onClick={() => void share()}>Send the minutes</Button>
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-[12px] font-semibold text-muted">What they&apos;ll get</p>
            {/* Lists keep their numbers, as in mail apps (the app's base styles would strip them). */}
            <div className="max-h-[60vh] overflow-auto rounded-[16px] border border-border bg-white p-5 text-[#1d1d1f] [&_ol]:list-decimal [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      )}
    </div>
  );
}

function People({ label, value, onChange, suggest, hint }: { label: string; value: string[]; onChange: (v: string[]) => void; suggest: string[]; hint?: string }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const ok = parts.filter((p) => EMAIL.test(p) && !value.includes(p));
    if (ok.length) onChange([...value, ...ok]);
    setText(parts.filter((p) => !EMAIL.test(p)).join(" "));
  };
  const more = suggest.filter((s) => !value.includes(s));
  return (
    <div className="grid gap-1.5">
      <p className="text-[13px] font-medium">{label}</p>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[12px] border border-border bg-[var(--surface-solid)] px-2 py-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-[12.5px]">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="grid size-5 place-items-center rounded-full hover:bg-fg/10"><X className="size-3" /></button></span>
        ))}
        <input aria-label={`Add to ${label}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); add(text); } }} onBlur={() => text && add(text)} placeholder={value.length ? "" : "name@company.com"} className="min-w-[8rem] flex-1 bg-transparent py-1 text-[13.5px] outline-none" style={{ outline: "none" }} />
      </div>
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
      {more.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {more.length > 1 && <button type="button" onClick={() => onChange([...value, ...more])} className="inline-flex h-7 items-center gap-1 rounded-full bg-sky-500/10 px-2.5 text-[12px] font-medium text-sky-700 hover:bg-sky-500/15 dark:text-sky-300"><UserPlus className="size-3.5" />Everyone invited</button>}
          {more.slice(0, 8).map((s) => <button key={s} type="button" onClick={() => onChange([...value, s])} className="h-7 rounded-full px-2.5 text-[12px] text-muted ring-1 ring-border hover:text-fg">+ {s}</button>)}
        </div>
      )}
    </div>
  );
}
