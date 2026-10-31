import type { Metadata } from "next";
import { InboxView } from "@/components/notify/inbox";

export const metadata: Metadata = { title: "My work" };

export default function Page() {
  return <InboxView />;
}
