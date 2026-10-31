import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { bannedIn, voicePrompt } from "@/lib/site/brand-rules";
import { completeJson } from "../ai/json";
import { getBrandRules } from "../services/brand";
import { monthlyBudgetMicroUsd, monthlySpend } from "../ai/tasks";
import { loadDoc, METRIC_LABEL, type Opportunity } from "./opportunities";

const headlineSchema = z.object({
  heading: z.string().trim().min(3).max(140),
  subheading: z.string().trim().max(400),
  rationale: z.string().max(400).optional(),
});

/**
 * Asks the model for one alternative hero headline to test. The result is
 * only a proposal for a test: the original stays live for half of visitors,
 * and nothing replaces it unless it measurably wins.
 */
export async function writeHeadline(project: { id: string; orgId: string; name: string }, userId: string | null, o: Opportunity) {
  if (!o.test) throw new ApiError("conflict", "Not a test suggestion");
  if ((await monthlySpend(project.orgId)).costMicroUsd >= monthlyBudgetMicroUsd()) throw new ApiError("rate_limited", "This organization has reached its monthly AI budget.");
  const loaded = await loadDoc(project.id);
  const page = loaded?.doc.pages.find((p) => p.path === o.test!.path);
  const section = page?.sections.find((s) => s.id === o.test!.sectionId);
  if (!loaded || !page || !section) throw new ApiError("conflict", "The section no longer exists");
  const outline = page.sections.map((s) => `- ${s.type}: ${String(s.props.heading ?? s.props.text ?? "").slice(0, 80)}`).join("\n");
  const rules = await getBrandRules(project.id);
  const brand = voicePrompt(rules);
  const started = new Date();
  const { value, usage } = await completeJson(
    {
      orgId: project.orgId,
      task: "site_edit",
      system:
        "You write website hero copy for A/B tests. Write ONE alternative headline and supporting line for the business described. Be specific and concrete about the customer benefit; no hype words (amazing, best-in-class, revolutionary), no invented facts, numbers, awards or claims the page does not support. Match the site's language. Reply with JSON only: {\"heading\": string (max 12 words), \"subheading\": string (max 30 words), \"rationale\": string}.",
      messages: [
        {
          role: "user",
          content: `Business: ${loaded.doc.name}\nPage: ${page.title} (${page.path})\nGoal of the test: more ${METRIC_LABEL[o.test.metric]}\nCurrent headline: ${section.props.heading}\nCurrent supporting line: ${section.props.subheading ?? ""}\nPage outline:\n${outline}${brand ? `\n${brand}` : ""}`,
        },
      ],
      maxTokens: 1500,
      signal: AbortSignal.timeout(90_000),
    },
    headlineSchema,
    {
      extraValidate: (v) => [
        ...(v.heading.trim().toLowerCase() === String(section.props.heading ?? "").trim().toLowerCase() ? ["The headline must differ from the current one"] : []),
        ...bannedIn(`${v.heading} ${v.subheading}`, rules?.bannedWords ?? []).map((w) => `Do not use “${w}”; it is on the brand's list of words to avoid`),
      ],
    },
  );
  // Recorded as a finished AI task so it counts toward usage and the monthly budget.
  await db.insert(schema.aiTasks).values({
    orgId: project.orgId,
    projectId: project.id,
    kind: "growth_copy",
    status: "succeeded",
    input: { opportunity: o.key, current: section.props.heading },
    result: { type: "growth_copy", ...value },
    createdBy: userId,
    startedAt: started,
    finishedAt: new Date(),
    ...usage,
  });
  return { heading: value.heading, subheading: value.subheading };
}
