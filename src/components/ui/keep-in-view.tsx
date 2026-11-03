"use client";

// Keeps every dropdown on screen, app-wide. Menus, suggestion lists and
// popovers (role="menu" / role="listbox", or marked data-popover) are placed
// by their own components next to what opened them; when that would put
// them past an edge of the viewport, this nudges them back inside (8px from
// the edge), narrows them to fit, and caps their height to the room left so
// they scroll instead. It re-checks when they change size and on resize.
// Mark one data-popover="static" to leave it alone (lists inside dialogs).
import { useEffect } from "react";

const SELECTOR = '[role="menu"], [role="listbox"], [data-popover]';
const GAP = 8;

function fit(el: HTMLElement) {
  if (el.closest('[data-popover="static"]')) return;
  // Measure where the component put it, without our previous adjustments.
  if (el.dataset.ccMaxH === undefined) {
    el.dataset.ccMaxH = el.style.maxHeight;
    el.dataset.ccOverflow = el.style.overflowY;
  }
  el.style.translate = "";
  el.style.maxHeight = el.dataset.ccMaxH;
  el.style.overflowY = el.dataset.ccOverflow ?? "";
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  el.style.maxWidth = `${vw - GAP * 2}px`;
  let dx = 0;
  if (r.right > vw - GAP) dx = vw - GAP - r.right;
  if (r.left + dx < GAP) dx = GAP - r.left;
  let dy = 0;
  if (r.bottom > vh - GAP) {
    // Prefer scrolling inside it; move it up only when there's barely any room.
    const room = vh - GAP - r.top;
    if (room >= 160) {
      el.style.maxHeight = `${room}px`;
      if (getComputedStyle(el).overflowY === "visible") el.style.overflowY = "auto";
    } else dy = Math.max(GAP - r.top, vh - GAP - r.bottom);
  } else if (r.top < GAP) dy = GAP - r.top;
  if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

export function KeepInView() {
  useEffect(() => {
    const watched = new WeakSet<HTMLElement>();
    const sizes = new ResizeObserver((entries) => {
      for (const e of entries) requestAnimationFrame(() => fit(e.target as HTMLElement));
    });
    const take = (root: ParentNode) => {
      const found: HTMLElement[] = [];
      if (root instanceof HTMLElement && root.matches(SELECTOR)) found.push(root);
      root.querySelectorAll?.<HTMLElement>(SELECTOR).forEach((x) => found.push(x));
      for (const el of found) {
        if (!watched.has(el)) {
          watched.add(el);
          sizes.observe(el);
        }
        requestAnimationFrame(() => fit(el));
      }
    };
    const added = new MutationObserver((records) => {
      for (const m of records) m.addedNodes.forEach((n) => n instanceof HTMLElement && take(n));
    });
    take(document.body);
    added.observe(document.body, { childList: true, subtree: true });
    const all = () => document.querySelectorAll<HTMLElement>(SELECTOR).forEach(fit);
    window.addEventListener("resize", all);
    return () => {
      added.disconnect();
      sizes.disconnect();
      window.removeEventListener("resize", all);
    };
  }, []);
  return null;
}
