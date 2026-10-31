import type { Metadata } from "next";
import { Suspense } from "react";
import { PortalPage } from "@/components/portal/portal-page";

export const metadata: Metadata = { title: "Portal", robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/portal/[slug]">) {
  const { slug } = await params;
  return (
    <Suspense>
      <PortalPage slug={slug} />
    </Suspense>
  );
}
