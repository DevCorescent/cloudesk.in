import type { Metadata } from "next";
import { OfflineView } from "./view";

export const metadata: Metadata = { title: "Offline" };

export default function Page() {
  return <OfflineView />;
}
