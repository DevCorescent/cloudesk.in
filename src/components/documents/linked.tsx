"use client";

// The documents and contracts linked to a record elsewhere (a deal, a
// company, a contact, an employee, a project, a supplier, an order, an asset),
// shown on that record's page when Documents is on and open to the member —
// with a quick upload that links the file, and "Write" to start a document
// about the record (linked to it, with its name in the title).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Section } from "@/components/crm/shared";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import type { LINK_TYPES } from "@/lib/documents/model";
import { visibleTo } from "@/lib/workspace/modules";

type Row = { id: string; title: string; filename?: string; number?: string; status?: string; kind?: string; updatedAt?: string };

export function LinkedDocuments({ type, id, name }: { type: (typeof LINK_TYPES)[number]; id: string; name?: string }) {
  const { org } = useSession();
  const on = visibleTo(org, "documents");
  const base = `/api/v1/orgs/${org.id}/documents`;
  const qs = `linkType=${type}&linkId=${id}`;
  const files = useQuery({ queryKey: ["documents", org.id, `files?${qs}`], queryFn: () => api<{ files: Row[] }>(`${base}/files?${qs}`), enabled: on, retry: false });
  const contracts = useQuery({ queryKey: ["documents", org.id, `contracts?${qs}`], queryFn: () => api<{ contracts: Row[] }>(`${base}/contracts?${qs}`), enabled: on, retry: false });
  const meta = useQuery({ queryKey: ["documents", org.id, "meta"], queryFn: () => api<{ me: { write: boolean } }>(`${base}/meta`), enabled: on, retry: false });
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!on || files.isError) return null;
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("meta", JSON.stringify({ title: file.name.replace(/\.[^.]+$/, ""), linkType: type, linkId: id }));
      const res = await fetch(`${base}/files`, { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      await qc.invalidateQueries({ queryKey: ["documents", org.id] });
      toast({ tone: "success", title: "Document added" });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const fs = files.data?.files ?? [];
  const cs = contracts.data?.contracts ?? [];
  return (
    <Section
      title="Documents"
      action={
        <span className="flex items-center gap-1">
          <Link href={`/documents/new?linkType=${type}&linkId=${id}${name ? `&title=${encodeURIComponent(name)}` : ""}`} className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium text-muted hover:bg-fg/[0.05] hover:text-fg">
            <FilePlus2 className="size-3.5" />
            Write
          </Link>
          {meta.data?.me.write && (
            <Button size="sm" variant="ghost" loading={busy} icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>
              Add
            </Button>
          )}
        </span>
      }
    >
      <input ref={input} type="file" aria-label="Add a document" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      {!fs.length && !cs.length ? (
        <p className="text-[13px] text-muted">No documents or contracts linked.</p>
      ) : (
        <ul className="grid gap-1 text-[13px]">
          {cs.map((c) => <li key={c.id}><Link href={`/documents/contracts/${c.id}`} className="inline-flex items-center gap-1.5 hover:underline"><FileText className="size-3.5 text-muted" />{c.number} · {c.title}</Link></li>)}
          {fs.map((f) => (
            <li key={f.id}>
              <Link href={f.kind === "doc" ? `/documents/d/${f.id}` : `/documents/file/${f.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                <FileText className={f.kind === "doc" ? "size-3.5 text-sky-600" : "size-3.5 text-muted"} />
                {f.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
