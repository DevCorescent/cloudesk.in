"use client";

// What the drive and the editor share: types, the API, file icons, and the
// Share and Move dialogs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, ChevronRight, Copy, FileArchive, FileImage, FileSpreadsheet, FileText, FileType2, Folder, FolderLock, Globe, Link2, Loader2, Lock, Presentation, Search, Users, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Select, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { FOLDER_SWATCH, KIND_LABEL, SHARE_ROLE_LABEL, SHARE_ROLES, kindOf } from "@/lib/documents/write";

export type Role = "view" | "comment" | "edit";
export type DriveFile = {
  id: string;
  kind: "doc" | "file";
  title: string;
  icon: string;
  folderId: string | null;
  access: string;
  status: string;
  tags: string[];
  expiresOn: string | null;
  linkType: string | null;
  linkId: string | null;
  filename: string;
  mime: string;
  size: number;
  version: number;
  words: number;
  snippet: string;
  createdBy: string | null;
  owner: string;
  lastEditedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  starred: boolean;
  shared: boolean;
  linkShared: boolean;
  role: Role;
  mine: boolean;
};
export type DriveFolder = { id: string; name: string; parentId: string | null; color: string; access: string; memberIds: string[]; createdBy: string | null; owner: string; createdAt: string; deletedAt: string | null; items: number; starred: boolean; shared: boolean; role: Role; mine: boolean };
export type TreeFolder = { id: string; name: string; parentId: string | null; color: string; access: string; root: "mine" | "team" | "shared"; role: Role };
export type Listing = { section: string; folder: DriveFolder | null; path: { root: "mine" | "team" | "shared"; crumbs: { id: string; name: string }[] }; folders: DriveFolder[]; files: DriveFile[] };
export type Person = { id: string; name: string; email: string };

export function useDocsBase() {
  const { org } = useSession();
  return `/api/v1/orgs/${org.id}/documents`;
}

/** Refreshes everything the drive shows after a change. */
export function useDriveRefresh() {
  const qc = useQueryClient();
  const { org } = useSession();
  return () => {
    void qc.invalidateQueries({ queryKey: ["drive", org.id] });
    void qc.invalidateQueries({ queryKey: ["documents", org.id] });
  };
}

