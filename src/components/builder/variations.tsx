"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import { useMemo } from "react";
import { sectionDef, variantOf, type Page, type Section, type SiteDoc } from "@/lib/site/model";
import { SitePreview } from "../site-preview";
import { Dialog } from "../ui/overlays";
import { sectionPreviewHtml } from "./panels";
import { useShortcuts } from "../ui/shortcut";

type Option = { key: string; variant: string; background: Section["style"]["background"]; label: string };

/** Side-by-side live previews of a section's layouts and backgrounds. */
export function VariationsDialog({ doc, page, section, open, onClose, onApply }: { doc: SiteDoc; page: Page; section: Section | null; open: boolean; onClose: () => void; onApply: (variant: string, background: Section["style"]["background"]) => void }) {
  const undo = useShortcuts().keys("mod+z");
  const options = useMemo<(Option & { html: string })[]>(() => {
    if (!section) return [];
    const def = sectionDef(section.type);
    const variants = def?.variants ?? [{ value: "default", label: "Default" }];
    const backgrounds: Section["style"]["background"][] = [section.style.background, ...(["default", "surface", "inverse"] as const).filter((b) => b !== section.style.background)].slice(0, variants.length > 3 ? 2 : 3);
    const bgLabel = { default: "page", surface: "subtle", accent: "accent", inverse: "inverted" };
    return variants.flatMap((v) =>
      backgrounds.map((bg) => {
        const s: Section = { ...structuredClone(section), variant: v.value, style: { ...section.style, background: bg } };
        return { key: `${v.value}-${bg}`, variant: v.value, background: bg, label: `${v.label} · ${bgLabel[bg]} background`, html: sectionPreviewHtml(doc, s, page) };
      }),
    );
  }, [doc, page, section]);
  if (!section) return null;
  const current = variantOf(section);
  return (
    <Dialog open={open} onClose={onClose} title={`${sectionDef(section.type)?.label} variations`} description={`Live previews with your content and theme. Pick one to apply${undo ? ` (undo with ${undo})` : " (Undo brings the old one back)"}.`} size="xl">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((o) => {
          const active = o.variant === current && o.background === section.style.background;
          return (
            <button key={o.key} onClick={() => { onApply(o.variant, o.background); onClose(); }} className={clsx("overflow-hidden rounded-[var(--radius-lg)] border text-left transition-shadow", active ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-border-strong hover:shadow-md")}>
              <SitePreview html={o.html} title={o.label} width={980} height={190} className="border-b border-border" />
              <p className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <span className="truncate">{o.label}</span>
                {active && <Check className="size-4 shrink-0 text-accent" aria-label="Current" />}
              </p>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
