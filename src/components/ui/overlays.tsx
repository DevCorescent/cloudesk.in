"use client";

import clsx from "clsx";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconButton } from "./primitives";

// ─── Dialog (native <dialog>: focus trap, Escape, inert background) ─────────

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  icon,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  /** Shown before the title. */
  icon?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", "2xl": "max-w-6xl" }[size];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dlg-title"
      className={clsx(
        "dlg-sheet glass-strong animate-in m-auto w-[calc(100%-32px)] rounded-[var(--radius-xl)] p-0 text-fg backdrop:bg-black/25 backdrop:backdrop-blur-[6px]",
        width,
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col max-sm:max-h-[90dvh]">
          <span className="mx-auto mt-2 h-[5px] w-10 shrink-0 rounded-full bg-fg/15 sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-3 max-sm:px-5 max-sm:pt-3">
            {icon}
            <div className="min-w-0 flex-1">
              <h2 id="dlg-title" className="text-[17px] font-semibold tracking-[-0.015em]">
                {title}
              </h2>
              {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose} icon={<X className="size-4" />} />
          </div>
          {children && <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-5 max-sm:px-5">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4 max-sm:px-5 max-sm:[&>*]:flex-1">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

type Toast = { id: number; tone: "success" | "error" | "info"; title: string; description?: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-[calc(var(--dock)+16px)] z-[100] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 max-sm:top-[calc(var(--bar)+8px)] max-sm:bottom-auto max-sm:right-1/2 max-sm:translate-x-1/2">
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertCircle : Info;
          return (
            <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="glass-strong animate-in pointer-events-auto flex gap-2.5 rounded-[var(--radius-lg)] px-4 py-3">
              <Icon className={clsx("mt-0.5 size-4 shrink-0", t.tone === "success" ? "text-success" : t.tone === "error" ? "text-danger" : "text-accent")} aria-hidden />
              <div className="min-w-0 text-[13px]">
                <p className="font-medium text-fg">{t.title}</p>
                {t.description && <p className="mt-0.5 text-muted">{t.description}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ─── Menu (dropdown) ─────────────────────────────────────────────────────────

export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | "separator";

export function Menu({ trigger, items, align = "end", label }: { trigger: (props: { onClick: (e?: React.MouseEvent<HTMLElement>) => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; items: MenuItem[]; align?: "start" | "end"; label: string }) {
  const [open, setOpen] = useState(false);
  // Opens upward when there isn't room below (say, a composer at the bottom of the screen).
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const toggle = (e?: React.MouseEvent<HTMLElement>) => {
    const r = e?.currentTarget.getBoundingClientRect();
    if (r && !open) {
      const below = window.innerHeight - r.bottom;
      setUp(below < Math.min(320, items.length * 34 + 24) && r.top > below);
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const btns = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      btns[(i + 1) % btns.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      btns[(i - 1 + btns.length) % btns.length]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    }
  };
  return (
    <div ref={root} className="relative inline-flex">
      {trigger({ onClick: toggle, "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          className={clsx("glass-strong animate-in absolute z-50 max-h-[min(70vh,420px)] min-w-52 overflow-y-auto rounded-[14px] p-1.5", up ? "bottom-full mb-1.5" : "top-full mt-1.5", align === "end" ? "right-0" : "left-0")}
        >
          {items.map((it, i) =>
            it === "separator" ? (
              <div key={i} className="mx-2 my-1 h-px bg-border" role="separator" />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={clsx(
                  // macOS-style highlight: a solid fill with inverted text.
                  "group flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[13px] outline-none disabled:opacity-40 disabled:hover:bg-transparent",
                  it.danger ? "text-danger hover:bg-danger hover:text-white focus:bg-danger focus:text-white" : "text-fg hover:bg-accent hover:text-accent-fg focus:bg-accent focus:text-accent-fg",
                )}
              >
                {it.icon && <span className="text-muted group-hover:text-current group-focus:text-current [&>svg]:size-4">{it.icon}</span>}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    // Scrolls sideways on its own when the tabs don't fit (the page never does); the baseline is an inset line so the active underline isn't clipped.
    <div role="tablist" className={clsx("flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.value === value);
            if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].value);
            if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].value);
          }}
          tabIndex={value === t.value ? 0 : -1}
          className={clsx(
            "flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
            value === t.value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Segmented control ───────────────────────────────────────────────────────

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-[9px] bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium transition-[background,color,box-shadow] duration-[var(--dur)]",
            value === o.value ? "bg-surface-solid text-fg shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)]" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
