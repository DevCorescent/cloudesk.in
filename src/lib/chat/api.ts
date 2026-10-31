// What the Chat API returns.
import type { Status } from "./model";

export type PersonOut = { id: string; name: string; email: string; status: Status; note: string; emoji: string; online: boolean; inMeeting: string | null; lastSeenAt: string | null; guest?: boolean };

export type ChannelOut = {
  id: string;
  kind: "channel" | "group" | "dm";
  name: string;
  topic: string;
  description: string;
  visibility: "public" | "private";
  emoji: string;
  color: string;
  posting: "everyone" | "admins";
  ai: boolean;
  archived: boolean;
  /** For DMs and groups: the other people. */
  people: string[];
  memberCount: number;
  member: boolean;
  role: "owner" | "admin" | "member" | null;
  notify: "all" | "mentions" | "none";
  starred: boolean;
  unread: number;
  mentions: number;
  lastMessageAt: string | null;
  lastPreview: string;
  readSeq: number;
  /** Guests (people outside the workspace) in it now. */
  guests: number;
  /** Guests waiting to be let in (only counted for its admins). */
  requests: number;
};

export type MetaOut = {
  me: { id: string; name: string; email: string; status: Status; note: string; emoji: string; until: string | null; admin: boolean };
  channels: ChannelOut[];
  people: PersonOut[];
  /** Guests in your conversations (and former ones), so their names show. */
  guests: PersonOut[];
  /** Saved items with a reminder that's due or upcoming, and unread mentions. */
  counts: { unread: number; mentions: number; saved: number; activity: number; requests: number };
  ai: boolean;
};

export type VoteOut = { choice: string; userId: string; note: string; at: string };

export type MessageOut = {
  id: string;
  seq: number;
  channelId: string;
  parentId: string | null;
  authorId: string | null;
  kind: string;
  body: string;
  data: Record<string, unknown>;
  mentions: { users: string[]; everyone: boolean; records: { kind: string; id: string; label: string; link: string }[] };
  tags: string[];
  priority: "normal" | "important" | "urgent";
  replyCount: number;
  lastReplyAt: string | null;
  replyPeople: string[];
  reactions: { emoji: string; users: string[] }[];
  votes: VoteOut[];
  files: { id: string; filename: string; mime: string; size: number }[];
  editedAt: string | null;
  deleted: boolean;
  pinned: boolean;
  saved: boolean;
  scheduledFor: string | null;
  forwardedFrom: { channel: string; author: string | null } | null;
  createdAt: string;
};

export type PageOut = { messages: MessageOut[]; hasMore: boolean; readSeqs: Record<string, number> };

export type ActivityItem = { kind: "mention" | "reply" | "reaction" | "dm" | "reminder"; message: MessageOut; channel: { id: string; name: string; kind: string }; at: string; unread: boolean };

export type CatchUpOut = { summary: string; decisions: string[]; actions: { text: string; owner: string; due: string }[]; questions: string[]; mood: string; count: number };

// Guests: invites and the people who came through them.
export type InviteOut = { id: string; code: string; url: string; label: string; approval: boolean; history: boolean; files: boolean; maxUses: number | null; uses: number; expiresAt: string | null; revokedAt: string | null; problem: string | null; sent: { via: string; to: string; at: string }[]; createdBy: string | null; createdAt: string };
export type GuestOut = { id: string; userId: string; name: string; contact: string; note: string; status: "pending" | "approved" | "rejected" | "removed" | "left"; reason: string; history: boolean; files: boolean; invite: string | null; device: string; decidedBy: string | null; decidedAt: string | null; lastSeenAt: string | null; createdAt: string };

/** What a guest's page knows: the invite, and (once in) the conversation. */
export type GuestStateOut = {
  invite: { workspace: string; where: string; kind: ChannelOut["kind"]; topic: string; emoji: string; color: string; inviter: string; approval: boolean; problem: string | null; channelId: string };
  guest: { id: string; userId: string; name: string; status: GuestOut["status"]; reason: string; files: boolean; history: boolean } | null;
  channel: ChannelOut | null;
  /** Everyone whose name may appear (former guests included). */
  people: PersonOut[];
  /** Who's in the conversation now. */
  members: string[];
};
