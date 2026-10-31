import { Suspense } from "react";
import { Verify } from "./verify";

export default function Page() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
