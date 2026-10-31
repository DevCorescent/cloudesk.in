"use client";

// "Your fields" on a built-in record: the workspace's custom fields, filled in
// and checked against its rules, plus records of its own objects that link
// here. Shows nothing when there are no fields and no links (owners and
// admins get a pointer to add some).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import { Button, Card, Field, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import type { EntityId } from "@/lib/custom/entities";
import type { Value, Values } from "@/lib/custom/model";
import { CustomInput, display, fieldErrors, type Def } from "./inputs";

type Resp = { fields: Def[]; values: Values; titles: Record<string, string>; backlinks: { objectId: string; object: string; field: string; id: string; title: string }[]; canEdit: boolean; manage: boolean };

export function CustomFieldsCard({ entity, id, className }: { entity: EntityId; id: string; className?: string }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["custom", org.id, "values", entity, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Resp>(`/api/v1/orgs/${org.id}/custom/values?entity=${entity}&id=${id}`), retry: false });
  const [edit, setEdit] = useState<Values | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<{ fields: Record<string, string>; rules: string[] }>({ fields: {}, rules: [] });
  const [saving, setSaving] = useState(false);
  if (!q.data) return null;
  const { fields, values, backlinks } = q.data;
  if (!fields.length && !backlinks.length)
    return q.data.manage ? <p className={className}><Link href={`/settings/customise?entity=${entity}`} className="text-[12.5px] text-muted hover:text-fg">+ Add your own fields</Link></p> : null;
  const allTitles = { ...q.data.titles, ...titles };

  const save = async () => {
    if (!edit) return;
    const changed: Record<string, Value> = {};
    for (const f of fields) if (JSON.stringify(edit[f.key] ?? null) !== JSON.stringify(values[f.key] ?? null)) changed[f.key] = edit[f.key] ?? null;
    if (!Object.keys(changed).length) return setEdit(null);
    setSaving(true);
    try {
      await api(`/api/v1/orgs/${org.id}/custom/values?entity=${entity}&id=${id}`, { method: "PUT", body: changed });
      await qc.invalidateQueries({ queryKey: key });
      setEdit(null);
      setErrs({ fields: {}, rules: [] });
      toast({ tone: "success", title: "Saved" });
    } catch (e) {
      const fe = fieldErrors(e);
      setErrs(fe);
      if (!Object.keys(fe.fields).length && !fe.rules.length) toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={`p-4 ${className ?? ""}`} aria-label="Your fields">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold">Your fields</h3>
        {fields.length > 0 && q.data.canEdit && !edit && <Button size="sm" variant="ghost" onClick={() => (setEdit({ ...values }), setErrs({ fields: {}, rules: [] }))}>Edit</Button>}
      </div>
      {edit ? (
        <div className="space-y-3">
          {errs.rules.length > 0 && <Notice tone="danger">{errs.rules.join(" · ")}</Notice>}
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.id} label={`${f.label}${f.required ? " *" : ""}`} hint={f.help || undefined} error={errs.fields[f.key]} className={f.type === "longtext" || f.type === "multiselect" ? "sm:col-span-2" : undefined}>
                {(a) => <CustomInput def={f} a={a} value={edit[f.key]} titles={allTitles} onChange={(v, t) => (setEdit({ ...edit, [f.key]: v }), t && typeof v === "string" && setTitles({ ...titles, [v]: t }))} />}
              </Field>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => (setEdit(null), setErrs({ fields: {}, rules: [] }))}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>Save</Button>
          </div>
        </div>
      ) : (
        fields.length > 0 && (
          <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.id} className={f.type === "longtext" ? "sm:col-span-2" : undefined}>
                <dt className="text-[12px] text-muted">{f.label}</dt>
                <dd>{display(f, values[f.key], allTitles)}</dd>
              </div>
            ))}
          </dl>
        )
      )}
      {backlinks.length > 0 && (
        <div className="mt-3 border-t border-border pt-3 text-[13px]">
          <p className="mb-1 text-[12px] text-muted">Linked from</p>
          <ul className="space-y-0.5">
            {backlinks.map((b) => (
              <li key={`${b.id}-${b.field}`}><Link href={`/objects/${b.objectId}/${b.id}`} className="underline underline-offset-2">{b.object}: {b.title}</Link> <span className="text-muted">· {b.field}</span></li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
