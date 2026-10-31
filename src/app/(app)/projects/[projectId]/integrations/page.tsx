import type { Metadata } from "next";
import { IntegrationsView } from "@/components/integrations/integrations-view";

export const metadata: Metadata = { title: "Integrations" };

export default async function Page({ params }: PageProps<"/projects/[projectId]/integrations">) {
  const { projectId } = await params;
  return <IntegrationsView projectId={projectId} />;
}
