import type { Metadata } from "next";
import { PosTerminal } from "@/components/store/pos-terminal";

export const metadata: Metadata = { title: "Point of sale" };

export default async function Page({ params }: PageProps<"/projects/[projectId]/pos">) {
  const { projectId } = await params;
  return <PosTerminal projectId={projectId} />;
}
