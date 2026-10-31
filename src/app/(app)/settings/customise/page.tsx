import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomiseView } from "./view";

export const metadata: Metadata = { title: "Customise" };

export default function Page() {
  return (
    <Suspense>
      <CustomiseView />
    </Suspense>
  );
}
