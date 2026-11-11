// AI copilot: conversations with Claude about the workspace. The model reads
// data only through tools that run as the person asking (the report engine's
// datasets, a permission-checked record search); anything that would change
// data is saved as a proposal, and only the person's Confirm carries it out —
// through the same module functions (and checks) the rest of the app uses.
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { ACTION_INPUT, ACTION_LABEL, chartOf, proposeInput, resultText, runReportInput, searchInput, SEARCH_KINDS, SYSTEM_PROMPT, titleFrom, toolLabel, toView, TOOLS, withQuestion, type ActionKind, type SearchKind } from "@/lib/copilot/model";
import { duplicateBills, expenseSpikes, largeBills, type Finding } from "@/lib/copilot/anomalies";
import { isOn } from "@/lib/workspace/modules";
import { anthropicFor, COPILOT_MODEL, providerError, recordUsage } from "../ai/gateway";
import { advisorById } from "@/lib/copilot/advisors";
import { countAttached, findAttached, forModel, toBlocks, type Upload } from "./attachments";
import { WORKSPACE_ACTIONS, type WorkspaceAction } from "@/lib/copilot/workspace-model";
import { execute, readTool } from "./workspace";
import { can } from "../authz/permissions";
import { datasets as biDatasets, preview, scopeFor, type Scope as BiScope } from "../bi/core";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { log } from "../log";

/** `auth` is the signed-in request, for tools that read as the person through other modules (the dashboard, their to-dos). */
export type Scope = BiScope & { name: string; auth?: AuthedContext };
const MAX_TURNS = 8;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "copilot:use");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "copilot")) throw new ApiError("forbidden", "Switch on the AI copilot in Settings → Features first");
  return { ...(await scopeFor(orgId, ctx.user.id, role)), name: ctx.user.name, auth: ctx };
}

// ── Threads ─────────────────────────────────────────────────────────────────

async function getThread(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Conversation");
  const [t] = await db.select().from(schema.copilotThreads).where(and(eq(schema.copilotThreads.id, id), eq(schema.copilotThreads.orgId, s.orgId), eq(schema.copilotThreads.userId, s.userId)));
  if (!t) throw notFound("Conversation");
  return t;
}

export async function threads(s: Scope) {
  return db.select({ id: schema.copilotThreads.id, title: schema.copilotThreads.title, updatedAt: schema.copilotThreads.updatedAt }).from(schema.copilotThreads).where(and(eq(schema.copilotThreads.orgId, s.orgId), eq(schema.copilotThreads.userId, s.userId))).orderBy(desc(schema.copilotThreads.updatedAt)).limit(100);
}

export async function thread(s: Scope, id: string) {
  const t = await getThread(s, id);
  const actions = await db.select().from(schema.copilotActions).where(eq(schema.copilotActions.threadId, t.id)).orderBy(asc(schema.copilotActions.createdAt));
  return {
    id: t.id,
    title: t.title,
    items: toView(t.messages),
    // `input` is the suggestion's details, so it can be shown and edited (an email draft) before confirming.
    actions: actions.map(({ payload, ...a }) => {
      const { toolUseId, ...input } = payload as Record<string, unknown>;
      return { ...a, toolUseId: String(toolUseId ?? ""), label: ACTION_LABEL[a.kind as ActionKind] ?? a.kind, input };
    }),
  };
}

export async function deleteThread(s: Scope, id: string) {
  const t = await getThread(s, id);
  await db.delete(schema.copilotThreads).where(eq(schema.copilotThreads.id, t.id));
}

/** Ask a question: run the model with its tools until it answers (or the turn limit), saving every message exchanged. */
/** What a streamed answer sends while it's being worked out: text as it's written, and each lookup as it starts. */
export type AskEvent = { t: "text"; d: string } | { t: "tool"; label: string };

