import { HorecaAdmin } from "@/components/horeca/horeca-admin";

export default async function Page({ params }: PageProps<"/projects/[projectId]/horeca/[[...path]]">) {
  const { projectId, path } = await params;
  return <HorecaAdmin projectId={projectId} path={path ?? []} />;
}
