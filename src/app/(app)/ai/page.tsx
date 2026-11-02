import type { Metadata } from "next";
import { AppAiMode } from "@/components/ai-mode/app-ai";

export const metadata: Metadata = { title: "AI mode" };

export default function Page() {
  return <AppAiMode />;
}
