"use client";

// Drive QR in the drive: set up a folder's QR (how long uploads stay, whether
// the uploader picks, who's told), show it to download, print or copy, and
// change it to stop the old one. Also: an upload's badge (from a phone, and
// when it's deleted), changing when a file is deleted, and its activity log.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Download, Loader2, Printer, QrCode, RotateCcw, Smartphone, Timer } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Select, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { LOG_LABEL, STAY_CHOICES, stayLabel } from "@/lib/documents/drop";
import { downloadUrl, useDocsBase, useDriveRefresh, type DriveFile } from "./shared";

type Drop = { id: string; folderId: string | null; root: string; name: string; enabled: boolean; stayMinutes: number | null; uploaderChooses: boolean; notifyOwner: boolean; uploads: number; lastUploadAt: string | null; url: string };
export type Place = { folderId: string | null; root: "team" | "mine" };

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** "in 3 h", "in 2 d" — how long until a file is deleted. */
export function leftOf(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 60_000) return "any moment";
  const m = Math.round(ms / 60_000);
  return m < 60 ? `in ${m} min` : m < 48 * 60 ? `in ${Math.round(m / 60)} h` : `in ${Math.round(m / 1440)} d`;
}

/** The badges an upload carries in the list: from a phone, and when it goes. */
export function DropBadges({ f }: { f: Pick<DriveFile, "deleteAt" | "dropped"> }) {
  return (
    <>
      {f.dropped && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#7c5cdb]/10 px-1.5 text-[10px] font-medium text-[#6a48d6] dark:text-[#b7a4ff]" title={`Uploaded by Drive QR${f.dropped.name ? ` by ${f.dropped.name}` : ""}`}>
          <QrCode className="size-2.5" aria-hidden /> QR
        </span>
      )}
      {f.deleteAt && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/12 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300" title={`Deleted completely ${when(f.deleteAt)}`}>
          <Timer className="size-2.5" aria-hidden /> {leftOf(f.deleteAt)}
        </span>
      )}
    </>
  );
}

