"use client";

// Hiring: open roles, the candidate board for each, the public careers page,
// and bringing a hire on board.
import { ArrowLeft, Briefcase, Copy, ExternalLink, MoreHorizontal, Plus, Star, UserCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Button, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { CANDIDATE_STAGES, EMPLOYMENT_LABEL, EMPLOYMENT_TYPES, STAGE_LABEL } from "@/lib/hr/model";
import { Avatar, deptName, fmt, fromPaise, lakh, locName, toPaise, todayIst, useHr, useHrAction, useHrQuery } from "./shared";

type Job = { id: string; title: string; departmentId: string | null; locationId: string | null; employmentType: string; description: string; openings: number; salaryRange: string; status: string; createdAt: string; total: number; active: number; hired: number };
const sourceLabel = (s: string) => (s === "careers_page" ? "Careers page" : s === "walk_in" ? "Walk-in" : s === "linkedin" ? "LinkedIn" : s ? s[0].toUpperCase() + s.slice(1) : "—");

type Candidate = { id: string; jobId: string; name: string; email: string; phone: string; source: string; stage: string; rating: number; resumeUrl: string; notes: string; expectedCtc: number | null; employeeId: string | null; createdAt: string };

export function HiringView() {
  const { meta, go } = useHr();
  const toast = useToast();
  const q = useHrQuery<{ jobs: Job[]; careersUrl: string }>("jobs");
  const [editing, setEditing] = useState<Partial<Job> | null>(null);
  return (
    <div>
      <PageHeader title="Hiring" description="Open roles, candidates and your public careers page." actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>Open a role</Button>} />
      {q.data && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-[18px] border border-border bg-surface px-4 py-3 text-[13px] shadow-sm">
          <span className="text-muted">Careers page:</span>
          <code className="min-w-0 flex-1 truncate text-[12px]">{q.data.careersUrl}</code>
          <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(q.data!.careersUrl).then(() => toast({ tone: "success", title: "Copied" }))}>
            Copy
          </Button>
          <a href={q.data.careersUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
            Open <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
      {!q.data ? (
        <Skeleton className="h-48 rounded-[20px]" />
      ) : !q.data.jobs.length ? (
        <EmptyState icon={<Briefcase />} title="No roles yet" description="Open a role — it appears on your careers page, where people can apply." action={<Button size="sm" variant="primary" onClick={() => setEditing({})}>Open a role</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.jobs.map((j) => (
            <button key={j.id} type="button" onClick={() => go(`hiring/${j.id}`)} className={cx("rounded-[20px] border border-border bg-surface p-4 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md", j.status === "closed" && "opacity-60")}>
              <p className="flex items-start justify-between gap-2">
                <b className="text-[15px]">{j.title}</b>
                <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", j.status === "open" ? "bg-success-soft text-success" : j.status === "paused" ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted")}>{j.status === "open" ? "Open" : j.status === "paused" ? "Paused" : "Closed"}</span>
              </p>
              <p className="mt-1 text-[12.5px] text-muted">{[deptName(meta, j.departmentId), locName(meta, j.locationId), EMPLOYMENT_LABEL[j.employmentType]].filter((x) => x !== "—").join(" · ")}</p>
              <div className="mt-3 flex gap-4 text-[12.5px]">
                <span>
                  <b className="tabular-nums">{j.active}</b> <span className="text-muted">in progress</span>
                </span>
                <span>
                  <b className="tabular-nums">{j.hired}</b>/<span className="tabular-nums">{j.openings}</span> <span className="text-muted">hired</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      {editing && <JobDialog init={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function JobDialog({ init, onClose }: { init: Partial<Job>; onClose: () => void }) {
  const { meta } = useHr();
  const [f, setF] = useState({ title: init.title ?? "", departmentId: init.departmentId ?? "", locationId: init.locationId ?? "", employmentType: init.employmentType ?? "full_time", description: init.description ?? "", openings: String(init.openings ?? 1), salaryRange: init.salaryRange ?? "", status: init.status ?? "open" });
  const save = useHrAction(() => ({ path: init.id ? `jobs/${init.id}` : "jobs", method: init.id ? "PUT" : "POST", body: { ...f, departmentId: f.departmentId || null, locationId: f.locationId || null, openings: Number(f.openings) || 1 } }), { success: init.id ? "Saved" : "Role opened — it's on your careers page", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={init.id ? `Edit ${init.title}` : "Open a role"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} autoFocus placeholder="Senior Sales Executive" />}</Field>
        <Field label="Department">
          {(a) => (
            <Select {...a} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
              <option value="">—</option>
              {meta.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Location">
          {(a) => (
            <Select {...a} value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
              <option value="">—</option>
              {meta.locations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Type">
          {(a) => (
            <Select {...a} value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value })}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EMPLOYMENT_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Openings">{(a) => <Input {...a} inputMode="numeric" value={f.openings} onChange={(e) => setF({ ...f, openings: e.target.value.replace(/\D/g, "") })} />}</Field>
        <Field label="Salary range (shown publicly)">{(a) => <Input {...a} value={f.salaryRange} onChange={(e) => setF({ ...f, salaryRange: e.target.value })} placeholder="₹4–6L a year" maxLength={80} />}</Field>
        {init.id && (
          <Field label="Status">
            {(a) => (
              <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="open">Open</option>
                <option value="paused">Paused (hidden)</option>
                <option value="closed">Closed</option>
              </Select>
            )}
          </Field>
        )}
        <Field label="About the role" className="sm:col-span-2">{(a) => <Textarea {...a} rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={10000} placeholder="What they'll do, who you're looking for…" />}</Field>
      </div>
    </Dialog>
  );
}

export function JobPage({ id }: { id: string }) {
  const { go } = useHr();
  const q = useHrQuery<{ job: Job; columns: { stage: string; candidates: Candidate[] }[] }>(`jobs/${id}`);
  const [adding, setAdding] = useState(false);
  const [editingJob, setEditingJob] = useState(false);
  const [open, setOpen] = useState<Candidate | null>(null);
  const [hiring, setHiring] = useState<Candidate | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const move = useHrAction<{ id: string; stage: string }>((b) => ({ path: `candidates/${b.id}/move`, body: { stage: b.stage } }));
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { job, columns } = q.data;
  return (
    <div>
      <Link href="/hr/hiring" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> Hiring
      </Link>
      <PageHeader
        title={job.title}
        description={`${job.openings} opening${job.openings === 1 ? "" : "s"}${job.salaryRange ? ` · ${job.salaryRange}` : ""} · opened ${fmt(job.createdAt.slice(0, 10))}`}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setEditingJob(true)}>
              Edit role
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Candidate
            </Button>
          </div>
        }
      />
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-3">
          {columns.map((col) => (
            <section
              key={col.stage}
              aria-label={STAGE_LABEL[col.stage]}
              onDragOver={(e) => drag && col.stage !== "hired" && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && col.stage !== "hired") move.mutate({ id: drag, stage: col.stage });
                setDrag(null);
              }}
              className={cx("flex w-[240px] shrink-0 flex-col rounded-[20px] p-2", col.stage === "hired" ? "bg-success-soft/50" : col.stage === "rejected" ? "bg-surface-2/50" : "bg-surface-2/80")}
            >
              <p className="flex items-center justify-between px-2 pt-1 pb-2 text-[13px] font-semibold">
                {STAGE_LABEL[col.stage]}
                <span className="rounded-full bg-surface px-2 text-[11.5px] tabular-nums text-muted">{col.candidates.length}</span>
              </p>
              <ol className="grid min-h-[80px] gap-2">
                {col.candidates.map((c) => (
                  <li key={c.id} draggable={!c.employeeId} onDragStart={() => setDrag(c.id)} onDragEnd={() => setDrag(null)} className={cx(drag === c.id && "opacity-40")}>
                    <div className="group rounded-[14px] border border-border bg-surface p-3 shadow-sm">
                      <div className="flex items-start gap-2">
                        <button type="button" onClick={() => setOpen(c)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <Avatar name={c.name} size={28} />
                          <span className="min-w-0">
                            <b className="block truncate text-[13px]">{c.name}</b>
                            <span className="block truncate text-[11.5px] text-muted">{c.source === "careers_page" ? "Applied online" : sourceLabel(c.source)} · {fmt(c.createdAt.slice(0, 10), { day: "numeric", month: "short" })}</span>
                          </span>
                        </button>
                        {!c.employeeId && (
                          <Menu
                            label={`Move ${c.name}`}
                            trigger={(p) => (
                              <button {...p} type="button" aria-label="Move" className="grid size-6 place-items-center rounded-full text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 focus:opacity-100">
                                <MoreHorizontal className="size-4" />
                              </button>
                            )}
                            items={[...CANDIDATE_STAGES.filter((s) => s !== c.stage && s !== "hired").map((s) => ({ label: `Move to ${STAGE_LABEL[s]}`, onSelect: () => move.mutate({ id: c.id, stage: s }) })), "separator" as const, { label: "Hire", icon: <UserCheck className="size-4" />, onSelect: () => setHiring(c) }]}
                          />
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="flex">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star key={n} className={cx("size-3", n <= c.rating ? "fill-[#f59e0b] text-[#f59e0b]" : "text-border")} />
                          ))}
                        </span>
                        {c.employeeId ? (
                          <Link href={`/hr/people/${c.employeeId}`} className="text-[11.5px] font-medium text-success hover:underline">
                            Employee →
                          </Link>
                        ) : (
                          col.stage === "offer" && (
                            <button type="button" onClick={() => setHiring(c)} className="text-[11.5px] font-semibold text-accent hover:underline">
                              Hire
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
      {adding && <CandidateDialog jobId={id} onClose={() => setAdding(false)} />}
      {open && <CandidateDialog jobId={id} init={open} onClose={() => setOpen(null)} />}
      {hiring && <HireDialog c={hiring} job={job} onClose={() => setHiring(null)} onDone={(eid) => go(`people/${eid}`)} />}
      {editingJob && <JobDialog init={job} onClose={() => setEditingJob(false)} />}
    </div>
  );
}

function CandidateDialog({ jobId, init, onClose }: { jobId: string; init?: Candidate; onClose: () => void }) {
  const [f, setF] = useState({ name: init?.name ?? "", email: init?.email ?? "", phone: init?.phone ?? "", source: init?.source ?? "referral", resumeUrl: init?.resumeUrl ?? "", notes: init?.notes ?? "", rating: init?.rating ?? 0, expectedCtc: fromPaise(init?.expectedCtc ?? 0) });
  const save = useHrAction(() => ({ path: init ? `candidates/${init.id}` : "candidates", method: init ? "PUT" : "POST", body: { ...f, jobId, expectedCtc: f.expectedCtc ? toPaise(f.expectedCtc) : null } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={init ? init.name : "Add a candidate"} description={init ? `${STAGE_LABEL[init.stage]}${init.source === "careers_page" ? " · applied on your careers page" : ""}` : undefined} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} autoFocus={!init} />}</Field>
        <Field label="Source">
          {(a) => (
            <Select {...a} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              {["referral", "careers_page", "linkedin", "naukri", "walk_in", "agency", "manual"].map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Email">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Phone">{(a) => <Input {...a} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label="CV link">{(a) => <Input {...a} type="url" value={f.resumeUrl} onChange={(e) => setF({ ...f, resumeUrl: e.target.value })} placeholder="https://" />}</Field>
        <Field label="Expected CTC (₹ a year)">{(a) => <Input {...a} inputMode="decimal" value={f.expectedCtc} onChange={(e) => setF({ ...f, expectedCtc: e.target.value })} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium">Rating</p>
          <span className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-label={`${n} stars`} onClick={() => setF({ ...f, rating: n === f.rating ? 0 : n })}>
                <Star className={cx("size-5", n <= f.rating ? "fill-[#f59e0b] text-[#f59e0b]" : "text-border")} />
              </button>
            ))}
          </span>
        </div>
        <Field label="Interview notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={5000} />}</Field>
        {init?.resumeUrl && (
          <a href={init.resumeUrl} target="_blank" rel="noreferrer" className="text-[13px] font-medium underline sm:col-span-2">
            Open their CV
          </a>
        )}
      </div>
    </Dialog>
  );
}

function HireDialog({ c, job, onClose, onDone }: { c: Candidate; job: Job; onClose: () => void; onDone: (id: string) => void }) {
  const { meta } = useHr();
  const [f, setF] = useState({ joinDate: todayIst(), ctc: fromPaise(c.expectedCtc ?? 0), designation: job.title, managerId: "" });
  const save = useHrAction<void, { employee: { id: string } }>(() => ({ path: `candidates/${c.id}/hire`, body: { ...f, ctc: toPaise(f.ctc) } }), { success: `${c.name} is on board — their joining checklist is ready`, onDone: (r) => (onClose(), onDone(r.employee.id)) });
  return (
    <Dialog open onClose={onClose} title={`Hire ${c.name}`} description="They become an employee with a joining checklist. Send their offer letter from their profile." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Hire</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Designation">{(a) => <Input {...a} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />}</Field>
        <Field label="Joining date">{(a) => <Input {...a} type="date" value={f.joinDate} onChange={(e) => setF({ ...f, joinDate: e.target.value })} />}</Field>
        <Field label="CTC (₹ a year)">{(a) => <Input {...a} inputMode="decimal" value={f.ctc} onChange={(e) => setF({ ...f, ctc: e.target.value })} />}</Field>
        <Field label="Reports to">
          {(a) => (
            <Select {...a} value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })}>
              <option value="">Nobody</option>
              {meta.people
                .filter((p) => p.status !== "exited")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        {toPaise(f.ctc) > 0 && <p className="text-[12.5px] text-muted sm:col-span-2">{lakh(toPaise(f.ctc))} a year</p>}
      </div>
    </Dialog>
  );
}


