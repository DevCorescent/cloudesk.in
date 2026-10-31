import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingView } from "./view";

export const metadata: Metadata = { title: "Billing" };

export default function Page() {
  return (
    <Suspense>
      <BillingView />
    </Suspense>
  );
}