/** The folder's QR: set it up, then show, print, download or change it. */
export function DropDialog({ place, placeName, onClose }: { place: Place; placeName: string; onClose: () => void }) {
  const base = useDocsBase();
  const toast = useToast();
  const qs = new URLSearchParams({ ...(place.folderId ? { folderId: place.folderId } : {}), root: place.root }).toString();
  const q = useQuery({ queryKey: ["drive", "drop", qs], queryFn: () => api<{ drop: Drop | null }>(`${base}/drop?${qs}`) });
  const d = q.data?.drop ?? null;
  const [f, setF] = useState<{ name: string; enabled: boolean; stayMinutes: number | null; uploaderChooses: boolean; notifyOwner: boolean } | null>(null);
  const form = f ?? { name: d?.name ?? "", enabled: d?.enabled ?? true, stayMinutes: d ? d.stayMinutes : 24 * 60, uploaderChooses: d?.uploaderChooses ?? true, notifyOwner: d?.notifyOwner ?? true };
  const set = (p: Partial<typeof form>) => setF({ ...form, ...p });
  const save = useMutation({
    mutationFn: () => api<{ drop: Drop }>(`${base}/drop`, { method: "PUT", body: { ...form, folderId: place.folderId, root: place.root } }),
    onSuccess: () => (void q.refetch(), setF(null), toast({ tone: "success", title: d ? "Drive QR saved" : "Drive QR is ready" })),
    onError: (e) => toast({ tone: "error", title: "Couldn't save it", description: errorMessage(e) }),
  });
  const rotate = useMutation({
    mutationFn: () => api<{ drop: Drop }>(`${base}/drop/${d!.id}/rotate`, { method: "POST", body: {} }),
    onSuccess: () => (void q.refetch(), toast({ tone: "success", title: "New QR made — the old one no longer works" })),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const [png, setPng] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!d?.url) return;
    let alive = true;
    const opts = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#111113", light: "#ffffff" } };
    void Promise.all([QRCode.toDataURL(d.url, { ...opts, width: 720 }), QRCode.toString(d.url, { ...opts, type: "svg" })]).then(([p, s]) => {
      if (!alive) return;
      setPng(p);
      setSvg(s);
    });
    return () => {
      alive = false;
    };
  }, [d?.url]);
  const label = form.name || placeName;
  const stays = form.stayMinutes === null ? "kept until someone deletes them" : `deleted automatically after ${stayLabel(form.stayMinutes).toLowerCase()}`;
  const print = () => {
    if (!png) return;
    const w = window.open("", "_blank", "noopener=no");
    if (!w) return;
    w.document.write(`<!doctype html><title>${esc(label)} — Drive QR</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:95vh;margin:0}.card{border:1px solid #ddd;border-radius:22px;padding:30px 34px;text-align:center;width:340px}img{width:270px;height:270px}h1{font-size:20px;margin:14px 0 6px}p{color:#555;font-size:13px;margin:4px 0}</style><div class="card"><img src="${png}" alt=""><h1>Scan to upload</h1><p><b>${esc(label)}</b></p><p>Point your phone camera here, then choose a photo or file. No app or sign-in needed.</p><p style="color:#888;font-size:11.5px">Uploads are ${esc(stays)}.</p></div>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  const copy = () => d && void navigator.clipboard.writeText(d.url).then(() => toast({ tone: "success", title: "Link copied" }), () => toast({ tone: "info", title: d.url }));
  const dirty = !!f;
  return (
    <Dialog open onClose={onClose} size="lg" title="Drive QR" description={`Anyone who scans it can upload into “${placeName}” from their phone — no account needed.`} footer={<><Button onClick={onClose}>Done</Button>{(!d || dirty) && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{d ? "Save changes" : "Make the QR"}</Button>}</>}>
      {!q.data ? (
        <Loader2 className="size-5 animate-spin text-muted" />
      ) : (
        <div className="grid gap-5">
          {d && (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="grid size-[200px] shrink-0 place-items-center rounded-[20px] border border-border bg-white p-2 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL */}
                {png ? <img src={png} alt={`Drive QR for ${label}`} className={d.enabled ? "size-full" : "size-full opacity-25"} /> : <Loader2 className="size-6 animate-spin text-black/40" />}
              </div>
              <div className="grid w-full min-w-0 gap-2">
                <p className="text-[14px] font-semibold">{d.enabled ? "Scan to upload" : "Turned off — scanning shows that it doesn't work"}</p>
                <p className="text-[12px] break-all text-muted">{d.url}</p>
                <p className="text-[12.5px] text-muted">{d.uploads ? `${d.uploads} upload${d.uploads === 1 ? "" : "s"} so far · last ${when(d.lastUploadAt!)}` : "No uploads yet."}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" icon={<Printer className="size-3.5" />} disabled={!png} onClick={print}>Print</Button>
                  <Button size="sm" icon={<Download className="size-3.5" />} disabled={!png} onClick={() => png && downloadUrl(png, `${label} QR.png`)}>PNG</Button>
                  <Button size="sm" icon={<Download className="size-3.5" />} disabled={!svg} onClick={() => svg && downloadUrl(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })), `${label} QR.svg`)}>SVG</Button>
                  <Button size="sm" icon={<Copy className="size-3.5" />} onClick={copy}>Copy link</Button>
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} loading={rotate.isPending} onClick={() => rotate.mutate()}>New QR</Button>
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-3 rounded-[16px] border border-border p-4 sm:grid-cols-2">
            <Field label="Name on the upload page" hint={`Shown as “${label}”`}>{(a) => <Input {...a} maxLength={80} value={form.name} placeholder={placeName} onChange={(e) => set({ name: e.target.value })} />}</Field>
            <Field label="Uploads are deleted after" hint="Completely — every copy and its history">
              {(a) => (
                <Select {...a} value={form.stayMinutes === null ? "keep" : String(form.stayMinutes)} onChange={(e) => set({ stayMinutes: e.target.value === "keep" ? null : Number(e.target.value) })}>
                  {STAY_CHOICES.map((c) => <option key={c.label} value={c.minutes === null ? "keep" : String(c.minutes)}>{c.minutes === null ? "Never — keep them" : c.label}</option>)}
                </Select>
              )}
            </Field>
            <label className="flex items-start gap-2.5 text-[13px] sm:col-span-2"><Switch checked={form.uploaderChooses} onChange={(v) => set({ uploaderChooses: v })} label="Uploader may choose a shorter time" /> <span><b className="font-medium">The uploader may choose a shorter time</b><span className="block text-muted">They pick how long their file stays, up to your limit.</span></span></label>
            <label className="flex items-start gap-2.5 text-[13px] sm:col-span-2"><Switch checked={form.notifyOwner} onChange={(v) => set({ notifyOwner: v })} label="Tell me about each upload" /> <span><b className="font-medium">Tell me about each upload</b><span className="block text-muted">A notification (and email, if you get them) for every file that comes in.</span></span></label>
            {d && <label className="flex items-start gap-2.5 text-[13px] sm:col-span-2"><Switch checked={form.enabled} onChange={(v) => set({ enabled: v })} label="Taking uploads" /> <span><b className="font-medium">Taking uploads</b><span className="block text-muted">Turn off to stop the QR working without changing it.</span></span></label>}
          </div>
          <p className="flex items-start gap-2 rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-muted">
            <Smartphone className="mt-0.5 size-4 shrink-0" />
            Uploaders can leave their email: they&apos;re told every time their file is opened, printed, downloaded or changed, with a link to delete it there and then. Everything done to an upload is in its activity log.
          </p>
        </div>
      )}
    </Dialog>
  );
}

/** When a file is deleted completely (or kept). */
export function StayDialog({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  const base = useDocsBase();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const [v, setV] = useState<string>(file.deleteAt ? "1440" : "keep");
  const save = useMutation({
    mutationFn: () => api<{ deleteAt: string | null }>(`${base}/files/${file.id}/stay`, { method: "PUT", body: { minutes: v === "keep" ? null : Number(v) } }),
    onSuccess: (r) => (refresh(), toast({ tone: "success", title: r.deleteAt ? `It'll be deleted ${leftOf(r.deleteAt)}` : "It's kept until someone deletes it" }), onClose()),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  return (
    <Dialog open onClose={onClose} size="sm" title="Delete automatically" description={file.deleteAt ? `Now: deleted completely ${when(file.deleteAt)}.` : "Now: kept until someone deletes it."} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <Field label="Delete it completely">
        {(a) => (
          <Select {...a} value={v} onChange={(e) => setV(e.target.value)}>
            {STAY_CHOICES.map((c) => <option key={c.label} value={c.minutes === null ? "keep" : String(c.minutes)}>{c.minutes === null ? "Never — keep it" : `${c.label} from now`}</option>)}
          </Select>
        )}
      </Field>
      {file.dropped?.email && <p className="mt-3 text-[12.5px] text-muted">{file.dropped.name || "Whoever uploaded it"} is emailed about the change.</p>}
    </Dialog>
  );
}

