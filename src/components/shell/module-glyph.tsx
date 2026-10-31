// One icon per workspace feature, shared by the shell, settings and onboarding.
import { BadgeCheck, BarChart3, BookOpenCheck, Bot, Boxes, CalendarDays, MessagesSquare, Code2, Contact, Database, Factory, ShieldCheck, Handshake, KanbanSquare, Megaphone, ReceiptText, ScanLine, ShoppingBag, UtensilsCrossed, Workflow, Wrench, FileSignature, Send, Truck, PieChart, Sparkles, LifeBuoy, DoorOpen, ShieldAlert, GraduationCap, Stethoscope, HardHat, Shapes, Mail, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@/lib/workspace/modules";

const ICONS: Record<ModuleId, LucideIcon> = {
  store: ShoppingBag,
  pos: ScanLine,
  horeca: UtensilsCrossed,
  crm: Contact,
  hr: BadgeCheck,
  inventory: Boxes,
  sales: Handshake,
  manufacturing: Factory,
  quality: ShieldCheck,
  maintenance: Wrench,
  documents: FileSignature,
  marketing: Send,
  logistics: Truck,
  bi: PieChart,
  copilot: Sparkles,
  helpdesk: LifeBuoy,
  mail: Mail,
  calendar: CalendarDays,
  chat: MessagesSquare,
  portal: DoorOpen,
  grc: ShieldAlert,
  education: GraduationCap,
  clinic: Stethoscope,
  construction: HardHat,
  objects: Shapes,
  work: KanbanSquare,
  accounting: BookOpenCheck,
  invoicing: ReceiptText,
  bookings: CalendarDays,
  promotions: Megaphone,
  growth: BarChart3,
  automations: Workflow,
  chatbot: Bot,
  data: Database,
  "ai-ide": Code2,
};

export function ModuleGlyph({ id, className }: { id: ModuleId; className?: string }) {
  const Icon = ICONS[id];
  return <Icon className={className} aria-hidden />;
}
