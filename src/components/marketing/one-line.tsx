"use client";

// Every marketing heading sits on one row: each h1, h2, large h3 and anything
// marked data-fit is shrunk just enough to fit the width it has. When that
// would take it below MIN_PX (long headings on phones) it wraps as usual.
// Anything inside [data-no-fit] (the legal pages' long titles) is left alone.
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const MIN_PX = 22;
const SELECTOR = "main h1, main h2, main h3, main [data-fit]";

/** The width a heading may use: its parent's content box. */
function room(h: HTMLElement) {
  const box = h.parentElement;
  if (!box) return h.clientWidth;
  const s = getComputedStyle(box);
  return box.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
}

function fit(h: HTMLElement) {
  if (h.closest("[data-no-fit]")) return;
  Object.assign(h.style, { fontSize: "", whiteSpace: "", maxWidth: "" });
  const base = parseFloat(getComputedStyle(h).fontSize);
  // Small h3s (card titles) keep their own layout.
  if (h.tagName === "H3" && !h.hasAttribute("data-fit") && base < 24) return;
  Object.assign(h.style, { whiteSpace: "nowrap", maxWidth: "none" });
  const range = document.createRange();
  range.selectNodeContents(h);
  const need = range.getBoundingClientRect().width;
  const have = room(h);
  if (!need || need <= have) return;
  const size = Math.floor(base * (have / need) * 0.985 * 10) / 10;
  if (size < MIN_PX) Object.assign(h.style, { whiteSpace: "", maxWidth: "" });
  else h.style.fontSize = `${size}px`;
}

export function OneLineHeadings() {
  const pathname = usePathname();
  useEffect(() => {
    let frame = 0;
    const all = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => document.querySelectorAll<HTMLElement>(SELECTOR).forEach(fit));
    };
    all();
    void document.fonts?.ready.then(all);
    window.addEventListener("resize", all);
    // Headings that arrive later (a slider's next hookline, a tab's panel).
    const main = document.querySelector("main");
    const mo = new MutationObserver((records) => {
      if (records.some((r) => [...r.addedNodes].some((n) => n instanceof HTMLElement && (n.matches(SELECTOR.replaceAll("main ", "")) || n.querySelector("h1, h2, h3, [data-fit]"))))) all();
    });
    if (main) mo.observe(main, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", all);
      mo.disconnect();
    };
  }, [pathname]);
  return null;
}
