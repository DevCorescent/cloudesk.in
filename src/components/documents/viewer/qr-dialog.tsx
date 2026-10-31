"use client";

// A QR code that opens a document or file: for your team (they sign in, and
// it only opens for people who can open it) or for anyone (it turns on the
// read-only link, which can be turned off again). Download it as PNG or SVG,
// copy the link, or print a card to stick on a wall, a box or a contract.
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, Download, Globe, Loader2, Printer, Users } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { downloadUrl, useDocsBase, useDriveRefresh } from "../drive/shared";

type Link = { url: string; role: string; expiresAt: string | null } | null;

export function QrDialog({ file, onClose }: { file: { id: string; title: string; kind: "doc" | "file"; role: string }; onClose: () => void }) {
  const base = useDocsBase();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const [who, setWho] = useState<"team" | "anyone">("team");
  const shares = useQuery({ queryKey: ["drive", "shares", `fileId=${file.id}`], queryFn: () => api<{ link: Link }>(`${base}/shares?fileId=${file.id}`), enabled: file.role === "edit" });
  const turnOn = useMutation({
    mutationFn: () => api<{ link: Link }>(`${base}/files/${file.id}/link`, { method: "PUT", body: { on: true } }),
    onSuccess: () => (void shares.refetch(), refresh()),
    onError: (e) => toast({ tone: "error", title: "Couldn't turn on the link", description: errorMessage(e) }),
  });
  const team = typeof window === "undefined" ? "" : `${window.location.origin}${file.kind === "doc" ? `/documents/d/${file.id}` : `/documents/file/${file.id}`}`;
  const link = who === "team" ? team : (shares.data?.link?.url ?? "");
  const [png, setPng] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!link) return;
    let alive = true;
    const opts = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#111113", light: "#ffffff" } };
    void Promise.all([QRCode.toDataURL(link, { ...opts, width: 720 }), QRCode.toString(link, { ...opts, type: "svg" })]).then(([p, s]) => {
      if (alive) {
        setPng(p);
        setSvg(s);
      }
    });
    return () => {
      alive = false;
    };
  }, [link]);
  const name = file.title.replace(/[^\w\- .()]+/g, "").trim() || "document";
  const print = () => {
    if (!png) return;
    const w = window.open("", "_blank", "noopener=no");
    if (!w) return;
    w.document.write(`<!doctype html><title>${escapeHtml(file.title)} — QR</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:95vh;margin:0}.card{border:1px solid #ddd;border-radius:20px;padding:28px 32px;text-align:center;width:320px}img{width:260px;height:260px}h1{font-size:18px;margin:14px 0 4px}p{color:#666;font-size:12px;margin:0;word-break:break-all}</style><div class="card"><img src="${png}" alt=""><h1>${escapeHtml(file.title)}</h1><p>${who === "team" ? "Scan to open in Cloudesk (sign in)" : "Scan to read"}</p></div>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  const needsLink = who === "anyone" && !shares.data?.link;
  return (
    <Dialog open onClose={onClose} title="QR code" description="Scan it with a phone camera to open this straight away." size="md" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="grid gap-4">
        <div role="radiogroup" aria-label="Who it opens for" className="grid grid-cols-2 gap-1 rounded-[14px] bg-fg/[0.05] p-1">
          {(
            [
              ["team", <Users key="t" className="size-4" />, "Your team", "Signs in; only people with access"],
              ["anyone", <Globe key="a" className="size-4" />, "Anyone", "Read-only, no sign-in"],
            ] as const
          ).map(([id, icon, label, line]) => (
            <button key={id} type="button" role="radio" aria-checked={who === id} disabled={id === "anyone" && file.role !== "edit"} onClick={() => setWho(id)} className={clsx("flex items-start gap-2 rounded-[11px] px-3 py-2 text-left disabled:opacity-40", who === id ? "bg-[var(--surface-solid)] shadow-sm" : "text-muted")}>
              <span className="mt-0.5">{icon}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{label}</span>
                <span className="block text-[11.5px] text-muted">{line}</span>
              </span>
            </button>
          ))}
        </div>
        {needsLink ? (
          <div className="rounded-[16px] border border-dashed border-border p-6 text-center">
            <Globe className="mx-auto size-7 text-fg/30" />
            <p className="mt-2 text-[13.5px] font-medium">Turn on the read-only link?</p>
            <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted">Anyone with the link or the code can read it, without signing in. You can turn it off any time from Share, and the code stops working.</p>
            <Button className="mt-3" variant="primary" loading={turnOn.isPending} onClick={() => turnOn.mutate()}>
              Turn on the link
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <div className="grid size-[220px] shrink-0 place-items-center rounded-[20px] border border-border bg-white p-2 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL */}
              {png ? <img src={png} alt={`QR code for ${file.title}`} className="size-full" /> : <Loader2 className="size-6 animate-spin text-black/40" />}
            </div>
            <div className="grid w-full min-w-0 gap-2">
              <p className="text-[13.5px] font-semibold break-words">{file.title}</p>
              <p className="text-[12px] break-all text-muted">{link}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Button size="sm" icon={<Download className="size-3.5" />} disabled={!png} onClick={() => png && downloadUrl(png, `${name} QR.png`)}>
                  PNG
                </Button>
                <Button size="sm" icon={<Download className="size-3.5" />} disabled={!svg} onClick={() => svg && downloadUrl(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })), `${name} QR.svg`)}>
                  SVG
                </Button>
                <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(link).then(() => toast({ tone: "success", title: "Link copied" }))}>
                  Copy link
                </Button>
                <Button size="sm" icon={<Printer className="size-3.5" />} disabled={!png} onClick={print}>
                  Print
                </Button>
              </div>
              <p className="text-[11.5px] text-muted">{who === "team" ? "It opens only for people in your workspace who can open this." : "Turn off the link in Share to stop this code working."}</p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
