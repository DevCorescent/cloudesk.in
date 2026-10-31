import { Suspense } from "react";
import { Invite } from "./invite";

export default function Page() {
  return (
    <Suspense>
      <Invite />
    </Suspense>
  );
}
