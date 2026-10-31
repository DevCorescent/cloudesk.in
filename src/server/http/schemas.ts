import { z } from "zod";
import { ROLES } from "../authz/permissions";

export const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
export const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9\W]/.test(p), "Mix letters with numbers or symbols");
export const role = z.enum(ROLES);
export const uuid = z.uuid();
