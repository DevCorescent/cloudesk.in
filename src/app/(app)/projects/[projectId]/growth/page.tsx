import { GrowthView } from "@/components/growth/growth-view";

export default async function Page({ params }: PageProps<"/projects/[projectId]/growth">) {
  const { projectId } = await params;
  return <GrowthView projectId={projectId} />;
}
