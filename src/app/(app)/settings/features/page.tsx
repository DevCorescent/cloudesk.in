import type { Metadata } from "next";
import { FeaturesSettings } from "@/components/shell/features-settings";

export const metadata: Metadata = { title: "Features" };

export default function Page() {
  return <FeaturesSettings />;
}
