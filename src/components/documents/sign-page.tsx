"use client";

// The page a signer opens from their link: who's asking, the file (shown here
// for PDFs and images, or downloaded), everyone's progress, and signing by
// typing their name and agreeing — or declining with a reason.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input, Notice, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { size } from "@/lib/documents/model";

type View = { from: string; title: string; message: string; status: string; file: { filename: string; mime: string; size: number; version: number; sha256: string }; me: { name: string; email: string; status: string; signedAt: string | null }; signers: { name: string; status: string; me: boolean }[]; canSign: boolean; expiresAt: string };

export function SignPage({ token }: { token: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sign", token], queryFn: () => api<View>(`/api/v1/sign/${token}`), retry: false });
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileUrl = `/api/v1/sign/${token}/file`;
  const act = async (path: "sign" | "decline", body: unknown) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/sign/${token}/${path}`, { method: "POST", body });
      await qc.invalidateQueries({ queryKey: ["sign", token] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (q.isError) return <Shell><Notice tone="danger" title="This signing link doesn't work">It may have been replaced with a newer one, or the document is finished. Ask whoever sent it for a new link.</Notice></Shell>;
  if (!q.data) return <Shell><Skeleton className="h-80 rounded-[20px]" /></Shell>;
  const v = q.data;
  const viewable = v.file.mime === "application/pdf" || v.file.mime.startsWith("image/");
  return (
    <Shell>
      <p className="text-[12.5px] text-muted">{v.from} has asked you to sign</p>
      <h1 className="mt-1 text-[22px] font-semibold">{v.title}</h1>
      {v.message && <p className="mt-2 text-[14px] whitespace-pre-wrap">{v.message}</p>}
      <ol className="mt-4 flex flex-wrap gap-2 text-[12.5px]">
        {v.signers.map((s, i) => <li key={i} className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1", s.status === "signed" ? "bg-success-soft text-success" : s.status === "declined" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted")}>{s.status === "signed" && <Check className="size-3.5" />}{s.name}{s.me ? " (you)" : ""}</li>)}
      </ol>
      <div className="mt-5 rounded-[20px] border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <FileText className="size-5 text-muted" />
          <span className="min-w-0 flex-1"><b className="block truncate">{v.file.filename}</b><span className="text-[12px] text-muted">{size(v.file.size)} · version {v.file.version}</span></span>
          <a href={fileUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)} className="inline-flex h-8 items-center rounded-[10px] border border-border px-3 text-[13px] font-medium hover:bg-surface-2">{viewable ? "Open" : "Download"}</a>
        </div>
        <p className="mt-3 text-[11.5px] break-all text-muted">SHA-256 {v.file.sha256}</p>
      </div>
      <div className="mt-5">
        {v.me.status === "signed" ? (
          <Notice tone="success" title="You've signed">{v.status === "completed" ? "Everyone has signed. The sender has the certificate of completion." : "We'll let the sender know. Others may still need to sign."}</Notice>
        ) : v.status === "declined" ? (
          <Notice tone="danger" title="This request was declined">Nobody else can sign it now.</Notice>
        ) : v.status !== "sent" ? (
          <Notice tone="neutral" title={`This request is ${v.status}`}>Ask whoever sent it if you need to sign.</Notice>
        ) : !v.canSign ? (
          <Notice tone="neutral" title="Not your turn yet">You&apos;ll get a new email when it&apos;s your turn to sign.</Notice>
        ) : declining ? (
          <div className="grid gap-3">
            <Field label="Why are you declining?">{(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <div className="flex gap-2"><Button onClick={() => setDeclining(false)}>Back</Button><Button variant="primary" disabled={!reason.trim()} loading={busy} onClick={() => act("decline", { reason })}>Decline to sign</Button></div>
          </div>
        ) : (
          <div className="grid gap-3">
            {!opened && <p className="text-[13px] text-muted">Open the document first to read it before you sign.</p>}
            <Field label="Type your full name to sign">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder={v.me.name} className="font-[cursive] text-[18px]" />}</Field>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>I agree to sign this document electronically, and that typing my name here is my signature on it. My name, the time, my IP address and browser are recorded.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!opened || name.trim().length < 2 || !consent} loading={busy} onClick={() => act("sign", { name, consent })}>Sign</Button>
              <Button variant="ghost" onClick={() => setDeclining(true)}>Decline</Button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      </div>
      <p className="mt-8 text-[11.5px] text-muted">Signing for {v.me.name} ({v.me.email}). The link is open until {new Date(v.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}. Click-to-sign electronic signature with an audit trail, through Cloudesk.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-2xl bg-bg px-4 py-10 sm:px-6">{children}</main>;
}
