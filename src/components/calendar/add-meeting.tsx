"use client";

// Adding a meeting found in an email: what we found (title, time, link,
// organiser) with the time editable — always confirmed by a person, since a
// time read from the text is a best guess — which calendar, the reminders,
// and (for a real invite) answering "accepted" to the organiser too.
import { AlertTriangle, CalendarPlus, Video } from "lucide-react";
import { useState } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, Select, Switch, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { EventOut } from "@/lib/calendar/api";
import { providerName } from "@/lib/calendar/detect";
import { DEFAULT_REMINDERS, REMINDER_OPTIONS, reminderLabel } from "@/lib/calendar/model";
import { dayKey, useCalApi, useCalMeta, useCalRefresh } from "./shared";

export type FoundMeeting = {
  messageId: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  url: string;
  provider: string | null;
  organizer: { name: string; address: string } | null;
  confidence: "high" | "medium" | "low";
  source: "ics" | "text";
};

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function AddMeetingDialog({ m, onClose, onAdded }: { m: FoundMeeting; onClose: () => void; onAdded?: (e: EventOut) => void }) {
  const { call } = useCalApi();
  const meta = useCalMeta();
  const refresh = useCalRefresh();
  const toast = useToast();
  const s0 = m.start ? new Date(m.start) : null;
  const e0 = m.end ? new Date(m.end) : s0 ? new Date(s0.getTime() + 30 * 60_000) : null;
  const [title, setTitle] = useState(m.title);
  const [day, setDay] = useState(s0 ? dayKey(s0) : "");
  const [from, setFrom] = useState(s0 ? hm(s0) : "");
  const [to, setTo] = useState(e0 ? hm(e0) : "");
  const [calendarId, setCalendarId] = useState("");
  const [reminders, setReminders] = useState(DEFAULT_REMINDERS);
  const [accept, setAccept] = useState(m.source === "ics" && !!m.organizer);
  const [busy, setBusy] = useState(false);
  const [past] = useState(() => !!s0 && s0.getTime() < Date.now());
  const cals = meta.data?.calendars ?? [];
  const cal = calendarId || cals.find((c) => c.isDefault)?.id || cals[0]?.id || "";
  const start = day && from ? new Date(`${day}T${from}:00`) : null;
  const end = day && to ? new Date(`${day}T${to}:00`) : null;
  const bad = !start ? "Pick the date and time" : !end || end <= start ? "It has to end after it starts" : "";

  const add = async () => {
    if (bad) return toast({ tone: "error", title: bad });
    setBusy(true);
    try {
      const r = await call<{ event: EventOut; already: boolean }>("events/from-mail", "POST", { messageId: m.messageId, calendarId: cal || undefined, title: title.trim() || m.title, start: start!.toISOString(), end: end!.toISOString(), reminders, accept });
      toast({ tone: "success", title: r.already ? "Already in your calendar" : "Added to your calendar", description: r.already ? undefined : `We'll remind you ${reminders.length ? reminders.map(reminderLabel).join(", ").toLowerCase() : "— no reminders set"}.` });
      refresh();
      onAdded?.(r.event);
      onClose();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title="Add to calendar" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<CalendarPlus className="size-4" />} loading={busy} disabled={!!bad} onClick={() => void add()}>Add to calendar</Button></>}>
      <div className="grid gap-4">
        {m.source === "text" && (
          <Notice tone={m.confidence === "low" || !s0 ? "warning" : "neutral"} title={!s0 ? "We couldn't tell when it is" : m.confidence === "low" ? "Check the time" : "Time read from the email"}>
            {!s0 ? "There's no calendar invite, so pick the date and time." : "There's no calendar invite — we read the time from the email's wording. Make sure it's right."}
          </Notice>
        )}
        <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Date">{(p) => <Input {...p} type="date" value={day} onChange={(e) => setDay(e.target.value)} className="!w-auto" />}</Field>
          <Field label="From">{(p) => <Input {...p} type="time" step={300} value={from} onChange={(e) => { const f = e.target.value; if (start && end && f) { const len = end.getTime() - start.getTime(); setTo(hm(new Date(new Date(`${day}T${f}:00`).getTime() + len))); } setFrom(f); }} className="!w-auto" />}</Field>
          <Field label="To">{(p) => <Input {...p} type="time" step={300} value={to} onChange={(e) => setTo(e.target.value)} className="!w-auto" />}</Field>
        </div>
        {m.url && <p className="flex items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2 text-[13px]"><Video className="size-4 shrink-0 text-sky-600" /><span className="font-medium">{providerName(m.provider) || "Video call"}</span><span className="min-w-0 truncate text-muted">{m.url}</span></p>}
        {cals.length > 1 && <Field label="Calendar">{(p) => <Select {...p} value={cal} onChange={(e) => setCalendarId(e.target.value)}>{cals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>}
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Remind me</p>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_OPTIONS.filter((x) => x <= 2880).map((x) => (
              <button key={x} type="button" aria-pressed={reminders.includes(x)} onClick={() => setReminders((r) => (r.includes(x) ? r.filter((y) => y !== x) : [...r, x].sort((a, b) => b - a)))} className={cx("h-8 rounded-full px-3 text-[12.5px] font-medium ring-1", reminders.includes(x) ? "bg-sky-600 text-white ring-sky-600" : "ring-border hover:bg-surface-2")}>{reminderLabel(x)}</button>
            ))}
          </div>
        </div>
        {m.source === "ics" && m.organizer && (
          <label className="flex items-center gap-2 text-[13.5px]"><Switch label="Accept" checked={accept} onChange={setAccept} /> Tell {m.organizer.name || m.organizer.address} I&apos;m coming</label>
        )}
        {past && <p className="flex items-center gap-1.5 text-[12.5px] text-amber-700 dark:text-amber-400"><AlertTriangle className="size-3.5" />This is in the past — you can still add it, to write the minutes.</p>}
      </div>
    </Dialog>
  );
}
