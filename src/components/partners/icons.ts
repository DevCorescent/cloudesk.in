// An icon for each kind of partner (shared by server and client components).
import { Briefcase, Building2, Megaphone, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import type { PartnerType } from "@/lib/partners/program";

export const TYPE_ICON: Record<PartnerType, LucideIcon> = { organisation: Building2, freelancer: UserRound, sales: Briefcase, marketing: Megaphone, influencer: Sparkles };
