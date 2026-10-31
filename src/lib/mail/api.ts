// The Mail API's shapes, shared by the server and the inbox UI.
// Base path: /api/v1/orgs/:orgId/mail/…  (see src/app/api/v1/orgs/[orgId]/mail)
import type { AutoReply, Category, ProviderId, View } from "./model";
import type { DesignId, SignatureFields } from "./signature";

export type Person = { name: string; address: string };

export type AccountOut = {
  id: string;
  name: string;
  address: string;
  displayName: string;
  provider: ProviderId;
  auth: "password" | "oauth_google" | "oauth_microsoft";
  shared: boolean;
  members: string[];
  ownerId: string;
  mine: boolean;
  color: string;
  signature: string;
  status: "connecting" | "active" | "error" | "paused";
  lastError: string;
  lastSyncAt: string | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  settings: { syncDays: number; sendDelaySec: number; aiTriage: boolean; slaHours: number | null; autoAddMeetings: boolean; autoReply: (AutoReply & { enabledAt?: string }) | null };
};

export type Counts = { inbox: number; unread: number; categories: Partial<Record<Category, number>>; snoozed: number; waiting: number; followups: number; scheduled: number; assigned: number; drafts: number; needsReply: number; overdue: number; muted: number; meetings: number };

/** GET meta */
/** Something an email was turned into, or that's attached to it (GET threads/:id/connections). id: the link (null when it's connected another way, e.g. a note attached to the email). */
export type ConnectionOut = { id: string | null; kind: "note" | "event" | "task" | "chat"; targetId: string; title: string; sub: string; href: string; at: string; by: string | null };
/** What an email can be turned into here (GET link-targets). null: not available to you. */
export type LinkTargetsOut = { calendars: { id: string; name: string; color: string; isDefault: boolean }[] | null; projects: { id: string; name: string; code: string }[] | null; chat: boolean; ai: boolean };

/** A recurring email (GET schedules, schedules/:id). */
export type ScheduleOut = {
  id: string;
  name: string;
  status: "active" | "paused" | "ended";
  statusNote: string;
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  groupIds: string[];
  separately: boolean;
  subject: string;
  body: string;
  /** undefined: the mailbox's default signature; null: none. */
  signatureId?: string | null;
  startDate: string;
  times: string[];
  tz: string;
  repeat: { freq: "daily" | "weekly" | "monthly" | "yearly"; interval: number; byDay: number[]; until: string | null; count: number | null };
  skipDates: string[];
  limit: number | null;
  thread: "new" | "same";
  stopOnReply: boolean;
  missed: "send" | "skip";
  notifyEach: boolean;
  meeting: { title: string; at: string | null; durationMin: number; link: string; makeLink: boolean; addToCalendar: boolean; calendarId: string | null; invite: boolean; details: boolean; reminders: number[] } | null;
  eventId: string | null;
  files: { id: string; filename: string; size: number }[];
  nextRunAt: string | null;
  lastRunAt: string | null;
  sentCount: number;
  describe: string;
  /** The next sends (up to 10). */
  upcoming: string[];
  mine: boolean;
  createdAt: string;
};
export type ScheduleRunOut = { id: string; plannedFor: string; status: "pending" | "sent" | "skipped" | "failed"; note: string; n: number | null; manual: boolean; messageId: string | null; threadId: string | null; recipients: number; at: string };

export type MetaOut = {
  me: { id: string; name: string; email: string; manage: boolean };
  accounts: AccountOut[];
  /** Keyed by account id, plus "all" for the unified inbox. */
  counts: Record<string, Counts>;
  labels: string[];
  aiAvailable: boolean;
  oauth: { google: boolean; microsoft: boolean };
  members: { id: string; name: string; email: string }[];
  links: { crm: boolean; helpdesk: boolean };
};

/** GET detect?email= */
export type DetectOut = { provider: ProviderId; via: "domain" | "mx" | "guess"; mx: string[] };

