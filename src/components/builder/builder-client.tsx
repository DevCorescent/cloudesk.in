"use client";

import dynamic from "next/dynamic";
import { Spinner } from "../ui/primitives";

// The editor depends on the browser (viewport size, storage, iframes) and loads
// its data client-side, so it is rendered only on the client.
export const BuilderClient = dynamic(() => import("./builder").then((m) => m.Builder), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center">
      <Spinner label="Loading editor" />
    </div>
  ),
});
