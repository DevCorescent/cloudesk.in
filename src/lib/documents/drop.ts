// Drive QR: shared by the server and the drive. How long an upload may stay
// before it's deleted completely, and how each logged action reads.
import { z } from "zod";

/** How long an upload stays, in minutes; null keeps it until someone deletes it. */
export const STAY_CHOICES: { minutes: number | null; label: string }[] = [
  { minutes: 60, label: "1 hour" },
  { minutes: 6 * 60, label: "6 hours" },
  { minutes: 24 * 60, label: "1 day" },
  { minutes: 3 * 24 * 60, label: "3 days" },
  { minutes: 7 * 24 * 60, label: "7 days" },
  { minutes: 30 * 24 * 60, label: "30 days" },
  { minutes: null, label: "Keep it" },
];
const MINUTES = STAY_CHOICES.map((c) => c.minutes).filter((m): m is number => m !== null);
export const stayLabel = (m: number | null) => STAY_CHOICES.find((c) => c.minutes === m)?.label ?? (m === null ? "Keep it" : `${m} minutes`);

/** The choices an uploader is offered: the drop's longest stay and anything shorter (all of them when it keeps files). */
export const choicesFor = (max: number | null, uploaderChooses: boolean) => (!uploaderChooses ? STAY_CHOICES.filter((c) => c.minutes === max) : max === null ? STAY_CHOICES : STAY_CHOICES.filter((c) => c.minutes !== null && c.minutes <= max));

export const stayMinutes = z.union([z.number().int().refine((m) => MINUTES.includes(m), "Pick one of the times offered"), z.null()]);

export const dropSchema = z.object({
  folderId: z.uuid().nullable().default(null),
  root: z.enum(["team", "mine"]).default("team"),
  name: z.string().trim().max(80).default(""),
  enabled: z.boolean().default(true),
  stayMinutes: stayMinutes.default(24 * 60),
  uploaderChooses: z.boolean().default(true),
  notifyOwner: z.boolean().default(true),
});

export const dropUploadMeta = z.object({
  name: z.string().trim().max(120).default(""),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email").max(200)]).default(""),
  stayMinutes: stayMinutes.optional(),
});

/** What each logged action reads as, in the log and in the uploader's email. */
export const LOG_LABEL: Record<string, string> = {
  dropped: "Uploaded from a phone (Drive QR)",
  viewed: "Opened",
  downloaded: "Downloaded",
  printed: "Printed",
  renamed: "Renamed",
  moved: "Moved",
  copied: "Copied",
  shared: "Shared",
  link_on: "Turned on a link anyone can open",
  link_off: "Turned off its link",
  trashed: "Moved to the trash",
  restored: "Restored from the trash",
  stay_changed: "Changed when it's deleted",
  converted: "Converted",
  exported: "Exported",
  commented: "Commented",
  deleted: "Deleted for good",
};
/** Actions on a QR upload that its uploader is told about straight away. */
export const TELL_UPLOADER = new Set(["viewed", "downloaded", "printed", "renamed", "moved", "copied", "shared", "link_on", "trashed", "restored", "stay_changed", "converted", "exported", "commented", "deleted"]);
