"use client";

// Settings → Notifications: how each person hears about things (in the app,
// by email), and — for owners and admins — the workspace's own wording.
import { SoundSettingsCard } from "./sounds";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

type Prefs = Record<string, { label: string; app: boolean; email: boolean }>;
type Template = { kind: string; label: string; fields: string[]; subject: string | null; body: string | null };

export function NotificationSettings() {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/api/v1/orgs/${org.id}/notifications`;
  const prefs = useQuery({ queryKey: ["notify", org.id, "prefs"], queryFn: () => api<{ prefs: Prefs }>(`${base}/prefs`) });
  const admin = ["owner", "admin"].includes(org.role);
  const tpls = useQuery({ queryKey: ["notify", org.id, "templates"], queryFn: () => api<{ templates: Template[] }>(`${base}/templates`), enabled: admin });
  const save = useMutation({
    mutationFn: (p: Prefs) => api(`${base}/prefs`, { method: "PUT", body: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { app: v.app, email: v.email }])) }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["notify", org.id, "prefs"] }), toast({ tone: "success", title: "Saved" })),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const [editing, setEditing] = useState<Template | null>(null);
  if (!prefs.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const p = prefs.data.prefs;
  const set = (k: string, ch: "app" | "email", v: boolean) => save.mutate({ ...p, [k]: { ...p[k], [ch]: v } });
  return (
    <div className="grid gap-8">
      <SoundSettingsCard />
      <section>
        <h2 className="text-[16px] font-semibold">How you hear about things</h2>
        <p className="mt-1 text-[13px] text-muted">For you, in this workspace. Emails are only delivered when the workspace has a mail service; otherwise they&apos;re kept in the outbox.</p>
        <table className="mt-3 w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-muted">
              <th className="py-2 text-left font-medium">When</th>
              <th className="w-24 py-2 font-medium">In the app</th>
              <th className="w-24 py-2 font-medium">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.entries(p).map(([k, v]) => (
              <tr key={k}>
                <td className="py-2.5">{v.label}</td>
                <td className="py-2.5 text-center"><Switch checked={v.app} onChange={(x) => set(k, "app", x)} label={`${v.label}: in the app`} /></td>
                <td className="py-2.5 text-center"><Switch checked={v.email} onChange={(x) => set(k, "email", x)} label={`${v.label}: email`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {admin && (
        <section>
          <h2 className="text-[16px] font-semibold">Wording</h2>
          <p className="mt-1 text-[13px] text-muted">Change what Cloudesk says, for everyone in the workspace. Use fields like {"{{document}}"} to fill in details.</p>
          {!tpls.data ? (
            <Skeleton className="mt-3 h-40 rounded-[16px]" />
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-[16px] border border-border">
              {tpls.data.templates.map((t) => (
                <li key={t.kind} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    {t.label}
                    <span className="block truncate text-[12px] text-muted">{t.subject ?? "Cloudesk's wording"}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>{t.subject ? "Edit" : "Customise"}</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {editing && <TemplateDialog t={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateDialog({ t, onClose }: { t: Template; onClose: () => void }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [subject, setSubject] = useState(t.subject ?? "");
  const [body, setBody] = useState(t.body ?? "");
  const url = `/api/v1/orgs/${org.id}/notifications/templates/${t.kind}`;
  const done = (title: string) => (qc.invalidateQueries({ queryKey: ["notify", org.id, "templates"] }), toast({ tone: "success", title }), onClose());
  const save = useMutation({ mutationFn: () => api(url, { method: "PUT", body: { subject, body } }), onSuccess: () => done("Wording saved"), onError: (e) => toast({ tone: "error", title: errorMessage(e) }) });
  const reset = useMutation({ mutationFn: () => api(url, { method: "DELETE" }), onSuccess: () => done("Back to Cloudesk's wording") });
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t.label}
      description={`Fields you can use: ${t.fields.map((f) => `{{${f}}}`).join(" ")}`}
      footer={
        <>
          {t.subject && <Button variant="ghost" className="mr-auto" loading={reset.isPending} onClick={() => reset.mutate()}>Use Cloudesk&apos;s wording</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!subject.trim() || !body.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Title / email subject">{(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Message">{(p) => <Textarea {...p} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
