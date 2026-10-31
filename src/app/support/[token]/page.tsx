import type { Metadata } from "next";
import { SupportPage } from "@/components/helpdesk/support-page";

export const metadata: Metadata = { title: "Your support request", robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/support/[token]">) {
  const { token } = await params;
  return <SupportPage token={token} />;
}
