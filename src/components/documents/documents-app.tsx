"use client";

// Documents & e-sign: home (renewals, notice dates, obligations, expiring
// files, signatures in progress), the library (folders with access, files
// with versions), contracts (register, approval, obligations, termination),
// signature requests (signers, the trail, the certificate) and settings.
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Download, PenLine, Plus, Trash2, Upload, X, Eye, FileCog, QrCode, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DocsShell, DriveHome, DriveView, type DocsMeta } from "./drive/drive-app";
import { DocEditorPage } from "./editor/doc-editor";
import { StudioPage } from "./studio";
import type { DriveFile } from "./drive/shared";
import { ConvertDialog } from "./viewer/convert-dialog";
import { FileViewer } from "./viewer/file-viewer";
import { PdfTools } from "./viewer/pdf-tools";
import { PdfView } from "./viewer/pdf-view";
import { QrDialog } from "./viewer/qr-dialog";
import { familyOf, targetsFor } from "@/lib/documents/formats";
import { Section, Stat } from "@/components/crm/shared";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { CONTRACT_KINDS, CONTRACT_KIND_LABEL, CONTRACT_STATUS_LABEL, FILE_STATUSES, FOLDER_ACCESS, LINK_LABEL, LINK_TYPES, size, type DocSettings } from "@/lib/documents/model";
import { target } from "@/lib/import/targets";
import { formatPrice } from "@/lib/store/money";

type Meta = { me: { id: string; write: boolean; manage: boolean }; settings: DocSettings; people: { id: string; name: string; email: string }[]; links: Record<string, boolean> };
type FolderRow = { id: string; name: string; parentId: string | null; access: (typeof FOLDER_ACCESS)[number]; memberIds: string[]; files: number };
type FileRow = { id: string; title: string; folderId: string | null; access?: string; tags: string[]; status: string; expiresOn: string | null; linkType: string | null; linkId: string | null; notes: string; version: number; filename: string; mime: string; size: number; link: { name: string; href: string } | null; expired: boolean; updatedAt: string };
type Obligation = { id: string; text: string; due: string | null; ownerId: string | null; done: boolean };
type Contract = { id: string; number: string; title: string; kind: (typeof CONTRACT_KINDS)[number]; counterparty: string; counterpartyEmail: string; ownerId: string | null; value: number; startOn: string | null; endOn: string | null; autoRenew: boolean; renewalMonths: number; noticeDays: number; status: keyof typeof CONTRACT_STATUS_LABEL; fileId: string | null; linkType: string | null; linkId: string | null; obligations: Obligation[]; notes: string; terminatedOn: string | null; term: { termEnd: string | null; noticeBy: string | null; renewals: number; state: string }; link: { name: string; href: string } | null; obligationsDue: number };

const useDocs = () => useModule<Meta>();
const inr = (n: number) => formatPrice(n, "INR");
const fmt = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const TONE: Record<string, string> = { draft: "bg-surface-2 text-muted", review: "bg-warning-soft text-warning", approved: "bg-accent-soft text-accent", signing: "bg-accent-soft text-accent", signed: "bg-success-soft text-success", terminated: "bg-surface-2 text-muted", sent: "bg-accent-soft text-accent", completed: "bg-success-soft text-success", declined: "bg-danger-soft text-danger", voided: "bg-surface-2 text-muted", expired: "bg-danger-soft text-danger", waiting: "bg-surface-2 text-muted", viewed: "bg-warning-soft text-warning", active: "bg-success-soft text-success", notice_due: "bg-danger-soft text-danger", ending: "bg-warning-soft text-warning", renewing: "bg-warning-soft text-warning", upcoming: "bg-surface-2 text-muted", open_ended: "bg-surface-2 text-muted", final: "bg-success-soft text-success", archived: "bg-surface-2 text-muted" };
const LABEL: Record<string, string> = { ...CONTRACT_STATUS_LABEL, sent: "Out for signature", completed: "Signed by all", declined: "Declined", voided: "Voided", expired: "Expired", waiting: "Waiting", viewed: "Opened", active: "Running", notice_due: "Notice due", ending: "Ending soon", renewing: "Renews soon", upcoming: "Not started", open_ended: "No end date", final: "Final", archived: "Archived" };
const Pill = ({ s, label }: { s: string; label?: string }) => <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", TONE[s] ?? "bg-surface-2 text-muted")}>{label ?? LABEL[s] ?? s}</span>;
const nameOf = (m: Meta, id: string | null) => m.people.find((p) => p.id === id)?.name ?? "Nobody";

const DRIVE = ["", "mine", "team", "shared", "starred", "recent", "trash", "search", "folder", "new"];

/**
 * Documents: the drive (written documents and files in folders), the editor
 * (/documents/d/:id, full width), and agreements — contracts, signatures and
 * their overview — in the same sidebar.
 */
export function DocumentsApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  const sp = useSearchParams();
  if (section === "d" && isId(id))
    return (
      <DocsShell section="d" bare>
        <DocEditorPage key={id} id={id!} />
      </DocsShell>
    );
  return (
    <DocsShell section={section === "library" ? "file" : section === "folders" ? "folder" : section}>
      <DocsSection section={section} id={id} q={sp.get("q") ?? ""} />
    </DocsShell>
  );
}

function DocsSection({ section, id, q }: { section: string; id?: string; q: string }) {
  const { meta } = useModule<DocsMeta>();
  if (section === "new") return <NewDocPage />;
  if (section === "studio") return <StudioPage />;
  if ((section === "folder" || section === "folders") && isId(id)) return <DriveView key={id} section="folder" folderId={id} meta={meta} />;
  if (section === "") return <DriveHome meta={meta} />;
  if (DRIVE.includes(section) && section !== "folder") return <DriveView key={`${section}:${q}`} section={section} q={q} meta={meta} />;
  switch (section) {
    case "file":
    case "library":
      return isId(id) ? <FilePage key={id} id={id!} /> : <DriveView section="team" meta={meta} />;
    case "agreements":
      return <HomeView />;
    case "contracts":
      return isId(id) ? <ContractPage key={id} id={id!} /> : <ContractsView />;
    case "signatures":
      return isId(id) ? <RequestPage key={id} id={id!} /> : <SignaturesView />;
    case "settings":
      return <SettingsView />;
    default:
      return <DriveHome meta={meta} />;
  }
}

