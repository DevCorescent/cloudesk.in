"use client";

// Six boxes for an emailed code: typing moves forward, backspace moves back,
// pasting (or the phone's "from Messages/Mail" suggestion) fills every box, and
// the whole code is handed over the moment the last digit lands.
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

export function OtpInput({ value, onChange, onComplete, length = 6, disabled, invalid, autoFocus, label = "Code", describedBy }: { value: string; onChange: (v: string) => void; onComplete?: (code: string) => void; length?: number; disabled?: boolean; invalid?: boolean; autoFocus?: boolean; label?: string; describedBy?: string }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  // The value as just typed, before React re-renders (focus moves in the same event).
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const focus = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  };
  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, length - 1)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when first shown
  }, [autoFocus]);

  const set = (next: string, from: number) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    latest.current = clean;
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    else focus(Math.min(clean.length, from));
  };
  const put = (i: number, text: string) => {
    const typed = text.replace(/\D/g, "");
    if (!typed) return;
    // A whole code (autofill or paste into one box) replaces everything.
    if (typed.length >= length) return set(typed, length);
    const chars = Array.from({ length }, (_, k) => latest.current[k] ?? "");
    for (let k = 0; k < typed.length && i + k < length; k++) chars[i + k] = typed[k]!;
    const joined = chars.join("");
    // Keep only the unbroken run from the start, so the value never has holes.
    const run = joined.slice(0, chars.findIndex((c) => !c) === -1 ? length : chars.findIndex((c) => !c));
    latest.current = run;
    onChange(run);
    if (run.length === length) onComplete?.(run);
    else focus(i + typed.length);
  };

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className="flex justify-between gap-1.5 sm:gap-2.5">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          maxLength={i === 0 ? length : 1}
          onFocus={(e) => {
            // Always type into the first empty box.
            if (i > latest.current.length) focus(latest.current.length);
            else e.currentTarget.select();
          }}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return set(value.slice(0, i), i);
            put(i, v.length > 1 && d && v.startsWith(d) ? v.slice(1) : v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              if (d) set(value.slice(0, i), i);
              else if (i > 0) set(value.slice(0, i - 1), i - 1);
            } else if (e.key === "ArrowLeft" && i > 0) {
              e.preventDefault();
              focus(i - 1);
            } else if (e.key === "ArrowRight" && i < value.length) {
              e.preventDefault();
              focus(i + 1);
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            put(i, e.clipboardData.getData("text"));
          }}
          className={clsx(
            "h-14 w-full min-w-0 max-w-[56px] rounded-[14px] border bg-[var(--surface-solid)] text-center font-mono text-[24px] font-semibold tabular-nums outline-none transition-[border,box-shadow] sm:h-16 sm:text-[26px]",
            invalid ? "border-danger/60 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--danger)_14%,transparent)]" : "border-fg/12 focus:border-fg/45 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--fg)_8%,transparent)]",
            disabled && "opacity-60",
          )}
        />
      ))}
    </div>
  );
}

/** Seconds left until a new code may be asked for (the server refuses one within 30 s). */
export function useCountdown(until: number) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(t);
    };
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [until]);
  return now ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
