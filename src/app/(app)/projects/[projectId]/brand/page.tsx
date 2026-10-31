import { BrandView } from "@/components/brand/brand-view";

export default async function Page({ params }: PageProps<"/projects/[projectId]/brand">) {
  const { projectId } = await params;
  return <BrandView projectId={projectId} />;
}
