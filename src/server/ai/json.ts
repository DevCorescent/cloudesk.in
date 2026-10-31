import type { z } from "zod";
import { ApiError } from "../http/errors";
import { complete, type Completion, type CompletionRequest } from "./gateway";

/** Pulls the first JSON object out of a model response (tolerates ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in the response");
  return JSON.parse(candidate.slice(start, end + 1));
}

export type Usage = Pick<Completion, "provider" | "model" | "inputTokens" | "outputTokens" | "costMicroUsd">;

/**
 * Asks for JSON, validates it against a schema, and on failure sends the
 * validation errors back for a bounded number of repair attempts.
 */
export async function completeJson<T extends z.ZodType>(
  req: CompletionRequest,
  schemaDef: T,
  opts: { maxRepairs?: number; onStep?: (label: string) => Promise<void>; extraValidate?: (v: z.infer<T>) => string[] } = {},
): Promise<{ value: z.infer<T>; usage: Usage }> {
  const usage: Usage = { provider: "anthropic", model: "", inputTokens: 0, outputTokens: 0, costMicroUsd: 0 };
  const messages = [...req.messages];
  const maxRepairs = opts.maxRepairs ?? 2;
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const res = await complete({ ...req, messages });
    usage.provider = res.provider;
    usage.model = res.model;
    usage.inputTokens += res.inputTokens;
    usage.outputTokens += res.outputTokens;
    usage.costMicroUsd += res.costMicroUsd;
    let problems: string[];
    try {
      const parsed = schemaDef.safeParse(extractJson(res.text));
      if (parsed.success) {
        problems = opts.extraValidate?.(parsed.data) ?? [];
        if (!problems.length) return { value: parsed.data, usage };
      } else {
        problems = parsed.error.issues.slice(0, 30).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      }
    } catch (e) {
      problems = [(e as Error).message];
    }
    if (attempt === maxRepairs) {
      throw new ApiError("provider_error", "The AI response did not pass validation after repair attempts.", { problems });
    }
    await opts.onStep?.(`Response failed validation (${problems.length} problem${problems.length === 1 ? "" : "s"}); asking for a corrected version`);
    messages.push({ role: "assistant", content: res.text });
    messages.push({
      role: "user",
      content: `Your JSON did not validate. Fix these problems and return the complete corrected JSON object only:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    });
  }
  throw new Error("unreachable");
}
