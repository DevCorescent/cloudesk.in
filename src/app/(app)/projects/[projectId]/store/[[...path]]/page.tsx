import { StoreAdmin } from "@/components/store/store-admin";

export default async function Page({ params }: PageProps<"/projects/[projectId]/store/[[...path]]">) {
  const { projectId, path } = await params;
  return <StoreAdmin projectId={projectId} path={path ?? []} />;
}