/** /documents/new: a blank document (or ?template=), straight into the editor. */
function NewDocPage() {
  const { orgId } = useModule<DocsMeta>();
  const router = useRouter();
  const sp = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const folder = sp.get("folder") ?? "";
    const linkId = sp.get("linkId") ?? "";
    const body = { templateId: sp.get("template") ?? undefined, title: sp.get("title") ?? "", root: "mine", folderId: isId(folder) ? folder : null, linkType: sp.get("linkType") || null, linkId: isId(linkId) ? linkId : null };
    api<{ file: { id: string } }>(`/api/v1/orgs/${orgId}/documents/docs`, { method: "POST", body })
      .then((r) => router.replace(`/documents/d/${r.file.id}`))
      .catch((e) => setError(errorMessage(e)));
  }, [orgId, router, sp]);
  return error ? (
    <Notice tone="danger" title="Couldn't create the document">
      {error}
    </Notice>
  ) : (
    <div className="grid h-64 place-items-center text-[13px] text-muted">Creating your document…</div>
  );
}

// ── Home ────────────────────────────────────────────────────────────────────

type HomeData = { counts: { contracts: number; review: number; signing: number; expiringFiles: number }; attention: { id: string; number: string; title: string; counterparty: string; state: string; termEnd: string | null; noticeBy: string | null }[]; obligations: { contractId: string; number: string; text: string; due: string; ownerId: string | null; overdue: boolean }[]; expiring: FileRow[]; signing: { id: string; title: string; expiresAt: string }[]; storage: { used: number; limit: number } };

function HomeView() {
  const { meta } = useDocs();
  const q = useModuleQuery<HomeData>("home");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Documents" description="Contracts coming up for renewal or notice, obligations due, files expiring and signatures in progress." />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Contracts in force" value={d.counts.contracts} />
            <Stat label="Waiting for approval" value={d.counts.review} tone={d.counts.review ? "warn" : undefined} />
            <Stat label="Out for signature" value={d.counts.signing} />
            <Stat label="Storage" value={size(d.storage.used)} sub={`of ${size(d.storage.limit)}`} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Contracts needing attention">{!d.attention.length ? <Empty>Nothing coming up in the next {meta.settings.alertDays} days.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.attention.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link href={`/documents/contracts/${c.id}`} className="min-w-0 truncate font-medium hover:underline">{c.number} · {c.title} <span className="font-normal text-muted">· {c.counterparty}</span></Link><span className="flex items-center gap-2 text-[12px] text-muted">{c.state === "notice_due" ? `notice by ${fmt(c.noticeBy)}` : `ends ${fmt(c.termEnd)}`}<Pill s={c.state} /></span></li>)}</ul>}</Section>
            <Section title="Obligations due">{!d.obligations.length ? <Empty>None due.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.obligations.map((o) => <li key={o.contractId + o.text} className="flex justify-between gap-3 py-2"><Link href={`/documents/contracts/${o.contractId}`} className="min-w-0 truncate hover:underline">{o.number} · {o.text}</Link><span className={cx("shrink-0", o.overdue ? "font-semibold text-danger" : "text-muted")}>{fmt(o.due)}</span></li>)}</ul>}</Section>
            <Section title="Files expiring">{!d.expiring.length ? <Empty>No files expiring soon.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.expiring.map((f) => <li key={f.id} className="flex justify-between gap-3 py-2"><Link href={`/documents/file/${f.id}`} className="min-w-0 truncate hover:underline">{f.title}</Link><span className={cx("shrink-0", f.expired ? "font-semibold text-danger" : "text-muted")}>{f.expired ? "expired " : ""}{fmt(f.expiresOn)}</span></li>)}</ul>}</Section>
            <Section title="Out for signature">{!d.signing.length ? <Empty>Nothing waiting on signatures.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.signing.map((r) => <li key={r.id} className="flex justify-between gap-3 py-2"><Link href={`/documents/signatures/${r.id}`} className="min-w-0 truncate hover:underline">{r.title}</Link><span className="shrink-0 text-muted">until {fmt(r.expiresAt)}</span></li>)}</ul>}</Section>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Library ─────────────────────────────────────────────────────────────────

