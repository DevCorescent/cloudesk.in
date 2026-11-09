import type { Metadata } from "next";
import { CollectPage } from "@/components/requisitions/collect-page";

export const metadata: Metadata = { title: "Documents requested", robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/collect/[token]">) {
  const { token } = await params;
  return <CollectPage token={token} />;
}
