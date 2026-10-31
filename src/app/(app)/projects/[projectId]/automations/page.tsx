import type { Metadata } from "next";
import { AutomationsView } from "@/components/automations/automations-view";

export const metadata: Metadata = { title: "Automations" };

export default async function Page({ params }: PageProps<"/projects/[projectId]/automations">) {
  const { projectId } = await params;
  return <AutomationsView projectId={projectId} />;
}