function LinkPicker({ type, id, onChange }: { type: string | null; id: string | null; onChange: (t: string | null, id: string | null) => void }) {
  const opts = useModuleQuery<{ options: { id: string; name: string }[] }>(type ? `links?type=${type}` : null);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Linked to">{(p) => <Select {...p} value={type ?? ""} onChange={(e) => onChange(e.target.value || null, null)}><option value="">Nothing</option>{LINK_TYPES.map((t) => <option key={t} value={t}>{LINK_LABEL[t]}</option>)}</Select>}</Field>
      {type && <Field label={LINK_LABEL[type as keyof typeof LINK_LABEL]}>{(p) => <Select {...p} value={id ?? ""} onChange={(e) => onChange(type, e.target.value || null)}><option value="">Pick one</option>{(opts.data?.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}</Field>}
    </div>
  );
}

/** Upload a file (a new one, or a new version) as multipart form data. */
function useUpload(path: string, onDone: (r: unknown) => void) {
  const { orgId } = useDocs();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const send = async (file: File, extra: Record<string, string>) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      for (const [k, v] of Object.entries(extra)) form.set(k, v);
      const res = await fetch(`/api/v1/orgs/${orgId}/documents/${path}`, { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      qc.invalidateQueries({ queryKey: ["documents", orgId] });
      toast({ tone: "success", title: "Uploaded" });
      onDone(json);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return { send, busy };
}

export function UploadDialog({ folderId, link, onClose }: { folderId: string | null; link?: { type: string; id: string }; onClose: () => void }) {
  const { go } = useDocs();
  const fq = useModuleQuery<{ folders: FolderRow[] }>("folders");
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: "", folderId, tags: "", status: "final", expiresOn: "", linkType: link?.type ?? null as string | null, linkId: link?.id ?? null as string | null, notes: "" });
  const up = useUpload("files", (r) => (onClose(), !link && go(`file/${(r as { file: FileRow }).file.id}`)));
  return (
    <Dialog open onClose={onClose} title="Upload a document" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!file || !f.title.trim()} loading={up.busy} onClick={() => file && up.send(file, { meta: JSON.stringify({ ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), expiresOn: f.expiresOn || null }) })}>Upload</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <input ref={fileRef} type="file" aria-label="File" className="block w-full text-[13px]" onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !f.title) setF({ ...f, title: x.name.replace(/\.[^.]+$/, "") }); }} />
          <p className="mt-1 text-[12px] text-muted">PDF, Word, Excel, PowerPoint, images, ZIP, CSV or text, up to 25 MB.</p>
        </div>
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Folder">{(p) => <Select {...p} value={f.folderId ?? ""} onChange={(e) => setF({ ...f, folderId: e.target.value || null })}><option value="">Top of Team</option>{(fq.data?.folders ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Expires" hint="Flagged before it does">{(p) => <Input {...p} type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} />}</Field>
        <Field label="Tags" hint="Separated by commas" className="sm:col-span-2">{(p) => <Input {...p} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />}</Field>
        {!link && <div className="sm:col-span-2"><LinkPicker type={f.linkType} id={f.linkId} onChange={(t, id) => setF({ ...f, linkType: t, linkId: id })} /></div>}
      </div>
    </Dialog>
  );
}

type FileDetail = { file: FileRow; versions: { id: string; version: number; filename: string; mime: string; size: number; sha256: string; note: string; createdAt: string; by: string | null }[]; requests: { id: string; title: string; status: string; createdAt: string; completedAt: string | null }[]; contracts: { id: string; number: string; title: string; status: string }[] };

