import type { Metadata } from "next";
import { Ide } from "@/components/ide/ide";

export const metadata: Metadata = { title: "AI IDE" };

export default async function Page({ params }: PageProps<"/projects/[projectId]/ide">) {
  const { projectId } = await params;
  return <Ide projectId={projectId} />;
}
