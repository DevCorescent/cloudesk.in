import type { Metadata } from "next";
import { Suspense } from "react";
import { RequestsApp } from "@/components/requests/requests-app";

export const metadata: Metadata = { title: "Request a feature" };

export default function Page() {
  return (
    <Suspense>
      <RequestsApp />
    </Suspense>
  );
}
