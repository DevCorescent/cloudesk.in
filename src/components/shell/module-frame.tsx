"use client";

// The frame every org-level module app shares: a side menu (grouped, with
// parts and manager-only entries hidden), the "not open to you" and loading
// states, and a typed context with the module's meta and API helpers.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import { ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { sendOrQueue } from "@/lib/client/outbox";

export type NavItem = { id: string; label: string; icon: ReactNode; group?: string; hidden?: boolean };

type Ctx<M> = { orgId: string; meta: M; go: (path: string) => void; base: string; api: string };
const FrameCtx = createContext<Ctx<unknown> | null>(null);

/** Provides the module's context for a module with its own layout (Documents' drive). */
export function ModuleContext<M>({ value, children }: { value: Ctx<M>; children: ReactNode }) {
  return <FrameCtx.Provider value={value as Ctx<unknown>}>{children}</FrameCtx.Provider>;
}

/** The module's context: its meta, `go` within the module, and the API base. */
export function useModule<M>() {
  const c = useContext(FrameCtx);
  if (!c) throw new Error("Module frame missing");
  return c as Ctx<M>;
}

/** GET a path under the module's API, cached under the module's key. */
export function useModuleQuery<T>(path: string | null, opts: { keepPrevious?: boolean } = {}) {
  const { orgId, api: base } = useModule();
  return useQuery({ queryKey: [base, orgId, path], queryFn: () => api<T>(`/api/v1/orgs/${orgId}/${base}/${path}`), enabled: !!path, placeholderData: opts.keepPrevious ? keepPreviousData : undefined });
}

/** POST/PUT/DELETE under the module's API, refreshing the module (and approvals and notifications) after. */
export function useModuleAction<B = unknown, R = unknown>(fn: (b: B) => { path: string; method?: string; body?: unknown }, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void; also?: string[] } = {}) {
  const { orgId, api: base } = useModule();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return api<R>(`/api/v1/orgs/${orgId}/${base}/${r.path}`, { method: r.method ?? "POST", body: r.body ?? {} });
    },
    onSuccess: (r) => {
      for (const k of [base, "approvals", "notify", ...(opts.also ?? [])]) qc.invalidateQueries({ queryKey: [k, orgId] });
      if (opts.success) toast({ tone: "success", title: typeof opts.success === "function" ? opts.success(r) : opts.success });
      opts.onDone?.(r);
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
}

/**
 * Like useModuleAction, for entries made on site: with no connection the
 * write is kept on this device and sent later (the toast says so), and it
 * carries an Idempotency-Key so it's never done twice.
 */
export function useModuleOfflineAction<B = unknown>(fn: (b: B) => { path: string; method?: string; body?: unknown; label: string }, opts: { success?: string; onDone?: () => void } = {}) {
  const { orgId, api: base } = useModule();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return sendOrQueue(`/api/v1/orgs/${orgId}/${base}/${r.path}`, { method: r.method ?? "POST", body: r.body ?? {}, label: r.label });
    },
    onSuccess: (r) => {
      const queued = !!r && typeof r === "object" && "queued" in r;
      if (queued) toast({ tone: "info", title: "No connection — kept on this device and sent when you're back online" });
      else {
        qc.invalidateQueries({ queryKey: [base, orgId] });
        if (opts.success) toast({ tone: "success", title: opts.success });
      }
      opts.onDone?.();
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
}

export function ModuleFrame<M>({ api: base, base: path, title, icon, nav, section, render }: { api: string; base: string; title: string; icon: ReactNode; nav: (m: M) => NavItem[]; section: string; render: (m: M) => ReactNode }) {
  const { org } = useSession();
  const router = useRouter();
  const meta = useQuery({ queryKey: [base, org.id, "meta"], queryFn: () => api<M>(`/api/v1/orgs/${org.id}/${base}/meta`), retry: false });
  if (meta.isError) {
    const status = (meta.error as { status?: number }).status;
    return status === 403 ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <span className="mx-auto grid size-6 place-items-center text-muted [&_svg]:size-6">{icon}</span>
        <h1 className="mt-3 text-lg font-semibold">{title} isn&apos;t open to you</h1>
        <p className="mt-1 text-[13px] text-muted">{errorMessage(meta.error)}</p>
        <Link href="/settings/features" className="mt-4 inline-flex text-[13px] font-medium underline">Open Features</Link>
      </div>
    ) : (
      <ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} />
    );
  }
  if (!meta.data)
    return (
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[210px_1fr]">
        <Skeleton className="hidden h-80 rounded-[20px] lg:block" />
        <Skeleton className="h-[70vh] rounded-[24px]" />
      </div>
    );
  const m = meta.data;
  const go = (p: string) => router.push(p ? `/${path}/${p}` : `/${path}`);
  const items = nav(m)
    .reduce<NavItem[]>((out, n) => [...out, { ...n, group: n.group ?? out[out.length - 1]?.group }], [])
    .filter((n) => !n.hidden)
    .map((n, i, all) => ({ ...n, group: n.group !== all[i - 1]?.group ? n.group : undefined }));
  return (
    <FrameCtx.Provider value={{ orgId: org.id, meta: m, go, base: path, api: base }}>
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[210px_minmax(0,1fr)] lg:py-8">
        <aside className="lg:sticky lg:top-6 lg:self-start print:hidden">
          <div className="mb-3 hidden px-2 lg:block">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">{title}</p>
            <p className="mt-1 truncate text-[14px] font-semibold">{org.name}</p>
          </div>
          <nav aria-label={title} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
            {items.map((n) => {
              const on = section === n.id;
              return (
                <div key={n.id} className="contents">
                  {n.group && <p className="hidden px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">{n.group}</p>}
                  <Link href={n.id ? `/${path}/${n.id}` : `/${path}`} aria-current={on ? "page" : undefined} className={cx("flex shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4", on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                    {n.icon}
                    {n.label}
                  </Link>
                </div>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">{render(m)}</main>
      </div>
    </FrameCtx.Provider>
  );
}

export const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/.test(x);
