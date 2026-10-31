"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Check, Circle, Database, FileText, Palette, Plug, Shuffle, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SitePreview } from "@/components/site-preview";
import { Steps } from "@/components/ai/steps";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, Field, Input, Notice, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { isActive, useTask } from "@/lib/client/use-task";
import { PERSONALITIES } from "@/lib/site/design";
import { SECTION_DEFS } from "@/lib/site/model";
import { composeSite, designChoices } from "@/lib/site/planner";
import { renderPage } from "@/lib/site/render";
import type { ProjectSpec } from "@/lib/site/spec";

const EXAMPLES = [
  "A premium website for my restaurant with online reservations, a menu, customer reviews, WhatsApp contact and an admin panel.",
  "A landing page for a SaaS invoicing tool for freelancers, with pricing plans and an FAQ.",
  "A portfolio for an architecture photographer with a gallery and an enquiry form.",
];

function DirectionPicker({ spec, setSpec }: { spec: ProjectSpec; setSpec: (s: ProjectSpec) => void }) {
  const [showAll, setShowAll] = useState(false);
  const choices = showAll ? PERSONALITIES.map((p) => p.id) : designChoices(spec);
  const selected = spec.personality ?? choices[0];
  const seed = spec.designSeed ?? 0;
  // Rendering a home page takes a few milliseconds, so previews are computed directly.
  const previews: Record<string, string> = Object.fromEntries(
    choices.map((id) => {
      const doc = composeSite(spec, { personality: id, seed: id === selected ? seed : 0 });
      return [id, renderPage(doc, doc.pages[0], { kind: "preview" })];
    }),
  );
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Palette className="size-3.5 text-muted" aria-hidden /> Design direction
          </h3>
          <p className="text-xs text-muted">Live previews of your home page. Everything can be changed later in the builder’s Style tab.</p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" icon={<Shuffle className="size-3.5" />} onClick={() => setSpec({ ...spec, personality: selected, designSeed: (seed + 1) % 1000 })}>
            Another variation
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show suggestions" : `All ${PERSONALITIES.length} directions`}
          </Button>
        </div>
      </div>
      <div role="radiogroup" aria-label="Design direction" className="grid gap-3 sm:grid-cols-3">
        {choices.map((id, i) => {
          const p = PERSONALITIES.find((x) => x.id === id)!;
          const active = selected === id;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={active}
              onClick={() => setSpec({ ...spec, personality: id, designSeed: 0 })}
              className={clsx("overflow-hidden rounded-[var(--radius-lg)] border bg-surface text-left shadow-sm transition-shadow", active ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-border-strong hover:shadow-md")}
            >
              <SitePreview html={previews[id]} title={`${p.label} preview`} height={220} className="border-b border-border" />
              <div className="p-3">
                <p className="flex items-center justify-between gap-2 text-[13px] font-medium">
                  {p.label}
                  {!showAll && i === 0 && <Badge tone="accent">Best match</Badge>}
                  {active && showAll && <Check className="size-3.5 text-accent" aria-label="Selected" />}
                </p>
                <p className="mt-0.5 text-xs text-muted">{p.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SpecReview({ spec, setSpec, planner }: { spec: ProjectSpec; setSpec: (s: ProjectSpec) => void; planner: "builtin" | "llm" }) {
  const label = (t: string) => SECTION_DEFS.find((d) => d.type === t)?.label ?? t;
  return (
    <div className="grid gap-5">
      {planner === "builtin" && (
        <Notice tone="accent" title="Planned with built-in rules">
          No AI provider is connected, so this plan comes from keyword rules, not a model. Connect one under <Link href="/settings/ai" className="underline">AI providers</Link> for plans tailored to your brief.
        </Notice>
      )}
      <Field label="Name">{(p) => <Input {...p} value={spec.name} maxLength={120} onChange={(e) => setSpec({ ...spec, name: e.target.value })} />}</Field>
      <div className="grid gap-1 text-[13px]">
        <p className="text-muted">
          <span className="font-medium text-fg">Audience:</span> {spec.audience}
        </p>
        <p className="text-muted">
          <span className="font-medium text-fg">Tone:</span> {spec.tone}
        </p>
        {spec.goals.length > 0 && (
          <p className="text-muted">
            <span className="font-medium text-fg">Goals:</span> {spec.goals.join(" · ")}
          </p>
        )}
      </div>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
          <FileText className="size-3.5 text-muted" aria-hidden /> Pages
        </h3>
        <div className="grid gap-2">
          {spec.pages.map((p, i) => (
            <div key={p.path} className="rounded-[var(--radius-md)] border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium">
                  {p.title} <span className="font-mono text-xs text-subtle">{p.path}</span>
                </p>
                {i > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSpec({ ...spec, pages: spec.pages.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">{p.purpose}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {p.sections.map((s, j) => (
                  <Badge key={j}>{label(s)}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {(spec.dataModels.length > 0 || spec.integrations.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {spec.dataModels.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                <Database className="size-3.5 text-muted" aria-hidden /> Data
              </h3>
              <ul className="grid gap-1.5 text-[13px]">
                {spec.dataModels.map((m) => (
                  <li key={m.name}>
                    <span className="font-medium">{m.name}</span> <span className="text-muted">— {m.purpose}</span>
                    <span className="block font-mono text-xs text-subtle">{m.fields.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {spec.integrations.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                <Plug className="size-3.5 text-muted" aria-hidden /> Integrations
              </h3>
              <ul className="grid gap-1.5 text-[13px]">
                {spec.integrations.map((m) => (
                  <li key={m.provider}>
                    <span className="font-medium">{m.provider}</span> <span className="text-muted">— {m.purpose}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {spec.assumptions.length > 0 && (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold">Assumptions</h3>
          <ul className="grid gap-1 text-[13px] text-muted">
            {spec.assumptions.map((a) => (
              <li key={a} className="flex gap-2">
                <Circle className="mt-1.5 size-1.5 shrink-0 fill-current" aria-hidden />
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function CreateView() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { org } = useSession();
  const [brief, setBrief] = useState(params.get("brief") ?? "");
  const [name, setName] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [spec, setSpec] = useState<ProjectSpec | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const task = useTask(taskId);
  // Adopt a finished plan once per task; later edits stay local to `spec`.
  const [adoptedTask, setAdoptedTask] = useState<string | null>(null);
  if (task.data?.status === "succeeded" && task.data.result?.type === "plan" && adoptedTask !== task.data.id) {
    setAdoptedTask(task.data.id);
    setSpec(task.data.result.spec);
  }

  const plan = useMutation({
    mutationFn: (withAnswers: boolean) =>
      api<{ task: { id: string } }>(`/api/v1/orgs/${org.id}/plan`, {
        method: "POST",
        body: { brief, name: name.trim() || undefined, answers: withAnswers ? Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim())) : undefined },
      }),
    onSuccess: (r) => {
      setSpec(null);
      setTaskId(r.task.id);
    },
    onError: (e) => toast({ tone: "error", title: "Could not start planning", description: errorMessage(e) }),
  });

  const create = useMutation({
    mutationFn: () => api<{ project: { id: string } }>(`/api/v1/orgs/${org.id}/projects`, { method: "POST", body: { spec, planTaskId: taskId ?? undefined } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["projects", org.id] });
      router.push(`/projects/${r.project.id}/builder`);
    },
    onError: (e) => toast({ tone: "error", title: "Could not create the web app", description: errorMessage(e) }),
  });

  const running = isActive(task.data?.status) || (!!taskId && task.isPending);
  const failed = task.data?.status === "failed";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="text-xl font-semibold tracking-[-0.01em]">Create a web app</h1>
      <p className="mt-1 text-[13px] text-muted">Describe it in plain language. You will review a plan before anything is created.</p>
      <Link href="/launch" className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] font-medium hover:border-fg/40">
        <Sparkles className="size-3.5" aria-hidden /> Just want it live fast? Launch a store or website in 5 minutes →
      </Link>

      {!spec && (
        <Card className="mt-6 p-5">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              plan.mutate(false);
            }}
          >
            <Field label="What do you want to build?" hint="Mention the business, the audience and the actions visitors should take.">
              {(p) => <Textarea {...p} value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} maxLength={4000} autoFocus disabled={running} />}
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" disabled={running} onClick={() => setBrief(ex)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-border-strong hover:text-fg">
                  {ex.slice(0, 48)}…
                </button>
              ))}
            </div>
            <Field label="Business name (optional)">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={running} />}</Field>
            <div className="flex items-center justify-between gap-3">
              <Link href="/templates" className="text-[13px] text-muted hover:text-fg">
                Or start from a template
              </Link>
              <Button type="submit" variant="primary" disabled={brief.trim().length < 10} loading={plan.isPending || running} icon={<Wand2 className="size-3.5" />}>
                Plan my project
              </Button>
            </div>
          </form>
          {taskId && task.data && (running || failed) && (
            <div className="mt-5 border-t border-border pt-4">
              <Steps steps={task.data.steps} running={running} />
              {failed && <Notice tone="danger" title="Planning failed">{task.data.error}</Notice>}
            </div>
          )}
        </Card>
      )}

      {spec && task.data?.result?.type === "plan" && (
        <div className="mt-6 grid gap-4">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="size-4 text-accent" aria-hidden /> Proposed plan
              </h2>
              <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={() => { setSpec(null); setTaskId(null); }}>
                Edit brief
              </Button>
            </div>
            <SpecReview spec={spec} setSpec={setSpec} planner={task.data.result.planner} />
            <div className="mt-6 border-t border-border pt-5">
              <DirectionPicker spec={spec} setSpec={setSpec} />
            </div>
          </Card>

          {spec.questions.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">A few questions that change the result</h2>
              <p className="mt-0.5 text-[13px] text-muted">Optional. Answer any and re-plan, or create now and fill in details later.</p>
              <div className="mt-4 grid gap-4">
                {spec.questions.map((q) => (
                  <Field key={q.id} label={q.question} hint={q.why}>
                    {(p) => <Input {...p} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} maxLength={1000} />}
                  </Field>
                ))}
              </div>
              <Button className="mt-4" loading={plan.isPending || running} disabled={!Object.values(answers).some((v) => v.trim())} onClick={() => plan.mutate(true)}>
                Re-plan with answers
              </Button>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="primary" size="lg" loading={create.isPending} disabled={!spec.name.trim()} onClick={() => create.mutate()}>
              Create project
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
