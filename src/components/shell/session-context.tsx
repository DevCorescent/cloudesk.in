"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

export type ClientUser = { id: string; email: string; name: string; emailVerified: boolean; isPlatformAdmin: boolean; mfaEnabled: boolean };
export type ClientOrg = {
  id: string;
  name: string;
  slug: string;
  role: string;
  requireMfa: boolean;
  modules: string[] | null;
  industry: string | null;
  /** Parts of modules switched off, by module id. */
  partsOff: Partial<Record<string, string[]>>;
  /** The member's custom role, if any, and the modules it's limited to. */
  customRole: string | null;
  allowed: string[] | null;
  /** Features the subscription includes (null = all). */
  entitled?: string[] | null;
  /** The subscription in force: trial, active, grace, canceling, expired or unrestricted. */
  plan?: { state: string; name: string; until: string | null } | null;
};

type Ctx = { user: ClientUser; orgs: ClientOrg[]; org: ClientOrg };
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const v = useContext(SessionCtx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

// Full reloads are deliberate here: switching organization or signing out must
// drop every cached query belonging to the previous context.
export function switchOrg(orgId: string) {
  document.cookie = `cc_org=${orgId}; Path=/; SameSite=Lax; Max-Age=31536000`;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears cached data from the previous session/org
  window.location.assign("/home");
}

export async function signOut() {
  await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears cached data from the previous session/org
  window.location.assign("/login");
}

export type ThemePref = "light" | "dark" | "system";

export function getTheme(): ThemePref {
  try {
    const t = localStorage.getItem("cc-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

const THEME_EVENT = "cc-theme-change";

/** Reads the stored theme preference without a hydration mismatch. */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(THEME_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(THEME_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    getTheme,
    () => "system",
  );
}

export function setTheme(t: ThemePref) {
  try {
    if (t === "system") localStorage.removeItem("cc-theme");
    else localStorage.setItem("cc-theme", t);
  } catch {
    /* storage unavailable: still apply for this page view */
  }
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  window.dispatchEvent(new Event(THEME_EVENT));
}
