import type { Metadata } from "next";
import { DataStudio } from "@/components/data/data-studio";

export const metadata: Metadata = { title: "Data" };

export default async function Page({ params }: PageProps<"/projects/[projectId]/data">) {
  const { projectId } = await params;
  return <DataStudio projectId={projectId} />;
}
