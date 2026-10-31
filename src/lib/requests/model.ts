// Feature requests: what a workspace asks the Cloudesk team for, where it is,
// and how a finished feature is given out (to everyone, or to chosen
// workspaces, through a release flag).
import { z } from "zod";

export const REQUEST_STATUSES = ["submitted", "under_review", "planned", "in_progress", "testing", "released", "declined", "duplicate"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const STATUS_INFO: Record<RequestStatus, { label: string; what: string; tone: string; open: boolean }> = {
  submitted: { label: "Submitted", what: "Received — the Cloudesk team will look at it soon", tone: "neutral", open: true },
  under_review: { label: "Under review", what: "The team is looking at what it would take", tone: "info", open: true },
  planned: { label: "Planned", what: "Accepted and scheduled", tone: "info", open: true },
  in_progress: { label: "In progress", what: "Being built", tone: "warning", open: true },
  testing: { label: "Testing", what: "Built and being checked before it's released", tone: "warning", open: true },
  released: { label: "Released", what: "Live — find it in your workspace", tone: "success", open: false },
  declined: { label: "Not planned", what: "Not something Cloudesk will build — see the team's note", tone: "danger", open: false },
  duplicate: { label: "Merged", what: "The same as another request, which carries it forward", tone: "neutral", open: false },
};
/** The path a request takes (for the progress bar). */
export const PIPELINE: RequestStatus[] = ["submitted", "under_review", "planned", "in_progress", "testing", "released"];

export const PRIORITIES = ["nice", "important", "critical"] as const;
export const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = { nice: "Nice to have", important: "Important", critical: "Blocking our work" };
export const SCOPES = ["workspace", "everyone"] as const;
export const SCOPE_LABEL: Record<(typeof SCOPES)[number], { label: string; what: string }> = {
  workspace: { label: "For our workspace", what: "Something specific to how we work — it can be switched on just for us" },
  everyone: { label: "For everyone", what: "Useful to any business on Cloudesk" },
};

export const requestSchema = z.object({
  title: z.string().trim().min(6, "Give it a short title (a few words)").max(140),
  problem: z.string().trim().min(10, "Say what you're trying to do, or what's hard today").max(4000),
  details: z.string().trim().max(8000).default(""),
  area: z.string().regex(/^[a-z0-9-]{2,30}$/).default("new"),
  priority: z.enum(PRIORITIES).default("important"),
  scope: z.enum(SCOPES).default("everyone"),
});
export const commentSchema = z.object({ body: z.string().trim().min(1, "Write something").max(4000) });

export const adminUpdateSchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  reply: z.string().trim().max(4000).optional(),
  eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  public: z.boolean().optional(),
  duplicateOf: z.uuid().nullable().optional(),
  /** A note only the team sees, or a message to the workspace. */
  note: z.string().trim().max(4000).optional(),
  internal: z.boolean().default(false),
});

export const releaseSchema = z.object({
  flagKey: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,60}$/, "Use lower-case letters, digits, . _ -"),
  mode: z.enum(["everyone", "workspaces"]),
  orgIds: z.array(z.uuid()).max(1000).default([]),
  notes: z.string().trim().max(4000).default(""),
  /** Tell everyone in the workspaces that get it (not just the person who asked). */
  announce: z.boolean().default(true),
});

/** A release flag key from the request: "fr-42-bulk-invoice-export". */
export const suggestKey = (n: number, title: string) => `fr-${n}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`.replace(/-+$/, "");

export type RequestOut = {
  id: string;
  number: number;
  title: string;
  problem: string;
  details: string;
  area: string;
  priority: (typeof PRIORITIES)[number];
  scope: (typeof SCOPES)[number];
  status: RequestStatus;
  reply: string;
  eta: string | null;
  public: boolean;
  votes: number;
  voted: boolean;
  mine: boolean;
  ours: boolean;
  by: string | null;
  duplicateOf: { id: string; number: number; title: string } | null;
  released: { at: string; notes: string; forUs: boolean } | null;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
};
export type NoteOut = { id: string; kind: string; body: string; fromTeam: boolean; internal: boolean; by: string | null; meta: Record<string, unknown>; at: string };

export type AdminRequestOut = RequestOut & {
  org: { id: string; name: string; plan: string | null };
  requester: { id: string; name: string; email: string } | null;
  flagKey: string | null;
  release: { mode: "everyone" | "workspaces"; orgIds: string[]; notes: string; by: string; at: string } | null;
  flag: { enabled: boolean; orgIds: string[] } | null;
  internalCount: number;
};
