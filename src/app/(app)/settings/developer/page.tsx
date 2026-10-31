import type { Metadata } from "next";
import { DeveloperView } from "./view";

export const metadata: Metadata = { title: "Developer" };

export default function Page() {
  return <DeveloperView />;
}
