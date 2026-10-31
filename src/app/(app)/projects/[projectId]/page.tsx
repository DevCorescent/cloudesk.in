import { OverviewView } from "./view";

export default async function Page({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  return <OverviewView projectId={projectId} />;
}
