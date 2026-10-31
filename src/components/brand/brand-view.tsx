"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Palette, Plus, RotateCcw, ShieldCheck, Trash2, Type, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, IconButton, Input, Notice, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import type { BrandIssue, BrandRules } from "@/lib/site/brand-rules";
import { FONTS } from "@/lib/site/fonts";
import type { SiteTheme } from "@/lib/site/model";

type Data = { rules: BrandRules | null; issues: BrandIssue[]; theme: SiteTheme | null; logo: string | null; canManage: boolean };
type Form = { lockPalette: boolean; lockFonts: boolean; lockLogo: boolean; voice: string; bannedWords: string[]; preferredTerms: { avoid: string; use: string }[] };

const fontLabel = (k: string | null | undefined) => (k && (FONTS as Record<string, { label: string }>)[k]?.label) || k || "—";

export function BrandView({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ["brand", projectId], queryFn: () => api<Data>(`/api/v1/projects/${projectId}/brand`) });
  if (q.isPending)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-72" />
      </div>
    );
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <BrandForm key={q.dataUpdatedAt} projectId={projectId} data={q.data} />;
}

function BrandForm({ projectId, data }: { projectId: string; data: Data }) {
  const qc = useQueryClient();
  const toast = useToast();
  const r = data.rules;
  const initial: Form = { lockPalette: r?.lockPalette ?? false, lockFonts: r?.lockFonts ?? false, lockLogo: r?.lockLogo ?? false, voice: r?.voice ?? "", bannedWords: r?.bannedWords ?? [], preferredTerms: r?.preferredTerms ?? [] };
  const [f, setF] = useState(initial);
  const [word, setWord] = useState("");
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const editable = data.canManage;
  const save = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/brand`, { method: "PUT", body: f }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand", projectId] });
      toast({ tone: "success", title: "Brand rules saved", description: f.lockPalette || f.lockFonts || f.lockLogo ? "Locked items now apply to everyone, including the AI." : undefined });
    },
    onError: (e) => toast({ tone: "error", title: "Could not save", description: errorMessage(e) }),
  });
  const restore = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/brand`, { method: "POST", body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand", projectId] });
      qc.invalidateQueries({ queryKey: ["file", projectId] });
      toast({ tone: "success", title: "Locked brand restored on the site" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not restore", description: errorMessage(e) }),
  });
  const addWord = () => {
    const ws = word.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (ws.length) setF({ ...f, bannedWords: [...new Set([...f.bannedWords, ...ws])].slice(0, 100) });
    setWord("");
  };
  const lockedDrift = data.issues.some((i) => i.kind === "palette" || i.kind === "fonts" || i.kind === "logo");
  const wording = data.issues.filter((i) => i.kind === "banned" || i.kind === "preferred");
  const pal = data.theme?.palette;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
        <ShieldCheck className="size-5 text-accent" /> Brand guardrails
      </h1>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">Lock what makes your brand recognisable and describe how it should sound. Locks apply to everyone who edits this site and to the AI; the voice guides every AI-written word.</p>
      {!editable && (
        <div className="mt-4">
          <Notice title="View only">Only owners and admins can change brand rules.</Notice>
        </div>
      )}

      <div className="mt-6 grid gap-4">
        <Card className="p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="size-4 text-muted" /> Locks
          </h2>
          <p className="mt-0.5 text-xs text-muted">Locking saves the site&apos;s current colours, fonts or logo as your brand. To change a locked item later, unlock it here first.</p>
          <div className="mt-4 grid gap-3">
            <LockRow
              icon={<Palette className="size-4" />}
              title="Colours"
              checked={f.lockPalette}
              disabled={!editable}
              onChange={(v) => setF({ ...f, lockPalette: v })}
              detail={
                pal && (
                  <span className="flex gap-1">
                    {(Object.keys(pal) as (keyof typeof pal)[]).map((k) => (
                      <span key={k} className="size-5 rounded-full border border-border" style={{ background: (r?.lockPalette && r.palette ? r.palette : pal)[k] }} title={k} />
                    ))}
                  </span>
                )
              }
            />
            <LockRow icon={<Type className="size-4" />} title="Fonts" checked={f.lockFonts} disabled={!editable} onChange={(v) => setF({ ...f, lockFonts: v })} detail={<span className="text-xs text-muted">{fontLabel(r?.lockFonts ? r.headingFont : data.theme?.headingFont)} / {fontLabel(r?.lockFonts ? r.font : data.theme?.font)}</span>} />
            <LockRow
              icon={<ShieldCheck className="size-4" />}
              title="Logo"
              checked={f.lockLogo}
              disabled={!editable || !data.logo}
              onChange={(v) => setF({ ...f, lockLogo: v })}
              detail={data.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- brand logo preview
                <img src={r?.lockLogo && r.logo ? r.logo : data.logo} alt="" className="h-6 max-w-24 object-contain" />
              ) : <span className="text-xs text-muted">No logo set — add one in the builder&apos;s Style panel</span>}
            />
          </div>
          {lockedDrift && (
            <div className="mt-4">
              <Notice tone="warning" title="The site has drifted from the locked brand" action={<Button size="sm" icon={<RotateCcw className="size-3.5" />} loading={restore.isPending} onClick={() => restore.mutate()}>Restore brand</Button>}>
                This can happen if a lock was set after changes were made.
              </Notice>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Voice</h2>
          <fieldset disabled={!editable} className="mt-3 grid gap-4">
            <Field label="How your brand sounds" hint="Given to the AI whenever it writes for this site.">
              {(a) => <Textarea {...a} rows={3} value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })} maxLength={1500} placeholder="Warm and plain-spoken, like a neighbourhood baker. Short sentences. Never pushy; no exclamation marks." />}
            </Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Words to avoid</p>
              <p className="mb-2 text-xs text-muted">The AI will not use these. They are flagged on your site and in deploy logs.</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {f.bannedWords.map((w) => (
                  <span key={w} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface-2 pr-1 pl-2.5 text-[13px]">
                    {w}
                    <button type="button" aria-label={`Remove ${w}`} className="rounded-full p-0.5 text-muted hover:bg-surface-3 hover:text-fg" onClick={() => setF({ ...f, bannedWords: f.bannedWords.filter((x) => x !== w) })}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <Input aria-label="Add a word to avoid" value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addWord(); } }} onBlur={addWord} placeholder="e.g. cheap, world-class" className="h-7 w-48" />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Preferred terms</p>
              <div className="grid gap-2">
                {f.preferredTerms.map((t, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-muted">Say</span>
                    <Input aria-label="Use" value={t.use} onChange={(e) => setF({ ...f, preferredTerms: f.preferredTerms.map((x, j) => (j === i ? { ...x, use: e.target.value } : x)) })} className="w-40" />
                    <span className="text-muted">instead of</span>
                    <Input aria-label="Avoid" value={t.avoid} onChange={(e) => setF({ ...f, preferredTerms: f.preferredTerms.map((x, j) => (j === i ? { ...x, avoid: e.target.value } : x)) })} className="w-40" />
                    <IconButton size="sm" label="Remove" icon={<Trash2 className="size-3.5" />} onClick={() => setF({ ...f, preferredTerms: f.preferredTerms.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                {f.preferredTerms.length < 50 && (
                  <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => setF({ ...f, preferredTerms: [...f.preferredTerms, { use: "", avoid: "" }] })}>
                    Add a term
                  </Button>
                )}
              </div>
            </div>
          </fieldset>
        </Card>

        {editable && (
          <div className="flex justify-end">
            <Button variant="primary" disabled={!dirty || f.preferredTerms.some((t) => !t.use.trim() || !t.avoid.trim())} loading={save.isPending} onClick={() => save.mutate()}>
              Save brand rules
            </Button>
          </div>
        )}

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Brand check</h2>
          {wording.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">{r ? "No wording issues on your site." : "Set up words to avoid or preferred terms to check your site's copy."}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-[13px]">
              {wording.slice(0, 50).map((i, n) => (
                <li key={n} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <Badge tone={i.kind === "banned" ? "warning" : "neutral"}>{i.kind === "banned" ? "Avoid" : "Prefer"}</Badge> {i.message}
                  </span>
                  <span className="text-xs text-muted">
                    {i.pageTitle} · {i.field}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/projects/${projectId}/builder`} className="mt-3 inline-block text-xs text-accent hover:underline">
            Fix in the builder →
          </Link>
        </Card>
      </div>
    </div>
  );
}

function LockRow({ icon, title, detail, checked, onChange, disabled }: { icon: React.ReactNode; title: string; detail: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-surface-2 text-muted">{icon}</span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium">
            {title} {checked && <Badge tone="accent">Locked</Badge>}
          </p>
          <div className="mt-0.5">{detail}</div>
        </div>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} label={`Lock ${title.toLowerCase()}`} />
    </div>
  );
}
