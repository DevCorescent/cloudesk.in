// Shapes of the Calendar API (/api/v1/orgs/:orgId/calendar/…).
import type { Notes } from "./model";
import type { Repeat } from "./recur";

export type Person = { name: string; email: string; response?: string };
export type CalendarOut = { id: string; name: string; color: string; isDefault: boolean };

/** One occurrence of an event in a date range (repeating events appear once per occurrence). */
export type OccurrenceOut = {
  key: string;
  id: string;
  occurrence: string;
  start: string;
  end: string;
  title: string;
  calendarId: string;
  color: string;
  allDay: boolean;
  meetingUrl: string;
  provider: string | null;
  location: string;
  recurring: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  response: "accepted" | "tentative" | "declined" | null;
  organizer: Person | null;
  attendees: number;
  source: "manual" | "mail";
  mailThreadId: string | null;
  /** Minutes: none yet, a draft, or shared. */
  notes: "none" | "draft" | "shared";
};
export type RangeOut = { events: OccurrenceOut[] };

export type EventOut = {
  id: string;
  calendarId: string;
  uid: string;
  title: string;
  description: string;
  location: string;
  meetingUrl: string;
  provider: string | null;
  start: string;
  end: string;
  allDay: boolean;
  tz: string;
  repeat: Repeat | null;
  attendees: Person[];
  organizer: Person | null;
  reminders: number[];
  color: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  response: "accepted" | "tentative" | "declined" | null;
  source: "manual" | "mail";
  mailAccountId: string | null;
  mailThreadId: string | null;
  /** Are we the organiser (so changes can be sent to the attendees)? */
  organising: boolean;
  notes: { occurrence: string; sharedAt: string | null }[];
};

/** A meeting found in an email that isn't in your calendar yet. */
export type MeetingInvite = {
  messageId: string;
  threadId: string;
  accountId: string;
  subject: string;
  from: { name: string; address: string };
  receivedAt: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  url: string;
  provider: string | null;
  location: string;
  source: "ics" | "text";
  confidence: "high" | "medium" | "low";
  organizer: { name: string; address: string } | null;
  attendees: { name: string; address: string }[];
};

export type CalMetaOut = {
  me: { name: string; email: string };
  calendars: CalendarOut[];
  /** Mailboxes you can send from (invites, replies, minutes). */
  accounts: { id: string; name: string; address: string; color: string }[];
  invites: MeetingInvite[];
  notesDue: { eventId: string; occurrence: string; title: string; end: string }[];
  mail: boolean;
};

export type NotesOut = {
  id: string | null;
  eventId: string;
  occurrence: string;
  fields: Notes;
  sharedAt: string | null;
  sharedTo: string[];
  event: { title: string; start: string; end: string; tz: string; allDay: boolean; organizer: Person | null; attendees: Person[]; meetingUrl: string; location: string; mailAccountId: string | null; mailThreadId: string | null };
};
