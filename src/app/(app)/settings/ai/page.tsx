import type { Metadata } from "next";
import { ProvidersView } from "./view";

export const metadata: Metadata = { title: "AI providers" };

export default function Page() {
  return <ProvidersView />;
}
