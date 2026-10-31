"use client";

// Settings → Features: build the app your business runs on. Pick modules by
// group, switch parts of a module off, and see the sidebar it makes. Switching
// something off only hides it — nothing is deleted. What a module needs comes
// with it; switching off something others need asks first.
import clsx from "clsx";
import { ArrowUpRight, Check, FolderOpen, Home, LayoutTemplate, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Button, Notice, Switch } from "@/components/ui/primitives";
import { CORE, industryById, isOn, MODULE_GROUPS, MODULES, moduleById, neededBy, withRequirements, type ModuleDef, type ModuleId } from "@/lib/workspace/modules";
import { ModuleGlyph } from "./module-glyph";
import { useSession } from "./session-context";
import { useModules } from "./use-modules";

export function FeaturesSettings() {
  const { org } = useSession();
  const { current, canManage, save, togglePart, partOn, busy, error, modules } = useModules();
  const [asking, setAsking] = useState<{ id: ModuleId; also: ModuleId[] } | null>(null);
  const industry = industryById(org.industry);
  const recommended = industry?.modules ?? [];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const workspaceOn = (id: ModuleId) => isOn(org.modules, id);

  const setModule = (id: ModuleId, value: boolean) => {
    if (value) return void save(withRequirements([...current, id]));
    const also = neededBy(id, current);
    if (also.length) return setAsking({ id, also });
    void save(current.filter((x) => x !== id));
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold">Build your app</h2>
          <p className="mt-1 max-w-xl text-[13.5px] text-muted">
            Pick the modules {org.name} runs on, and switch off the parts you don&apos;t need. The sidebar follows for everyone in the workspace. Switching something off only hides it — its data stays, and it comes back exactly as it was.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {industry && !same(current, recommended) && (
              <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={busy} onClick={() => void save(recommended, industry.id)}>
                Recommended for {industry.label.toLowerCase()}
              </Button>
            )}
            {modules !== null && (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void save(null)}>
                Switch everything on
              </Button>
            )}
          </div>
        )}
      </div>
      {!canManage && <Notice title="Only owners and admins can change features">You can see what this workspace uses below.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <SidebarPreview on={workspaceOn} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
          <section className="rounded-[20px] border border-border bg-surface p-5">
            <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">Always included</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {CORE.map((c) => (
                <li key={c} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-medium">
                  <Check className="size-3.5 text-success" />
                  {c}
                </li>
              ))}
            </ul>
          </section>
          {MODULE_GROUPS.map((g) => (
            <section key={g.id} aria-labelledby={`group-${g.id}`}>
              <div className="mb-2.5">
                <h3 id={`group-${g.id}`} className="text-[14px] font-semibold">
                  {g.label}
                </h3>
                <p className="text-[12.5px] text-muted">{g.line}</p>
              </div>
              <ul className="grid gap-3">
                {MODULES.filter((m) => m.group === g.id).map((m) => (
                  <ModuleCard key={m.id} m={m} enabled={workspaceOn(m.id)} recommended={recommended.includes(m.id)} disabled={!canManage || busy} onToggle={(v) => setModule(m.id, v)} partOn={(p) => partOn(m.id, p)} onPart={(p, v) => void togglePart(m.id, p, v)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!asking}
        onClose={() => setAsking(null)}
        onConfirm={() => {
          if (!asking) return;
          void save(current.filter((x) => x !== asking.id && !asking.also.includes(x)));
          setAsking(null);
        }}
        loading={busy}
        title={`Switch off ${asking ? moduleById(asking.id)?.name : ""}?`}
        description={asking ? `${asking.also.map((x) => moduleById(x)?.name).join(" and ")} ${asking.also.length === 1 ? "needs" : "need"} it, so ${asking.also.length === 1 ? "it" : "they"} will be switched off too. Nothing is deleted.` : ""}
        confirmLabel="Switch them off"
      />
    </div>
  );
}

function ModuleCard({ m, enabled, recommended, disabled, onToggle, partOn, onPart }: { m: ModuleDef; enabled: boolean; recommended: boolean; disabled: boolean; onToggle: (v: boolean) => void; partOn: (p: string) => boolean; onPart: (p: string, v: boolean) => void }) {
  const needs = (m.requires ?? []).map((r) => moduleById(r)?.name).filter(Boolean);
  return (
    <li className={clsx(`tint-${m.tint}`, "rounded-[20px] border bg-surface p-4 transition-colors", enabled ? "border-[color-mix(in_srgb,var(--t-ink)_30%,transparent)]" : "border-border")}>
      <div className="flex items-start gap-4">
        <span className={clsx("grid size-11 shrink-0 place-items-center rounded-[14px] transition-colors", enabled ? "tint-chip" : "bg-surface-2 text-muted")}>
          <ModuleGlyph id={m.id} className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-[14.5px] font-semibold">{m.name}</b>
            {recommended && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold text-muted">Recommended</span>}
          </span>
          <span className="mt-0.5 block text-[13px] text-muted">{m.short}</span>
          {needs.length > 0 && <span className="mt-0.5 block text-[12px] text-subtle">Needs {needs.join(" and ")} — switched on with it</span>}
          <Link href={`/features/${m.feature}`} target="_blank" className="mt-1.5 inline-flex items-center gap-0.5 text-[12px] text-muted hover:text-fg">
            What it does <ArrowUpRight className="size-3" />
          </Link>
        </span>
        <Switch checked={enabled} disabled={disabled} onChange={onToggle} label={`${m.name} ${enabled ? "on" : "off"}`} />
      </div>
      {enabled && (m.parts?.length || m.partsNote) ? (
        <div className="mt-3 border-t border-border pt-3">
          {m.parts?.length ? (
            <ul className="grid gap-1.5">
              {m.parts.map((p) => {
                const on = partOn(p.id);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className={clsx("block text-[13px] font-medium", !on && "text-muted")}>{p.name}</span>
                      <span className="block truncate text-[11.5px] text-subtle">{p.short}</span>
                    </span>
                    <Switch checked={on} disabled={disabled} onChange={(v) => onPart(p.id, v)} label={`${m.name}: ${p.name} ${on ? "on" : "off"}`} />
                  </li>
                );
              })}
            </ul>
          ) : null}
          {m.partsNote && <p className={clsx("text-[12px] text-muted", m.parts?.length && "mt-2")}>{m.partsNote}</p>}
        </div>
      ) : null}
    </li>
  );
}

/** What the sidebar will look like with these choices. */
function SidebarPreview({ on }: { on: (id: ModuleId) => boolean }) {
  // Grouped exactly like the sidebar: workspace areas, then what lives inside each web app.
  const count = MODULES.filter((m) => on(m.id)).length;
  const groups = MODULE_GROUPS.map((g) => ({ ...g, list: MODULES.filter((m) => m.group === g.id && on(m.id) && m.id !== "bookings") })).filter((g) => g.list.length);
  return (
    <aside aria-label="Your sidebar" className="min-w-0 rounded-[22px] border border-border bg-surface p-4">
      <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">Your sidebar</p>
      <p className="mt-1 text-[12.5px] text-muted">
        {count} of {MODULES.length} modules on
      </p>
      <ul className="mt-3 flex flex-wrap gap-1 text-[13px]">
        {[
          { icon: <Home />, name: "Home" },
          { icon: <FolderOpen />, name: "Web apps" },
          { icon: <Wand2 />, name: "Create with AI" },
          { icon: <LayoutTemplate />, name: "Templates" },
        ].map((x) => (
          <li key={x.name} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-muted [&_svg]:size-3.5">
            {x.icon}
            {x.name}
          </li>
        ))}
      </ul>
      {groups.map((g) => (
        <div key={g.id} className="mt-3">
          <p className="px-2 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase">{g.label}</p>
          <ul className="mt-1 flex flex-wrap gap-1 text-[13px]">
            {g.list.map((m) => (
              <li key={m.id} className={clsx(`tint-${m.tint}`, "flex items-center gap-2 rounded-[10px] px-2 py-1.5 font-medium")}>
                <ModuleGlyph id={m.id} className="size-3.5" />
                {m.name}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {on("bookings") && <p className="mt-3 px-2 text-[12px] text-muted">Bookings live on your web apps&apos; pages.</p>}
    </aside>
  );
}
