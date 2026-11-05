"use client";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown,
  ) {
    super(message);
  }
  fieldErrors(): Record<string, string[]> {
    const d = this.details;
    return d && typeof d === "object" && !Array.isArray(d) && !("problems" in d) ? (d as Record<string, string[]>) : {};
  }
}

/** JSON fetch against the platform API with the standard error envelope. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch {
    throw new ApiClientError(0, "network_error", "Could not reach the server. Check your connection.", null);
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = (json as { error?: { code: string; message: string; details: unknown } } | null)?.error;
    // Public pages (portals, support links, signing) have their own sign-in; only member APIs go to the login page.
    if (res.status === 401 && typeof window !== "undefined" && !/^\/api\/v1\/(auth|portal|support|sign|guest)\//.test(path)) {
      // Session expired: a full navigation clears all cached data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears cached data from the previous session/org
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    // A plan limit or a feature outside the plan: the app shows one upgrade prompt for all of them.
    const d = (e?.details ?? null) as { quota?: string[]; planRequired?: string[]; upgrade?: string[]; topup?: string[] } | null;
    if (typeof window !== "undefined" && d && (d.quota || d.planRequired)) {
      window.dispatchEvent(new CustomEvent("cc:paywall", { detail: { message: e?.message ?? "", quota: d.quota?.[0] ?? null, module: d.planRequired?.[0] ?? null, upgrade: d.upgrade?.[0] ?? null, topup: d.topup?.[0] ?? null } }));
    }
    throw new ApiClientError(res.status, e?.code ?? "http_error", e?.message ?? `Request failed (${res.status})`, e?.details ?? null);
  }
  return json as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
