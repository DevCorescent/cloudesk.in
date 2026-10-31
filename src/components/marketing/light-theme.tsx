"use client";

// The marketing site is designed light. These pin the page to the light theme
// whatever the device prefers, and hand back the person's own app theme on leaving.
import { useLayoutEffect } from "react";

/** Runs before first paint on a full page load. */
export const LIGHT_SCRIPT = `document.documentElement.dataset.theme='light'`;

/** Covers client-side navigation into and out of the marketing pages. */
export function LightTheme() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = "light";
    return () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("cc-theme");
      } catch {}
      if (saved === "light" || saved === "dark") root.dataset.theme = saved;
      else delete root.dataset.theme;
    };
  }, []);
  return null;
}
