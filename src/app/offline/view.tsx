"use client";

// Shown by the service worker when a page can't be reached.
import { useSyncExternalStore } from "react";
import { LogoMark } from "@/components/brand";
import { pending, subscribe } from "@/lib/client/outbox";

export function OfflineView() {
  const waiting = useSyncExternalStore(subscribe, () => pending().length, () => 0);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <LogoMark className="size-12" />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-[14px] text-muted">This page needs a connection. {waiting ? `${waiting} change${waiting === 1 ? " is" : "s are"} kept on this device and will be sent when you're back online.` : "Nothing you entered offline is waiting to be sent."}</p>
      <button type="button" className="mt-2 rounded-full border border-border px-4 py-2 text-[13.5px] font-medium" onClick={() => location.reload()}>Try again</button>
    </main>
  );
}
