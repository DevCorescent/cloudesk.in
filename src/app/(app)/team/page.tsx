import type { Metadata } from "next";
import { TeamView } from "./view";

export const metadata: Metadata = { title: "Team" };

export default function Page() {
  return <TeamView />;
}
