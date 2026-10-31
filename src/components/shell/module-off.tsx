"use client";

// Shown in place of a page whose feature this workspace hasn't switched on.
import { ArrowLeft, ArrowUpRight, Check, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ModuleDef } from "@/lib/workspace/modules";
import { Button } from "../ui/primitives";
import { ModuleGlyph } from "./module-glyph";
import { useModules } from "./use-modules";
import { useSession } from "./session-context";

export function ModuleOff({ module: m, reason = "off" }: { module: ModuleDef; reason?: "off" | "role" | "plan" }) {
  const { toggle, canManage, busy, error } = useModules();
  const { org } = useSession();
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-5 py-12">
      <div className={`tint-${m.tint} animate-in w-full overflow-hidden rounded-[28px] border border-border bg-surface text-center shadow-[0_30px_80px_-40px_rgb(40_20_80/0.35)]`}>
        <div className="relative grid place-items-center overflow-hidden px-6 pt-10 pb-8" style={{ background: "radial-gradient(70% 90% at 50% 0%, var(--t), transparent)" }}>
          <span className="grid size-20 place-items-center rounded-[26px] bg-surface shadow-[0_20px_40px_-18px_rgb(0_0_0/0.35)] ring-1 ring-fg/[0.06]" style={{ color: "var(--t-ink)", animation: "ob-float 6s ease-in-out infinite" }}>
            <ModuleGlyph id={m.id} className="size-9" />
          </span>
          <p className="mt-5 text-[12px] font-semibold tracking-[0.16em] text-muted uppercase">{reason === "role" ? "Not in your role" : reason === "plan" ? "Not in your plan" : "Not switched on"}</p>
          <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-[-0.02em]">{m.name}</h1>
          <p className="mt-2 max-w-sm text-[14.5px] text-muted">{m.short}.</p>
        </div>
        <ul className="flex flex-wrap justify-center gap-2 px-6">
          {m.adds.map((a) => (
            <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[12.5px] font-medium">
              <Check className="size-3.5" style={{ color: "var(--t-ink)" }} />
              {a}
            </li>
          ))}
        </ul>
        <div className="grid gap-3 p-6">
          {reason === "plan" ? (
            ["owner", "admin", "billing"].includes(org.role) ? (
              <Link href={`/settings/billing?add=${m.id}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-fg px-6 text-[14.5px] font-medium text-bg transition-opacity hover:opacity-90">
                <Sparkles className="size-4" /> Add {m.name} to your plan
              </Link>
            ) : (
              <p className="rounded-[14px] bg-surface-2 p-3 text-[13.5px] text-muted">{m.name} isn&apos;t in this workspace&apos;s {org.plan?.name || "current"} plan. Ask an owner to add it in Settings → Billing.</p>
            )
          ) : reason === "role" ? (
            <p className="rounded-[14px] bg-surface-2 p-3 text-[13.5px] text-muted">
              Your role{org.customRole ? ` (${org.customRole})` : ""} in this workspace doesn&apos;t include {m.name}. Ask an owner or admin if you need it.
            </p>
          ) : canManage ? (
            <Button variant="primary" size="lg" loading={busy} icon={<Sparkles className="size-4" />} onClick={() => void toggle(m.id, true)}>
              Switch on {m.name}
            </Button>
          ) : (
            <p className="rounded-[14px] bg-surface-2 p-3 text-[13.5px] text-muted">Ask an owner or admin of this workspace to switch it on in Settings → Features.</p>
          )}
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex items-center justify-center gap-4 text-[13px]">
            <Link href="/home" className="inline-flex items-center gap-1 text-muted hover:text-fg">
              <ArrowLeft className="size-3.5" /> Back home
            </Link>
            <Link href={`/features/${m.feature}`} target="_blank" className="inline-flex items-center gap-1 text-muted hover:text-fg">
              What it does <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
