"use client";

// One event, opened: a big Join button (live when it's on), when and where,
// the organiser and guests with their answers, your own answer (sent to the
// organiser as a real calendar reply), reminders, notes, the email it came
// from, and the minutes — write them after, then share them by email.
import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarDays, Check, CircleHelp, Download, ExternalLink, FileText, Mail, MapPin, Pencil, Repeat2, Trash2, Users, Video, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmailButton } from "@/components/mail/compose-provider";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, IconButton, Skeleton, Switch, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { CalMetaOut, EventOut, OccurrenceOut } from "@/lib/calendar/api";
import { providerName } from "@/lib/calendar/detect";
import { reminderLabel } from "@/lib/calendar/model";
import { describeRepeat } from "@/lib/calendar/recur";
import { calKey, useCalApi, useCalRefresh, whenLocal } from "./shared";

const RESP = { accepted: { label: "Going", icon: Check, cls: "text-success" }, tentative: { label: "Maybe", icon: CircleHelp, cls: "text-amber-600" }, declined: { label: "No", icon: X, cls: "text-danger" } } as const;

export function EventPanel({ meta, occ, now, onClose, onEdit, onNotes }: { meta: CalMetaOut; occ: OccurrenceOut; now: number; onClose: () => void; onEdit: (e: EventOut) => void; onNotes: (occ: OccurrenceOut) => void }) {
  const { orgId, base, call } = useCalApi();
  const refresh = useCalRefresh();
  const toast = useToast();
  const q = useQuery({ queryKey: calKey(orgId, "event", occ.id), queryFn: () => call<EventOut>(`events/${occ.id}`) });
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const e = q.data;
  const start = new Date(occ.start);
  const end = new Date(occ.end);
  const live = start.getTime() <= now && end.getTime() > now;
  const over = end.getTime() <= now;
  const cal = meta.calendars.find((c) => c.id === occ.calendarId);
  const soon = !over && start.getTime() - now < 15 * 60_000;

  const answer = async (response: "accepted" | "tentative" | "declined") => {
    setBusy(response);
    try {
      await call(`events/${occ.id}/rsvp`, "POST", { response });
      toast({ tone: "success", title: `${RESP[response].label === "Going" ? "Accepted" : RESP[response].label === "Maybe" ? "Answered maybe" : "Declined"}`, description: meta.accounts.length ? `We told ${e?.organizer?.name || e?.organizer?.email}.` : undefined });
      refresh();
      void q.refetch();
    } catch (err) {
      toast({ tone: "error", title: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[var(--surface-solid)]">
      <div className="h-1.5 shrink-0" style={{ background: occ.color }} />
      <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
        <span className="flex items-center gap-1.5 text-[12px] text-muted"><span className="size-2 rounded-full" style={{ background: cal?.color ?? occ.color }} />{cal?.name}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {e && <IconButton size="sm" label="Edit" icon={<Pencil className="size-4" />} onClick={() => onEdit(e)} />}
          <a href={`${base}/events/${occ.id}/ics`} aria-label="Download .ics" title="Download .ics" className="grid size-8 place-items-center rounded-full text-muted hover:bg-fg/10 hover:text-fg"><Download className="size-4" /></a>
          <IconButton size="sm" label="Delete" icon={<Trash2 className="size-4" />} onClick={() => setDel(true)} />
          <IconButton size="sm" label="Close" icon={<X className="size-4" />} onClick={onClose} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-6">
        <h2 className={cx("text-[21px] leading-snug font-semibold tracking-[-0.015em]", occ.status === "cancelled" && "line-through opacity-60")}>{occ.title}</h2>
        <p className="mt-1 text-[13.5px] text-muted">{whenLocal(start, end, occ.allDay)}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {occ.status === "cancelled" && <Badge tone="danger">Cancelled by the organiser</Badge>}
          {live && <Badge tone="success">Happening now</Badge>}
          {occ.recurring && e?.repeat && <Badge><Repeat2 className="size-3" />{describeRepeat(e.repeat)}</Badge>}
          {occ.source === "mail" && <Badge tone="accent"><Mail className="size-3" />From email</Badge>}
        </div>

        {occ.meetingUrl && !over && occ.status !== "cancelled" && (
          <a href={occ.meetingUrl} target="_blank" rel="noreferrer" className={cx("mt-4 flex items-center justify-center gap-2 rounded-[14px] px-4 py-3 text-[14.5px] font-semibold text-white shadow-[0_10px_24px_-12px_rgb(0_0_0/0.5)] transition-transform active:scale-[0.99]", live || soon ? "bg-emerald-600" : "bg-sky-600")}>
            <Video className="size-[18px]" /> {live ? "Join now" : `Join ${providerName(occ.provider) || "the call"}`}
          </a>
        )}
        {occ.meetingUrl && <p className="mt-1.5 truncate text-center text-[11.5px] text-muted">{occ.meetingUrl}</p>}

        {/* Minutes */}
        {over && occ.status !== "cancelled" && (
          <div className={cx("mt-4 rounded-[16px] border p-3.5", occ.notes === "shared" ? "border-success/30 bg-success-soft" : "border-amber-500/30 bg-amber-500/[0.07]")}>
            <p className="flex items-center gap-1.5 text-[13.5px] font-semibold"><FileText className="size-4" />Minutes of meeting</p>
            <p className="mt-0.5 text-[12.5px] text-muted">{occ.notes === "shared" ? "Written and shared by email." : occ.notes === "draft" ? "A draft is saved — finish and share it." : "Note what was decided and who's doing what, then share it with everyone."}</p>
            <Button size="sm" variant={occ.notes === "shared" ? "secondary" : "primary"} className="mt-2.5" icon={<FileText className="size-3.5" />} onClick={() => onNotes(occ)}>{occ.notes === "none" ? "Write the minutes" : occ.notes === "draft" ? "Finish the minutes" : "Open the minutes"}</Button>
          </div>
        )}

        {!e ? (
          <div className="mt-5 grid gap-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-16" /></div>
        ) : (
          <div className="mt-5 grid gap-4 text-[13.5px]">
            {e.organizer && !e.organising && occ.status !== "cancelled" && !over && (
              <div>
                <p className="mb-1.5 text-[12px] font-semibold text-muted">Going?</p>
                <div className="flex gap-1.5">
                  {(["accepted", "tentative", "declined"] as const).map((r) => {
                    const I = RESP[r].icon;
                    return (
                      <button key={r} type="button" disabled={!!busy} aria-pressed={e.response === r} onClick={() => void answer(r)} className={cx("inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold ring-1 transition-colors disabled:opacity-60", e.response === r ? "bg-fg text-bg ring-fg" : "ring-border hover:bg-surface-2")}>
                        <I className="size-4" />{RESP[r].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {e.location && <Row icon={<MapPin />}>{e.location}</Row>}
            {(e.organizer || e.attendees.length > 0) && (
              <Row icon={<Users />}>
                <p className="font-medium">{(() => { const n = e.attendees.filter((a) => a.email !== e.organizer?.email).length + (e.organizer ? 1 : 0); return `${n} ${n === 1 ? "person" : "people"}`; })()}</p>
                <ul className="mt-1.5 grid gap-1.5">
                  {e.organizer && <Person name={e.organizer.name} email={e.organizer.email} note="Organiser" />}
                  {e.attendees.filter((a) => a.email !== e.organizer?.email).map((a) => <Person key={a.email} name={a.name} email={a.email} note={a.response ? RESP[a.response as keyof typeof RESP]?.label : undefined} />)}
                </ul>
                {(() => {
                  // Everyone on the invite but you.
                  const mine = new Set(meta.accounts.map((a) => a.address.toLowerCase()));
                  const guests = [e.organizer, ...e.attendees].filter((p) => p && !mine.has(p.email.toLowerCase()));
                  return guests.length > 0 && <EmailButton className="mt-2.5" to={guests} label="Email guests" title={`Email the guests — ${e.title}`} subject={`Re: ${e.title}`} body={`Hi all,\n\nAbout ${e.title} (${whenLocal(start, end, occ.allDay)}):\n\n`} />;
                })()}
              </Row>
            )}
            {!occ.allDay && e.reminders.length > 0 && <Row icon={<Bell />}>{e.reminders.map(reminderLabel).join(" · ")}</Row>}
            {e.description && <Row icon={<FileText />}><p className="whitespace-pre-line break-words text-fg/85">{e.description.length > 1200 ? `${e.description.slice(0, 1200)}…` : e.description}</p></Row>}
            {e.mailThreadId && <Row icon={<Mail />}><Link href={`/mail/t/${e.mailThreadId}`} className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline dark:text-sky-400">Open the email <ExternalLink className="size-3.5" /></Link></Row>}
            <Row icon={<CalendarDays />}><span className="text-muted">{cal?.name} calendar</span></Row>
          </div>
        )}
      </div>
      {del && e && <DeleteDialog e={e} occ={occ} meta={meta} onClose={() => setDel(false)} onDone={() => { setDel(false); onClose(); }} />}
    </aside>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-muted [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Person({ name, email, note }: { name: string; email: string; note?: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: `hsl(${[...email].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 55% 48%)` }}>{(name || email).slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px]">{name || email}</span>{name && <span className="block truncate text-[11.5px] text-muted">{email}</span>}</span>
      {note && <span className="shrink-0 text-[11.5px] text-muted">{note}</span>}
    </li>
  );
}

function DeleteDialog({ e, occ, meta, onClose, onDone }: { e: EventOut; occ: OccurrenceOut; meta: CalMetaOut; onClose: () => void; onDone: () => void }) {
  const { call } = useCalApi();
  const refresh = useCalRefresh();
  const toast = useToast();
  const [notify, setNotify] = useState(e.organising && e.attendees.length > 0 && meta.accounts.length > 0);
  const [busy, setBusy] = useState(false);
  const go = async (scope: "this" | "all") => {
    setBusy(true);
    try {
      await call(`events/${e.id}?scope=${scope}&occurrence=${encodeURIComponent(occ.occurrence)}${notify && scope === "all" ? "&notify=1" : ""}`, "DELETE");
      toast({ tone: "success", title: scope === "this" ? "Removed this one" : "Deleted", description: notify && scope === "all" ? "The guests were sent a cancellation." : undefined });
      refresh();
      onDone();
    } catch (err) {
      toast({ tone: "error", title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title={`Delete “${e.title}”?`} footer={e.repeat ? <><Button onClick={() => void go("this")} loading={busy}>Only this one</Button><Button variant="danger" onClick={() => void go("all")} loading={busy}>All of them</Button></> : <><Button onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => void go("all")} loading={busy}>Delete</Button></>}>
      <div className="grid gap-3 text-[13.5px]">
        <p className="text-muted">{e.repeat ? "It repeats — remove just this occurrence, or the whole series?" : "It comes off your calendar."}</p>
        {e.organising && e.attendees.length > 0 && meta.accounts.length > 0 && <label className="flex items-center gap-2"><Switch label="Tell the guests" checked={notify} onChange={setNotify} /> Email the {e.attendees.length} guests a cancellation</label>}
      </div>
    </Dialog>
  );
}

