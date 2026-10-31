"use client";

// The till's lock screen and the manager-PIN prompt. The lock screen covers
// the whole window; staff tap their name and enter their PIN to unlock, and
// that person is recorded on what they do. It locks the device's screen — the
// account behind it stays signed in.
import { Delete, Lock, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { hApi, type Operator } from "./shared";

/**
 * A native modal, so it sits in the browser's top layer — above any dialog
 * that was already open (which no z-index can beat). `onCancel` is Escape;
 * leave it out and Escape does nothing.
 */
function TopLayer({ label, className, onCancel, children }: { label: string; className: string; onCancel?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onCancel?.();
      }}
      className={cx("m-0 h-dvh max-h-none w-screen max-w-none border-0 p-0 backdrop:bg-transparent", className)}
    >
      {children}
    </dialog>
  );
}

type Staff = { id: string; name: string; role: string; active: boolean };
const ROLE: Record<string, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier", captain: "Captain", waiter: "Waiter", chef: "Chef", bartender: "Bartender", host: "Host", housekeeping: "Housekeeping", valet: "Valet" };
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const TONES = ["#b4532a", "#2f6b4f", "#2d4fa3", "#8a3ffc", "#a16207", "#be185d", "#0f766e", "#4b5563"];

/** A number pad for PINs, usable with a mouse, touch or the keyboard. */
function PinPad({ value, onChange, onSubmit, busy, dark }: { value: string; onChange: (v: string) => void; onSubmit: () => void; busy?: boolean; dark?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key) && value.length < 6) onChange(value + e.key);
      else if (e.key === "Backspace") onChange(value.slice(0, -1));
      else if (e.key === "Enter" && value.length >= 4) onSubmit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [value, onChange, onSubmit]);
  const key = cx("grid h-16 place-items-center rounded-[20px] text-[24px] font-medium tabular-nums transition-[background,transform] duration-150 active:scale-95 disabled:opacity-40", dark ? "bg-white/10 text-white hover:bg-white/15" : "bg-surface-2 hover:bg-surface-3");
  return (
    <div className="grid gap-5">
      <div className="flex justify-center gap-3" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={cx("size-3.5 rounded-full transition-all duration-200", i < value.length ? (dark ? "scale-110 bg-white" : "scale-110 bg-fg") : dark ? "bg-white/20" : "bg-fg/15", i >= 4 && i >= value.length && "opacity-40")} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" disabled={busy || value.length >= 6} onClick={() => onChange(value + d)} className={key}>
            {d}
          </button>
        ))}
        <button type="button" aria-label="Delete" disabled={busy || !value} onClick={() => onChange(value.slice(0, -1))} className={key}>
          <Delete className="size-5" />
        </button>
        <button type="button" disabled={busy || value.length >= 6} onClick={() => onChange(value + "0")} className={key}>
          0
        </button>
        <button type="button" aria-label="Unlock" disabled={busy || value.length < 4} onClick={onSubmit} className={cx(key, dark ? "!bg-white !text-black" : "!bg-fg !text-bg")}>
          {busy ? "…" : "OK"}
        </button>
      </div>
    </div>
  );
}

export function LockScreen({ projectId, venueName, staff, onUnlock }: { projectId: string; venueName: string; staff: Staff[]; onUnlock: (o: Operator) => void }) {
  const [who, setWho] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const active = staff.filter((s) => s.active);
  const submit = async () => {
    if (!who || pin.length < 4) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ staff: Staff & { ticket: string } }>(hApi(projectId, "unlock"), { method: "POST", body: { staffId: who.id, pin } });
      onUnlock({ id: r.staff.id, name: r.staff.name, role: r.staff.role, ticket: r.staff.ticket });
    } catch (e) {
      setError(errorMessage(e));
      setPin("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <TopLayer label="Locked" className="grid overflow-y-auto bg-[#0d0d10] text-white">
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(60% 50% at 20% 10%, rgb(180 83 42 / 0.35), transparent 70%), radial-gradient(50% 50% at 90% 90%, rgb(45 79 163 / 0.3), transparent 70%)" }} />
      <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center justify-center px-6 py-10">
        <p className="flex items-center gap-2 text-[13px] font-medium text-white/50">
          <Lock className="size-3.5" /> {venueName}
        </p>
        <p className="mt-3 text-[64px] leading-none font-semibold tracking-[-0.04em] tabular-nums sm:text-[84px]">{now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</p>
        <p className="mt-2 text-[15px] text-white/50">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        {!who ? (
          <div className="mt-12 w-full">
            <p className="mb-4 text-center text-[14px] text-white/60">Who&apos;s using the till?</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {active.map((s, i) => (
                <button key={s.id} type="button" onClick={() => (setWho(s), setPin(""), setError(""))} className="group flex flex-col items-center gap-2.5 rounded-[24px] bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur-[20px] transition-[background,transform] duration-200 hover:-translate-y-0.5 hover:bg-white/10">
                  <span className="grid size-14 place-items-center rounded-full text-[18px] font-semibold" style={{ background: TONES[i % TONES.length] }}>
                    {initials(s.name)}
                  </span>
                  <span className="text-center">
                    <b className="block text-[15px] font-semibold">{s.name}</b>
                    <span className="text-[12px] text-white/50">{ROLE[s.role] ?? s.role}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-10 w-full max-w-[300px]">
            <button type="button" onClick={() => setWho(null)} className="mx-auto mb-6 flex items-center gap-2.5 rounded-full bg-white/[0.08] py-1.5 pr-4 pl-1.5 text-[14px] ring-1 ring-white/10 hover:bg-white/[0.12]">
              <span className="grid size-8 place-items-center rounded-full text-[12px] font-semibold" style={{ background: TONES[active.indexOf(who) % TONES.length] }}>
                {initials(who.name)}
              </span>
              {who.name}
              <X className="size-3.5 text-white/50" />
            </button>
            <PinPad value={pin} onChange={(v) => (setPin(v), setError(""))} onSubmit={() => void submit()} busy={busy} dark />
            <p className="mt-4 h-5 text-center text-[13px] text-[#fca5a5]" role="alert">
              {error}
            </p>
          </div>
        )}
      </div>
    </TopLayer>
  );
}

/** "This needs a manager": enter a manager's PIN to approve. */
export function ApprovalPrompt({ why, onDone }: { why: string; onDone: (pin: string | null) => void }) {
  const [pin, setPin] = useState("");
  return (
    <TopLayer label="Manager approval" onCancel={() => onDone(null)} className="grid place-items-center bg-black/40 p-4 text-fg backdrop-blur-[6px]">
      <div className="w-full max-w-[340px] rounded-[28px] border border-white/60 bg-white/85 p-6 shadow-[0_40px_100px_-30px_rgb(0_0_0/0.5)] backdrop-blur-[30px] dark:border-white/10 dark:bg-[rgb(28_28_32/0.85)]">
        <div className="mb-5 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-warning-soft text-warning">
            <ShieldCheck className="size-6" />
          </span>
          <h2 className="mt-3 text-[18px] font-semibold">Manager approval</h2>
          <p className="mt-1 text-[13px] text-muted">{why}</p>
        </div>
        <PinPad value={pin} onChange={setPin} onSubmit={() => onDone(pin)} />
        <button type="button" onClick={() => onDone(null)} className="mt-4 w-full text-[13px] text-muted hover:text-fg">
          Cancel
        </button>
      </div>
    </TopLayer>
  );
}
