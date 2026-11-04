"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { forwardRef, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export { clsx as cx };

// ─── Button ──────────────────────────────────────────────────────────────────

import { buttonClasses, type Size, type Variant } from "./button-classes";

export { buttonClasses };

/** A link styled as a button (avoids nesting a <button> inside an <a>). */
export function ButtonLink({ href, variant = "secondary", size = "md", icon, className, children, external, label, onClick }: { href: string; variant?: Variant; size?: Size; icon?: ReactNode; className?: string; children?: ReactNode; external?: boolean; label?: string; onClick?: () => void }) {
  const cls = buttonClasses(variant, size, clsx(!children && (size === "sm" ? "!w-7 !px-0" : "!w-8 !px-0"), className));
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls} aria-label={label} title={label} onClick={onClick}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} aria-label={label} title={label} onClick={onClick}>
      {icon}
      {children}
    </Link>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, size = "md", ...rest }: Omit<ButtonProps, "children"> & { label: string; children?: ReactNode }) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      title={label}
      className={clsx(size === "sm" ? "!w-7 max-sm:!w-8 !px-0" : "!w-8 max-sm:!w-9 !px-0", className)}
      size={size}
      {...rest}
    />
  );
}

// ─── Form controls ───────────────────────────────────────────────────────────

// On phones: 16px text (smaller makes iOS zoom in when a field is tapped) and thumb-sized height.
const control =
  "w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 text-[13px] max-sm:text-[16px] text-fg placeholder:text-subtle shadow-[inset_0_1px_2px_rgb(0_0_0/0.03)] transition-[border,box-shadow,background] duration-[var(--dur)] hover:border-border-strong focus:border-accent focus:bg-surface-solid focus:outline-none focus:ring-4 focus:ring-accent/20 disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(control, "h-9 max-sm:h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(control, "min-h-20 resize-y py-2 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(control, "h-9 max-sm:h-11 appearance-none bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-7", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b8b92' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

/**
 * For a table of editable lines (an invoice's items, a journal's entries): give
 * it `className="form-lines"` and this ref. Each cell is labelled with its
 * column's heading, so on a phone (where the CSS turns each row into a card,
 * globals.css) every field still says what it is.
 */
export function useColumnLabels<T extends HTMLTableElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
    for (const row of t.querySelectorAll("tbody tr")) {
      [...row.children].forEach((td, i) => {
        const label = heads[i];
        if (label) td.setAttribute("data-label", label);
        else td.removeAttribute("data-label");
      });
    }
  });
  return ref;
}

/** A table of editable lines that becomes a stack of cards on phones (see useColumnLabels). */
export function FormLines({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useColumnLabels<HTMLTableElement>();
  return (
    <table ref={ref} className={clsx("form-lines", className)}>
      {children}
    </table>
  );
}

/** Label + control + hint/error with correct aria wiring. */
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode; className?: string }) {
  const id = useId();
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={clsx("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": descId })}
      {(error || hint) && (
        <p id={descId} className={clsx("text-xs", error ? "text-danger" : "text-subtle")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-[var(--dur)] disabled:opacity-50",
        checked ? "bg-fg" : "bg-surface-3",
      )}
    >
      <span className={clsx("size-[18px] rounded-full bg-white dark:bg-black shadow-[0_2px_4px_rgb(0_0_0/0.2),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-[var(--dur)] ease-[var(--ease)]", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

// ─── Display ─────────────────────────────────────────────────────────────────

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  accent: "bg-accent-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  const color = { neutral: "bg-subtle", accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <span className={clsx("size-1.5 rounded-full", color)} aria-hidden />
      {label}
    </span>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("glass-card rounded-[var(--radius-xl)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton rounded-[var(--radius-sm)]", className)} aria-hidden />;
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={clsx("size-4 animate-spin text-subtle", className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {icon && <div className="glass-card mb-4 flex size-12 items-center justify-center rounded-[var(--radius-lg)] text-accent">{icon}</div>}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Could not load this", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted">{message}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-sans text-[11px] text-muted">{children}</kbd>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-7 sm:gap-4">
      <div className="min-w-0">
        <h1 className="title-xl text-fg max-sm:text-[23px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted sm:mt-1.5 sm:text-[14px]">{description}</p>}
      </div>
      {/* Phones: the actions get their own row under the title, wrapping if there are many. */}
      {actions && <div className="flex flex-wrap items-center gap-2 max-sm:w-full">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const bg = { neutral: "bg-surface-2 border-border", accent: "bg-accent-soft border-transparent", success: "bg-success-soft border-transparent", warning: "bg-warning-soft border-transparent", danger: "bg-danger-soft border-transparent" }[tone];
  return (
    <div className={clsx("flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-[13px]", bg)} role={tone === "danger" ? "alert" : "status"}>
      <div className="min-w-0">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}
