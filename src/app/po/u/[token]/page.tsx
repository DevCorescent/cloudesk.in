import type { Metadata } from "next";
import { unsubscribe, unsubscribeInfo } from "@/server/outreach/core";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The unsubscribe link in Cloudesk's promotional emails: one tap to stop them.
export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  async function confirm() {
    "use server";
    await unsubscribe(token);
    const { redirect } = await import("next/navigation");
    redirect(`/po/u/${token}?done=1`);
  }
  const info = await unsubscribeInfo(token);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-[20px] border border-border bg-surface p-6 text-center">
        <h1 className="text-[18px] font-semibold">{!info ? "This link has expired" : info.done || done ? "You're unsubscribed" : "Unsubscribe from Cloudesk emails?"}</h1>
        <p className="mt-2 text-[13.5px] text-muted">
          {!info ? "If you keep getting our emails, reply to one and we'll remove you." : info.done || done ? `We won't send promotional emails to ${info.email} again.` : `We'll stop sending promotional emails to ${info.email}.`}
        </p>
        {info && !info.done && !done && (
          <form action={confirm} className="mt-5">
            <button type="submit" className="h-10 w-full rounded-full bg-fg text-[14px] font-semibold text-bg">Unsubscribe</button>
          </form>
        )}
      </div>
    </main>
  );
}
