"use client";

// Shortcut hints that fit the device: ⌘K on a Mac or iPad, Ctrl+K on Windows,
// Linux and ChromeOS, and nothing on phones and touch-only tablets (no
// keyboard to press them on). The server renders no device-specific text; the
// browser fills it in after hydration and follows a mouse or trackpad being
// connected or removed.
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { detectDevice, shortcutKeys, shortcutText, type Device } from "@/lib/client/keys";
import { Kbd, cx } from "./primitives";

let cached: Device | null = null;
const QUERIES = ["(any-pointer: fine)", "(any-pointer: coarse)"];

function subscribe(onChange: () => void) {
  const lists = QUERIES.map((q) => window.matchMedia(q));
  const changed = () => {
    cached = detectDevice();
    onChange();
  };
  lists.forEach((l) => l.addEventListener("change", changed));
  return () => lists.forEach((l) => l.removeEventListener("change", changed));
}
const snapshot = () => (cached ??= detectDevice());
const serverSnapshot = () => null;

/** This device, or null while rendering on the server and hydrating. */
export function useDevice(): Device | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * `keys("mod+k")` → "⌘K" / "Ctrl+K", or null when there's no keyboard (or not known yet).
 * `withKeys("Bold", "mod+b")` → "Bold (⌘B)" — or just "Bold" without a keyboard.
 */
export function useShortcuts() {
  const device = useDevice();
  const apple = device?.apple ?? false;
  const keyboard = !!device?.keyboard;
  const keys = useCallback((spec: string) => (keyboard ? shortcutText(spec, apple) : null), [keyboard, apple]);
  const withKeys = useCallback((text: string, spec: string) => (keyboard ? `${text} (${shortcutText(spec, apple)})` : text), [keyboard, apple]);
  return useMemo(() => ({ device, apple, keyboard, keys, withKeys }), [device, apple, keyboard, keys, withKeys]);
}

/** Keycaps for a shortcut ("mod+shift+z", alternatives with " / "). Hidden on devices without a keyboard unless `always`. */
export function Keys({ k, always, className }: { k: string; always?: boolean; className?: string }) {
  const device = useDevice();
  if (!device || (!device.keyboard && !always)) return null;
  const alts = shortcutKeys(k, device.apple);
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-1 align-middle", className)}>
      {alts.map((keys, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="mx-0.5 text-[11px] text-subtle">/</span>}
          {keys.map((x, j) => (
            <Kbd key={j}>{x}</Kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

/** Shows its content only where there's a keyboard — for tips that are only about shortcuts. */
export function KeyboardOnly({ children }: { children: ReactNode }) {
  const device = useDevice();
  return device?.keyboard ? <>{children}</> : null;
}
