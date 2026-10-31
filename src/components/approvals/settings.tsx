"use client";

// Settings → Approvals: the rules (who approves what, above which amounts,
// in which order), and how approvals are going. Owners and admins only.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, EmptyState, Field, Input, Notice, Select, Skeleton, Switch, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { describeApprover, type Approver, type Step } from "@/lib/approvals/model";

type Meta = { me: { id: string; admin: boolean }; kinds: { kind: string; label: string; noun: string; amount: string }[]; people: { id: string; name: string; role: string }[]; roles: string[]; departments: { id: string; name: string }[]; groups: { id: string; name: string }[] };
type Policy = { id: string; kind: string; name: string; active: boolean; priority: number; conditions: { minAmount: number | null; maxAmount: number | null; departmentIds: string[] }; steps: Step[]; version: number };
type Analytics = { byKind: { kind: string; label: string; pending: number; approved: number; rejected: number; hours: number; overdue: number }[]; bottlenecks: { kind: string; step: string; waiting: number; hours: number }[] };

const rupees = (p: number | null) => (p === null ? "" : String(p / 100));
const paise = (v: string) => (v.trim() === "" ? null : Math.round(Number(v.replace(/[^\d.]/g, "")) * 100));
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;

function useApi<T>(path: string, enabled = true) {
  const { org } = useSession();
  return useQuery({ queryKey: ["approvals", org.id, path], queryFn: () => api<T>(`/api/v1/orgs/${org.id}/approvals/${path}`), enabled });
}

