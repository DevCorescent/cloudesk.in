// Illustrations for onboarding, drawn with CSS and SVG (no image downloads):
// a storefront, a phone, a till receipt, a payment and a domain, floating in
// glass. Purely decorative — hidden from assistive technology.
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

type PieceStyle = CSSProperties & { "--rot"?: string; "--lift"?: string; "--dur"?: string; "--float-delay"?: string };

/** A floating piece of a scene. Small badges (`badge`) fade in and stay put. */
function Piece({ className, style, delay = 0, badge, children }: { className?: string; style?: PieceStyle; delay?: number; badge?: boolean; children: ReactNode }) {
  return (
    <div className={clsx(badge ? "ob-badge" : "ob-piece", "absolute", className)} style={{ animationDelay: badge ? `${delay}ms` : `${delay}ms, ${delay + 900}ms`, ...style }}>
      {children}
    </div>
  );
}

const Bar = ({ w, className }: { w: string; className?: string }) => <span className={clsx("block h-2 rounded-full ob-shimmer", className)} style={{ width: w }} />;

/** The welcome scene: everything the person is about to get, in one picture. */
export function HeroArt({ name }: { name?: string }) {
  const brand = (name?.trim() || "yourbrand").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 18) || "yourbrand";
  return (
    <div aria-hidden className="relative mx-auto aspect-[5/4] w-full max-w-[560px] select-none">
      {/* Browser with a storefront */}
      <Piece className="top-[6%] left-[4%] w-[74%]" style={{ "--rot": "-2deg", "--dur": "9s" }} delay={100}>
        <div className="p-glass overflow-hidden rounded-[20px]">
          <div className="flex items-center gap-1.5 border-b border-fg/5 px-3 py-2">
            <span className="size-2 rounded-full bg-[#ff5f57]" />
            <span className="size-2 rounded-full bg-[#febc2e]" />
            <span className="size-2 rounded-full bg-[#28c840]" />
            <span className="mx-auto rounded-full bg-fg/[0.06] px-3 py-0.5 text-[9px] font-medium text-fg/50">{brand}.com</span>
          </div>
          <div className="grid gap-3 p-4">
            <div className="grid grid-cols-[1.2fr_1fr] items-center gap-3">
              <div className="grid gap-2">
                <span className="block h-3 w-4/5 rounded-full bg-fg/80" />
                <span className="block h-3 w-3/5 rounded-full bg-fg/80" />
                <Bar w="90%" />
                <span className="mt-1 inline-flex h-5 w-20 items-center justify-center rounded-full bg-fg text-[8px] font-semibold text-bg">Shop now</span>
              </div>
              <div className="aspect-[4/3] rounded-[12px] bg-gradient-to-br from-[var(--p-peach)] via-[var(--p-rose)] to-[var(--p-lavender)]" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {["var(--p-mint)", "var(--p-sky)", "var(--p-butter)", "var(--p-lavender)"].map((c, i) => (
                <div key={i} className="grid gap-1">
                  <div className="aspect-square rounded-[8px]" style={{ background: c }} />
                  <Bar w="80%" className="h-1.5" />
                  <span className="text-[8px] font-semibold text-fg/70">₹{[799, 1299, 499, 2199][i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Piece>

      {/* Phone with a product page */}
      <Piece className="top-[30%] right-[3%] w-[30%]" style={{ "--rot": "4deg", "--lift": "-6px", "--dur": "8s" }} delay={320}>
        <div className="rounded-[26px] border-[5px] border-fg/85 bg-bg p-2 shadow-[0_30px_60px_-30px_rgb(0_0_0/.55)]">
          <div className="mx-auto mb-1.5 h-1.5 w-8 rounded-full bg-fg/80" />
          <div className="aspect-[4/5] rounded-[14px] bg-gradient-to-b from-[var(--p-sky)] to-[var(--p-mint)]" />
          <div className="mt-2 grid gap-1 px-0.5">
            <Bar w="85%" />
            <span className="text-[9px] font-bold">₹1,299</span>
            <span className="mt-0.5 flex h-5 items-center justify-center rounded-full bg-fg text-[7.5px] font-semibold text-bg">Add to cart</span>
          </div>
        </div>
      </Piece>

      {/* Receipt from the till */}
      <Piece className="bottom-[2%] left-[10%] w-[24%]" style={{ "--rot": "-6deg", "--lift": "-5px", "--dur": "10s" }} delay={520}>
        <div className="rounded-[10px] bg-white p-2.5 font-mono text-[7px] leading-tight text-black shadow-[0_24px_40px_-24px_rgb(0_0_0/.5)]">
          <p className="text-center font-sans text-[8px] font-bold">{brand.toUpperCase().slice(0, 12)}</p>
          <p className="mt-1 flex justify-between"><span>Kurta × 1</span><span>1,299</span></p>
          <p className="flex justify-between"><span>Earrings × 2</span><span>998</span></p>
          <p className="mt-1 flex justify-between border-t border-dashed border-black/40 pt-1 font-bold"><span>TOTAL</span><span>₹2,297</span></p>
          <div className="relative mt-1.5 flex h-6 items-end gap-[1.5px] overflow-hidden">
            {[2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 2, 1, 1, 2].map((w, i) => <span key={i} className="h-full bg-black" style={{ width: w }} />)}
            <span className="ob-scan absolute inset-x-0 top-0 h-px bg-[#ef4444] shadow-[0_0_6px_#ef4444]" />
          </div>
        </div>
      </Piece>

      {/* Payment received */}
      <Piece badge className="top-[0%] right-[8%]" style={{ "--rot": "3deg", "--dur": "7s" }} delay={720}>
        <div className="p-glass flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-[11px] font-semibold">
          <span className="grid size-6 place-items-center rounded-full bg-[var(--p-mint)] text-[var(--p-mint-ink)]">₹</span>
          Order #1042 · Paid
        </div>
      </Piece>

      {/* Domain connected */}
      <Piece badge className="bottom-[10%] right-[16%]" style={{ "--rot": "-2deg", "--dur": "8.5s" }} delay={900}>
        <div className="p-glass flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-[11px] font-semibold">
          <span className="grid size-6 place-items-center rounded-full bg-[var(--p-lavender)] text-[var(--p-lavender-ink)]">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span>
          {brand}.com connected
        </div>
      </Piece>

      {/* Bookings */}
      <Piece badge className="top-[52%] left-[-2%]" style={{ "--rot": "-4deg", "--dur": "9.5s" }} delay={1080}>
        <div className="p-glass grid gap-1 rounded-[16px] px-3 py-2 text-[10px]">
          <span className="font-semibold">New booking</span>
          <span className="text-fg/55">Sat · 11:30 am</span>
        </div>
      </Piece>
    </div>
  );
}

/** Small scenes for "where do customers buy?". */
export function SellArt({ kind }: { kind: "online" | "shop" | "both" | "none" }) {
  return (
    <div aria-hidden className="relative h-24 w-full">
      {(kind === "online" || kind === "both") && (
        <div className={clsx("absolute top-2 overflow-hidden rounded-[10px] border border-fg/10 bg-bg/80 shadow-sm", kind === "both" ? "left-2 w-[58%]" : "left-1/2 w-[70%] -translate-x-1/2")}>
          <div className="flex gap-1 border-b border-fg/5 px-2 py-1">
            <span className="size-1.5 rounded-full bg-fg/20" />
            <span className="size-1.5 rounded-full bg-fg/20" />
            <span className="size-1.5 rounded-full bg-fg/20" />
          </div>
          <div className="grid grid-cols-3 gap-1 p-1.5">
            {["var(--p-peach)", "var(--p-mint)", "var(--p-sky)"].map((c) => <span key={c} className="aspect-square rounded-[4px]" style={{ background: c }} />)}
          </div>
        </div>
      )}
      {(kind === "shop" || kind === "both") && (
        <div className={clsx("absolute bottom-1 grid justify-items-center", kind === "both" ? "right-2 w-[40%]" : "left-1/2 w-[55%] -translate-x-1/2")}>
          <div className="h-3 w-full rounded-t-[6px]" style={{ background: "repeating-linear-gradient(90deg, var(--p-peach-ink) 0 10px, var(--p-peach) 10px 20px)" }} />
          <div className="grid h-14 w-[92%] grid-cols-2 gap-1 rounded-b-[6px] border border-t-0 border-fg/10 bg-bg/80 p-1.5">
            <span className="rounded-[3px] bg-[var(--p-butter)]" />
            <span className="rounded-[3px] bg-fg/10" />
          </div>
        </div>
      )}
      {kind === "none" && (
        <div className="absolute top-2 left-1/2 w-[70%] -translate-x-1/2 overflow-hidden rounded-[10px] border border-fg/10 bg-bg/80 p-2 shadow-sm">
          <span className="block h-2 w-2/3 rounded-full bg-fg/70" />
          <span className="mt-1.5 block h-1.5 w-full rounded-full bg-fg/10" />
          <span className="mt-1 block h-1.5 w-4/5 rounded-full bg-fg/10" />
          <span className="mt-2 inline-block h-3 w-12 rounded-full bg-[var(--p-lavender)]" />
        </div>
      )}
    </div>
  );
}