/** POST accounts/check and the body of POST accounts (plus name, color, shared, members, syncDays). */
export type ConnectIn = {
  provider: ProviderId;
  address: string;
  displayName?: string;
  username?: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
};
/** What went wrong with a connection, so the wizard can say what to try without re-reading the message. */
export type FailKind = "auth" | "dns" | "network" | "tls" | "disabled" | "other";
export type CheckOut = { imap: { ok: boolean; error?: string; kind?: FailKind; folders?: string[] }; smtp: { ok: boolean; error?: string; kind?: FailKind } };

/** GET threads?account=all|<id>&view=<View>&category=&q=&label=&cursor= */
export type ThreadRow = {
  id: string;
  accountId: string;
  subject: string;
  snippet: string;
  participants: Person[];
  lastMessageAt: string;
  messageCount: number;
  unread: number;
  lastDirection: "in" | "out";
  category: Category;
  priority: "high" | "normal" | "low";
  status: "inbox" | "archived" | "trash" | "spam";
  snoozeUntil: string | null;
  starred: boolean;
  pinned: boolean;
  labels: string[];
  assigneeId: string | null;
  followUpAt: string | null;
  hasAttachments: boolean;
  warnings: string[];
  muted: boolean;
  /** When the oldest unanswered message arrived; null when it's answered. */
  awaitingSince: string | null;
  /** A meeting found in the conversation: when, and its calendar event once added. */
  meetingAt: string | null;
  meetingEventId: string | null;
};
export type ThreadsOut = { threads: ThreadRow[]; next: string | null };

export type AttachmentOut = { id: string; filename: string; mime: string; size: number; inline: boolean; stored: boolean };
export type MessageOut = {
  id: string;
  from: Person;
  to: Person[];
  cc: Person[];
  replyTo: string;
  subject: string;
  date: string;
  text: string;
  /** Present when the email has HTML; render it in a sandboxed frame (GET messages/:id/html). */
  hasHtml: boolean;
  direction: "in" | "out";
  sendStatus: null | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  sendAt: string | null;
  sendError: string;
  attachments: AttachmentOut[];
  messageId: string;
  unsubscribe: { mailto?: string; url?: string; oneClick: boolean } | null;
  /** An automatic reply (out of office). */
  auto: boolean;
  /** A meeting found in it (calendar invite, or a video link and a time from the text). */
  meeting: MessageMeeting | null;
  /** Sent to these address-book groups (they became their members when it went). */
  groups: { id: string; name: string; color: string }[];
};

/** GET threads/:id */
export type ThreadOut = {
  thread: ThreadRow & { reasons: string[]; aiSummary: string | null; contactId: string | null; dealId: string | null; ticketId: string | null };
  messages: MessageOut[];
  notes: { id: string; body: string; by: string | null; at: string }[];
  /** The CRM contact behind the main correspondent, if any. */
  contact: { id: string; name: string; email: string; company: string | null; deals: { id: string; title: string; value: number; status: string }[] } | null;
  sender: { address: string; verdict: "allowed" | "blocked" | "vip" | null };
};

/** PATCH threads/:id — any of these. */
export type ThreadPatch = Partial<{ status: ThreadRow["status"]; starred: boolean; pinned: boolean; labels: string[]; category: Category; snoozeUntil: string | null; followUpAt: string | null; assigneeId: string | null; read: boolean; muted: boolean }>;

/** POST threads/bulk */
export type BulkIn = { ids: string[]; action: "archive" | "inbox" | "trash" | "spam" | "read" | "unread" | "star" | "unstar" | "label" | "unlabel" | "category" | "snooze"; value?: string };

/** POST send */
export type SendIn = {
  accountId: string;
  threadId?: string;
  /** Our message id being replied to / forwarded. */
  replyTo?: string;
  mode?: "new" | "reply" | "replyAll" | "forward";
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** ISO time to send later; otherwise sent after the account's undo delay. */
  sendAt?: string;
  /** Remind me if nobody replies by then. */
  followUpAt?: string;
  attachments?: { filename: string; mime: string; data: string }[];
  /** Attachments of an earlier message to forward. */
  forwardAttachments?: string[];
  templateId?: string;
  /** One of your signatures, null for none; left out: your default for this mailbox. */
  signatureId?: string | null;
  /** Address-book groups: their members are added to To. */
  groupIds?: string[];
  /** One email per To recipient (no one sees the others; {{first_name}} is theirs). */
  separately?: boolean;
};
export type SendOut = { message: { id: string; threadId: string; sendStatus: string; sendAt: string }; count?: number };

