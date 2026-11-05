"use client";

// Paying a subscription invoice. Razorpay opens its checkout over the page and
// we confirm with the server afterwards; Stripe sends the browser to its page
// and back (handled by useStripeReturn). Nothing reads as paid until the server
// has asked the provider and says so.
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Landmark } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Notice } from "@/components/ui/primitives";
import { money } from "@/lib/billing/catalog";
import { api, errorMessage } from "@/lib/client/api";
import { subKey, subPath, type Invoice, type Overview, type Provider } from "./types";

type RazorpayStart = { provider: "razorpay"; keyId: string; orderId: string; amount: number; currency: string; name: string; description: string; prefill: { email: string; name: string } };
type StripeStart = { provider: "stripe"; url: string };
type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCtor = new (o: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: unknown) => void) => void };

const PROVIDER = { razorpay: { name: "Razorpay", line: "UPI, cards, net banking and wallets" }, stripe: { name: "Stripe", line: "Cards from anywhere" } } as const;

let razorpayScript: Promise<RazorpayCtor> | null = null;
function loadRazorpay(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  razorpayScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay didn't load")));
    s.onerror = () => {
      razorpayScript = null;
      reject(new Error("Couldn't reach Razorpay. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return razorpayScript;
}

/**
 * Starts paying an invoice: asks which provider when both are set up, says
 * plainly when none is. Render `ui` once; call `pay(invoice)`.
 */
export function usePayInvoice(orgId: string, overview: Overview | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  const [picking, setPicking] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noProvider, setNoProvider] = useState<Invoice | null>(null);
  const providers = overview?.providers ?? [];

  const done = (o: Overview) => qc.setQueryData(subKey(orgId), o);

  async function run(inv: Invoice, provider: Provider) {
    setPicking(null);
    setBusy(inv.id);
    try {
      const r = await api<RazorpayStart | StripeStart>(subPath(orgId, `/invoices/${inv.id}/pay`), { method: "POST", body: { provider } });
      if (r.provider === "stripe") {
        window.location.assign(r.url);
        return;
      }
      const Razorpay = await loadRazorpay();
      const rz = new Razorpay({
        key: r.keyId,
        order_id: r.orderId,
        amount: r.amount,
        currency: r.currency,
        name: r.name,
        description: r.description,
        prefill: r.prefill,
        theme: { color: "#111111" },
        modal: { ondismiss: () => setBusy(null) },
        handler: async (resp: RazorpayResponse) => {
          try {
            const c = await api<{ paid: boolean; overview: Overview }>(subPath(orgId, `/invoices/${inv.id}/confirm`), { method: "POST", body: { provider: "razorpay", orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature } });
            done(c.overview);
            toast(c.paid ? { tone: "success", title: `${inv.number} paid`, description: "Thank you — your plan is up to date." } : { tone: "info", title: "Payment is still processing", description: "This page updates once Razorpay confirms it." });
          } catch (e) {
            toast({ tone: "error", title: "Couldn't confirm the payment", description: errorMessage(e) });
            void qc.invalidateQueries({ queryKey: subKey(orgId) });
          } finally {
            setBusy(null);
          }
        },
      });
      rz.on("payment.failed", () => toast({ tone: "error", title: "The payment didn't go through", description: "Nothing was charged. You can try again." }));
      rz.open();
    } catch (e) {
      setBusy(null);
      toast({ tone: "error", title: "Couldn't start the payment", description: errorMessage(e) });
    }
  }

  function pay(inv: Invoice) {
    if (!providers.length) return setNoProvider(inv);
    // Payment providers only accept payments from the website they approved: continue there.
    const home = overview?.payOrigin;
    if (home && window.location.origin !== home) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- another origin, so a full navigation
      window.location.assign(`${home}/settings/billing?pay=${encodeURIComponent(inv.id)}`);
      return;
    }
    if (providers.length === 1) return void run(inv, providers[0]!);
    setPicking(inv);
  }

  const ui = (
    <>
      {picking && (
        <Dialog open onClose={() => setPicking(null)} title={`Pay ${money(picking.total, picking.currency)}`} description={`${picking.number} · ${picking.description}`} size="sm">
          <div className="grid gap-2">
            {providers.map((p) => (
              <button key={p} type="button" onClick={() => void run(picking, p)} className="flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2">
                <span className="grid size-9 place-items-center rounded-[10px] bg-surface-2">{p === "razorpay" ? <Landmark className="size-4" /> : <CreditCard className="size-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">{PROVIDER[p].name}</span>
                  <span className="block text-[12px] text-muted">{PROVIDER[p].line}</span>
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {noProvider && (
        <Dialog open onClose={() => setNoProvider(null)} title={`Pay ${noProvider.number}`} size="sm" footer={<Button onClick={() => setNoProvider(null)}>Close</Button>}>
          <NoProviderNote invoice={noProvider} />
        </Dialog>
      )}
    </>
  );
  return { pay, busy, ui };
}

export function NoProviderNote({ invoice }: { invoice?: Invoice }) {
  return (
    <Notice tone="warning" title="Online payments aren't set up yet">
      Contact support to pay by bank transfer or UPI{invoice ? <> — quote <b className="font-medium text-fg">{invoice.number}</b> for {money(invoice.total, invoice.currency)}</> : null}. The Cloudesk team marks the invoice paid once it arrives, and your plan updates on its own.
    </Notice>
  );
}

/** Back from Stripe Checkout: confirm once with the server, then tidy the address bar. */
export function useStripeReturn(orgId: string, enabled: boolean) {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const once = useRef(false);
  const paid = params.get("paid");
  const [cancelled, setCancelled] = useState(paid === "cancelled");
  const invoice = params.get("invoice");
  const session = params.get("session_id");
  useEffect(() => {
    if (!enabled || once.current || !paid) return;
    once.current = true;
    const clean = () => router.replace("/settings/billing", { scroll: false });
    if (paid !== "stripe" || !invoice || !session) return clean();
    api<{ paid: boolean; overview: Overview }>(subPath(orgId, `/invoices/${invoice}/confirm`), { method: "POST", body: { provider: "stripe", sessionId: session } })
      .then((r) => {
        qc.setQueryData(subKey(orgId), r.overview);
        toast(r.paid ? { tone: "success", title: "Payment received", description: "Thank you — your plan is up to date." } : { tone: "info", title: "Payment is still processing", description: "This page updates once Stripe confirms it." });
      })
      .catch((e) => toast({ tone: "error", title: "Couldn't confirm the payment", description: errorMessage(e) }))
      .finally(clean);
  }, [enabled, paid, invoice, session, orgId, qc, router, toast]);
  return { cancelled, dismissCancelled: () => setCancelled(false) };
}
