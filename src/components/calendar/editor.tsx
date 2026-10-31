"use client";

// Making or changing an event: title, when (with all-day and repeats), which
// calendar, the video link and place, who's invited (and emailing them a real
// invite from your mailbox), reminders, colour and notes.
import { Bell, Check, Link2, MapPin, Repeat2, Users, Video, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Select, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { CalMetaOut, EventOut } from "@/lib/calendar/api";
import { findMeetingLink, providerName } from "@/lib/calendar/detect";
import { CAL_COLORS, DEFAULT_REMINDERS, REMINDER_OPTIONS, reminderLabel } from "@/lib/calendar/model";
import { describeRepeat, type Repeat } from "@/lib/calendar/recur";
import { addDays, dayKey, localTz, useCalApi, useCalRefresh } from "./shared";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const TIMES = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
const label = (t: string) => new Date(`2026-01-01T${t}:00`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

type RepeatChoice = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

function choiceOf(r: Repeat | null): RepeatChoice {
  if (!r) return "none";
  if (r.freq === "weekly" && r.interval === 1 && [...r.byDay].sort().join() === "1,2,3,4,5" && !r.until && !r.count) return "weekdays";
  if (r.interval === 1 && !r.until && !r.count && (r.freq !== "weekly" || r.byDay.length <= 1)) return r.freq;
  return "custom";
}

export type Draft = { start: Date; end: Date; allDay: boolean; title?: string };

export function EventEditor({ meta, event, draft, onClose, onSaved }: { meta: CalMetaOut; event?: EventOut; draft?: Draft; onClose: () => void; onSaved: (e: EventOut) => void }) {
  const { call } = useCalApi();
  const refresh = useCalRefresh();
  const toast = useToast();
  // Editing one occurrence of a repeating event shows that occurrence's time (draft).
  const s0 = draft?.start ?? (event ? new Date(event.start) : new Date());
  const e0 = draft?.end ?? (event ? new Date(event.end) : new Date(s0.getTime() + 3_600_000));
  const allDay0 = event?.allDay ?? draft?.allDay ?? false;
  const [title, setTitle] = useState(event?.title ?? draft?.title ?? "");
  const [allDay, setAllDay] = useState(allDay0);
  const [day, setDay] = useState(dayKey(s0));
  const [endDay, setEndDay] = useState(dayKey(allDay0 ? addDays(e0, -1) : e0));
  const [from, setFrom] = useState(timeOf(s0));
  const [to, setTo] = useState(timeOf(e0));
  const [calendarId, setCalendarId] = useState(event?.calendarId ?? meta.calendars.find((c) => c.isDefault)?.id ?? meta.calendars[0]?.id ?? "");
  const [meetingUrl, setMeetingUrl] = useState(event?.meetingUrl ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [attendees, setAttendees] = useState(event?.attendees.map((a) => ({ name: a.name, email: a.email })) ?? []);
  const [guest, setGuest] = useState("");
  const [reminders, setReminders] = useState<number[]>(event?.reminders ?? DEFAULT_REMINDERS);
  const [color, setColor] = useState<string | null>(event?.color ?? null);
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>(choiceOf(event?.repeat ?? null));
  const [custom, setCustom] = useState<Repeat>(event?.repeat ?? { freq: "weekly", interval: 1, byDay: [s0.getDay()], until: null, count: null });
  const [sendInvite, setSendInvite] = useState(!event && meta.accounts.length > 0);
  const [accountId, setAccountId] = useState(event?.mailAccountId ?? meta.accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [scopeAsk, setScopeAsk] = useState(false);

  const start = useMemo(() => (allDay ? new Date(`${day}T00:00:00`) : new Date(`${day}T${from}:00`)), [allDay, day, from]);
  const end = useMemo(() => (allDay ? addDays(new Date(`${endDay}T00:00:00`), 1) : new Date(`${endDay}T${to}:00`)), [allDay, endDay, to]);
  const wd = start.getDay();
  const repeat: Repeat | null =
    repeatChoice === "none" ? null
      : repeatChoice === "weekdays" ? { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5], until: null, count: null }
        : repeatChoice === "custom" ? custom
          : { freq: repeatChoice, interval: 1, byDay: repeatChoice === "weekly" ? [wd] : [], until: null, count: null };
  const link = meetingUrl ? findMeetingLink(meetingUrl) : null;
  const badLink = !!meetingUrl && !/^https:\/\//i.test(meetingUrl);
  const invalid = !title.trim() ? "Give it a title" : end <= start ? "It has to end after it starts" : badLink ? "Use a full https:// meeting link" : "";
  const changedPeople = event ? JSON.stringify(event.attendees.map((a) => a.email)) !== JSON.stringify(attendees.map((a) => a.email)) : false;
  const organising = event ? event.organising : true;

  const addGuest = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const ok = parts.filter((p) => EMAIL.test(p) && !attendees.some((a) => a.email === p));
    if (ok.length) setAttendees([...attendees, ...ok.map((email) => ({ name: "", email }))]);
    setGuest(parts.filter((p) => !EMAIL.test(p)).join(" "));
  };

  const save = async (scope: "all" | "this" = "all") => {
    if (invalid) return toast({ tone: "error", title: invalid });
    setBusy(true);
    try {
      // Changing "all" from a later occurrence shifts the whole series by the same amount.
      const shift = event?.repeat && draft && scope === "all" ? start.getTime() - draft.start.getTime() : null;
      const st = shift !== null ? new Date(Date.parse(event!.start) + shift) : start;
      const en = shift !== null ? new Date(st.getTime() + (end.getTime() - start.getTime())) : end;
      const body = { calendarId, title: title.trim(), description, location, meetingUrl: meetingUrl.trim(), start: st.toISOString(), end: en.toISOString(), allDay, tz: event?.tz ?? localTz(), repeat, attendees, reminders, color, sendInvite: sendInvite && attendees.length > 0, notify: !!event && sendInvite && attendees.length > 0 && organising, accountId: accountId || undefined, scope, occurrence: event ? draft?.start.toISOString() : undefined };
      const r = event ? await call<{ event: EventOut }>(`events/${event.id}`, "PATCH", body) : await call<{ event: EventOut }>("events", "POST", body);
      toast({ tone: "success", title: event ? "Saved" : "Added to your calendar", description: body.sendInvite || body.notify ? `Invite emailed to ${attendees.length} ${attendees.length === 1 ? "person" : "people"}.` : undefined });
      refresh();
      onSaved(r.event);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggleReminder = (m: number) => setReminders((r) => (r.includes(m) ? r.filter((x) => x !== m) : [...r, m].sort((a, b) => b - a).slice(0, 8)));
  const cal = meta.calendars.find((c) => c.id === calendarId);

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={event ? "Edit event" : "New event"}
      footer={
        scopeAsk ? (
          <>
            <span className="mr-auto text-[13px] text-muted">This is a repeating event.</span>
            <Button onClick={() => void save("this")} loading={busy}>Only this one</Button>
            <Button variant="primary" onClick={() => void save("all")} loading={busy}>All of them</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!!invalid} onClick={() => (event?.repeat && draft ? setScopeAsk(true) : void save())}>{event ? "Save" : sendInvite && attendees.length ? "Save and send invite" : "Save"}</Button>
          </>
        )
      }
    >
      <div className="grid gap-5">
        <input autoFocus aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a title" className="w-full border-b border-border bg-transparent pb-2 text-[22px] font-semibold tracking-[-0.01em] outline-none placeholder:text-subtle focus:border-sky-500" style={{ outline: "none" }} />

        {/* When */}
        <div className="grid gap-3 rounded-[16px] bg-surface-2/60 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="Date" value={day} onChange={(e) => { const v = e.target.value; setDay(v); if (v > endDay || !allDay) setEndDay(v); }} className="!h-9 !w-auto" />
            {!allDay && (
              <>
                <Select aria-label="From" value={from} onChange={(e) => { const f = e.target.value; const len = end.getTime() - start.getTime(); setFrom(f); const ne = new Date(new Date(`${day}T${f}:00`).getTime() + len); setTo(timeOf(ne)); setEndDay(dayKey(ne)); }} className="!h-9 !w-auto">
                  {TIMES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </Select>
                <span className="text-muted">–</span>
                <Select aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="!h-9 !w-auto">
                  {TIMES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </Select>
              </>
            )}
            {(allDay || endDay !== day) && (
              <>
                {allDay && <span className="text-muted">–</span>}
                <Input type="date" aria-label="End date" value={endDay} min={day} onChange={(e) => setEndDay(e.target.value)} className="!h-9 !w-auto" />
              </>
            )}
            <label className="ml-auto flex items-center gap-2 text-[13px]"><Switch label="All day" checked={allDay} onChange={setAllDay} /> All day</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Repeat2 className="size-4 text-muted" />
            <Select aria-label="Repeat" value={repeatChoice} onChange={(e) => setRepeatChoice(e.target.value as RepeatChoice)} className="!h-8 !w-auto !text-[13px]">
              <option value="none">Doesn&apos;t repeat</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday (Mon–Fri)</option>
              <option value="weekly">Every week on {start.toLocaleDateString("en-IN", { weekday: "long" })}</option>
              <option value="monthly">Every month on day {start.getDate()}</option>
              <option value="yearly">Every year on {start.toLocaleDateString("en-IN", { day: "numeric", month: "long" })}</option>
              <option value="custom">Custom…</option>
            </Select>
            {repeat && <span className="text-[12.5px] text-muted">{describeRepeat(repeat)}</span>}
          </div>
          {repeatChoice === "custom" && (
            <div className="grid gap-2 rounded-[12px] border border-border bg-[var(--surface-solid)] p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                Every <Input type="number" min={1} max={99} aria-label="Every" value={custom.interval} onChange={(e) => setCustom({ ...custom, interval: Math.max(1, Number(e.target.value) || 1) })} className="!h-8 !w-16" />
                <Select aria-label="Unit" value={custom.freq} onChange={(e) => setCustom({ ...custom, freq: e.target.value as Repeat["freq"] })} className="!h-8 !w-auto">
                  <option value="daily">days</option><option value="weekly">weeks</option><option value="monthly">months</option><option value="yearly">years</option>
                </Select>
              </div>
              {custom.freq === "weekly" && (
                <div className="flex flex-wrap gap-1">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <button key={i} type="button" aria-pressed={custom.byDay.includes(i)} onClick={() => setCustom({ ...custom, byDay: custom.byDay.includes(i) ? custom.byDay.filter((x) => x !== i) : [...custom.byDay, i] })} className={cx("grid size-8 place-items-center rounded-full text-[12px] font-semibold", custom.byDay.includes(i) ? "bg-sky-600 text-white" : "bg-surface-2 text-muted hover:text-fg")}>{d}</button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                Ends
                <Select aria-label="Ends" value={custom.until ? "until" : custom.count ? "count" : "never"} onChange={(e) => setCustom({ ...custom, until: e.target.value === "until" ? dayKey(addDays(start, 90)) : null, count: e.target.value === "count" ? 10 : null })} className="!h-8 !w-auto">
                  <option value="never">never</option><option value="until">on a date</option><option value="count">after a number of times</option>
                </Select>
                {custom.until && <Input type="date" aria-label="Until" value={custom.until} min={day} onChange={(e) => setCustom({ ...custom, until: e.target.value })} className="!h-8 !w-auto" />}
                {custom.count && <Input type="number" aria-label="Times" min={1} max={999} value={custom.count} onChange={(e) => setCustom({ ...custom, count: Math.max(1, Number(e.target.value) || 1) })} className="!h-8 !w-20" />}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Calendar">{(p) => (
            <div className="flex items-center gap-2"><span className="size-3 shrink-0 rounded-full" style={{ background: color ?? cal?.color }} /><Select {...p} value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>{meta.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          )}</Field>
          <Field label="Video call" hint={link ? `${providerName(link.provider)} link` : "Paste a Google Meet, Zoom, Teams or other link"} error={badLink ? "Use a full https:// link" : undefined}>{(p) => (
            <div className="relative"><Video className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" /><Input {...p} value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://meet.google.com/…" className="pl-9" /></div>
          )}</Field>
          <Field label="Where">{(p) => (
            <div className="relative"><MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" /><Input {...p} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Office, address or room" className="pl-9" /></div>
          )}</Field>
          <div className="grid gap-1.5">
            <p className="text-[13px] font-medium">Colour</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" aria-pressed={!color} onClick={() => setColor(null)} className={cx("h-7 rounded-full px-2.5 text-[12px] ring-1 ring-border", !color && "bg-fg text-bg ring-fg")}>Calendar&apos;s</button>
              {CAL_COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cx("grid size-7 place-items-center rounded-full", color === c && "ring-2 ring-fg ring-offset-2 ring-offset-[var(--bg)]")} style={{ background: c }}>{color === c && <Check className="size-3.5 text-white" />}</button>)}
            </div>
          </div>
        </div>

        {/* People */}
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-[13px] font-medium"><Users className="size-4 text-muted" /> Guests</p>
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[12px] border border-border bg-[var(--surface-solid)] px-2 py-1.5">
            {attendees.map((a) => (
              <span key={a.email} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-[12.5px]">
                {a.name || a.email}
                <button type="button" aria-label={`Remove ${a.email}`} onClick={() => setAttendees(attendees.filter((x) => x.email !== a.email))} className="grid size-5 place-items-center rounded-full hover:bg-fg/10"><X className="size-3" /></button>
              </span>
            ))}
            <input aria-label="Add a guest" value={guest} onChange={(e) => setGuest(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); addGuest(guest); } if (e.key === "Backspace" && !guest && attendees.length) setAttendees(attendees.slice(0, -1)); }} onBlur={() => guest && addGuest(guest)} placeholder={attendees.length ? "" : "name@company.com"} className="min-w-[10rem] flex-1 bg-transparent py-1 text-[13.5px] outline-none" style={{ outline: "none" }} />
          </div>
          {attendees.length > 0 && meta.accounts.length > 0 && organising && (
            <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-sky-500/[0.06] px-3 py-2 text-[13px]">
              <Switch label="Email the invite" checked={sendInvite} onChange={setSendInvite} />
              <span>{event ? (changedPeople ? "Email the changes to the guests" : "Email the update to the guests") : "Email a calendar invite"} from</span>
              <Select aria-label="From mailbox" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="!h-8 !w-auto !text-[13px]">{meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.address}</option>)}</Select>
            </div>
          )}
          {attendees.length > 0 && !meta.accounts.length && <p className="text-[12px] text-muted">Connect a mailbox in Mail to email invites.</p>}
        </div>

        {/* Reminders */}
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-[13px] font-medium"><Bell className="size-4 text-muted" /> Remind me {allDay && <span className="font-normal text-muted">(not for all-day events)</span>}</p>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_OPTIONS.map((m) => (
              <button key={m} type="button" aria-pressed={reminders.includes(m)} disabled={allDay} onClick={() => toggleReminder(m)} className={cx("h-8 rounded-full px-3 text-[12.5px] font-medium ring-1 transition-colors disabled:opacity-40", reminders.includes(m) ? "bg-sky-600 text-white ring-sky-600" : "ring-border hover:bg-surface-2")}>{reminderLabel(m)}</button>
            ))}
          </div>
          <p className="text-[12px] text-muted">Reminders show in your notifications with the join link.</p>
        </div>

        <Field label="Notes">{(p) => <Textarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Agenda, links, anything people should know" />}</Field>
        {meetingUrl && !link && !badLink && <p className="flex items-center gap-1.5 text-[12px] text-muted"><Link2 className="size-3.5" /> We don&apos;t recognise this link&apos;s service, but it&apos;ll still show a Join button.</p>}
      </div>
    </Dialog>
  );
}
