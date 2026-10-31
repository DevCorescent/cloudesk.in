import type { Metadata } from "next";
import { WelcomeView } from "@/components/onboarding/welcome-view";

export const metadata: Metadata = { title: "Welcome" };

export default function Page() {
  return <WelcomeView />;
}
