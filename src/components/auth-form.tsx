"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LogoMark } from "./brand";

/** Sign-in screens: a calm title, the form, and a quiet footer line. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-form p-in">
      <LogoMark className="mb-7 size-12 drop-shadow-[0_12px_20px_rgb(0_0_0/0.22)]" />
      <h1 className="text-[34px] leading-[1.05] font-semibold tracking-[-0.035em] text-fg">{title}</h1>
      {subtitle && <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
      <div className="mt-8">{children}</div>
      {footer && <div className="mt-8 text-[14px] text-muted">{footer}</div>}
    </div>
  );
}

/** Password input with show/hide and, for new passwords, a gentle strength hint. */
export function PasswordInput({ id, name, autoComplete, strength, invalid, describedBy, autoFocus }: { id: string; name: string; autoComplete: string; strength?: boolean; invalid?: boolean; describedBy?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");
  const score = Math.min(4, (value.length >= 10 ? 1 : 0) + (value.length >= 14 ? 1 : 0) + (/[0-9]/.test(value) ? 1 : 0) + (/[^A-Za-z0-9]/.test(value) ? 1 : 0) + (/[A-Z]/.test(value) && /[a-z]/.test(value) ? 1 : 0));
  const label = ["Too short", "Weak", "Fair", "Good", "Strong"][value.length < 10 ? 0 : score];
  const colors = ["var(--p-rose)", "var(--p-peach)", "var(--p-butter)", "var(--p-sky)", "var(--p-mint)"];
  return (
    <div className="grid gap-2">
      <div className="relative">
        <input id={id} name={name} type={show ? "text" : "password"} autoComplete={autoComplete} required minLength={strength ? 10 : undefined} aria-invalid={invalid || undefined} aria-describedby={describedBy} autoFocus={autoFocus} value={value} onChange={(e) => setValue(e.target.value)} className="p-input pr-12" />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide" : "Show"} title={show ? "Hide password" : "Show password"} className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-fg/5 hover:text-fg">
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {strength && value && (
        <div className="flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-1 flex-1 rounded-full transition-colors duration-300" style={{ background: value.length >= 10 && i < score ? colors[score] : "color-mix(in srgb, var(--fg) 8%, transparent)", filter: "saturate(1.6) brightness(.92)" }} />
            ))}
          </div>
          <span className="w-16 text-right text-[11px] text-muted">{label}</span>
        </div>
      )}
    </div>
  );
}
