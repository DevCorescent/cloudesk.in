import type { Metadata } from "next";
import { AdminConsole } from "./view";

export const metadata: Metadata = { title: "Platform admin", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminConsole />;
}
