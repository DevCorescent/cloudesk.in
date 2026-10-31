"use client";

// What the Notes API sends, and the hooks every Notes screen shares.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useSession } from "@/components/shell/session-context";
import { api } from "@/lib/client/api";
import type { Doc } from "@/lib/notes/blocks";
import { MODULES, type ModuleId } from "@/lib/workspace/modules";

export type Visibility = "private" | "view" | "edit";
export type Attached = { module: string; href: string; label: string } | null;

export type NoteSummary = {
  id: string;
  title: string;
  icon: string;
  color: string;
  folderId: string | null;
  tags: string[];
  pinned: boolean;
  locked: boolean;
  kind: "note" | "daily" | "template";
  day: string | null;
  visibility: Visibility;
  attached: Attached;
  snippet: string;
  words: number;
  remindAt: string | null;
  published: boolean;
  mine: boolean;
  owner: string | null;
  deletedAt: string | null;
  updatedAt: string;
  createdAt: string;
};

export type NoteFull = NoteSummary & {
  content: Doc;
  version: number;
  access: "owner" | "edit" | "view";
  canEdit: boolean;
  owner: { id: string; name: string; email: string } | null;
  shares: { userId: string; role: "view" | "edit"; name: string; email: string }[];
  publicToken: string | null;
  backlinks: { id: string; title: string; icon: string }[];
  links: { id: string; title: string; icon: string }[];
  versions: number;
};

export type Folder = { id: string; parentId: string | null; name: string; color: string; icon: string; module: string | null; sort: number; count: number };
export type Overview = { folders: Folder[]; unfiled: number; tags: { tag: string; n: number }[]; counts: Record<string, number> };
export type View = "all" | "mine" | "shared" | "pinned" | "daily" | "templates" | "reminders" | "trash";

export const NOTES_KEY = ["notes"] as const;

export function useNotesApi() {
  const { org } = useSession();
  const qc = useQueryClient();
  const base = `/api/v1/orgs/${org.id}/notes`;
  const call = useCallback(<T,>(path = "", init?: { method?: string; body?: unknown }) => api<T>(`${base}${path}`, init), [base]);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: [...NOTES_KEY, org.id] }), [qc, org.id]);
  return { base, call, refresh, orgId: org.id, key: (...k: unknown[]) => [...NOTES_KEY, org.id, ...k] };
}

/** Which module a page belongs to ("/crm/deals/…" → crm), for notes saved from it. */
export function moduleOfPath(path: string): { id: string; name: string } | null {
  const m = MODULES.find((x) => x.paths.some((r) => r.test(path)));
  if (m) return { id: m.id, name: m.name };
  const first = path.split("/")[1] ?? "";
  if (first === "projects") return { id: "projects", name: "Web apps" };
  return first ? { id: first.slice(0, 40), name: first[0]!.toUpperCase() + first.slice(1) } : null;
}
export type { ModuleId };

export const when = (iso: string) => {
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)} min ago`;
  if (mins < 60 * 24 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (mins < 60 * 24 * 6) return d.toLocaleDateString("en-IN", { weekday: "short" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};

export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const shiftDay = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