export function ApprovalSettings() {
  const meta = useApi<Meta>("meta");
  const admin = !!meta.data?.me.admin;
  const policies = useApi<{ policies: Policy[] }>("policies", admin);
  const stats = useApi<Analytics>("analytics", admin);
  const [editing, setEditing] = useState<Policy | "new" | null>(null);
  if (!meta.data) return <Skeleton className="h-60 rounded-[20px]" />;
  if (!admin) return <Notice title="Only owners and admins change approval rules">You can see what&apos;s waiting on you, and who approves for you while you&apos;re away, in My work.</Notice>;
  const m = meta.data;
  const name = (id: string) => m.people.find((p) => p.id === id)?.name ?? "someone";
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">Approval rules</h2>
          <p className="mt-1 max-w-xl text-[13px] text-muted">Pick what needs approval, above what amount, and who signs off, step by step. A document follows the first rule that matches it. Nobody approves their own request.</p>
        </div>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
          New rule
        </Button>
      </div>
      {!policies.data ? (
        <Skeleton className="h-40 rounded-[20px]" />
      ) : !policies.data.policies.length ? (
        <EmptyState title="No approval rules yet" description="Without rules, bills, orders, journals, claims and payroll take effect straight away — as they always have." action={<Button size="sm" variant="primary" onClick={() => setEditing("new")}>Add the first rule</Button>} />
      ) : (
        <div className="grid gap-4">
          {m.kinds.map((k) => {
            const list = policies.data!.policies.filter((p) => p.kind === k.kind);
            if (!list.length) return null;
            return (
              <section key={k.kind}>
                <h3 className="mb-2 text-[13px] font-semibold text-muted">{k.label}</h3>
                <ul className="grid gap-2">
                  {list.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setEditing(p)} className="w-full rounded-[16px] border border-border bg-surface p-3.5 text-left shadow-sm hover:bg-surface-2/50">
                        <span className="flex flex-wrap items-center gap-2">
                          <b className="text-[14px] font-semibold">{p.name}</b>
                          {!p.active && <Badge>Off</Badge>}
                          <span className="text-[12px] text-muted">
                            {p.conditions.minAmount !== null ? `from ${inr(p.conditions.minAmount)}` : "any amount"}
                            {p.conditions.maxAmount !== null ? ` up to ${inr(p.conditions.maxAmount)}` : ""}
                            {p.conditions.departmentIds.length ? ` · ${p.conditions.departmentIds.map((d) => m.departments.find((x) => x.id === d)?.name ?? "").join(", ")}` : ""}
                          </span>
                          <span className="ml-auto text-[11.5px] text-subtle">v{p.version}</span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
                          {p.steps.map((s, i) => (
                            <span key={i} className="rounded-full bg-surface-2 px-2.5 py-1">
                              {i + 1}. {s.name}: {s.approvers.map((a) => describeApprover(a, name, (id) => m.groups.find((g) => g.id === id)?.name ?? "a group")).join(s.mode === "all" ? " and " : " or ")}
                              {s.minAmount !== null ? ` · from ${inr(s.minAmount)}` : ""}
                              {s.slaHours ? ` · ${s.slaHours}h` : ""}
                            </span>
                          ))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <section>
        <h2 className="text-[16px] font-semibold">How approvals are going</h2>
        <p className="mt-1 text-[13px] text-muted">The last 90 days.</p>
        {!stats.data?.byKind.length ? (
          <p className="mt-3 rounded-[16px] border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted">Nothing has gone through approval yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="text-right text-[12px] text-muted">
                  <th className="py-2 text-left font-medium">What</th>
                  <th className="py-2 font-medium">Waiting</th>
                  <th className="py-2 font-medium">Overdue</th>
                  <th className="py-2 font-medium">Approved</th>
                  <th className="py-2 font-medium">Sent back</th>
                  <th className="py-2 font-medium">Average time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-right tabular-nums">
                {stats.data.byKind.map((k) => (
                  <tr key={k.kind}>
                    <td className="py-2 text-left">{k.label}</td>
                    <td className="py-2">{k.pending}</td>
                    <td className={cx("py-2", k.overdue > 0 && "font-semibold text-danger")}>{k.overdue}</td>
                    <td className="py-2">{k.approved}</td>
                    <td className="py-2">{k.rejected}</td>
                    <td className="py-2">{k.approved + k.rejected ? (k.hours < 1 ? `${Math.round(k.hours * 60)} min` : `${k.hours.toFixed(1)} h`) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {stats.data && stats.data.bottlenecks.length > 0 && (
          <div className="mt-3">
            <p className="text-[13px] font-medium">Where things wait</p>
            <ul className="mt-1 grid gap-1 text-[12.5px] text-muted">
              {stats.data.bottlenecks.map((b) => (
                <li key={`${b.kind}-${b.step}`}>
                  {m.kinds.find((k) => k.kind === b.kind)?.label} at “{b.step}”: {b.waiting} waiting, the oldest for {b.hours < 24 ? `${Math.round(b.hours)} h` : `${Math.round(b.hours / 24)} days`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {editing && <PolicyDialog meta={m} policy={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

type StepForm = { name: string; mode: "any" | "all"; minAmount: string; slaHours: string; escalateTo: string[]; approvers: { type: Approver["type"]; userId: string; role: string; groupId: string; limit: string }[] };
const blankStep = (): StepForm => ({ name: "", mode: "any", minAmount: "", slaHours: "", escalateTo: [], approvers: [{ type: "role", userId: "", role: "owner", groupId: "", limit: "" }] });

function PolicyDialog({ meta, policy, onClose }: { meta: Meta; policy?: Policy; onClose: () => void }) {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState(policy?.kind ?? meta.kinds[0]?.kind ?? "acc.bill");
  const [name, setName] = useState(policy?.name ?? "");
  const [active, setActive] = useState(policy?.active ?? true);
  const [priority, setPriority] = useState(String(policy?.priority ?? 0));
  const [min, setMin] = useState(rupees(policy?.conditions.minAmount ?? null));
  const [max, setMax] = useState(rupees(policy?.conditions.maxAmount ?? null));
  const [depts, setDepts] = useState<string[]>(policy?.conditions.departmentIds ?? []);
  const [steps, setSteps] = useState<StepForm[]>(
    policy?.steps.map((s) => ({ name: s.name, mode: s.mode, minAmount: rupees(s.minAmount), slaHours: s.slaHours ? String(s.slaHours) : "", escalateTo: s.escalateTo, approvers: s.approvers.map((a) => ({ type: a.type, userId: a.type === "user" ? a.userId : "", role: a.type === "role" ? a.role : "owner", groupId: a.type === "group" ? a.groupId : "", limit: rupees(a.limit) })) })) ?? [{ ...blankStep(), name: "Approval" }],
  );
  const [deleting, setDeleting] = useState(false);
  const setStep = (i: number, p: Partial<StepForm>) => setSteps((x) => x.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const body = () => ({
    kind,
    name,
    active,
    priority: Number(priority) || 0,
    conditions: { minAmount: paise(min), maxAmount: paise(max), departmentIds: depts },
    steps: steps.map((s) => ({
      name: s.name,
      mode: s.mode,
      minAmount: paise(s.minAmount),
      slaHours: s.slaHours ? Number(s.slaHours) : null,
      escalateTo: s.escalateTo,
      approvers: s.approvers.map((a) => (a.type === "user" ? { type: "user", userId: a.userId, limit: paise(a.limit) } : a.type === "role" ? { type: "role", role: a.role, limit: paise(a.limit) } : a.type === "group" ? { type: "group", groupId: a.groupId, limit: paise(a.limit) } : { type: "manager", limit: paise(a.limit) })),
    })),
  });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["approvals", org.id] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => api(`/api/v1/orgs/${org.id}/approvals/policies${policy ? `/${policy.id}` : ""}`, { method: policy ? "PUT" : "POST", body: body() }),
    onSuccess: () => (toast({ tone: "success", title: policy ? "Rule saved — new requests use it; ones already waiting keep their steps" : "Rule added" }), done()),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/v1/orgs/${org.id}/approvals/policies/${policy!.id}`, { method: "DELETE" }),
    onSuccess: () => (toast({ tone: "success", title: "Rule deleted" }), done()),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const k = meta.kinds.find((x) => x.kind === kind);
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={policy ? `Edit “${policy.name}”` : "New approval rule"}
      footer={
        <>
          {policy && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)} className="mr-auto">Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !steps.length} onClick={() => save.mutate()}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What needs approval">
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)} disabled={!!policy}>
              {meta.kinds.map((x) => (
                <option key={x.kind} value={x.kind}>{x.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${k?.label ?? "Bills"} over ₹50,000`} />}</Field>
        <Field label={`${k?.amount ?? "Amount"} from (₹)`} hint="Leave blank for any amount">{(p) => <Input {...p} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />}</Field>
        <Field label="Up to (₹)">{(p) => <Input {...p} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />}</Field>
        {meta.departments.length > 0 && (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-[13px] font-medium">Only for people in</p>
            <div className="flex flex-wrap gap-1.5">
              {meta.departments.map((d) => {
                const on = depts.includes(d.id);
                return (
                  <button key={d.id} type="button" aria-pressed={on} onClick={() => setDepts(on ? depts.filter((x) => x !== d.id) : [...depts, d.id])} className={cx("h-8 rounded-full px-3 text-[12.5px] font-medium", on ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>
                    {d.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11.5px] text-subtle">Departments come from HR. None picked means everyone.</p>
          </div>
        )}
        <Field label="Order" hint="When rules overlap, lower numbers are checked first">{(p) => <Input {...p} type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} className="max-w-[120px]" />}</Field>
        <div className="flex items-end gap-2.5 pb-1 text-[13px]">
          <Switch checked={active} onChange={setActive} label="Rule is on" />
          <span>Rule is on</span>
        </div>
      </div>
      <h3 className="mt-6 text-[14px] font-semibold">Steps</h3>
      <p className="text-[12.5px] text-muted">In order. Each step finishes before the next starts.</p>
      <ol className="mt-3 grid gap-3">
        {steps.map((s, i) => (
          <li key={i} className="rounded-[16px] border border-border p-3">
            <div className="flex items-center gap-2">
              <b className="text-[13px]">Step {i + 1}</b>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => setSteps((x) => (([x[i - 1], x[i]] = [x[i], x[i - 1]]), [...x]))} />
                <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => setSteps((x) => (([x[i + 1], x[i]] = [x[i], x[i + 1]]), [...x]))} />
                <Button size="sm" variant="ghost" aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} icon={<Trash2 className="size-3.5" />} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} />
              </span>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} placeholder="e.g. Finance" />}</Field>
              <Field label="Who must approve">
                {(p) => (
                  <Select {...p} value={s.mode} onChange={(e) => setStep(i, { mode: e.target.value as "any" | "all" })}>
                    <option value="any">Any one of them</option>
                    <option value="all">All of them</option>
                  </Select>
                )}
              </Field>
              <Field label="Only from (₹)" hint="Skip below this">{(p) => <Input {...p} inputMode="decimal" value={s.minAmount} onChange={(e) => setStep(i, { minAmount: e.target.value })} />}</Field>
            </div>
            <div className="mt-3 grid gap-2">
              {s.approvers.map((a, j) => (
                <div key={j} className="grid grid-cols-[130px_minmax(0,1fr)_120px_32px] items-center gap-2">
                  <Select aria-label="Approver type" value={a.type} onChange={(e) => setStep(i, { approvers: s.approvers.map((x, n) => (n === j ? { ...x, type: e.target.value as Approver["type"] } : x)) })}>
                    <option value="role">Anyone who is</option>
                    <option value="user">A person</option>
                    <option value="manager">Their manager</option>
                    {meta.groups.length > 0 && <option value="group">Anyone in a group</option>}
                  </Select>
                  {a.type === "role" ? (
                    <Select aria-label="Role" value={a.role} onChange={(e) => setStep(i, { approvers: s.approvers.map((x, n) => (n === j ? { ...x, role: e.target.value } : x)) })}>
                      {meta.roles.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </Select>
                  ) : a.type === "user" ? (
                    <Select aria-label="Person" value={a.userId} onChange={(e) => setStep(i, { approvers: s.approvers.map((x, n) => (n === j ? { ...x, userId: e.target.value } : x)) })}>
                      <option value="">Pick someone</option>
                      {meta.people.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  ) : a.type === "group" ? (
                    <Select aria-label="Group" value={a.groupId} onChange={(e) => setStep(i, { approvers: s.approvers.map((x, n) => (n === j ? { ...x, groupId: e.target.value } : x)) })}>
                      <option value="">Pick a group</option>
                      {meta.groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-[12.5px] text-muted">From HR&apos;s reporting line (owners if they have none)</span>
                  )}
                  <Input aria-label="Approval limit" inputMode="decimal" value={a.limit} onChange={(e) => setStep(i, { approvers: s.approvers.map((x, n) => (n === j ? { ...x, limit: e.target.value } : x)) })} placeholder="No limit (₹)" title="Their approval only counts up to this amount" />
                  <button type="button" aria-label="Remove approver" disabled={s.approvers.length === 1} onClick={() => setStep(i, { approvers: s.approvers.filter((_, n) => n !== j) })} className="grid size-8 place-items-center text-subtle hover:text-danger disabled:opacity-30">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setStep(i, { approvers: [...s.approvers, { type: "user", userId: "", role: "owner", groupId: "", limit: "" }] })} className="justify-self-start">
                Approver
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <Field label="Escalate after (hours)">{(p) => <Input {...p} type="number" min={1} value={s.slaHours} onChange={(e) => setStep(i, { slaHours: e.target.value })} placeholder="Never" />}</Field>
              {s.slaHours && (
                <div>
                  <p className="mb-1.5 text-[13px] font-medium">Tell</p>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.people.map((p) => {
                      const on = s.escalateTo.includes(p.id);
                      return (
                        <button key={p.id} type="button" aria-pressed={on} onClick={() => setStep(i, { escalateTo: on ? s.escalateTo.filter((x) => x !== p.id) : [...s.escalateTo, p.id] })} className={cx("h-7 rounded-full px-2.5 text-[12px] font-medium", on ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[11.5px] text-subtle">None picked tells the workspace owners. The approvers are reminded too.</p>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setSteps((x) => [...x, blankStep()])} className="mt-3">
        Add a step
      </Button>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title={`Delete “${policy?.name}”?`} description="New documents won't need this approval. Ones already waiting finish with the steps they started with." confirmLabel="Delete rule" destructive loading={del.isPending} onConfirm={() => del.mutate()} />
    </Dialog>
  );
}
