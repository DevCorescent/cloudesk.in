// An iPhone 17 frame for real phone screens: the 6.3" body (a 402×874 pt
// screen, so 1206×2622 screenshots fit exactly), an aluminium edge in one of
// the phone's colours, a thin black border, the Dynamic Island, a status bar
// and home indicator, the side buttons (Action and volume on the left, side
// button and Camera Control on the right) and a soft glass reflection.
// Everything is sized from the frame's width (container units), so it can be
// sized by width or by height. Styles: .ip17 in app/globals.css.
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

export type IPhoneColor = "black" | "white" | "lavender" | "sage" | "mist";

export function IPhone17({ children, color = "black", className, style, ...rest }: { children: ReactNode; color?: IPhoneColor; className?: string; style?: CSSProperties } & Record<`data-${string}`, string | number | undefined>) {
  return (
    <div className={clsx("ip17", className)} data-color={color} style={style} {...rest}>
      <span className="ip17-btn ip17-action" />
      <span className="ip17-btn ip17-vol-up" />
      <span className="ip17-btn ip17-vol-down" />
      <span className="ip17-btn ip17-side" />
      <span className="ip17-btn ip17-camera" />
      <div className="ip17-body">
        <div className="ip17-screen">
          <div className="ip17-status" aria-hidden>
            <span className="ip17-time">9:41</span>
            <span className="ip17-icons">
              <svg viewBox="0 0 18 12" className="ip17-signal">
                <rect x="0" y="8" width="3" height="4" rx="0.8" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
                <rect x="10" y="3" width="3" height="9" rx="0.8" />
                <rect x="15" y="0" width="3" height="12" rx="0.8" />
              </svg>
              <svg viewBox="0 0 16 12" className="ip17-wifi">
                <path d="M8 2.2c2.5 0 4.8.95 6.5 2.55l1.2-1.25A11.1 11.1 0 0 0 8 .4 11.1 11.1 0 0 0 .3 3.5l1.2 1.25A9.3 9.3 0 0 1 8 2.2Z" />
                <path d="M8 5.6c1.6 0 3 .6 4.1 1.6l1.2-1.25A7.7 7.7 0 0 0 8 3.8c-2 0-3.9.8-5.3 2.15L3.9 7.2A5.9 5.9 0 0 1 8 5.6Z" />
                <path d="M8 9c.7 0 1.3.25 1.8.7L8 11.6 6.2 9.7c.5-.45 1.1-.7 1.8-.7Z" />
              </svg>
              <span className="ip17-battery"><i /></span>
            </span>
          </div>
          <div className="ip17-view">{children}</div>
          <span className="ip17-island" aria-hidden />
          <span className="ip17-home" aria-hidden />
        </div>
      </div>
      <span className="ip17-shine" aria-hidden />
    </div>
  );
}
