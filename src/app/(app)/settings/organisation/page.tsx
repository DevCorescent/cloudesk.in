import type { Metadata } from "next";
import { OrganisationSettings } from "@/components/org/settings";

export const metadata: Metadata = { title: "Organisation" };

export default function Page() {
  return <OrganisationSettings />;
}