function FilePage({ id }: { id: string }) {
  const { meta, orgId, go } = useDocs();
  const q = useModuleQuery<FileDetail>(`files/${id}`);
  const [editing, setEditing] = useState(false);
  // ?sign=1 (from the AI document studio) opens straight on "Send for signature".
  const sp = useSearchParams();
  const [sending, setSending] = useState(sp.get("sign") === "1");
  const [view, setView] = useState<null | "viewer" | "convert" | "tools" | "qr">(null);
  const versionRef = useRef<HTMLInputElement>(null);
  const up = useUpload(`files/${id}/versions`, () => {});
  const del = useModuleAction<void>(() => ({ path: `files/${id}`, method: "DELETE" }), { success: "Deleted", onDone: () => go("team") });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { file: f, versions } = q.data;
  const href = (v?: number, inline?: boolean) => `/api/v1/orgs/${orgId}/documents/files/${f.id}/download?${new URLSearchParams({ ...(v ? { version: String(v) } : {}), ...(inline ? { inline: "1" } : {}) })}`;
  const drive = { ...f, kind: "file" as const, icon: "", role: (meta.me.write ? "edit" : "view") as "edit" | "view", access: f.access ?? "inherit" } as unknown as DriveFile;
  const fam = familyOf(f);
  return (
    <div>
      <button type="button" onClick={() => go(f.folderId ? `folder/${f.folderId}` : f.access === "private" ? "mine" : "team")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Back</button>
      <PageHeader
        title={f.title}
        description={`${f.filename} · ${size(f.size)} · version ${f.version}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Eye className="size-3.5" />} onClick={() => setView("viewer")}>Preview</Button>
            {fam === "pdf" && <Button size="sm" icon={<Wrench className="size-3.5" />} onClick={() => setView("tools")}>PDF tools</Button>}
            {(targetsFor(fam).length > 0 || fam === "pdf" || fam === "image") && <Button size="sm" icon={<FileCog className="size-3.5" />} onClick={() => setView("convert")}>Convert</Button>}
            <Button size="sm" icon={<QrCode className="size-3.5" />} onClick={() => setView("qr")}>QR</Button>
            <a href={href()} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" />Download</a>
            {meta.me.write && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            {meta.me.write && <Button size="sm" loading={up.busy} icon={<Upload className="size-3.5" />} onClick={() => versionRef.current?.click()}>New version</Button>}
            {meta.me.write && f.status !== "archived" && <Button size="sm" variant="primary" icon={<PenLine className="size-3.5" />} onClick={() => setSending(true)}>Send for signature</Button>}
            <input ref={versionRef} type="file" aria-label="New version" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) void up.send(x, { note: "" }); e.target.value = ""; }} />
          </div>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
          {(fam === "pdf" || fam === "image") && (
            <div className="min-w-0 overflow-hidden rounded-[20px] border border-border bg-fg/[0.03]">
              {fam === "pdf" ? (
                <PdfView key={f.version} src={href(undefined, true)} className="h-[min(72vh,760px)]" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- the drive's own private file
                <button type="button" onClick={() => setView("viewer")} className="grid w-full place-items-center p-4"><img src={href(undefined, true)} alt={f.title} className="max-h-[60vh] rounded-[8px] object-contain shadow" /></button>
              )}
            </div>
          )}
          <Section title="Versions">
            <ul className="divide-y divide-border text-[13px]">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                  <b className="w-10 tabular-nums">v{v.version}</b>
                  <span className="min-w-0 flex-1"><span className="block truncate">{v.filename} · {size(v.size)}</span><span className="block truncate text-[11.5px] text-muted" title={v.sha256}>{when(v.createdAt)}{v.by ? ` · ${v.by}` : ""}{v.note ? ` · ${v.note}` : ""} · SHA-256 {v.sha256.slice(0, 12)}…</span></span>
                  <a href={href(v.version)} className="text-[12.5px] font-medium underline">Download</a>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Signature requests">{!q.data.requests.length ? <p className="text-[12.5px] text-muted">Not sent for signature.</p> : <ul className="divide-y divide-border text-[13px]">{q.data.requests.map((r) => <li key={r.id} className="flex justify-between gap-2 py-2"><Link href={`/documents/signatures/${r.id}`} className="hover:underline">{r.title}</Link><span className="flex items-center gap-2 text-[12px] text-muted">{when(r.createdAt)}<Pill s={r.status} /></span></li>)}</ul>}</Section>
        </div>
        <Section title="About">
          <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-muted">Status</dt><dd><Pill s={f.status} /></dd>
            <dt className="text-muted">Expires</dt><dd className={cx(f.expired && "font-semibold text-danger")}>{fmt(f.expiresOn)}</dd>
            <dt className="text-muted">Tags</dt><dd>{f.tags.join(", ") || "—"}</dd>
            <dt className="text-muted">Linked to</dt><dd>{f.link ? <Link href={f.link.href} className="underline">{f.link.name}</Link> : "—"}</dd>
            {q.data.contracts.length > 0 && <><dt className="text-muted">Contracts</dt><dd className="grid">{q.data.contracts.map((c) => <Link key={c.id} href={`/documents/contracts/${c.id}`} className="underline">{c.number} · {c.title}</Link>)}</dd></>}
          </dl>
          {f.notes && <p className="mt-3 text-[12.5px] whitespace-pre-wrap text-muted">{f.notes}</p>}
          {meta.me.write && <Button size="sm" variant="ghost" className="mt-4" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()}>Delete file</Button>}
        </Section>
      </div>
      {editing && <FileEditDialog file={f} onClose={() => setEditing(false)} />}
      {view === "viewer" && <FileViewer file={drive} onClose={() => setView(null)} />}
      {view === "convert" && <ConvertDialog file={drive} onClose={() => setView(null)} />}
      {view === "tools" && <PdfTools file={drive} onClose={() => setView(null)} onSaved={() => (setView(null), void q.refetch())} />}
      {view === "qr" && <QrDialog file={drive} onClose={() => setView(null)} />}
      {sending && <SendDialog fileId={f.id} title={f.title} onClose={() => setSending(false)} />}
    </div>
  );
}

function FileEditDialog({ file, onClose }: { file: FileRow; onClose: () => void }) {
  const fq = useModuleQuery<{ folders: FolderRow[] }>("folders");
  const [f, setF] = useState({ title: file.title, folderId: file.folderId, tags: file.tags.join(", "), status: file.status, expiresOn: file.expiresOn ?? "", linkType: file.linkType, linkId: file.linkId, notes: file.notes });
  const save = useModuleAction<void>(() => ({ path: `files/${file.id}`, method: "PUT", body: { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), expiresOn: f.expiresOn || null } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Edit document" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Folder">{(p) => <Select {...p} value={f.folderId ?? ""} onChange={(e) => setF({ ...f, folderId: e.target.value || null })}><option value="">Top of Team</option>{(fq.data?.folders ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Status">{(p) => <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{FILE_STATUSES.map((x) => <option key={x} value={x}>{LABEL[x] ?? "Draft"}</option>)}</Select>}</Field>
        <Field label="Expires">{(p) => <Input {...p} type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} />}</Field>
        <Field label="Tags">{(p) => <Input {...p} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />}</Field>
        <div className="sm:col-span-2"><LinkPicker type={f.linkType} id={f.linkId} onChange={(t, id) => setF({ ...f, linkType: t, linkId: id })} /></div>
        <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Sending for signature ───────────────────────────────────────────────────

type Link = { signerId: string; name: string; email: string; url: string };

function CopyLinks({ links, emailed }: { links: Link[]; emailed: boolean }) {
  const toast = useToast();
  return (
    <div className="grid gap-2">
      <Notice tone={emailed ? "success" : "warning"} title={emailed ? "Sent" : "Email isn't set up — send these links yourself"}>{emailed ? "Each signer has been emailed their link. You can also copy them now — they aren't shown again." : "Copy each link and send it to that person. They aren't shown again; you can make a new one from the request."}</Notice>
      {links.map((l) => (
        <div key={l.signerId} className="flex items-center gap-2 rounded-[12px] border border-border px-3 py-2 text-[12.5px]">
          <span className="min-w-0 flex-1"><b className="block">{l.name}</b><span className="block truncate text-muted">{l.url}</span></span>
          <Button size="sm" variant="ghost" aria-label={`Copy ${l.name}'s link`} icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard?.writeText(l.url).then(() => toast({ tone: "success", title: "Link copied" }), () => {})} />
        </div>
      ))}
    </div>
  );
}

