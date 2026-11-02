import { understandBrief } from "./understand";
import type { IndustryId } from "@/lib/workspace/modules";

/** Suggests an industry from a one-line description. */
export function suggestIndustry(text: string): IndustryId | null {
  const t = text.toLowerCase();
  if (!t.trim()) return null;
  // \b doesn't treat "é" as a letter, so "café." would never match: look for letters around the word instead.
  if (/(?<!\p{L})(caf[eé]|coffee|espresso|brunch)(?!\p{L})/u.test(t)) return "cafe";
  if (/\b(bar|pub|lounge|brewery|cocktails?)\b/.test(t)) return "bar";
  if (/\b(construction|contractor|civil|infrastructure|interiors?|epc)\b/.test(t)) return "construction";
  if (/\b(school|college|coaching|tuition|academy|institute)\b/.test(t)) return "education";
  const u = understandBrief(text);
  const site: Record<string, IndustryId> = { restaurant: "restaurant", hotel: "hotel", salon: "salon", clinic: "clinic", fitness: "fitness", consulting: "services", portfolio: "services", education: "education", realestate: "services", nonprofit: "services", app: "software" };
  const store: Record<string, IndustryId> = { fashion: "retail", jewellery: "retail", beauty: "retail", books: "retail", gadgets: "retail", fitness: "retail", bakery: "food", home: "home", gifts: "home" };
  if (u.confidence === "none") return null;
  if (u.kind === "store" && u.storeCategory) return store[u.storeCategory] ?? "retail";
  if (u.websiteCategory) return site[u.websiteCategory] ?? null;
  return null;
}
