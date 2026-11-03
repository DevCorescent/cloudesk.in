// A MacBook Pro frame for real desktop screens: a black-bordered lid with
// the camera notch and a thin aluminium edge, the 16:10 screen (2880×1800
// screenshots fit exactly), and the base with its thumb groove. Sized in
// container units of its own width, so always size it by width.
// Styles: .mbp in app/globals.css.
import clsx from "clsx";
import type { ReactNode } from "react";

export function MacBook({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("mbp", className)}>
      <div className="mbp-lid">
        <div className="mbp-screen">
          <div className="mbp-view">{children}</div>
          <span className="mbp-notch" aria-hidden />
        </div>
      </div>
      <div className="mbp-base" aria-hidden>
        <span className="mbp-groove" />
      </div>
    </div>
  );
}