/** POST threads/:id/ai */
export type AiIn = { kind: "summary" | "reply" | "actions"; tone?: "friendly" | "formal" | "short"; instruction?: string };
export type AiOut = { summary?: string; draft?: string; actions?: { kind: "task" | "date" | "amount" | "question"; text: string }[]; provider: "ai" };

export type RuleOut = { id: string; name: string; accountId: string | null; match: "all" | "any"; conditions: { field: string; op: string; value: string }[]; actions: { type: string; value: string }[]; enabled: boolean; hits: number };
export type TemplateOut = { id: string; name: string; subject: string; body: string; shortcut: string; shared: boolean; mine: boolean; uses: number };

export type { Category, View };

/** GET analytics?days=&account=&tz= — every figure is counted from the stored mail; nothing is estimated. */
export type MailStats = {
  range: { days: number; from: string; to: string; tz: string };
  totals: { received: number; sent: number; conversations: number; replied: number; owed: number; replyRate: number | null; medianReplyMin: number | null; p90ReplyMin: number | null; withinSla: number | null; needsReply: number; overdue: number; autoReplies: number };
  prev: { received: number; sent: number; medianReplyMin: number | null; replyRate: number | null };
  daily: { day: string; received: number; sent: number }[];
  /** Received mail by weekday (0 = Monday) and hour, in the viewer's time zone. */
  hours: number[][];
  replyBuckets: { label: string; n: number }[];
  categories: { category: Category; n: number }[];
  senders: { address: string; name: string; n: number }[];
  domains: { domain: string; n: number }[];
  mailboxes: { id: string; name: string; color: string; received: number; sent: number; medianReplyMin: number | null; withinSla: number | null; slaHours: number | null; needsReply: number; overdue: number }[];
  people: { id: string | null; name: string; replies: number; medianReplyMin: number | null }[];
  oldestWaiting: { id: string; subject: string; from: string; since: string; waitingMin: number; accountId: string; overdue: boolean }[];
};

/** GET senders/top — who fills the inbox, for the clean-up tool. */
export type SenderRow = { address: string; name: string; messages: number; unread: number; inInbox: number; last: string; list: boolean; verdict: "allowed" | "blocked" | "vip" | null };
export type SendersOut = { senders: SenderRow[] };
/** POST senders/cleanup */
export type CleanupIn = { address: string; account?: string; action: "archive" | "trash" | "read" | "block" | "unsubscribe" };

/** GET messages/:id/details */
export type MessageDetails = {
  messageId: string;
  inReplyTo: string;
  references: string[];
  folder: string | null;
  sizeBytes: number;
  date: string;
  replyTo: string;
  auth: { spf: string | null; dkim: string | null; dmarc: string | null; raw: string };
  listUnsubscribe: string;
  auto: boolean;
};

/** GET signatures — your signatures, and which one each mailbox uses for new mail and for replies. */
export type SignatureOut = { id: string; name: string; design: DesignId; fields: SignatureFields; updatedAt: string };
export type SignaturesOut = { signatures: SignatureOut[]; defaults: Record<string, { newId: string | null; replyId: string | null }> };

export type MessageMeeting = {
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
  cancelled: boolean;
  /** Has an organiser to answer (a real invite). */
  rsvp: boolean;
};

/** The address book. */
export type GroupOut = { id: string; name: string; color: string; description: string; count: number };
export type ContactOut = { id: string; name: string; email: string; company: string; title: string; phone: string; notes: string; tags: string[]; favorite: boolean; groupIds: string[]; lastEmailedAt: string | null; emailCount: number };
export type ContactsOut = { contacts: ContactOut[]; groups: GroupOut[]; total: number };
/** GET suggest?q= — who to send to. */
export type Suggestion = { kind: "person" | "group"; id: string | null; name: string; email: string; company?: string; color?: string; count?: number; source: "Group" | "Favourite" | "Contacts" | "Emailed" | "CRM" | "Team" };
