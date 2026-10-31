import type { Metadata } from "next";
import { NotificationSettings } from "@/components/notify/settings";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return <NotificationSettings />;
}
