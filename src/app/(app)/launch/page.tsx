import type { Metadata } from "next";
import { Suspense } from "react";
import { LaunchView } from "@/components/launch/launch-view";

export const metadata: Metadata = { title: "Launch" };

export default function Page() {
  return (
    <Suspense>
      <LaunchView />
    </Suspense>
  );
}
