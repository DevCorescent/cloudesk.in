import type { Metadata } from "next";
import { PublicCard } from "@/components/cards/public-card";
import { publicCard } from "@/server/cards/cards";

// A member's business ID, shared by link or QR code: their card, one tap to
// save them to contacts, share it on, or send your own details back. Not
// indexed by search engines — it's shared with the people they meet.
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await publicCard((await params).slug);
  if (!c) return { title: "Business ID not found", robots: { index: false, follow: false } };
  const title = [c.data.name, [c.data.title, c.data.company].filter(Boolean).join(" at ")].filter(Boolean).join(" · ");
  const description = c.data.bio || c.data.tagline || `${c.data.name ?? "Business ID"} on Cloudesk`;
  return { title, description, robots: { index: false, follow: false }, openGraph: { title, description, type: "profile" } };
}

export default async function BusinessIdPage({ params }: Props) {
  const c = await publicCard((await params).slug, { count: "view" });
  return <PublicCard card={c} />;
}
