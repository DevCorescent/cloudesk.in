import { DeploymentsView } from "./view";

export default async function Page({ params }: PageProps<"/projects/[projectId]/deployments">) {
  const { projectId } = await params;
  return <DeploymentsView projectId={projectId} />;
}