export async function ask(s: Scope, threadId: string | null, text: string, opts: { files?: Upload[]; advisor?: string | null; onEvent?: (e: AskEvent) => void } = {}) {
  const files = opts.files ?? [];
  const q = text.trim() || (files.length ? "What is this, and what should I do with it?" : "");
  if (!q) throw new ApiError("validation_failed", "Ask something first", { text: ["Required"] });
  if (q.length > 4000) throw new ApiError("validation_failed", "Keep the question under 4,000 characters", { text: ["Too long"] });
  const client = await anthropicFor(s.orgId);
  const t = threadId ? await getThread(s, threadId) : (await db.insert(schema.copilotThreads).values({ orgId: s.orgId, userId: s.userId, title: titleFrom(text.trim() || files.map((f) => f.name).join(", ")) }).returning())[0];
  let messages = withQuestion(t.messages, q);
  if (files.length) {
    // The files go just before the question, in the same turn.
    const { blocks } = toBlocks(files, countAttached(t.messages));
    const last = messages[messages.length - 1] as { role: string; content: string | unknown[] };
    const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
    const qi = content.length - 1;
    messages = [...messages.slice(0, -1), { role: "user", content: [...content.slice(0, qi), ...blocks, content[qi]] }];
  }
  const advisor = advisorById(opts.advisor);
  const emit = opts.onEvent ?? (() => {});
  const [known, habits] = await Promise.all([(await import("./knowledge")).context(s, q), habitsOf(s, t.id)]);
  const save = () => db.update(schema.copilotThreads).set({ messages, updatedAt: new Date() }).where(eq(schema.copilotThreads.id, t.id));
  const note = (msg: string) => {
    messages = [...messages, { role: "assistant", content: [{ type: "text", text: msg }] }];
  };
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.beta.messages
        .stream({
          model: COPILOT_MODEL,
          max_tokens: 16_000,
          // The instructions are the same for everyone, so they're cached; who and when follows.
          system: [
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            { type: "text", text: `Today is ${todayIst()} (India). You're helping ${s.name}.` },
            ...(known ? [{ type: "text", text: known }] : []),
            ...(habits ? [{ type: "text", text: habits }] : []),
            ...(advisor.brief ? [{ type: "text", text: `Advisor mode — ${advisor.name}.\n${advisor.brief}` }] : []),
          ],
          tools: TOOLS.map((x) => ({ ...x, eager_input_streaming: true })) as unknown as Anthropic.Beta.BetaToolUnion[],
          messages: forModel(messages) as Anthropic.Beta.BetaMessageParam[],
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        } as Anthropic.Beta.MessageCreateParamsStreaming);
      // The answer reaches the person as it's written, not when it's finished.
      if (opts.onEvent) stream.on("text", (d: string) => emit({ t: "text", d }));
      const res = await stream.finalMessage();
      // Usage is recorded alongside the next step rather than holding it up.
      const used = recordUsage(s.orgId, s.userId, "copilot", res.usage, res.model ?? COPILOT_MODEL, { threadId: t.id }).catch((e) => log.warn("copilot.usage_failed", { err: String(e) }));
      messages = [...messages, { role: "assistant", content: res.content }];
      if (res.stop_reason === "refusal") {
        note("I can't help with that request.");
        break;
      }
      if (res.stop_reason === "max_tokens") {
        note("(That answer was cut off for length. Ask for a narrower answer.)");
        break;
      }
      if (res.stop_reason !== "tool_use") {
        await used;
        break;
      }
      // Lookups asked for together run together (results stay in the order they were asked).
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      for (const b of calls) emit({ t: "tool", label: toolLabel(b.name, b.input) });
      const results = await Promise.all(calls.map((b) => runTool(s, t.id, b.id, b.name, b.input, messages)));
      await used;
      messages = [...messages, { role: "user", content: results }];
      if (turn === MAX_TURNS - 1) note("I stopped after several lookups without a final answer. Ask again, perhaps more specifically.");
    }
  } catch (err) {
    await save();
    log.warn("copilot.ask_failed", { orgId: s.orgId, err: err instanceof Error ? err.name : "unknown" });
    throw providerError(err);
  }
  await save();
  return thread(s, t.id);
}

/**
 * What the copilot has learned from working with this person, beyond the facts
 * it was told: their recent conversations (so "like last time" lands) and how
 * they've answered its suggestions — which kinds they confirm and which they
 * dismiss — over the last 90 days.
 */
