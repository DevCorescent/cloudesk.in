import { describe, expect, it } from "vitest";
import { comboKeys, detectDevice, platformOf, shortcutKeys, shortcutText } from "@/lib/client/keys";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
const CROS = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const media = (fine: boolean, coarse: boolean) => (q: string) => (q.includes("fine") ? fine : q.includes("coarse") ? coarse : false);

describe("keyboard shortcuts per device", () => {
  it("knows the platform, including iPads that say they're Macs", () => {
    expect(platformOf({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 })).toBe("mac");
    expect(platformOf({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 })).toBe("ios");
    expect(platformOf({ userAgent: WIN, platform: "Win32" })).toBe("windows");
    expect(platformOf({ userAgent: WIN, userAgentData: { platform: "Windows" } })).toBe("windows");
    expect(platformOf({ userAgent: IPHONE, platform: "iPhone" })).toBe("ios");
    expect(platformOf({ userAgent: ANDROID, platform: "Linux armv81" })).toBe("android");
    expect(platformOf({ userAgent: CROS, platform: "Linux x86_64" })).toBe("chromeos");
    expect(platformOf({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)", platform: "Linux x86_64" })).toBe("linux");
  });

  it("hides hints on phones and touch-only tablets, keeps them with a mouse or trackpad", () => {
    expect(detectDevice({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 }, media(true, false))).toEqual({ platform: "mac", apple: true, keyboard: true });
    expect(detectDevice({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 }, media(false, true)).keyboard).toBe(false);
    expect(detectDevice({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 }, media(false, true))).toEqual({ platform: "ios", apple: true, keyboard: false });
    expect(detectDevice({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 }, media(true, true)).keyboard).toBe(true); // iPad + Magic Keyboard
    expect(detectDevice({ userAgent: ANDROID, platform: "Linux armv81" }, media(false, true)).keyboard).toBe(false);
    expect(detectDevice({ userAgent: WIN, platform: "Win32" }, media(true, true))).toEqual({ platform: "windows", apple: false, keyboard: true });
  });

  it("writes shortcuts the way each device names them", () => {
    expect(shortcutText("mod+k", true)).toBe("⌘K");
    expect(shortcutText("mod+k", false)).toBe("Ctrl+K");
    // Apple's modifier order is ⌃⌥⇧⌘, whatever order the combo was written in.
    expect(shortcutText("shift+mod+z", true)).toBe("⇧⌘Z");
    expect(shortcutText("mod+alt+c", true)).toBe("⌥⌘C");
    expect(shortcutText("mod+shift+z", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutText("mod+enter", true)).toBe("⌘↵");
    expect(shortcutText("mod+enter", false)).toBe("Ctrl+Enter");
    expect(shortcutText("mod+backslash", false)).toBe("Ctrl+\\");
    expect(shortcutText("alt+up / alt+down", true)).toBe("⌥↑ / ⌥↓");
    expect(shortcutText("alt+n", false)).toBe("Alt+N");
    expect(shortcutText("?", false)).toBe("?");
    expect(shortcutText("1 / 2 / 3", true)).toBe("1 / 2 / 3");
  });

  it("splits keys for keycaps", () => {
    expect(comboKeys("mod+shift+x", false)).toEqual(["Ctrl", "Shift", "X"]);
    expect(comboKeys("shift+alt+mod+c", false)).toEqual(["Ctrl", "Alt", "Shift", "C"]);
    expect(comboKeys("mod+shift+x", true)).toEqual(["⇧", "⌘", "X"]);
    expect(shortcutKeys("mod+z / mod+shift+z", true)).toEqual([["⌘", "Z"], ["⇧", "⌘", "Z"]]);
    expect(shortcutKeys("esc", false)).toEqual([["Esc"]]);
  });
});