type Act = { kind: string; detail: Record<string, unknown>; at: string; who: string };

/** Everything done to a file, newest first — who, when and from where. */
export function ActivityDialog({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  const base = useDocsBase();
  const q = useQuery({ queryKey: ["drive", "activity", file.id], queryFn: () => api<{ activity: Act[] }>(`${base}/files/${file.id}/activity`) });
  return (
    <Dialog open onClose={onClose} size="md" title="Activity" description={file.title} footer={<Button onClick={onClose}>Done</Button>}>
      {file.dropped && (
        <p className="mb-3 rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-muted">
          Uploaded by Drive QR{file.dropped.name ? ` by ${file.dropped.name}` : ""}{file.dropped.email ? ` (${file.dropped.email} — emailed about every access)` : ""}.{file.deleteAt ? ` Deleted completely ${when(file.deleteAt)}.` : ""}
        </p>
      )}
      {!q.data ? (
        <Loader2 className="size-5 animate-spin text-muted" />
      ) : !q.data.activity.length ? (
        <p className="text-[13px] text-muted">Nothing yet.</p>
      ) : (
        <ol className="grid gap-2.5">
          {q.data.activity.map((a, i) => {
            const from = [a.detail.device, a.detail.ip].filter(Boolean).join(" · ");
            const who = a.kind === "dropped" ? (typeof a.detail.name === "string" && a.detail.name) || "Someone" : a.who;
            return (
              <li key={i} className="grid gap-0.5 text-[13px]">
                <span><b className="font-medium">{who}</b> — {(LOG_LABEL[a.kind] ?? a.kind.replace(/_/g, " ")).toLowerCase()}{a.kind === "stay_changed" ? `: ${stayLabel((a.detail.stayMinutes as number | null) ?? null).toLowerCase()}` : ""}</span>
                <span className="text-[11.5px] text-subtle">{when(a.at)}{from ? ` · ${from}` : ""}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Dialog>
  );
}