export function SendDialog({ fileId, title, contractId, signers: initial, onClose }: { fileId: string; title: string; contractId?: string; signers?: { name: string; email: string }[]; onClose: () => void }) {
  const [f, setF] = useState({ title, message: "", sequential: true });
  const [signers, setSigners] = useState(initial?.length ? initial : [{ name: "", email: "" }]);
  const [sent, setSent] = useState<{ links: Link[]; emailed: boolean } | null>(null);
  const send = useModuleAction<void, { links: Link[]; emailed: boolean }>(() => ({ path: "signatures", body: { ...f, fileId, contractId: contractId ?? null, signers: signers.filter((s) => s.name.trim() || s.email.trim()) } }), { success: "Sent for signature", onDone: (r) => setSent(r) });
  return (
    <Dialog open onClose={onClose} title={sent ? "Signing links" : "Send for signature"} footer={sent ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim() || !signers.some((s) => s.name.trim() && s.email.includes("@"))} loading={send.isPending} onClick={() => send.mutate()}>Send</Button></>}>
      {sent ? <CopyLinks links={sent.links} emailed={sent.emailed} /> : (
        <div className="grid gap-3">
          <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Message (optional)">{(p) => <Textarea {...p} rows={2} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
          <p className="text-[12.5px] font-medium">Signers</p>
          {signers.map((s, i) => (
            <div key={i} className="flex gap-2">
              <span className="w-5 pt-2 text-[12px] text-muted tabular-nums">{i + 1}</span>
              <Input aria-label={`Signer ${i + 1} name`} value={s.name} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className="h-9 flex-1" />
              <Input aria-label={`Signer ${i + 1} email`} value={s.email} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} placeholder="Email" className="h-9 flex-1" />
              <Button size="sm" variant="ghost" aria-label="Remove signer" icon={<X className="size-3.5" />} onClick={() => setSigners(signers.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => setSigners([...signers, { name: "", email: "" }])}>Signer</Button>
          <Switch checked={f.sequential} onChange={(v) => setF({ ...f, sequential: v })} label="One after another, in this order" />
          <p className="text-[12px] text-muted">Signers open a private link, read the file and type their name to sign. It&apos;s a click-to-sign electronic signature with an audit trail — not Aadhaar eSign or a DSC.</p>
        </div>
      )}
    </Dialog>
  );
}

// ── Contracts ───────────────────────────────────────────────────────────────

function ContractsView() {
  const { meta, orgId, go } = useDocs();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const q = useModuleQuery<{ contracts: Contract[] }>(`contracts?${new URLSearchParams({ status, ...(search ? { q: search } : {}) })}`, { keepPrevious: true });
  const rows = q.data?.contracts ?? [];
  return (
    <div>
      <PageHeader
        title="Contracts"
        description="Every agreement: its terms, value, renewal and notice dates, and what it obliges you to do."
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportMenu name="contracts" columns={[{ key: "number", label: "Number" }, { key: "title", label: "Title" }, { key: "kind", label: "Type" }, { key: "counterparty", label: "Counterparty" }, { key: "value", label: "Value", money: true }, { key: "startOn", label: "Start" }, { key: "termEnd", label: "Current term ends" }, { key: "noticeBy", label: "Notice by" }, { key: "autoRenew", label: "Auto-renews" }, { key: "status", label: "Status" }, { key: "state", label: "Term" }]} rows={rows.map((c) => ({ ...c, kind: CONTRACT_KIND_LABEL[c.kind], termEnd: c.term.termEnd ?? "", noticeBy: c.term.noticeBy ?? "", autoRenew: c.autoRenew ? "yes" : "no", status: CONTRACT_STATUS_LABEL[c.status], state: LABEL[c.term.state] }))} />
            {meta.me.manage && <ImportButton target={target("documents.contracts")} onImport={(r, mode) => api(`/api/v1/orgs/${orgId}/documents/contracts/import`, { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["documents", orgId] })} />}
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Contract</Button>}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search contracts" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, counterparty, number" className="h-9 max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 !w-44"><option value="all">Any status</option>{Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No contracts yet. Add one, or import your register from a spreadsheet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => go(`contracts/${c.id}`)} className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left hover:opacity-80">
                <span className="min-w-0 flex-1"><b className="block truncate font-semibold">{c.title}</b><span className="text-[12px] text-muted">{c.number} · {CONTRACT_KIND_LABEL[c.kind]} · {c.counterparty}{c.link ? ` · ${c.link.name}` : ""}</span></span>
                {meta.me.write && c.value > 0 && <span className="tabular-nums">{inr(c.value)}</span>}
                {c.status === "signed" && c.term.termEnd && <span className="text-[12px] text-muted">{c.term.state === "notice_due" ? `notice by ${fmt(c.term.noticeBy)}` : `to ${fmt(c.term.termEnd)}`}</span>}
                {c.status === "signed" ? <Pill s={c.term.state} /> : <Pill s={c.status} />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && <ContractDialog onClose={() => setAdding(false)} onSaved={(id) => go(`contracts/${id}`)} />}
    </div>
  );
}

function ContractDialog({ contract, onClose, onSaved }: { contract?: Contract; onClose: () => void; onSaved?: (id: string) => void }) {
  const { meta } = useDocs();
  const files = useModuleQuery<{ files: FileRow[] }>("files?all=1");
  const locked = !!contract && ["approved", "signing", "signed"].includes(contract.status);
  const [f, setF] = useState({ title: contract?.title ?? "", kind: contract?.kind ?? "customer", counterparty: contract?.counterparty ?? "", counterpartyEmail: contract?.counterpartyEmail ?? "", ownerId: contract?.ownerId ?? meta.me.id, value: contract?.value ? String(contract.value / 100) : "", startOn: contract?.startOn ?? "", endOn: contract?.endOn ?? "", autoRenew: contract?.autoRenew ?? false, renewalMonths: String(contract?.renewalMonths ?? 12), noticeDays: String(contract?.noticeDays ?? 30), fileId: contract?.fileId ?? "", linkType: contract?.linkType ?? null, linkId: contract?.linkId ?? null, notes: contract?.notes ?? "" });
  const [obligations, setObligations] = useState<Obligation[]>(contract?.obligations ?? []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useModuleAction<void, { contract: Contract }>(() => ({ path: contract ? `contracts/${contract.id}` : "contracts", method: contract ? "PUT" : "POST", body: { ...f, value: Math.round((Number(f.value.replace(/[^\d.]/g, "")) || 0) * 100), startOn: f.startOn || null, endOn: f.endOn || null, renewalMonths: Number(f.renewalMonths) || 12, noticeDays: Number(f.noticeDays) || 0, fileId: f.fileId || null, ownerId: f.ownerId || null, obligations: obligations.filter((o) => o.text.trim()).map((o) => ({ ...o, due: o.due || null })) } }), { success: "Contract saved", onDone: (r) => (onClose(), onSaved?.(r.contract.id)) });
  return (
    <Dialog open onClose={onClose} title={contract ? `Edit ${contract.number}` : "New contract"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim() || !f.counterparty.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {locked && <div className="sm:col-span-2"><Notice tone="neutral" title="The terms are agreed">Only obligations, the owner, links and notes can change now.</Notice></div>}
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} autoFocus disabled={locked} value={f.title} onChange={set("title")} placeholder="e.g. Mutual NDA" />}</Field>
        <Field label="Type">{(p) => <Select {...p} disabled={locked} value={f.kind} onChange={set("kind")}>{CONTRACT_KINDS.map((k) => <option key={k} value={k}>{CONTRACT_KIND_LABEL[k]}</option>)}</Select>}</Field>
        <Field label="Counterparty">{(p) => <Input {...p} disabled={locked} value={f.counterparty} onChange={set("counterparty")} />}</Field>
        <Field label="Their email">{(p) => <Input {...p} type="email" value={f.counterpartyEmail} onChange={set("counterpartyEmail")} />}</Field>
        <Field label="Owner">{(p) => <Select {...p} value={f.ownerId ?? ""} onChange={set("ownerId")}>{meta.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Value (₹)">{(p) => <Input {...p} disabled={locked} inputMode="decimal" value={f.value} onChange={set("value")} />}</Field>
        <Field label="Document">{(p) => <Select {...p} disabled={locked} value={f.fileId} onChange={set("fileId")}><option value="">None yet</option>{(files.data?.files ?? []).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</Select>}</Field>
        <Field label="Starts">{(p) => <Input {...p} disabled={locked} type="date" value={f.startOn} onChange={set("startOn")} />}</Field>
        <Field label="Ends">{(p) => <Input {...p} disabled={locked} type="date" value={f.endOn} onChange={set("endOn")} />}</Field>
        <div className="flex items-end pb-2 sm:col-span-2"><Switch checked={f.autoRenew} disabled={locked} onChange={(v) => setF({ ...f, autoRenew: v })} label="Renews automatically unless notice is given" /></div>
        {f.autoRenew && <Field label="Renews for (months)">{(p) => <Input {...p} disabled={locked} inputMode="numeric" value={f.renewalMonths} onChange={set("renewalMonths")} />}</Field>}
        {f.autoRenew && <Field label="Notice (days before the end)">{(p) => <Input {...p} disabled={locked} inputMode="numeric" value={f.noticeDays} onChange={set("noticeDays")} />}</Field>}
        <div className="sm:col-span-2"><LinkPicker type={f.linkType} id={f.linkId} onChange={(t, id) => setF({ ...f, linkType: t, linkId: id })} /></div>
        <div className="grid gap-2 sm:col-span-2">
          <p className="text-[12.5px] font-medium">Obligations</p>
          {obligations.map((o, i) => (
            <div key={o.id} className="flex gap-2">
              <Input aria-label={`Obligation ${i + 1}`} value={o.text} onChange={(e) => setObligations(obligations.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="e.g. Quarterly security report" className="h-9 flex-1" />
              <Input aria-label={`Obligation ${i + 1} due`} type="date" value={o.due ?? ""} onChange={(e) => setObligations(obligations.map((x, j) => (j === i ? { ...x, due: e.target.value || null } : x)))} className="h-9 !w-40" />
              <Button size="sm" variant="ghost" aria-label="Remove obligation" icon={<X className="size-3.5" />} onClick={() => setObligations(obligations.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => setObligations([...obligations, { id: `o${Date.now().toString(36)}`, text: "", due: null, ownerId: f.ownerId || null, done: false }])}>Obligation</Button>
        </div>
        <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.notes} onChange={set("notes")} />}</Field>
      </div>
    </Dialog>
  );
}

type ContractDetail = { contract: Contract; file: FileRow | null; requests: { id: string; title: string; status: string; createdAt: string; completedAt: string | null }[]; approval: { status: string; policyName: string } | null };

function ContractPage({ id }: { id: string }) {
  const { meta, go } = useDocs();
  const q = useModuleQuery<ContractDetail>(`contracts/${id}`);
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const act = useModuleAction<{ path: string; body?: unknown }, { status?: string }>((b) => ({ path: `contracts/${id}/${b.path}`, body: b.body ?? {} }), { success: (r) => (r?.status ? `Contract ${LABEL[r.status]?.toLowerCase() ?? r.status}` : "Done") });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { contract: c, file } = q.data;
  return (
    <div>
      <button type="button" onClick={() => go("contracts")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Contracts</button>
      <PageHeader
        title={c.title}
        description={`${c.number} · ${CONTRACT_KIND_LABEL[c.kind]} · ${c.counterparty}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill s={c.status} />
            <ShareToChatButton card={{ kind: "contracts", id: c.id, title: `${c.title} (${c.number})`, sub: c.counterparty, link: `/documents/contracts/${c.id}`, module: "Contract", fields: [{ label: "Type", value: c.kind }, { label: "Status", value: c.status }] }} />
            <EmailButton to={[{ email: c.counterpartyEmail, name: c.counterparty }]} title={`Email ${c.counterparty}`} subject={`${c.title} (${c.number})`} body={`Hi {{first_name}},\n\nAbout ${c.title} (${c.number}): \n\nThanks,\n{{my_name}}`} />
            {meta.me.write && c.status !== "terminated" && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            {meta.me.write && c.status === "draft" && <Button size="sm" variant="primary" onClick={() => act.mutate({ path: "submit" })}>Send for approval</Button>}
            {meta.me.manage && c.status === "review" && !q.data.approval?.status?.startsWith("pending") && <><Button size="sm" variant="ghost" onClick={() => act.mutate({ path: "decide", body: { approve: false } })}>Send back</Button><Button size="sm" variant="primary" onClick={() => act.mutate({ path: "decide", body: { approve: true } })}>Approve</Button></>}
            {meta.me.write && c.status === "approved" && file && <Button size="sm" variant="primary" icon={<PenLine className="size-3.5" />} onClick={() => setSending(true)}>Send for signature</Button>}
            {meta.me.manage && ["approved", "signing"].includes(c.status) && <Button size="sm" onClick={() => act.mutate({ path: "signed" })}>Signed elsewhere</Button>}
            {meta.me.manage && c.status === "signed" && <Button size="sm" variant="ghost" onClick={() => setEnding(true)}>Terminate</Button>}
          </div>
        }
      />
      {c.status === "approved" && !file && <div className="mb-4"><Notice tone="neutral" title="Approved — attach the document to send it for signature">Edit the contract and pick the document from Documents.</Notice></div>}
      {q.data.approval?.status === "pending" && <div className="mb-4"><Notice tone="warning" title="With its approvers">{q.data.approval.policyName} — decided in Approvals.</Notice></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Value" value={meta.me.write ? inr(c.value) : "—"} />
        <Stat label="Current term" value={c.term.termEnd ? `to ${fmt(c.term.termEnd)}` : "No end date"} sub={c.startOn ? `from ${fmt(c.startOn)}${c.term.renewals ? ` · renewed ${c.term.renewals}×` : ""}` : undefined} />
        <Stat label="Notice by" value={c.term.noticeBy ? fmt(c.term.noticeBy) : "—"} sub={c.autoRenew ? `renews for ${c.renewalMonths} months` : "doesn't renew"} tone={c.term.state === "notice_due" ? "warn" : undefined} />
        <Stat label="Term" value={LABEL[c.term.state] ?? c.term.state} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-5">
          <Section title="Obligations">
            {!c.obligations.length ? <p className="text-[12.5px] text-muted">None recorded.</p> : (
              <ul className="grid gap-1.5 text-[13px]">
                {c.obligations.map((o) => (
                  <li key={o.id}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={o.done} disabled={!meta.me.write && o.ownerId !== meta.me.id} onChange={(e) => act.mutate({ path: "obligation", body: { item: o.id, done: e.target.checked } })} className="accent-[var(--accent)]" />
                      <span className={cx("flex-1", o.done && "text-muted line-through")}>{o.text}</span>
                      {o.due && <span className={cx("text-[12px]", !o.done && o.due < today() ? "font-semibold text-danger" : "text-muted")}>{fmt(o.due)}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Signatures">{!q.data.requests.length ? <p className="text-[12.5px] text-muted">Not sent for signature.</p> : <ul className="divide-y divide-border text-[13px]">{q.data.requests.map((r) => <li key={r.id} className="flex justify-between gap-2 py-2"><Link href={`/documents/signatures/${r.id}`} className="hover:underline">{r.title}</Link><span className="flex items-center gap-2 text-[12px] text-muted">{when(r.createdAt)}<Pill s={r.status} /></span></li>)}</ul>}</Section>
        </div>
        <Section title="About">
          <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-muted">Owner</dt><dd>{nameOf(meta, c.ownerId)}</dd>
            <dt className="text-muted">Their email</dt><dd>{c.counterpartyEmail || "—"}</dd>
            <dt className="text-muted">Document</dt><dd>{file ? <Link href={`/documents/file/${file.id}`} className="underline">{file.title}</Link> : "—"}</dd>
            <dt className="text-muted">Linked to</dt><dd>{c.link ? <Link href={c.link.href} className="underline">{c.link.name}</Link> : "—"}</dd>
            {c.terminatedOn && <><dt className="text-muted">Terminated</dt><dd>{fmt(c.terminatedOn)}</dd></>}
          </dl>
          {c.notes && <p className="mt-3 text-[12.5px] whitespace-pre-wrap text-muted">{c.notes}</p>}
        </Section>
      </div>
      {editing && <ContractDialog contract={c} onClose={() => setEditing(false)} />}
      {sending && file && <SendDialog fileId={file.id} title={c.title} contractId={c.id} signers={c.counterpartyEmail ? [{ name: c.counterparty, email: c.counterpartyEmail }] : undefined} onClose={() => setSending(false)} />}
      {ending && <TerminateDialog id={c.id} onClose={() => setEnding(false)} />}
    </div>
  );
}

function TerminateDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [on, setOn] = useState(today());
  const [reason, setReason] = useState("");
  const act = useModuleAction<void>(() => ({ path: `contracts/${id}/terminate`, body: { on, reason } }), { success: "Contract terminated", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Terminate the contract" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={act.isPending} onClick={() => act.mutate()}>Terminate</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ends on">{(p) => <Input {...p} type="date" value={on} onChange={(e) => setOn(e.target.value)} />}</Field>
        <Field label="Why" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
      <p className="mt-3 text-[12px] text-muted">It stops renewing, and the record stays.</p>
    </Dialog>
  );
}

// ── Signatures ──────────────────────────────────────────────────────────────

function SignaturesView() {
  const { go } = useDocs();
  const [tab, setTab] = useState<"sent" | "completed" | "all">("sent");
  const q = useModuleQuery<{ requests: { id: string; title: string; status: string; createdAt: string; expiresAt: string; signers: { name: string; status: string }[] }[] }>(`signatures${tab === "all" ? "" : `?status=${tab}`}`, { keepPrevious: true });
  const rows = q.data?.requests ?? [];
  return (
    <div>
      <PageHeader title="Signatures" description="Files sent for signature, who has signed, and the trail." actions={<ExportMenu name="signature-requests" columns={[{ key: "title", label: "Title" }, { key: "status", label: "Status" }, { key: "signers", label: "Signers" }, { key: "createdAt", label: "Sent" }]} rows={rows.map((r) => ({ ...r, status: LABEL[r.status] ?? r.status, signers: r.signers.map((s) => `${s.name} (${LABEL[s.status] ?? s.status})`).join("; ") }))} />} />
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[{ value: "sent", label: "Waiting" }, { value: "completed", label: "Signed" }, { value: "all", label: "All" }]} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>Send a document for signature from its page in Documents, or from a contract.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => go(`signatures/${r.id}`)} className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left hover:opacity-80">
                <span className="min-w-0 flex-1"><b className="block truncate font-semibold">{r.title}</b><span className="text-[12px] text-muted">{r.signers.filter((s) => s.status === "signed").length} of {r.signers.length} signed · sent {when(r.createdAt)}</span></span>
                <Pill s={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type RequestDetail = { request: { id: string; title: string; status: string; sha256: string; sequential: boolean; expiresAt: string; completedAt: string | null; hasCertificate: boolean; fileId: string; contractId: string | null }; signers: { id: string; name: string; email: string; order: number; status: string; viewedAt: string | null; signedAt: string | null; signedName: string | null; ip: string | null; declineReason: string | null }[]; events: { id: string; kind: string; detail: string; at: string; ip: string | null }[]; version: { version: number; filename: string }; turn: string[] };

function RequestPage({ id }: { id: string }) {
  const { meta, orgId, go } = useDocs();
  const q = useModuleQuery<RequestDetail>(`signatures/${id}`);
  const [links, setLinks] = useState<{ links: Link[]; emailed: boolean } | null>(null);
  const remind = useModuleAction<string, { link: Link; emailed: boolean }>((signerId) => ({ path: `signatures/${id}/remind`, body: { signerId } }), { success: "New link made", onDone: (r) => setLinks({ links: [r.link], emailed: r.emailed }) });
  const voidIt = useModuleAction<void>(() => ({ path: `signatures/${id}/void`, body: { reason: "" } }), { success: "Request voided" });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { request: r, signers, events } = q.data;
  return (
    <div>
      <button type="button" onClick={() => go("signatures")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Signatures</button>
      <PageHeader
        title={r.title}
        description={<span><Link href={`/documents/file/${r.fileId}`} className="underline">{q.data.version.filename}</Link> · version {q.data.version.version} · {r.sequential ? "in order" : "all at once"}</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill s={r.status} />
            {r.hasCertificate && <a href={`/api/v1/orgs/${orgId}/documents/signatures/${r.id}/certificate`} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" />Certificate</a>}
            {meta.me.write && r.status === "sent" && <Button size="sm" variant="ghost" loading={voidIt.isPending} onClick={() => voidIt.mutate()}>Void</Button>}
          </div>
        }
      />
      <p className="mb-5 text-[12px] break-all text-muted">SHA-256 of the file sent: {r.sha256}</p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Signers">
          <ul className="divide-y divide-border text-[13px]">
            {signers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-5 text-[12px] text-muted tabular-nums">{s.order}</span>
                <span className="min-w-0 flex-1"><b className="block font-semibold">{s.name}</b><span className="text-[12px] [overflow-wrap:anywhere] text-muted">{s.email}{s.signedAt ? ` · signed as “${s.signedName}” ${when(s.signedAt)}` : s.viewedAt ? ` · opened ${when(s.viewedAt)}` : ""}{s.declineReason ? ` · “${s.declineReason}”` : ""}</span></span>
                <Pill s={s.status} />
                {meta.me.write && q.data.turn.includes(s.id) && <Button size="sm" variant="ghost" loading={remind.isPending} onClick={() => remind.mutate(s.id)}>New link</Button>}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Trail">
          <ol className="grid gap-1.5 text-[12.5px]">
            {events.map((e) => <li key={e.id} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2"><span className="text-muted tabular-nums">{when(e.at)}</span><span className="min-w-0 [overflow-wrap:anywhere]"><b className="font-medium capitalize">{e.kind}</b> {e.detail}{e.ip ? <span className="text-muted"> · {e.ip}</span> : null}</span></li>)}
          </ol>
        </Section>
      </div>
      {links && <Dialog open onClose={() => setLinks(null)} title="Signing link" footer={<Button variant="primary" onClick={() => setLinks(null)}>Done</Button>}><CopyLinks links={links.links} emailed={links.emailed} /></Dialog>}
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function SettingsView() {
  const { meta } = useDocs();
  const [f, setF] = useState(meta.settings);
  const save = useModuleAction<void>(() => ({ path: "settings", method: "PUT", body: f }), { success: "Saved" });
  return (
    <div className="grid max-w-2xl gap-5">
      <PageHeader title="Documents settings" />
      <Section title="Contracts and signing">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contract numbers start with">{(p) => <Input {...p} value={f.contractPrefix} onChange={(e) => setF({ ...f, contractPrefix: e.target.value })} />}</Field>
          <Field label="Flag what's due within (days)" hint="Renewals, notice dates, obligations, expiring files">{(p) => <Input {...p} inputMode="numeric" value={String(f.alertDays)} onChange={(e) => setF({ ...f, alertDays: Number(e.target.value) || 1 })} />}</Field>
          <Field label="Signing links stay open (days)">{(p) => <Input {...p} inputMode="numeric" value={String(f.signDays)} onChange={(e) => setF({ ...f, signDays: Number(e.target.value) || 1 })} />}</Field>
        </div>
      </Section>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}
