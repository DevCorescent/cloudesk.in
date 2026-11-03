// A page's opening on matte black, lit in the page's own pastel (its tint),
// then a long fade into the light page below. The band redefines --fg and
// --bg, so everything inside (text-fg/…, rings, the CTA) flips to light-on-
// dark without per-class changes. Styles: .mk-dark in (marketing)/marketing.css.
import clsx from "clsx";
import type { ReactNode } from "react";
import type { Tint } from "@/lib/workspace/modules";
import { W } from "./sections";

/** The band on its own, for pages that lay out their own inner container. */
export function DarkBand({ tint, children, className }: { tint?: Tint; children: ReactNode; className?: string }) {
  return (
    <>
      <div className={clsx("mk-dark mk-under-head", tint && `tint-${tint}`, className)}>
        <div aria-hidden className="mk-dark-glow" />
        {children}
      </div>
      <div aria-hidden className="mk-dark-fade" />
    </>
  );
}

/** The band with the site's usual page width inside. */
export function DarkHero({ tint, children, className }: { tint?: Tint; children: ReactNode; className?: string }) {
  return (
    <DarkBand tint={tint}>
      <div className={clsx(W, className)}>{children}</div>
    </DarkBand>
  );
}
