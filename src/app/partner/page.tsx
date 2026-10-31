import { PartnerDashboard } from "@/components/partners/dashboard";
import { getPageSession } from "@/server/auth/page-session";

export default async function PartnerPage() {
  const session = await getPageSession();
  return <PartnerDashboard person={session?.user.name ?? ""} />;
}
