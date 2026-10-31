"use client";

// A partner's code: typed at sign-up or in Billing. It's checked as you leave
// the box (what it gives, and whose it is); the server checks it again when
// it's used.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Loader2, TicketPercent } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { subKey, subPath, type Overview } from "./types";

type Checked = { valid: true; code: string; partner: string; label: string } | { valid: false };

export function useCodeCheck(code: string) {
  const [state, setState] = useState<{ busy: boolean; result: Checked | null }>({ busy: false, result: null });
  const check = async (c = code) => {
    const v = c.trim();
    if (!v) return setState({ busy: false, result: null });
    setState({ busy: true, result: null });
    try {
      setState({ busy: false, result: await api<Checked>(`/api/v1/partners/coupon?code=${encodeURIComponent(v)}`) });
    } catch {
      setState({ busy: false, result: null });
    }
  };
  return { ...state, check };
}

/** The sign-up form's optional code (also filled from ?code= in the address). */
export function CouponField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const [open, setOpen] = useState(!!value);
  const c = useCodeCheck(value);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (fromUrl && !value) {
      /* eslint-disable react-hooks/set-state-in-effect -- read once from the address */
      onChange(fromUrl.toUpperCase());
      setOpen(true);
      /* eslint-enable react-hooks/set-state-in-effect */
      void c.check(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 justify-self-start text-[13.5px] font-medium text-fg/60 hover:text-fg">
        <TicketPercent className="size-4" /> Have a partner code?
      </button>
    );
  const shown = error ?? (c.result && !c.result.valid ? "That code isn't valid or has expired." : undefined);
  return (
    <div className="grid gap-1.5">
      <label htmlFor="coupon" className="text-[13px] font-medium">Partner code <span className="font-normal text-fg/45">· optional</span></label>
      <input id="coupon" className="p-input uppercase" value={value} onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20))} onBlur={() => void c.check()} placeholder="e.g. RIYA42" aria-invalid={!!shown || undefined} autoComplete="off" />
      {c.busy ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-fg/50"><Loader2 className="size-3.5 animate-spin" /> Checking…</p>
      ) : shown ? (
        <p className="text-[12.5px] text-danger">{shown}</p>
      ) : c.result?.valid ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--p-mint-ink,#0f766e)]"><BadgeCheck className="size-3.5" /> {c.result.label} · from {c.result.partner}</p>
      ) : null}
    </div>
  );
}

/** Settings → Billing: the code on the workspace, or a box to add one. */
export function CouponCard({ o, orgId }: { o: Overview; orgId: string }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(false);
  const c = useCodeCheck(code);
  const apply = useMutation({
    mutationFn: () => api<Overview>(subPath(orgId, "/coupon"), { method: "POST", body: { code } }),
    onSuccess: (ov) => qc.setQueryData(subKey(orgId), ov),
  });
  if (o.coupon)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] bg-surface p-4 ring-1 ring-border">
        <span className="grid size-9 place-items-center rounded-[12px] bg-success-soft text-success"><TicketPercent className="size-4" /></span>
        <div className="min-w-0 text-[13px]">
          <p className="font-medium">Partner code {o.coupon.code}</p>
          <p className="text-muted">{o.coupon.left > 0 && o.coupon.discount ? `${o.coupon.discount.replace(/^(\S+) off the first/, "$1 off your next")} — taken off each invoice automatically.` : "Applied to this workspace."}</p>
        </div>
      </div>
    );
  return (
    <div className="rounded-[16px] bg-surface p-4 ring-1 ring-border">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 text-[13px] font-medium text-muted hover:text-fg">
          <TicketPercent className="size-4" /> Have a partner code? Add it for a discount on your invoices.
        </button>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply.mutate();
          }}
        >
          <label htmlFor="billing-coupon" className="text-[13px] font-medium">Partner code</label>
          <div className="flex flex-wrap gap-2">
            <Input id="billing-coupon" className="max-w-[220px] uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20))} onBlur={() => void c.check()} placeholder="e.g. RIYA42" autoComplete="off" />
            <Button type="submit" variant="primary" loading={apply.isPending} disabled={!code}>Apply</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
          {apply.error ? (
            <p className="text-[12.5px] text-danger">{errorMessage(apply.error)}</p>
          ) : c.result?.valid ? (
            <p className="text-[12.5px] text-success">{c.result.label} · from {c.result.partner}</p>
          ) : c.result ? (
            <p className="text-[12.5px] text-danger">That code isn&apos;t valid or has expired.</p>
          ) : (
            <p className="text-[12.5px] text-subtle">A workspace can use one partner code. The discount applies to invoices raised after it&apos;s added.</p>
          )}
        </form>
      )}
    </div>
  );
}
