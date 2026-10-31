// Calendar API for a workspace: your calendars, events in a date range,
// create/change/delete (one occurrence or all), answering invites, .ics
// download, meetings from email, and minutes (save and share by email).
// Dispatches on "METHOD section :id sub", like the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { calScope } from "@/server/calendar/access";
import { addFromMail, createEvent, deleteCalendar, deleteEvent, detail, icsFile, meta, range, rsvp, saveCalendar, updateEvent } from "@/server/calendar/core";
import { getNotes, saveNotes, shareNotes, skipNotes } from "@/server/calendar/notes";
import { scanMine } from "@/server/calendar/scan";
import { scope as mailScope } from "@/server/mail/access";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.unknown());
const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/i.test(x);

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (isId(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await calScope(ctx, orgId);
  // Sending (invites, replies, minutes) goes through Mail, as you.
  const mail = async () => (s.has("mail") ? mailScope(ctx, orgId).catch(() => null) : null);

  switch (key) {
    case "GET meta":
      return meta(s);
    case "POST calendars":
      return saveCalendar(s, null, await body(ctx));
    case "PATCH calendars :id":
      return saveCalendar(s, id!, await body(ctx));
    case "DELETE calendars :id":
      await deleteCalendar(s, id!);
      return { ok: true };

    case "GET events":
      return range(s, qs);
    case "POST events":
      await rateLimit(`cal-write:${s.userId}`, 600, 60 * 60_000);
      return createEvent(s, await body(ctx), await mail());
    case "GET events :id":
      return detail(s, id!);
    case "PATCH events :id":
      await rateLimit(`cal-write:${s.userId}`, 600, 60 * 60_000);
      return updateEvent(s, id!, await body(ctx), await mail());
    case "DELETE events :id":
      return deleteEvent(s, id!, qs, await mail());
    case "POST events :id rsvp":
      await rateLimit(`cal-send:${s.userId}`, 200, 60 * 60_000);
      return rsvp(s, id!, await body(ctx), await mail());
    case "GET events :id ics":
      return icsFile(s, id!);
    case "POST meetings scan":
      await rateLimit(`cal-scan:${s.userId}`, 20, 60 * 60_000);
      return scanMine(orgId, s.userId);
    case "POST events from-mail":
      return addFromMail(s, await body(ctx), await mail());

    case "GET notes":
      return getNotes(s, qs);
    case "PUT notes":
      return saveNotes(s, await body(ctx));
    case "POST notes skip":
      return skipNotes(s, await body(ctx));
    case "POST notes share":
      await rateLimit(`cal-send:${s.userId}`, 200, 60 * 60_000);
      return shareNotes(s, await body(ctx), await mail());
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const PATCH = route<P>(handle);
export const DELETE = route<P>(handle);