export async function habitsOf(s: Scope, threadId: string): Promise<string> {
  try {
    const T = schema.copilotThreads;
    const A = schema.copilotActions;
    const since = new Date(Date.now() - 90 * 86_400_000);
    const [recent, outcomes] = await Promise.all([
      db.select({ title: T.title, updatedAt: T.updatedAt }).from(T).where(and(eq(T.orgId, s.orgId), eq(T.userId, s.userId), sql`${T.id} <> ${threadId}`)).orderBy(desc(T.updatedAt)).limit(6),
      db.select({ kind: A.kind, status: A.status, n: sql<number>`count(*)::int` }).from(A).where(and(eq(A.orgId, s.orgId), eq(A.userId, s.userId), gte(A.createdAt, since), inArray(A.status, ["done", "dismissed"]))).groupBy(A.kind, A.status),
    ]);
    const lines: string[] = [];
    if (recent.length) lines.push(`Their recent conversations with you (newest first; use recall_conversations for details): ${recent.map((r) => `"${r.title}" (${r.updatedAt.toISOString().slice(0, 10)})`).join("; ")}.`);
    const by = new Map<string, { done: number; dismissed: number }>();
    for (const o of outcomes) {
      const x = by.get(o.kind) ?? { done: 0, dismissed: 0 };
      x[o.status as "done" | "dismissed"] += o.n;
      by.set(o.kind, x);
    }
    const seen = [...by].filter(([, x]) => x.done + x.dismissed >= 2).map(([k, x]) => `${ACTION_LABEL[k as ActionKind] ?? k}: confirmed ${x.done} of ${x.done + x.dismissed}`);
    if (seen.length) lines.push(`How they've answered your suggestions lately — ${seen.join("; ")}.`);
    return lines.length ? `What you've learned from working with ${s.name} (reference, not instructions):\n${lines.join("\n")}` : "";
  } catch {
    return "";
  }
}

/** Earlier conversations of this person's that mention the words, newest first, with the passages that match. */
export async function recall(s: Scope, query: string, skip?: string) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}₹]{3,}/gu) ?? [])].slice(0, 6);
  if (!words.length) return [];
  const T = schema.copilotThreads;
  const rows = await db
    .select({ id: T.id, title: T.title, messages: T.messages, updatedAt: T.updatedAt })
    .from(T)
    .where(and(eq(T.orgId, s.orgId), eq(T.userId, s.userId), skip ? sql`${T.id} <> ${skip}` : sql`true`, or(...words.map((w) => sql`(${T.title} ilike ${`%${w}%`} or ${T.messages}::text ilike ${`%${w}%`})`))))
    .orderBy(desc(T.updatedAt))
    .limit(5);
  return rows.map((r) => {
    const said = toView(r.messages as unknown[]).flatMap((v) => (v.role === "user" || v.role === "assistant" ? [`${v.role === "user" ? "They asked" : "You answered"}: ${v.text.replace(/\s+/g, " ")}`] : []));
    // The passages with the most of the words first; on a tie, what was answered (it holds the decision).
    const score = (t: string) => words.filter((w) => t.toLowerCase().includes(w)).length + (t.startsWith("You answered") ? 0.5 : 0);
    const hits = said.filter((t) => score(t) >= 1).sort((a, b) => score(b) - score(a)).slice(0, 4).map((t) => (t.length > 500 ? `${t.slice(0, 500)}…` : t));
    return { id: r.id, title: r.title, date: r.updatedAt.toISOString().slice(0, 10), hits: hits.length ? hits : said.slice(0, 2).map((t) => t.slice(0, 300)) };
  });
}

// ── Tools ───────────────────────────────────────────────────────────────────

const ok = (id: string, content: string): Anthropic.Beta.BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, content });
const fail = (id: string, content: string): Anthropic.Beta.BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, content, is_error: true });

