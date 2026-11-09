import type { Metadata } from "next";
import { DocumentsSpotlight } from "@/components/marketing/documents-spotlight";
import { FeatureMarquee } from "@/components/marketing/feature-marquee";
import { FilmReel } from "@/components/marketing/film-reel";
import { HomeHero } from "@/components/marketing/home";
import { Impact } from "@/components/marketing/impact";
import { NotesSpotlight, WorkdayCards } from "@/components/marketing/home-spotlights";
import { Innovations } from "@/components/marketing/innovations";
import { IntelligenceHighlight } from "@/components/marketing/intelligence";
import { isDiwali, launchOffer } from "@/lib/festive";
import { PlatformTrio } from "@/components/marketing/platform-trio";
import { SiteJsonLd } from "@/components/legal/json-ld";
import { MobileIntro } from "@/components/marketing/mobile-intro";

export const metadata: Metadata = {
  title: "Cloudesk — your website, store and business software, ready in minutes",
  description: "Create your website, open an online store and run your business — sales, invoices, accounts, HR and stock — on one platform, set up in minutes.",
};

// The homepage: the hero, the intelligence, the feature films, then one idea
// per section (the footer and trust strip come from the marketing layout).
export default function Landing() {
  const diwali = isDiwali();
  return (
    <>
      <SiteJsonLd />
      {/* Phones open on a swipeable intro instead of the long page. */}
      <MobileIntro diwali={diwali} offer={diwali && !!launchOffer()} />
      <HomeHero diwali={diwali} />
      <IntelligenceHighlight />
      {/* ── The feature films ── */}
      <FilmReel />
      <WorkdayCards />
      <FeatureMarquee />
      <NotesSpotlight />
      <DocumentsSpotlight />

      <PlatformTrio />

      {/* ── What makes it different ── */}
      <Innovations />

      {/* ── How Cloudesk helps, then the footer ── */}
      <Impact />
    </>
  );
}
