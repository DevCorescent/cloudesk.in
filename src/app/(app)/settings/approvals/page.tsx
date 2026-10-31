import type { Metadata } from "next";
import { ApprovalSettings } from "@/components/approvals/settings";

export const metadata: Metadata = { title: "Approvals" };

export default function Page() {
  return <ApprovalSettings />;
}
