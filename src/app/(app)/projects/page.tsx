import type { Metadata } from "next";
import { ProjectsView } from "./view";

export const metadata: Metadata = { title: "Web apps" };

export default function Page() {
  return <ProjectsView />;
}
