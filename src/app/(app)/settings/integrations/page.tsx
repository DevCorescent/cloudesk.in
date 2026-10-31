import type { Metadata } from "next";
import { HubView } from "./view";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return <HubView />;
}
