import type { Metadata } from "next";
import { PromotionsView } from "@/components/promotions/promotions-view";

export const metadata: Metadata = { title: "Promotions" };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <PromotionsView projectId={projectId} />;
}
