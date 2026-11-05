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
  if (!res.ok) failed(res.status, path, json);
  return json as T;
}

/** An error answer from the API: signs out on an expired session, raises the upgrade prompt for plan limits, and throws. */
export function failed(status: number, path: string, json: unknown): never {
  const e = (json as { error?: { code: string; message: string; details: unknown } } | null)?.error;
  // Public pages (portals, support links, signing) have their own sign-in; only member APIs go to the login page.
  if (status === 401 && typeof window !== "undefined" && !/^\/api\/v1\/(auth|portal|support|sign|guest)\//.test(path)) {
    // Session expired: a full navigation clears all cached data.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears cached data from the previous session/org
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  // A plan limit or a feature outside the plan: the app shows one upgrade prompt for all of them.
  const d = (e?.details ?? null) as { quota?: string[]; planRequired?: string[]; upgrade?: string[]; topup?: string[] } | null;
  if (typeof window !== "undefined" && d && (d.quota || d.planRequired)) {
    window.dispatchEvent(new CustomEvent("cc:paywall", { detail: { message: e?.message ?? "", quota: d.quota?.[0] ?? null, module: d.planRequired?.[0] ?? null, upgrade: d.upgrade?.[0] ?? null, topup: d.topup?.[0] ?? null } }));
  }
  throw new ApiClientError(status, e?.code ?? "http_error", e?.message ?? `Request failed (${status})`, e?.details ?? null);
}

/**
 * A streamed API answer (one JSON object per line): each object goes to
 * `onEvent` as it arrives; resolves with the "done" object's `thread`, or
 * throws like api() for an error (before or during the stream).
 */
export async function apiStream<T>(path: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal }, onEvent: (e: { t: string; [k: string]: unknown }) => void): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "POST",
      headers: { Accept: "application/x-ndjson", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch {
    throw new ApiClientError(0, "network_error", "Could not reach the server. Check your connection.", null);
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) failed(res.status, path, json);
    return json as T;
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw new ApiClientError(0, "network_error", "The connection dropped before the answer finished. Try again.", null);
    }
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const e = safeJson(line) as { t: string; [k: string]: unknown } | null;
      if (!e) continue;
      if (e.t === "done") return e.thread as T;
      if (e.t === "error") failed(Number(e.status) || 500, path, { error: { code: e.code, message: e.message, details: e.details } });
      onEvent(e);
    }
  }
  throw new ApiClientError(0, "network_error", "The answer stopped before it finished. Try again.", null);
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