/** Starts a download from one of the API's file URLs. */
export function downloadUrl(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const hrefOf = (f: Pick<DriveFile, "id" | "kind">) => (f.kind === "doc" ? `/documents/d/${f.id}` : `/documents/file/${f.id}`);

const KIND_ICON: Record<ReturnType<typeof kindOf>, [ReactNode, string]> = {
  doc: [<FileText key="d" />, "#2a86d1"],
  word: [<FileType2 key="w" />, "#2b579a"],
  pdf: [<FileText key="p" />, "#e5484d"],
  image: [<FileImage key="i" />, "#1f9d6c"],
  sheet: [<FileSpreadsheet key="s" />, "#1f9d6c"],
  slides: [<Presentation key="sl" />, "#e8743b"],
  text: [<FileText key="t" />, "#64748b"],
  archive: [<FileArchive key="a" />, "#c9871a"],
  other: [<FileText key="o" />, "#8e8e93"],
};

/** A file's icon: its emoji if it has one, otherwise its kind, tinted. */
export function FileGlyph({ f, size = 32, className }: { f: Pick<DriveFile, "kind" | "mime" | "filename" | "icon">; size?: number; className?: string }) {
  const k = kindOf(f);
  const [icon, color] = KIND_ICON[k];
  return (
    <span className={clsx("grid shrink-0 place-items-center rounded-[9px]", className)} style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 13%, transparent)`, color }} title={KIND_LABEL[k]}>
      {f.icon ? <span style={{ fontSize: size * 0.55 }}>{f.icon}</span> : <span className="[&_svg]:size-[55%]">{icon}</span>}
    </span>
  );
}

export function FolderGlyph({ f, size = 32 }: { f: Pick<DriveFolder, "color" | "access">; size?: number }) {
  const c = FOLDER_SWATCH[f.color] ?? FOLDER_SWATCH[""];
  return (
    <span className="grid shrink-0 place-items-center rounded-[9px]" style={{ width: size, height: size, background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }}>
      {f.access === "private" || f.access === "members" || f.access === "managers" ? <FolderLock className="size-[55%]" /> : <Folder className="size-[55%]" fill="currentColor" fillOpacity={0.25} />}
    </span>
  );
}

export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 6) return new Date(iso).toLocaleDateString("en-IN", { weekday: "short" });
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

// ── Share ───────────────────────────────────────────────────────────────────

type SharesOut = { people: { userId: string; role: Role; name: string; email: string }[]; link: { url: string; role: string; expiresAt: string | null } | null; ownerId: string | null; team: Person[] };

export function ShareDialog({ target, onClose }: { target: { fileId?: string; folderId?: string; title: string; isDoc?: boolean }; onClose: () => void }) {
  const base = useDocsBase();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const { user } = useSession();
  const qs = target.fileId ? `fileId=${target.fileId}` : `folderId=${target.folderId}`;
  const q = useQuery({ queryKey: ["drive", "shares", qs], queryFn: () => api<SharesOut>(`${base}/shares?${qs}`) });
  const [people, setPeople] = useState<{ userId: string; role: Role }[] | null>(null);
  const [find, setFind] = useState("");
  const [role, setRole] = useState<Role>("edit");
  const [message, setMessage] = useState("");
  const list = useMemo(() => people ?? q.data?.people.map((p) => ({ userId: p.userId, role: p.role })) ?? [], [people, q.data]);
  const team = useMemo(() => q.data?.team ?? [], [q.data]);
  const name = (id: string) => team.find((p) => p.id === id);
  const candidates = useMemo(() => {
    const t = find.trim().toLowerCase();
    if (!t) return [];
    return team.filter((p) => p.id !== q.data?.ownerId && !list.some((x) => x.userId === p.id) && (p.name.toLowerCase().includes(t) || p.email.toLowerCase().includes(t))).slice(0, 6);
  }, [find, team, list, q.data?.ownerId]);
  const save = useMutation({
    mutationFn: () => api(`${base}/shares`, { method: "PUT", body: { ...(target.fileId ? { fileId: target.fileId } : { folderId: target.folderId }), people: list, message } }),
    onSuccess: () => {
      toast({ tone: "success", title: "Sharing updated" });
      refresh();
      onClose();
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't share", description: errorMessage(e) }),
  });
  const link = useMutation({
    mutationFn: (on: boolean) => api<{ link: SharesOut["link"] }>(`${base}/files/${target.fileId}/link`, { method: "PUT", body: { on } }),
    onSuccess: () => {
      void q.refetch();
      refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't change the link", description: errorMessage(e) }),
  });
  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url).catch(() => {});
    toast({ tone: "success", title: "Link copied" });
  };
  const owner = q.data?.ownerId ? name(q.data.ownerId) : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Share “${target.title}”`}
      description={target.folderId ? "Everyone you add can open everything in this folder." : "People in your workspace you add here can open it, even if they can't open its folder."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={!q.data}>
            Save
          </Button>
        </>
      }
    >
      {!q.data ? (
        <div className="grid h-32 place-items-center text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="relative">
            <div className="flex items-center gap-2 rounded-[12px] border border-border bg-bg px-3 focus-within:border-fg/30">
              <Search className="size-4 text-muted" aria-hidden />
              <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Add people by name or email" aria-label="Add people" className="h-10 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="What they can do" className="!h-8 !w-auto !border-0 !bg-transparent !pr-7 text-[12.5px]">
                {SHARE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {SHARE_ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </div>
            {candidates.length > 0 && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-[12px] border border-border bg-[var(--surface-solid)] p-1 shadow-lg">
                {candidates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPeople([...list, { userId: p.id, role }]);
                      setFind("");
                    }}
                    className="flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left hover:bg-fg/[0.05]"
                  >
                    <Avatar name={p.name} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{p.name}</span>
                      <span className="block truncate text-[11.5px] text-muted">{p.email}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">People with access</p>
            <ul className="grid gap-0.5">
              {owner && (
                <li className="flex items-center gap-2.5 py-1.5">
                  <Avatar name={owner.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {owner.name}
                      {owner.id === user.id && " (you)"}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted">{owner.email}</span>
                  </span>
                  <span className="text-[12px] text-muted">Owner</span>
                </li>
              )}
              {list.map((p) => {
                const who = name(p.userId);
                return (
                  <li key={p.userId} className="flex items-center gap-2.5 py-1.5">
                    <Avatar name={who?.name ?? "?"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{who?.name ?? "Someone"}</span>
                      <span className="block truncate text-[11.5px] text-muted">{who?.email}</span>
                    </span>
                    <Select value={p.role} onChange={(e) => setPeople(list.map((x) => (x.userId === p.userId ? { ...x, role: e.target.value as Role } : x)))} aria-label={`What ${who?.name} can do`} className="!h-8 !w-auto text-[12.5px]">
                      {SHARE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {SHARE_ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                    <button type="button" aria-label={`Remove ${who?.name}`} onClick={() => setPeople(list.filter((x) => x.userId !== p.userId))} className="grid size-8 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg">
                      <X className="size-4" />
                    </button>
                  </li>
                );
              })}
              {!list.length && <li className="py-1.5 text-[12.5px] text-muted">{target.folderId ? "Only people who can open the folder by its rules." : "Nobody else has been added."}</li>}
            </ul>
          </div>
          {list.length > (q.data.people.length ?? 0) && <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a message (optional)" aria-label="Message" className="h-10 rounded-[12px] border border-border bg-bg px-3 text-[13.5px] outline-none focus:border-fg/30" />}
          {target.fileId && (
            <div className="rounded-[14px] border border-border p-3">
              <div className="flex items-center gap-3">
                <span className={clsx("grid size-9 shrink-0 place-items-center rounded-full", q.data.link ? "bg-success-soft text-success" : "bg-fg/[0.06] text-muted")}>{q.data.link ? <Globe className="size-4" /> : <Lock className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{q.data.link ? "Anyone with the link can view" : "Only people with access"}</p>
                  <p className="text-[11.5px] text-muted">{q.data.link ? "Read-only, without signing in. Turn it off to stop the link working." : "Turn on a link to share it outside your workspace."}</p>
                </div>
                <Switch checked={!!q.data.link} onChange={(v) => link.mutate(v)} label="Link sharing" disabled={link.isPending} />
              </div>
              {q.data.link && (
                <div className="mt-3 flex items-center gap-2">
                  <input readOnly value={q.data.link.url} aria-label="Share link" className="h-9 min-w-0 flex-1 rounded-[10px] border border-border bg-bg px-3 text-[12.5px] text-muted" onFocus={(e) => e.currentTarget.select()} />
                  <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(q.data!.link!.url)}>
                    Copy
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function Avatar({ name, size = 30, color }: { name: string; size?: number; color?: string }) {
  const initials = name
    .split(/\s+/)
    .map((x) => x[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="grid shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ width: size, height: size, background: color ?? `hsl(${hue} 55% 52%)`, fontSize: size * 0.38 }} aria-hidden>
      {initials || "?"}
    </span>
  );
}

// ── Move ────────────────────────────────────────────────────────────────────

/** Pick a folder (or the top of My documents / Team) to move or copy things to. */
export function MoveDialog({ title, exclude = [], current, onPick, onClose, action = "Move here" }: { title: string; exclude?: string[]; current?: string | null; onPick: (to: { folderId: string | null; root: "mine" | "team" }) => void; onClose: () => void; action?: string }) {
  const base = useDocsBase();
  const { org } = useSession();
  const q = useQuery({ queryKey: ["drive", org.id, "tree"], queryFn: () => api<{ folders: TreeFolder[] }>(`${base}/tree`) });
  const [at, setAt] = useState<{ folderId: string | null; root: "mine" | "team" }>({ folderId: null, root: "mine" });
  const folders = (q.data?.folders ?? []).filter((f) => f.role === "edit");
  const blocked = new Set(exclude);
  // Hide excluded folders and everything inside them (a folder can't go inside itself).
  const hidden = (f: TreeFolder): boolean => blocked.has(f.id) || (!!f.parentId && !!folders.find((x) => x.id === f.parentId) && hidden(folders.find((x) => x.id === f.parentId)!));
  const kids = (parent: string | null, root: string) => folders.filter((f) => f.parentId === parent && (parent || f.root === root) && !hidden(f));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const row = (f: TreeFolder, depth: number): ReactNode => {
    const sub = kids(f.id, f.root);
    const on = at.folderId === f.id;
    return (
      <div key={f.id}>
        <button type="button" onClick={() => setAt({ folderId: f.id, root: f.root === "mine" ? "mine" : "team" })} onDoubleClick={() => setOpen((o) => new Set(o.has(f.id) ? [...o].filter((x) => x !== f.id) : [...o, f.id]))} className={clsx("flex w-full items-center gap-2 rounded-[9px] py-1.5 pr-2 text-left text-[13px]", on ? "bg-fg text-bg" : "hover:bg-fg/[0.05]", f.id === current && "opacity-50")} style={{ paddingLeft: 8 + depth * 18 }}>
          <span
            role="button"
            tabIndex={-1}
            aria-label={open.has(f.id) ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => new Set(o.has(f.id) ? [...o].filter((x) => x !== f.id) : [...o, f.id]));
            }}
            className={clsx("grid size-4 place-items-center", !sub.length && "invisible")}
          >
            <ChevronRight className={clsx("size-3.5 transition-transform", open.has(f.id) && "rotate-90")} />
          </span>
          <FolderGlyph f={f} size={20} />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {on && <Check className="size-3.5" />}
        </button>
        {open.has(f.id) && sub.map((x) => row(x, depth + 1))}
      </div>
    );
  };
  const rootRow = (root: "mine" | "team", label: string, icon: ReactNode) => (
    <div key={root}>
      <button type="button" onClick={() => setAt({ folderId: null, root })} className={clsx("flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[13px] font-medium", at.folderId === null && at.root === root ? "bg-fg text-bg" : "hover:bg-fg/[0.05]")}>
        <span className="grid size-5 place-items-center [&_svg]:size-4">{icon}</span>
        {label}
      </button>
      {kids(null, root).map((f) => row(f, 1))}
    </div>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onPick(at)}>
            {action}
          </Button>
        </>
      }
    >
      <div className="max-h-[50vh] overflow-y-auto rounded-[12px] border border-border p-1">
        {!q.data ? (
          <div className="grid h-24 place-items-center text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            {rootRow("mine", "My documents", <Lock />)}
            {rootRow("team", "Team", <Users />)}
          </>
        )}
      </div>
      <p className="mt-2 text-[12px] text-muted">
        <Link2 className="mr-1 inline size-3" />
        Things in My documents are private to you until you share them. Team folders follow their own rules.
      </p>
    </Dialog>
  );
}
