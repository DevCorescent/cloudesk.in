import type { Metadata } from "next";
import { AiHero, AskAnything, Bento, Films, Powers, Questions, StartCta, Rails, RealScreens } from "@/components/marketing/ai-page";

export const metadata: Metadata = {
  title: "Cloudesk AI — intelligence in every corner of your business",
  description: "Ask your books in plain words, draft replies, read bills, list products from a photo, catch duplicate bills and build your website by describing it.",
};

// Cloudesk AI: every AI power in the product, then the free trial.
export default function AiPage() {
  return (
    <>
      <AiHero />
      <Powers />
      <AskAnything />
      <Bento />
      <RealScreens />
      <Films />
      <Rails />
      <StartCta />
      <Questions />
    </>
  );
}
