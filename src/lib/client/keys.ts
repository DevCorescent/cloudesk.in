// Keyboard shortcuts, written once and shown the way the person's device
// names them: "mod+shift+z" is ⇧⌘Z on a Mac, iPhone or iPad and Ctrl+Shift+Z
// on Windows, Linux, ChromeOS and Android. Combos are "+"-joined key names;
// alternatives are separated by " / " ("mod+z / mod+shift+z").

export type Platform = "mac" | "ios" | "windows" | "linux" | "chromeos" | "android" | "other";
/** apple: ⌘-style keys. keyboard: a physical keyboard is likely (a fine pointer — mouse or trackpad — is present). */
export type Device = { platform: Platform; apple: boolean; keyboard: boolean };

type Nav = { platform?: string; userAgent?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } };

export function platformOf(nav: Nav): Platform {
  const hint = (nav.userAgentData?.platform || nav.platform || "").toLowerCase();
  const ua = (nav.userAgent || "").toLowerCase();
  // iPadOS presents itself as a Mac; touch points give it away.
  if (/iphone|ipad|ipod/.test(hint) || /iphone|ipad|ipod/.test(ua) || ((/mac/.test(hint) || /macintosh/.test(ua)) && (nav.maxTouchPoints ?? 0) > 1)) return "ios";
  if (/mac/.test(hint) || /macintosh|mac os x/.test(ua)) return "mac";
  if (/android/.test(hint) || /android/.test(ua)) return "android";
  if (/cros|chrome os/.test(hint) || /cros/.test(ua)) return "chromeos";
  if (/win/.test(hint) || /windows/.test(ua)) return "windows";
  if (/linux|x11/.test(hint) || /linux|x11/.test(ua)) return "linux";
  return "other";
}

/** The device in this browser. Phones and touch-only tablets report no keyboard, so shortcut hints stay out of their way. */
export function detectDevice(nav: Nav = navigator, media: (q: string) => boolean = (q) => window.matchMedia(q).matches): Device {
  const platform = platformOf(nav);
  const fine = media("(any-pointer: fine)");
  const keyboard = platform === "mac" || platform === "windows" || platform === "linux" || platform === "chromeos" ? fine || !media("(any-pointer: coarse)") : fine;
  return { platform, apple: platform === "mac" || platform === "ios", keyboard };
}

// Modifier order: Apple's is Control, Option, Shift, Command (⌃⌥⇧⌘);
// Windows and Linux write Ctrl, Alt, Shift.
const APPLE_ORDER = ["ctrl", "alt", "shift", "mod"];
const OTHER_ORDER = ["mod", "ctrl", "alt", "shift"];
const MODS = new Set(["mod", "cmd", "ctrl", "alt", "option", "shift"]);
const APPLE: Record<string, string> = { mod: "⌘", cmd: "⌘", ctrl: "⌃", alt: "⌥", option: "⌥", shift: "⇧", enter: "↵", return: "↵", backspace: "⌫", delete: "⌫", esc: "Esc", escape: "Esc", tab: "⇥", space: "Space" };
const OTHER: Record<string, string> = { mod: "Ctrl", cmd: "Ctrl", ctrl: "Ctrl", alt: "Alt", option: "Alt", shift: "Shift", enter: "Enter", return: "Enter", backspace: "Backspace", delete: "Delete", esc: "Esc", escape: "Esc", tab: "Tab", space: "Space" };
const SAME: Record<string, string> = { up: "↑", down: "↓", left: "←", right: "→", backslash: "\\", slash: "/", plus: "+" };

function label(key: string, apple: boolean) {
  const k = key.trim();
  const low = k.toLowerCase();
  return (apple ? APPLE : OTHER)[low] ?? SAME[low] ?? (k.length === 1 ? k.toUpperCase() : k);
}

/** One combo as separate key labels, modifiers first: "mod+shift+z" → ["⇧", "⌘", "Z"] or ["Ctrl", "Shift", "Z"]. */
export function comboKeys(combo: string, apple: boolean): string[] {
  const parts = combo.split(/\+(?!$)/).map((p) => p.trim()).filter(Boolean);
  const mods = parts.filter((p) => MODS.has(p.toLowerCase()));
  const rest = parts.filter((p) => !MODS.has(p.toLowerCase()));
  const order = apple ? APPLE_ORDER : OTHER_ORDER;
  const rank = (p: string) => order.indexOf(({ cmd: "mod", option: "alt" } as Record<string, string>)[p.toLowerCase()] ?? p.toLowerCase());
  return [...mods.sort((a, b) => rank(a) - rank(b)), ...rest].map((p) => label(p, apple));
}

/** Alternatives, each a list of key labels: "mod+z / mod+shift+z" → [["⌘","Z"], ["⇧","⌘","Z"]]. */
export function shortcutKeys(spec: string, apple: boolean): string[][] {
  return spec.split(" / ").map((c) => comboKeys(c, apple));
}

/** As text, for titles, menus and toasts: "⇧⌘Z" on Apple devices, "Ctrl+Shift+Z" elsewhere. */
export function shortcutText(spec: string, apple: boolean): string {
  return shortcutKeys(spec, apple)
    .map((keys) => (apple ? keys.join("") : keys.join("+")))
    .join(" / ");
}