async function runTool(s: Scope, threadId: string, id: string, name: string, input: unknown, messages: unknown[] = []): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  try {
    if (name === "list_datasets") {
      const list = biDatasets(s).map((d) => `${d.id} — ${d.label}${d.dateField ? ` (dates: ${d.dateField})` : ""}\n  fields: ${d.fields.map((f) => `${f.key} (${f.label}, ${f.type})`).join(", ")}`);
      return ok(id, list.length ? list.join("\n") : "No datasets are open to this person.");
    }
    if (name === "run_report") {
      const v = runReportInput.safeParse(input);
      if (!v.success) return fail(id, `Invalid input: ${v.error.issues[0]?.message}`);
      const r = await preview(s, v.data);
      return ok(id, resultText(r));
    }
    if (name === "search_records") {
      const v = searchInput.safeParse(input);
      if (!v.success) return fail(id, `Invalid input: ${v.error.issues[0]?.message}`);
      const hits = await search(s, v.data.query, v.data.kinds);
      return ok(id, hits.length ? hits.map((h) => `${h.kind}: ${h.label} — id ${h.id} — ${h.link}`).join("\n") : "Nothing found that this person can see.");
    }
    if (name === "find_anomalies") {
      const r = await checks(s);
      if (!r.open) return fail(id, "Accounts isn't open to this person.");
      return ok(id, r.findings.length ? r.findings.map((f) => `${f.title}: ${f.detail} (${f.link})`).join("\n") : "No duplicate bills, unusually large bills or expense spikes found.");
    }
    if (name === "propose_action") {
      const v = proposeInput.safeParse(input);
      if (!v.success) return fail(id, `Invalid input: ${v.error.issues[0]?.message}`);
      if (v.data.kind === "record_bill") return fail(id, "Bills are prepared by the extract_bill tool from the file, not typed — call extract_bill with the attachment id.");
      const p = ACTION_INPUT[v.data.kind].safeParse(v.data.input);
      if (!p.success) return fail(id, `Invalid ${v.data.kind} input: ${p.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
      const [a] = await db.insert(schema.copilotActions).values({ orgId: s.orgId, threadId, userId: s.userId, kind: v.data.kind, payload: { ...p.data, toolUseId: id }, summary: v.data.summary }).returning();
      return ok(id, `Proposal saved (id ${a.id}). Nothing has changed yet: it is waiting for the person to press Confirm.`);
    }
    if (name === "identify_document") {
      const i = (input ?? {}) as { attachmentId?: string; kind?: string };
      if (!i.attachmentId || !findAttached(messages, i.attachmentId)) return fail(id, "Use the id of a file in this conversation (f1, f2…).");
      return ok(id, `Labelled ${i.attachmentId} as ${i.kind}. Now say in one line what it is and offer the most useful next step.`);
    }
    if (name === "extract_bill") {
      const i = (input ?? {}) as { attachmentId?: string; kind?: string };
      const f = i.attachmentId ? findAttached(messages, i.attachmentId) : null;
      if (!f) return fail(id, "Use the id of a file in this conversation (f1, f2…).");
      if (!s.has("accounting")) return fail(id, "Accounts isn't switched on for this workspace.");
      const { scopeFor } = await import("../accounting/access");
      const { extractBill } = await import("../accounting/extract");
      const as = await scopeFor(s.orgId, s.userId, s.role);
      const r = (await extractBill(as, { name: f.name, bytes: f.bytes })) as { draft: Record<string, unknown>; warnings: string[] };
      const kind = i.kind === "expense" ? "expense" : "bill";
      const d = r.draft as { supplierName?: string; billNo?: string; date?: string; lines?: { amount: number; gstRate: number }[] };
      const sub = (d.lines ?? []).reduce((n, l) => n + l.amount, 0);
      const tax = (d.lines ?? []).reduce((n, l) => n + Math.round((l.amount * l.gstRate) / 100), 0);
      const summary = `${kind === "expense" ? "Expense" : "Bill"} from ${d.supplierName || "an unnamed supplier"}${d.billNo ? ` (${d.billNo})` : ""} — ₹${((sub + tax) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
      const [a] = await db.insert(schema.copilotActions).values({ orgId: s.orgId, threadId, userId: s.userId, kind: "record_bill", payload: { attachmentId: i.attachmentId, kind, draft: r.draft, warnings: r.warnings, fileName: f.name, toolUseId: id }, summary }).returning();
      return ok(id, `Read the file and prepared it (proposal ${a.id}), waiting for the person to confirm: ${summary}. Lines: ${(d.lines ?? []).length}, GST ₹${(tax / 100).toFixed(2)}, dated ${d.date ?? "?"}.${r.warnings.length ? ` Warnings to tell them: ${r.warnings.join(" ")}` : " No warnings."}`);
    }
    if (name === "knowledge_search") {
      const { search: searchKnowledge } = await import("./knowledge");
      const hits = await searchKnowledge(s, String((input as { query?: unknown } | null)?.query ?? "").slice(0, 300)).catch(() => []);
      return ok(id, hits.length ? hits.map((h) => `[${h.title}]\n${h.text}`).join("\n\n") : "Nothing in the knowledge base matches. Say so, and offer to note the answer once they tell you.");
    }
    if (name === "remember") {
      const { remember } = await import("./knowledge");
      try {
        await remember(s, input);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        return fail(id, "Memory isn't available right now; carry on without saving it.");
      }
      return ok(id, "Remembered for future conversations.");
    }
    if (name === "recall_conversations") {
      const found = await recall(s, String((input as { query?: unknown } | null)?.query ?? "").slice(0, 200), threadId);
      return ok(id, found.length ? found.map((f) => `"${f.title}" — ${f.date}\n${f.hits.join("\n")}`).join("\n\n") : "No earlier conversation mentions that.");
    }
    if (name === "show_chart") return chartOf(input) ? ok(id, "The chart is shown in your answer. Now give the takeaway in a sentence or two — don't repeat every figure.") : fail(id, "Give every series one value per label (1–4 series, up to 60 labels).");
    if (name === "suggest_next") return ok(id, "Shown as buttons under your answer. Don't repeat them in the text.");
    if (name === "start_document") {
      if (!s.has("documents") || !s.ctx.can("doc:write")) return fail(id, "Documents isn't open to this person for writing — tell them, and offer to write it here in the chat instead.");
      return ok(id, "The document studio is open below your answer: it asks the details, drafts, reviews and shows the document there. Say in one short sentence that it's ready to fill in below — nothing more.");
    }
    const read = await readTool(s, name, (input ?? {}) as Record<string, unknown>);
    if (read !== null) return ok(id, read);
    return fail(id, `Unknown tool ${name}`);
  } catch (err) {
    if (err instanceof ApiError) return fail(id, err.message);
    throw err;
  }
}

type Hit = { kind: SearchKind; id: string; label: string; link: string };

/** Records matching a query, of the kinds this person may open (the CRM's "own records" rule included). */
export async function search(s: Scope, query: string, kinds?: readonly SearchKind[]): Promise<Hit[]> {
  const t = `%${query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const want = new Set(kinds?.length ? kinds : SEARCH_KINDS);
  const own = (col: SQL | ReturnType<typeof sql>) => (s.ctx.crmOwn ? sql`(${col} = ${s.userId} or ${col} is null)` : sql`true`);
  // Every kind is looked up at once, then put together in the usual order.
  const jobs: Promise<Hit[]>[] = [];
  const crm = s.has("crm") && s.ctx.can("crm:read");
  if (want.has("contacts") && crm) {
    jobs.push(
      (async () => {
        const out: Hit[] = [];
    const C = schema.crmContacts;
    for (const r of await db.select({ id: C.id, name: C.name, email: C.email }).from(C).where(and(eq(C.orgId, s.orgId), or(ilike(C.name, t), ilike(C.email, t), ilike(C.phone, t)), own(sql`${C.ownerId}`))).limit(5)) out.push({ kind: "contacts", id: r.id, label: [r.name || "(no name)", r.email].filter(Boolean).join(" · "), link: `/crm/contacts/${r.id}` });
        return out;
      })(),
    );
  }
  if (want.has("deals") && crm) {
    jobs.push(
      (async () => {
        const out: Hit[] = [];
    const D = schema.crmDeals;
    for (const r of await db.select({ id: D.id, title: D.title, value: D.value, status: D.status }).from(D).where(and(eq(D.orgId, s.orgId), ilike(D.title, t), own(sql`${D.ownerId}`))).limit(5)) out.push({ kind: "deals", id: r.id, label: `${r.title} · ₹${(r.value / 100).toLocaleString("en-IN")} · ${r.status}`, link: `/crm/deals/${r.id}` });
        return out;
      })(),
    );
  }
  const inv = s.has("inventory") && s.ctx.can("inventory:read");
  if (want.has("suppliers") && inv) {
    jobs.push(
      (async () => {
        const out: Hit[] = [];
    const P = schema.invSuppliers;
    for (const r of await db.select({ id: P.id, name: P.name, gstin: P.gstin }).from(P).where(and(eq(P.orgId, s.orgId), or(ilike(P.name, t), ilike(P.gstin, t), ilike(P.email, t)))).limit(5)) out.push({ kind: "suppliers", id: r.id, label: [r.name, r.gstin].filter(Boolean).join(" · "), link: "/inventory/suppliers" });
        return out;
      })(),
    );
  }
  if (want.has("items") && inv) {
    jobs.push(
      (async () => {
        const out: Hit[] = [];
    const I = schema.invItems;
    for (const r of await db.select({ id: I.id, name: I.name, sku: I.sku }).from(I).where(and(eq(I.orgId, s.orgId), or(ilike(I.name, t), ilike(I.sku, t)))).limit(5)) out.push({ kind: "items", id: r.id, label: [r.name, r.sku].filter(Boolean).join(" · "), link: `/inventory/items/${r.id}` });
        return out;
      })(),
    );
  }
  // The staff directory beyond one's own record is for those who run HR.
  if (want.has("employees") && s.has("hr") && s.ctx.can("hr:manage")) {
    jobs.push(
      (async () => {
        const out: Hit[] = [];
    const E = schema.hrEmployees;
    for (const r of await db.select({ id: E.id, name: E.name, empNo: E.empNo, designation: E.designation }).from(E).where(and(eq(E.orgId, s.orgId), or(ilike(E.name, t), ilike(E.empNo, t), ilike(E.email, t)))).limit(5)) out.push({ kind: "employees", id: r.id, label: [r.name, r.empNo, r.designation].filter(Boolean).join(" · "), link: `/hr/people/${r.id}` });
        return out;
      })(),
    );
  }
  if (want.has("projects") && s.has("work") && s.ctx.can("work:read")) {
    jobs.push(
      (async () => {
        const out: Hit[] = [];
    const W = schema.workProjects;
    for (const r of await db.select({ id: W.id, name: W.name, code: W.code, client: W.clientName }).from(W).where(and(eq(W.orgId, s.orgId), or(ilike(W.name, t), ilike(W.code, t), ilike(W.clientName, t)))).limit(5)) out.push({ kind: "projects", id: r.id, label: [r.code, r.name, r.client].filter(Boolean).join(" · "), link: `/work/projects/${r.id}` });
        return out;
      })(),
    );
  }
  // Documents: the drive's own rules (private, shared, folders), words inside written documents too.
  if (want.has("documents") && s.has("documents") && s.ctx.can("doc:read")) {
    jobs.push(
      (async () => {
        const { getSettings } = await import("../documents/access");
        const { list } = await import("../documents/drive");
        const ds = { orgId: s.orgId, userId: s.userId, role: s.role, write: s.ctx.can("doc:write"), manage: s.ctx.can("doc:manage"), settings: await getSettings(s.orgId), has: s.has };
        return (await list(ds, { section: "search", q: query })).files.slice(0, 5).map((f): Hit => ({ kind: "documents", id: f.id, label: [f.title, f.kind === "doc" ? f.snippet.slice(0, 160) : f.filename].filter(Boolean).join(" · "), link: f.kind === "doc" ? `/documents/d/${f.id}` : `/documents/file/${f.id}` }));
      })(),
    );
  }
  return (await Promise.all(jobs)).flat();
}

// ── Proposals ───────────────────────────────────────────────────────────────

async function getAction(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Suggestion");
  const [a] = await db.select().from(schema.copilotActions).where(and(eq(schema.copilotActions.id, id), eq(schema.copilotActions.orgId, s.orgId), eq(schema.copilotActions.userId, s.userId)));
  if (!a) throw notFound("Suggestion");
  if (a.status !== "proposed" && a.status !== "failed") throw new ApiError("conflict", a.status === "done" ? "This was already done" : a.status === "running" ? "This is already being done" : "This suggestion was already dismissed");
  return a;
}

const istMorning = (d: string | null) => (d ? `${d}T10:00:00+05:30` : null);

/** Carry out a proposal, as the person, through the module that owns the record. `edited` is the person's own changes to it (an email draft they rewrote), checked like the original. */
export async function confirm(ctx: AuthedContext, s: Scope, id: string, edited?: Record<string, unknown>) {
  const a0 = await getAction(s, id);
  let a = a0;
  if (edited && Object.keys(edited).length) {
    const kind0 = a0.kind as ActionKind;
    const { toolUseId, ...before } = a0.payload as Record<string, unknown>;
    const v = ACTION_INPUT[kind0].safeParse({ ...before, ...edited });
    if (!v.success) throw new ApiError("validation_failed", v.error.issues[0]?.message ?? "Check the details", Object.fromEntries(v.error.issues.map((i) => [i.path.join(".") || "input", [i.message]])));
    const payload = { ...(v.data as Record<string, unknown>), toolUseId };
    await db.update(schema.copilotActions).set({ payload }).where(eq(schema.copilotActions.id, a0.id));
    a = { ...a0, payload };
  }
  // Claim it first, so a double click can't do it twice.
  const [claimed] = await db.update(schema.copilotActions).set({ status: "running", decidedAt: new Date() }).where(and(eq(schema.copilotActions.id, a.id), inArray(schema.copilotActions.status, ["proposed", "failed"]))).returning();
  if (!claimed) throw new ApiError("conflict", "This is already being done");
  try {
    let result: { id: string; link: string };
    const kind = a.kind as ActionKind;
    if (kind === "crm_task" || kind === "crm_note") {
      if (!s.has("crm")) throw new ApiError("forbidden", "The CRM isn't open to you");
      const { scope: crmScope } = await import("../crm/access");
      const { createActivity } = await import("../crm/activities");
      const cs = await crmScope(ctx, s.orgId, "crm:write");
      const p = ACTION_INPUT[kind].parse(a.payload) as { subject?: string; body: string; dueDate?: string | null; priority?: "low" | "normal" | "high"; contactId: string | null; dealId: string | null; companyId: string | null };
      const act = await createActivity(cs, kind === "crm_task" ? { kind: "task", subject: p.subject, body: p.body, dueAt: istMorning(p.dueDate ?? null), priority: p.priority, contactId: p.contactId, dealId: p.dealId, companyId: p.companyId, ownerId: s.userId } : { kind: "note", body: p.body, contactId: p.contactId, dealId: p.dealId, companyId: p.companyId });
      const link = p.dealId ? `/crm/deals/${p.dealId}` : p.contactId ? `/crm/contacts/${p.contactId}` : p.companyId ? `/crm/companies/${p.companyId}` : "/crm/tasks";
      result = { id: (act as { id: string }).id, link };
    } else if ((WORKSPACE_ACTIONS as readonly string[]).includes(kind)) {
      const { toolUseId: _t, ...input } = a.payload as Record<string, unknown>;
      void _t;
      const [th] = await db.select({ messages: schema.copilotThreads.messages }).from(schema.copilotThreads).where(eq(schema.copilotThreads.id, a.threadId));
      result = await execute(ctx, s, kind as WorkspaceAction, input, (th?.messages as unknown[]) ?? []);
    } else {
      if (!s.has("work")) throw new ApiError("forbidden", "Projects aren't open to you");
      const { scope: workScope } = await import("../work/access");
      const { saveTask } = await import("../work/tasks");
      const ws = await workScope(ctx, s.orgId);
      const p = ACTION_INPUT.work_task.parse(a.payload);
      const task = await saveTask(ws, null, { projectId: p.projectId, title: p.title, description: p.description, dueDate: p.dueDate, priority: p.priority });
      result = { id: (task as { id: string }).id, link: `/work/projects/${p.projectId}` };
    }
    await db.update(schema.copilotActions).set({ status: "done", result }).where(eq(schema.copilotActions.id, a.id));
    return { ...result, status: "done" as const };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Something went wrong";
    await db.update(schema.copilotActions).set({ status: "failed", error: message }).where(eq(schema.copilotActions.id, a.id));
    throw err instanceof ApiError ? err : new ApiError("internal_error", message);
  }
}

export async function dismiss(s: Scope, id: string) {
  const a = await getAction(s, id);
  await db.update(schema.copilotActions).set({ status: "dismissed", decidedAt: new Date() }).where(eq(schema.copilotActions.id, a.id));
}

/** Whether a provider is connected, for the page to say so before anyone types. */
export async function status(s: Scope) {
  const { hasLlm } = await import("../ai/gateway");
  return { connected: await hasLlm(s.orgId), canConnect: can(s.role, "secrets:manage"), books: s.has("accounting") && s.ctx.can("accounts:read") };
}

// ── Checks (fixed rules, no AI) ─────────────────────────────────────────────

/** Bills and expenses worth a second look, within the companies this person may see. Empty when Accounts isn't theirs. */
export async function checks(s: Scope): Promise<{ open: boolean; findings: Finding[] }> {
  if (!s.has("accounting") || !s.ctx.can("accounts:read")) return { open: false, findings: [] };
  const { memberAccess } = await import("../org/org");
  const access = await memberAccess(s.orgId, s.userId);
  const companies = access?.companies?.length ? access.companies : null;
  const today = todayIst();
  const yearAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const B = schema.accBills;
  const bills = await db
    .select({ id: B.id, number: B.number, supplier: B.supplierName, billNo: B.billNo, total: B.total, date: B.date })
    .from(B)
    .where(and(eq(B.orgId, s.orgId), eq(B.kind, "bill"), notInArray(B.status, ["void", "rejected"]), gte(B.date, yearAgo), companies ? inArray(B.companyId, companies) : sql`true`));
  const rows = bills.map((b) => ({ ...b, date: String(b.date) }));
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10);
  const spend = (await db.execute(sql`
    select l.account_id as "accountId", a.name, to_char(j.date, 'YYYY-MM') as month, sum(l.debit - l.credit)::bigint as amount
    from acc_lines l join acc_journals j on j.id = l.journal_id join acc_accounts a on a.id = l.account_id
    where j.org_id = ${s.orgId} and a.type = 'expense' and j.date >= ${from}::date and j.date <= ${today}::date
      ${companies ? sql`and j.company_id = any(${`{${companies.join(",")}}`}::uuid[])` : sql``}
    group by 1, 2, 3`)) as unknown as { rows: { accountId: string; name: string; month: string; amount: string }[] };
  const findings = [...duplicateBills(rows), ...largeBills(rows, new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)), ...expenseSpikes(spend.rows.map((r) => ({ ...r, amount: Number(r.amount) })), monthStart.slice(0, 7))];
  return { open: true, findings };
}

// ── AI activity (owners and admins) ─────────────────────────────────────────

/** What the workspace's AI did in the last 30 days: calls and cost by kind and person, and every suggestion carried out. */
export async function activity(s: Scope) {
  if (!can(s.role, "secrets:manage")) throw new ApiError("forbidden", "Only workspace owners and admins can see AI activity");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const T = schema.aiTasks;
  const usage = await db
    .select({ kind: T.kind, userId: T.createdBy, name: schema.users.name, calls: sql<number>`count(*)::int`, tokens: sql<number>`coalesce(sum(${T.inputTokens} + ${T.outputTokens}), 0)::bigint`, costMicroUsd: sql<number>`coalesce(sum(${T.costMicroUsd}), 0)::bigint` })
    .from(T)
    .leftJoin(schema.users, eq(schema.users.id, T.createdBy))
    .where(and(eq(T.orgId, s.orgId), gte(T.createdAt, since)))
    .groupBy(T.kind, T.createdBy, schema.users.name)
    .orderBy(desc(sql`3`));
  const A = schema.copilotActions;
  const done = await db
    .select({ id: A.id, kind: A.kind, summary: A.summary, status: A.status, error: A.error, result: A.result, decidedAt: A.decidedAt, name: schema.users.name })
    .from(A)
    .innerJoin(schema.users, eq(schema.users.id, A.userId))
    .where(and(eq(A.orgId, s.orgId), gte(A.createdAt, since), inArray(A.status, ["done", "failed"])))
    .orderBy(desc(A.decidedAt))
    .limit(200);
  return { usage: usage.map((u) => ({ ...u, tokens: Number(u.tokens), costMicroUsd: Number(u.costMicroUsd) })), actions: done.map((a) => ({ ...a, label: ACTION_LABEL[a.kind as ActionKind] ?? a.kind })) };
}
