"use client";

// The meeting in an email, shown above it: what, when, on which service, who
// sent it; Join; and Add to calendar (or, once added, open it and answer
// Going / Maybe / No — sent to the organiser as a real calendar reply).
import { CalendarCheck2, CalendarPlus, Check, CircleHelp, Video, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AddMeetingDialog } from "@/components/calendar/add-meeting";
import { useCalApi, useCalRefresh } from "@/components/calendar/shared";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import { Badge, Button, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { providerName } from "@/lib/calendar/detect";
import type { MessageMeeting } from "@/lib/mail/api";
import { visibleTo } from "@/lib/workspace/modules";
import { useMailRefresh } from "./shared";

export function MeetingCard({ messageId, meeting: m, eventId }: { messageId: string; meeting: MessageMeeting; eventId: string | null }) {
  const { org } = useSession();
  const calendarOn = visibleTo(org, "calendar");
  const { call } = useCalApi();
  const refreshCal = useCalRefresh();
  const refreshMail = useMailRefresh();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const start = m.start ? new Date(m.start) : null;
  const end = m.end ? new Date(m.end) : null;
  const over = !!end && end.getTime() < now;
  const day = start?.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const time = start && end ? `${start.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "";

  const rsvp = async (response: "accepted" | "tentative" | "declined") => {
    if (!eventId) return;
    setBusy(true);
    try {
      await call(`events/${eventId}/rsvp`, "POST", { response });
      setAnswer(response);
      toast({ tone: "success", title: response === "accepted" ? "Accepted" : response === "tentative" ? "Answered maybe" : "Declined", description: `We told ${m.organizer?.name || m.organizer?.address}.` });
      refreshCal();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("mt-4 overflow-hidden rounded-[18px] border", m.cancelled ? "border-danger/30 bg-danger-soft" : "border-sky-500/25 bg-[linear-gradient(135deg,color-mix(in_srgb,#0ea5e9_9%,transparent),transparent_70%)]")}>
      <div className="flex flex-wrap items-start gap-3.5 p-4">
        {start ? (
          <div className="grid w-14 shrink-0 overflow-hidden rounded-[12px] bg-[var(--surface-solid)] text-center shadow-sm ring-1 ring-border">
            <span className="bg-red-500 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white uppercase">{start.toLocaleDateString("en-IN", { month: "short" })}</span>
            <span className="py-1 text-[22px] leading-none font-semibold tabular-nums">{start.getDate()}</span>
            <span className="pb-1 text-[10px] text-muted uppercase">{start.toLocaleDateString("en-IN", { weekday: "short" })}</span>
          </div>
        ) : (
          <span className="grid size-14 shrink-0 place-items-center rounded-[12px] bg-sky-500/15 text-sky-600"><Video className="size-6" /></span>
        )}
        <div className="min-w-[200px] flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-sky-700 uppercase dark:text-sky-400">
            {m.cancelled ? <span className="text-danger">Cancelled</span> : m.source === "ics" ? "Meeting invite" : "Meeting link"}
            {m.url && <span className="normal-case tracking-normal text-muted">· {providerName(m.provider) || "Video call"}</span>}
          </p>
          <p className={cx("mt-0.5 text-[16px] leading-snug font-semibold", m.cancelled && "line-through")}>{m.title}</p>
          <p className="mt-0.5 text-[13px] text-muted">{start ? `${day} · ${time}` : "No time given — add it when you put it in your calendar"}{m.source === "text" && start && m.confidence !== "high" && <span className="ml-1 text-amber-700 dark:text-amber-400">(read from the email — check it)</span>}</p>
          {(m.organizer || m.attendees.length > 0) && <p className="mt-0.5 truncate text-[12.5px] text-subtle">{m.organizer ? `From ${m.organizer.name || m.organizer.address}` : ""}{m.attendees.length > 1 ? ` · ${m.attendees.length} invited` : ""}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {m.url && !over && !m.cancelled && <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white hover:brightness-110"><Video className="size-4" />Join</a>}
          {calendarOn && !m.cancelled && (eventId ? (
            <Link href={`/calendar?event=${eventId}${m.start ? `&at=${encodeURIComponent(m.start)}` : ""}`} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ring-1 ring-border hover:bg-surface-2"><CalendarCheck2 className="size-4 text-success" />In your calendar</Link>
          ) : (
            <Button variant="primary" icon={<CalendarPlus className="size-4" />} onClick={() => setAdding(true)}>Add to calendar</Button>
          ))}
        </div>
      </div>
      {calendarOn && eventId && m.rsvp && !over && !m.cancelled && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-[var(--surface-solid)]/60 px-4 py-2.5 text-[13px]">
          <span className="mr-1 text-muted">Going?</span>
          {([["accepted", "Yes", Check], ["tentative", "Maybe", CircleHelp], ["declined", "No", X]] as const).map(([r, l, I]) => (
            <button key={r} type="button" disabled={busy} aria-pressed={answer === r} onClick={() => void rsvp(r)} className={cx("inline-flex h-8 items-center gap-1 rounded-full px-3 font-semibold ring-1 transition-colors disabled:opacity-60", answer === r ? "bg-fg text-bg ring-fg" : "ring-border hover:bg-surface-2")}><I className="size-3.5" />{l}</button>
          ))}
          {answer && <Badge tone="success">Sent to {m.organizer?.name || m.organizer?.address}</Badge>}
        </div>
      )}
      {adding && <AddMeetingDialog m={{ messageId, title: m.title, start: m.start, end: m.end, allDay: m.allDay, url: m.url, provider: m.provider, organizer: m.organizer, confidence: m.confidence, source: m.source }} onClose={() => setAdding(false)} onAdded={() => refreshMail()} />}
    </div>
  );
}
