// What the welcome flow records about a person (users.onboarding).
import { z } from "zod";

export const answers = z.object({
  intent: z.enum(["website", "store", "internal"]).optional(),
  role: z.enum(["solo", "team", "agency", "company"]).optional(),
  experience: z.enum(["first", "some", "pro"]).optional(),
  /** Needs discovery: what they told us and what we suggested. */
  name: z.string().trim().max(80).optional(),
  brief: z.string().trim().max(500).optional(),
  sells: z.enum(["online", "shop", "both", "none"]).optional(),
  stage: z.enum(["new", "selling", "moving"]).optional(),
  goals: z.array(z.enum(["sell", "pos", "bookings", "enquiries", "showcase", "subscriptions", "digital", "whatsapp", "ship-intl", "invoicing"])).max(9).optional(),
  assets: z.array(z.enum(["spreadsheet", "logo", "photos", "domain", "website"])).max(5).optional(),
  catalogSize: z.enum(["1-10", "10-100", "100-1000", "1000+"]).optional(),
  domain: z.string().trim().max(253).optional(),
  kind: z.enum(["store", "website"]).optional(),
  category: z.string().trim().max(40).optional(),
  /** The dashboard tour was finished or dismissed. */
  tourDone: z.boolean().optional(),
  /** Asked to hear when internal software opens. */
  notifyInternal: z.boolean().optional(),
  /** Marks the welcome flow finished (or skipped). */
  complete: z.boolean().optional(),
});
