import { Suspense } from "react";
import { ResetForm } from "./form";

export default function Page() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
