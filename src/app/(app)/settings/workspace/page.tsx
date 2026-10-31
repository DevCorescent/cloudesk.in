import type { Metadata } from "next";
import { WorkspaceView } from "./view";

export const metadata: Metadata = { title: "Workspace" };

export default function Page() {
  return <WorkspaceView />;
}
