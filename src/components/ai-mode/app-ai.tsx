"use client";

// AI mode in the workspace. The recap and "what needs attention" come straight
// from the dashboard's numbers (instant, no AI needed); anything typed goes to
// the copilot, which answers from the workspace's data within the person's
// role. Setup shortcuts lead the screen while the workspace is still new.
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, BadgeIndianRupee, BookOpen, Boxes, Brain, Briefcase, Building2, CalendarDays, ChartColumn, ChartLine, ChevronDown, ChevronRight, ClipboardList, Compass, Contact, CornerDownRight, FileSearch, FileSignature, Inbox, Landmark, LayoutDashboard, Mail, MailCheck, MessageSquareWarning, PenLine, Receipt, Scale, Sparkles, TrendingUp, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { api, apiStream, errorMessage } from "@/lib/client/api";
import { ADVISORS, advisorById, DOC_KIND_INFO, type AdvisorId, type DocKind } from "@/lib/copilot/advisors";
import type { ChartSpec } from "@/lib/copilot/model";
import { AnswerChart } from "@/components/copilot/answer-chart";
import { industryById, visibleTo } from "@/lib/workspace/modules";
import { ActionCard, confirmAll, type CopilotAction } from "./action-card";
import { AiScreen, type AiMsg, type AiSection } from "./ai-screen";
import { AiHome, type Pulse } from "./ai-home";
import { InboxCard } from "./inbox-card";
import { HistorySheet } from "./history-sheet";
import { KnowledgeSheet } from "./knowledge-sheet";

type Kpi = { id: string; label: string; value: number; format: "money" | "number" | "hours" | "percent"; sub?: string; change?: number | null; good?: "up" | "down"; href: string };
type Insight = { id: string; tone: "danger" | "warning" | "info" | "success"; title: string; detail: string; href: string };
type Dash = { kpis: Kpi[]; insights: Insight[]; waiting: { counts: { approvals: number; todo: number; overdue: number } } | null };
type BriefItem = { text: string; sub?: string; href?: string; tone?: "danger" | "warning" | "info" };
type BriefTip = { label: string; prompt: string };
type Brief = { today: BriefItem[]; attention: BriefItem[]; suggestions: BriefTip[]; updates: BriefTip[]; counts: { meetings: number; replies: number; overdueInvoices: number; overdueTasks: number } };
type Doc = { attachmentId: string; kind: string; title: string; facts: string[] };
type Item = { role: "user"; text: string; files?: { name: string; mime: string }[] } | { role: "assistant"; text: string } | { role: "tool"; label: string; toolUseId?: string; doc?: Doc } | { role: "chart"; chart: ChartSpec } | { role: "next"; prompts: string[] };
type Thread = { id: string; items: Item[]; actions: (CopilotAction & { toolUseId?: string })[] };
/** The conversation open in AI mode, so a reload (or coming back to the tab) picks it up again. */
const KEEP = (orgId: string) => `cc-ai-thread:${orgId}`;
const keep = (orgId: string, id: string | null) => {
  try {
    if (id) sessionStorage.setItem(KEEP(orgId), id);
    else sessionStorage.removeItem(KEEP(orgId));
  } catch {}
};
const ADVISOR_ICON: Record<string, LucideIcon> = { sparkles: Sparkles, landmark: Landmark, scale: Scale, trending: TrendingUp, boxes: Boxes, users: Users, compass: Compass };

/** Photos are shrunk before they're sent (a phone photo is 3–8 MB; 1,800 px is plenty to read). */
async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith("image/") || f.type === "image/gif" || f.size < 700_000) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
    return blob ? new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : f;
  } catch {
    return f;
  }
}

/** A question with files goes as a form; the answer has the same shape as a JSON question's. */
/** A question with files, as a form. */
function formOf(text: string, files: File[], advisor: string) {
  const form = new FormData();
  form.set("text", text);
  form.set("advisor", advisor);
  for (const f of files) form.append("files", f, f.name);
  return form;
}

/** A scan from the camera, filed in Documents. */
async function saveDoc(orgId: string, f: File) {
  const form = new FormData();
  form.set("file", f, f.name);
  form.set("meta", "{}");
  const res = await fetch(`/api/v1/orgs/${orgId}/documents/files`, { method: "POST", body: form, credentials: "same-origin" });
  const json = (await res.json().catch(() => ({}))) as { file?: { id: string }; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "Couldn't save it to Documents");
  return `/documents/file/${json.file?.id}`;
}

const money = (p: number) => {
  const r = p / 100;
  const a = Math.abs(r);
  if (a >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  return `₹${Math.round(r).toLocaleString("en-IN")}`;
};
const show = (k: Kpi) => (k.format === "money" ? money(k.value) : k.format === "hours" ? `${k.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}h` : k.format === "percent" ? `${k.value}%` : Math.round(k.value).toLocaleString("en-IN"));
const TONE: Record<Insight["tone"], string> = { danger: "#ff6b6b", warning: "#f5a35c", info: "#6cc0ff", success: "#4fd6a0" };

function hello(name: string) {
  const h = new Date().getHours();
  return `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${name.split(" ")[0]}.`;
}

let n = 0;
const id = () => `a${++n}`;

const Go = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="ai-link">
    <span>{children}</span>
    <ChevronRight className="size-4" aria-hidden />
  </Link>
);

export function AppAiMode() {
  const { user, org } = useSession();
  const router = useRouter();
  const [msgs, setMsgs] = useState<AiMsg[]>([]);
  const [busy, setBusy] = useState(false);
  // An answer being written right now (shown as it streams in).
  const [live, setLive] = useState(false);
  const thread = useRef<string | null>(null);
  // Suggestions already shown, so each answer only carries its own.
  const shown = useRef(new Set<string>());
  const [advisor, setAdvisor] = useState<AdvisorId>("general");
  const [picking, setPicking] = useState(false);
  const [knowing, setKnowing] = useState<"" | "business" | "memory">("");
  // Open with the conversation that was showing, so it can be marked in the list.
  const [history, setHistory] = useState<false | { current: string | null }>(false);
  const params = useSearchParams();
  const adv = advisorById(advisor);
  const has = (m: Parameters<typeof visibleTo>[1]) => visibleTo(org, m);
  const copilotOn = has("copilot");

  const dash = useQuery({ queryKey: ["dashboard", org.id], queryFn: () => api<Dash>(`/api/v1/orgs/${org.id}/dashboard`), staleTime: 60_000 });
  const brief = useQuery({ queryKey: ["copilot", org.id, "briefing"], queryFn: () => api<Brief>(`/api/v1/orgs/${org.id}/copilot/briefing`), enabled: copilotOn, staleTime: 2 * 60_000, retry: false });
  const meta = useQuery({ queryKey: ["copilot", org.id, "meta"], queryFn: () => api<{ connected: boolean; canConnect: boolean }>(`/api/v1/orgs/${org.id}/copilot/meta`), enabled: copilotOn, staleTime: 5 * 60_000, retry: false });

  // Full screen on phones: the app bar and the tab dock step aside.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-immersive", "");
    return () => root.removeAttribute("data-immersive");
  }, []);

  const add = (m: Omit<AiMsg, "id">) => setMsgs((x) => [...x, { id: id(), ...m }]);
  const fresh = !!dash.data && dash.data.kpis.every((k) => !k.value);

  const recap = async () => {
    add({ role: "user", text: "Give me today's business recap" });
    setBusy(true);
    const d = dash.data ?? (await api<Dash>(`/api/v1/orgs/${org.id}/dashboard`).catch(() => null));
    setBusy(false);
    if (!d || !d.kpis.length) return add({ role: "assistant", text: "There's nothing to recap yet — numbers appear here as soon as you make your first sale, invoice or hire." });
    add({
      role: "assistant",
      text: "Here's where things stand right now.",
      node: (
        <div className="ai-panel">
          <div className="ai-rows">
            {d.kpis.slice(0, 8).map((k) => (
              <div key={k.id} className="ai-row">
                <span>
                  {k.label}
                  {k.sub && <small> · {k.sub}</small>}
                </span>
                <b>{show(k)}</b>
                {typeof k.change === "number" && k.change !== 0 && <small style={{ color: (k.change > 0) === (k.good !== "down") ? "#4fd6a0" : "#ff6b6b" }}>{k.change > 0 ? "▲" : "▼"} {Math.abs(Math.round(k.change))}%</small>}
              </div>
            ))}
          </div>
          <Link href="/home" className="ai-cta">
            Open the dashboard
          </Link>
        </div>
      ),
    });
  };

  const attention = async () => {
    add({ role: "user", text: "What needs my attention?" });
    setBusy(true);
    const d = dash.data ?? (await api<Dash>(`/api/v1/orgs/${org.id}/dashboard`).catch(() => null));
    setBusy(false);
    const list = d?.insights ?? [];
    const c = d?.waiting?.counts;
    const waiting = c ? [c.approvals && `${c.approvals} approval${c.approvals === 1 ? "" : "s"} waiting`, c.overdue && `${c.overdue} overdue task${c.overdue === 1 ? "" : "s"}`].filter(Boolean) : [];
    if (!list.length && !waiting.length) return add({ role: "assistant", text: "All clear — nothing needs you right now." });
    add({
      role: "assistant",
      text: waiting.length ? `You have ${waiting.join(" and ")}.${list.length ? " Also worth a look:" : ""}` : "Worth a look:",
      node: list.length ? (
        <div className="ai-panel">
          <div className="ai-rows">
            {list.slice(0, 6).map((i) => (
              <Link key={i.id} href={i.href} className="ai-link">
                <i className="ai-dot-tone" style={{ "--c": TONE[i.tone] } as React.CSSProperties} />
                <span>
                  {i.title}
                  <small>{i.detail}</small>
                </span>
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            ))}
          </div>
        </div>
      ) : undefined,
    });
  };

  const ask = async (text: string, files: File[] = []) => {
    add({ role: "user", text, files: files.map((f) => ({ name: f.name, mime: f.type })) });
    if (!copilotOn) {
      return add({
        role: "assistant",
        text: "To answer questions in your own words, switch on the **AI copilot**. It reads your workspace's data — only what your role can see — and anything it suggests changing waits for you to confirm.",
        node: <div className="ai-panel"><Go href="/settings/features">Switch on the AI copilot</Go></div>,
      });
    }
    if (meta.data && !meta.data.connected) {
      return add({
        role: "assistant",
        text: meta.data.canConnect ? "Connect an AI provider first — add an Anthropic API key and I can answer from your data." : "AI isn't connected for this workspace yet. Ask an owner to add an AI provider in Settings.",
        node: meta.data.canConnect ? <div className="ai-panel"><Go href="/settings/ai">Connect an AI provider</Go></div> : undefined,
      });
    }
    setBusy(true);
    // The answer appears as it's written, with each lookup named as it happens; repainted at most once a frame.
    const mid = id();
    let said = "";
    let gap = false;
    const looking: string[] = [];
    let frame = 0;
    let shownLive = false;
    const paint = () => {
      frame = 0;
      const m: AiMsg = { id: mid, role: "assistant", text: said, node: looking.length && !said ? <p className="ai-looked ai-live">{looking.slice(-3).join(" · ")}…</p> : looking.length ? <p className="ai-looked">{looking.slice(-3).join(" · ")}</p> : undefined };
      setMsgs((x) => (shownLive ? x.map((y) => (y.id === mid ? m : y)) : [...x, m]));
      shownLive = true;
      setLive(true);
    };
    const onEvent = (e: { t: string; [k: string]: unknown }) => {
      if (e.t === "text" && typeof e.d === "string") {
        if (gap) said += "\n\n";
        gap = false;
        said += e.d;
      } else if (e.t === "tool" && typeof e.label === "string") {
        looking.push(e.label);
        if (said) gap = true;
      } else return;
      frame ||= requestAnimationFrame(paint);
    };
    const dropLive = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setMsgs((x) => x.filter((y) => y.id !== mid));
      setLive(false);
    };
    try {
      const path = thread.current ? `threads/${thread.current}/messages` : "threads";
      const url = `/api/v1/orgs/${org.id}/copilot/${path}`;
      const t = files.length ? await apiStream<Thread>(url, { form: formOf(text, await Promise.all(files.map(shrink)), advisor) }, onEvent) : await apiStream<Thread>(url, { body: { text, advisor } }, onEvent);
      dropLive();
      thread.current = t.id;
      keep(org.id, t.id);
      // The answer is everything after the last thing they asked.
      const lastAsk = t.items.map((x) => x.role).lastIndexOf("user");
      const proposed = t.actions.filter((a) => !shown.current.has(a.id));
      proposed.forEach((a) => shown.current.add(a.id));
      add(answerOf(t.items.slice(lastAsk + 1), proposed));
    } catch (e) {
      dropLive();
      add({ role: "assistant", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  /** One answer: what was said, what was looked up, charts, files it read, suggestions to confirm and follow-ups to tap. */
  const answerOf = (items: Item[], proposed: Thread["actions"], live = true): Omit<AiMsg, "id"> => {
    const answer = items.filter((x): x is { role: "assistant"; text: string } => x.role === "assistant").map((x) => x.text).join("\n\n");
    const looked = items.filter((x): x is { role: "tool"; label: string } => x.role === "tool").map((x) => x.label).filter((l) => !l.startsWith("Suggested:") && !l.startsWith("Drew a chart") && l !== "Suggested next steps");
    const docs = items.flatMap((x) => (x.role === "tool" && x.doc ? [x.doc] : []));
    const charts = items.flatMap((x) => (x.role === "chart" ? [x.chart] : []));
    const next = items.flatMap((x) => (x.role === "next" ? x.prompts : [])).slice(0, 4);
    const emails = proposed.filter((a) => a.kind === "send_email" && a.status === "proposed");
    return {
      role: "assistant",
      text: answer || (proposed.length ? "Here's what I've prepared — check it and confirm." : charts.length ? "" : "Done."),
      node:
        looked.length || proposed.length || docs.length || charts.length || next.length ? (
          <>
            {looked.length > 0 && <p className="ai-looked">{looked.slice(0, 6).join(" · ")}</p>}
            {charts.map((c, i) => (
              <AnswerChart key={i} chart={c} />
            ))}
            {docs.map((d) => (
              <DocCard key={d.attachmentId} doc={d} onAct={(prompt) => void ask(prompt)} />
            ))}
            {proposed.map((a) => (
              <ActionCard key={a.id} orgId={org.id} action={a} />
            ))}
            {emails.length > 1 && (
              <button type="button" className="ai-btn ai-send-all" onClick={() => confirmAll(emails.map((a) => a.id))}>
                <Mail className="size-4" /> Send all {emails.length} emails
              </button>
            )}
            {live && next.length > 0 && (
              <div className="ai-follow" aria-label="Follow-ups">
                {next.map((q) => (
                  <button key={q} type="button" onClick={() => void ask(q)}>
                    <CornerDownRight className="size-3.5" aria-hidden />
                    {q}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : undefined,
    };
  };

  /** Open an earlier conversation where it was left: each question, then its answer as it was given. */
  const open = async (tid: string) => {
    setHistory(false);
    setBusy(true);
    try {
      const t = await api<Thread>(`/api/v1/orgs/${org.id}/copilot/threads/${tid}`);
      thread.current = t.id;
      keep(org.id, t.id);
      shown.current = new Set(t.actions.map((a) => a.id));
      const out: AiMsg[] = [];
      let group: Item[] = [];
      const flush = (last: boolean) => {
        if (!group.length) return;
        const ids = new Set(group.flatMap((x) => (x.role === "tool" && x.toolUseId ? [x.toolUseId] : [])));
        out.push({ id: id(), ...answerOf(group, t.actions.filter((a) => a.toolUseId && ids.has(a.toolUseId)), last) });
        group = [];
      };
      for (const it of t.items) {
        if (it.role === "user") {
          flush(false);
          out.push({ id: id(), role: "user", text: it.text, files: it.files?.map((f) => ({ name: f.name, mime: f.mime })) });
        } else group.push(it);
      }
      flush(true);
      setMsgs(out);
    } catch (e) {
      keep(org.id, null);
      add({ role: "assistant", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  // A question sent from elsewhere (the dashboard's "Ask AI"), or the conversation that was open before a reload.
  useEffect(() => {
    const q = params.get("q")?.trim();
    const tid = params.get("thread");
    let kept: string | null = null;
    try {
      kept = sessionStorage.getItem(KEEP(org.id));
    } catch {}
    if (q || tid) router.replace("/ai", { scroll: false });
    // Straight after the first paint, so the screen shows before the answer starts.
    const t = setTimeout(() => {
      if (tid && /^[0-9a-f-]{36}$/i.test(tid)) void open(tid);
      else if (q) {
        keep(org.id, null);
        void ask(q.slice(0, 4000));
      } else if (kept) void open(kept);
    }, 0);
    return () => clearTimeout(t);
    // Runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Switch advisor, and let them introduce themselves with what to ask. */
  const meet = (id: AdvisorId) => {
    const a = advisorById(id);
    setAdvisor(id);
    setPicking(false);
    if (a.id === "general") return;
    add({
      role: "assistant",
      text: `I'm your **${a.name}** — ${a.role.toLowerCase()}. I look at your workspace's numbers before I advise. Ask me anything, or start with one of these:`,
      node: (
        <div className="ai-chips" style={{ marginTop: 10 }}>
          {a.starters.map((q) => (
            <button key={q} type="button" className="ai-chip" onClick={() => void ask(q)}>
              {q}
            </button>
          ))}
        </div>
      ),
    });
  };

  const ahead: AiSection = {
    title: "A few ways to stay ahead.",
    label: "For you",
    cards: [
      { id: "recap", title: "Get today's business recap", sub: "Sales, money owed, stock and team — at a glance.", icon: ChartColumn, tone: "#4f5ef7", onPick: () => void recap() },
      { id: "inbox", title: "Catch me up on email", sub: "What's new, what needs a reply, and drafts ready to send.", icon: Inbox, tone: "#2ec4b6", onPick: () => void ask("Catch me up on my inbox: what's new, and what needs a reply from me? Offer to draft the replies.") },
      { id: "week", title: "Plan my week", sub: "Meetings, overdue invoices and follow-ups in one view.", icon: CalendarDays, tone: "#8b7bff", onPick: () => void ask("What's on my calendar this week, which invoices are overdue, and what should I follow up on?") },
      { id: "ask", title: "Ask about my sales", sub: "This month against last, answered from your own data.", icon: Sparkles, tone: "#ff7aa2", onPick: () => void ask("How did sales do this month compared with last month?") },
    ],
  };
  const analyse: AiSection = {
    title: "See where the business is heading.",
    label: "Analyse",
    cards: [
      { id: "dash", title: "Explain my dashboard", sub: "What moved, why it matters and what to do.", icon: LayoutDashboard, tone: "#4f5ef7", onPick: () => void ask("Walk me through my dashboard: what moved since the last period, why it matters, and the three things I should do about it.") },
      { id: "forecast", title: "Forecast my sales", sub: "12 months of trend, this month's pace and the next three.", icon: ChartLine, tone: "#3ccf91", onPick: () => void ask("Show my sales trend for the last 12 months as a chart, how this month is pacing, and a projection for the next three months.") },
      { id: "mailstats", title: "How am I doing on email?", sub: "Reply times, who's waiting and the noise to clear.", icon: MailCheck, tone: "#2ec4b6", onPick: () => void ask("Analyse my email for the last 30 days: reply times, who's been waiting longest, and how much is newsletters or promotions. Then offer to tidy the inbox.") },
      { id: "tidy", title: "Tidy my inbox", sub: "Archive the noise and set follow-ups, in one confirm.", icon: Inbox, tone: "#8b7bff", onPick: () => void ask("Tidy my inbox: find newsletters, promotions and notifications I've read and prepare to archive them, and list emails I should follow up on.") },
      { id: "remind", title: "Remind me", sub: "“Remind me to call Sharma on Friday at 11.”", icon: AlarmClock, tone: "#f5a35c", onPick: () => void ask("I want to set a reminder. Ask me what and when, then set it.") },
      { id: "cash", title: "Cash and collections", sub: "Who owes what, ageing, and reminders to send.", icon: BadgeIndianRupee, tone: "#ff7aa2", onPick: () => void ask("Who owes me money? Break it down by how overdue it is, show it as a chart, and draft reminder emails for the oldest ones.") },
    ],
  };
  const doIt: AiSection = {
    title: "Get things done in a sentence.",
    label: "Quick tasks",
    cards: [
      { id: "draft", title: "Draft an email", sub: "Tell me who and what — I'll write it for you to check and send.", icon: PenLine, tone: "#4f5ef7", onPick: () => void ask("I want to send an email. Ask me who it's for and what it's about, then draft it.") },
      { id: "invoice", title: "Make an invoice", sub: "Client, items and prices in your words — saved as a draft.", icon: Mail, tone: "#3ccf91", onPick: () => void ask("Help me make an invoice. Ask me for the client and what to bill, then prepare a draft.") },
    ],
  };
  const files: AiSection = {
    title: "Hand me a document.",
    label: "Documents",
    cards: [
      ...(has("documents") ? [{ id: "studio", title: "Draft a business document", sub: "Contracts, HR letters, notices, policies — legally sound, in minutes.", icon: FileSignature, tone: "#6366f1", onPick: () => router.push("/documents/studio") }] : []),
      { id: "bill", title: "Record a bill or receipt", sub: "Snap or upload it — I read it into Accounts with GST.", icon: Receipt, tone: "#3ccf91", onPick: () => add({ role: "assistant", text: "Tap **+** below and choose **Take a photo** or **Photo or document**, then send it. I'll read the bill — supplier, GSTIN, lines and GST — and prepare it for Accounts." }) },
      { id: "review", title: "Review a contract", sub: "Risks, money, dates and what to negotiate, clause by clause.", icon: FileSearch, tone: "#8b7bff", onPick: () => (setAdvisor("legal"), add({ role: "assistant", text: "Your **Legal & contracts advisor** is on. Tap **+** and add the contract (PDF, Word or photos), and I'll review it in depth." })) },
    ],
  };
  const advisors: AiSection = {
    title: "Talk to an advisor.",
    label: "Advisors",
    cards: ADVISORS.filter((a) => a.id !== "general").map((a) => ({ id: a.id, title: a.name, sub: a.role, icon: ADVISOR_ICON[a.icon]!, tone: a.tone, onPick: () => meet(a.id) })),
  };
  // Ready-made work: each a prompt that gets a finished piece, from the workspace's own data.
  const savers: AiSection = {
    title: "Save an hour today.",
    label: "Time savers",
    cards: [
      { id: "quote", title: "Write a quotation", sub: "Client, items and terms — a ready-to-send quote.", icon: FileSignature, tone: "#4f5ef7", onPick: () => void ask("Prepare a professional quotation. Ask me for the client, items, quantities and prices if you can't find them, then write it in full with GST, validity and payment terms.") },
      { id: "chase", title: "Chase payments", sub: "Polite reminders for every overdue invoice.", icon: BadgeIndianRupee, tone: "#3ccf91", onPick: () => void ask("Show my overdue invoices and draft a professional payment reminder email to each client — courteous for recent ones, firmer for the oldest.") },
      { id: "week-review", title: "Review my week", sub: "Sales, cash, wins and what slipped, in one page.", icon: ClipboardList, tone: "#8b7bff", onPick: () => void ask("Give me a one-page review of this week: sales and collections against last week, cash position, deals won and lost, overdue work, and the three things I should focus on next week.") },
      { id: "complaint", title: "Handle a complaint", sub: "A calm, professional reply that keeps the customer.", icon: MessageSquareWarning, tone: "#ff7a59", onPick: () => void ask("Help me respond to a customer complaint. Ask me what happened (or find the email), then draft a professional reply that acknowledges the issue, explains the resolution and keeps the relationship.") },
      { id: "hire", title: "Write a job post", sub: "Role, skills, pay and a clean job description.", icon: Briefcase, tone: "#4fb3ff", onPick: () => void ask("Write a job description for a role I'm hiring. Ask me the role, location, experience and salary range, then write a clear, professional post with responsibilities, requirements and benefits.") },
      { id: "gst", title: "Get ready for GST filing", sub: "Sales, purchases and ITC for the month, checked.", icon: Landmark, tone: "#f5a35c", onPick: () => void ask("Help me prepare for this month's GST filing: summarise outward supplies and tax, purchases and eligible input tax credit, and flag anything missing or inconsistent before I file GSTR-1 and 3B.") },
    ],
  };
  const teach: AiSection = {
    title: "Make it yours.",
    label: "Knowledge",
    cards: [
      { id: "kb", title: "Knowledge base", sub: "Prices, policies and FAQs the AI should know.", icon: BookOpen, tone: "#2ec4b6", onPick: () => setKnowing("business") },
      { id: "memory", title: "What I remember", sub: "Facts and preferences learned from your chats.", icon: Brain, tone: "#ff7aa2", onPick: () => setKnowing("memory") },
    ],
  };
  const launch: AiSection = {
    title: "Set up in a few taps.",
    label: "Launch",
    tiles: [
      { id: "store", label: "Launch my online store", photo: industryById("retail")!.photo, onPick: () => router.push("/launch?kind=store") },
      { id: "site", label: "Build my website", photo: industryById("services")!.photo, onPick: () => router.push("/launch?kind=website") },
    ],
  };
  const finish: AiSection = {
    title: fresh ? `Let's get ${org.name} ready.` : "Finish setting up.",
    label: "Set up",
    cards: [
      { id: "profile", title: "Set up my business details", sub: "Legal name, GSTIN, address and UPI — just tell me in chat.", icon: Building2, tone: "#ff7a59", onPick: () => void ask("Help me set up my workspace: check what's missing, ask me for it, and save it.") },
      { id: "team", title: "Invite my team", sub: "Give me their emails — I'll send the invitations.", icon: Users, tone: "#4fb3ff", onPick: () => void ask("I want to invite people to my team. Ask me for their emails and roles, then send the invitations.") },
      ...(has("crm") ? [{ id: "crm", title: "Bring in my customers", sub: "Import contacts from a CSV or Excel file in seconds.", icon: Contact, tone: "#3ccf91", onPick: () => router.push("/crm") }] : []),
      ...(has("mail") ? [{ id: "mail", title: "Connect my email", sub: "Gmail, Outlook or Zoho in one smart inbox.", icon: Mail, tone: "#ff7aa2", onPick: () => router.push("/mail") }] : []),
    ],
  };

  // The opening screen: a few live figures, what needs them in one line (opening the briefing and inbox), and common questions.
  const c = brief.data?.counts;
  const pulse: Pulse[] = dash.data?.kpis.length
    ? dash.data.kpis.slice(0, 3).map((k) => ({ label: k.label, value: k.value, format: k.format, sub: k.sub }))
    : c
      ? [
          { label: "Meetings ahead", value: c.meetings, format: "number" },
          { label: "Emails to answer", value: c.replies, format: "number" },
          { label: "Overdue invoices", value: c.overdueInvoices, format: "number" },
        ]
      : [];
  const bits = c ? [c.replies && `${c.replies} email${c.replies === 1 ? "" : "s"} to answer`, c.meetings && `${c.meetings} meeting${c.meetings === 1 ? "" : "s"} coming up`, c.overdueInvoices && `${c.overdueInvoices} overdue invoice${c.overdueInvoices === 1 ? "" : "s"}`, c.overdueTasks && `${c.overdueTasks} overdue task${c.overdueTasks === 1 ? "" : "s"}`].filter(Boolean) as string[] : [];
  const home = (
    <AiHome
      name={hello(user.name)}
      headline={copilotOn ? "Your business, understood. Ask anything about sales, money, stock or your team." : "Switch on the AI copilot to ask questions about your business."}
      pulse={pulse}
      onAsk={(q) => void ask(q)}
      attention={
        copilotOn && (bits.length || brief.data?.suggestions.length)
          ? {
              text: bits.length ? bits.join(" · ") : "A few suggestions for today",
              children: (
                <>
                  <BriefCard brief={brief.data} loading={brief.isLoading} dash={dash.data} onAsk={(q) => void ask(q)} onAttention={() => void attention()} mailShown={has("mail") && !!c?.replies} />
                  {has("mail") && <InboxCard orgId={org.id} me={user.name} onAsk={(q) => void ask(q)} />}
                </>
              ),
            }
          : null
      }
    />
  );

  return (
    <AiScreen
      lead={home}
      moreLabel="More ways to use AI"
      sections={copilotOn ? (fresh ? [finish, teach, doIt, analyse, savers, files, advisors, launch, ahead] : [ahead, analyse, savers, advisors, files, doIt, teach, launch, finish]) : fresh ? [finish, doIt, files, advisors, launch, ahead] : [ahead, advisors, files, doIt, launch, finish]}
      overlay={knowing ? <KnowledgeSheet orgId={org.id} start={knowing} onClose={() => setKnowing("")} /> : history ? <HistorySheet orgId={org.id} current={history.current} onOpen={(tid) => void open(tid)} onClose={() => setHistory(false)} /> : undefined}
      onHistory={copilotOn ? () => setHistory({ current: thread.current }) : undefined}
      onSaveDoc={has("documents") ? (f) => saveDoc(org.id, f) : undefined}
      messages={msgs}
      busy={busy}
      typing={busy && !live}
      attach
      onSend={(t, f) => void ask(t, f)}
      mark={
        <button type="button" className="ai-advisor" style={{ "--tone": adv.tone } as React.CSSProperties} onClick={() => setPicking(!picking)} aria-expanded={picking} aria-label={`Advisor: ${adv.name}`}>
          <i aria-hidden />
          <span>{adv.id === "general" ? "AI mode" : adv.name.replace(/ advisor$/, "")}</span>
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      }
      below={
        picking ? (
          <div className="ai-advisors">
            {ADVISORS.map((a) => {
              const Icon = ADVISOR_ICON[a.icon]!;
              return (
                <button key={a.id} type="button" aria-pressed={a.id === advisor} onClick={() => meet(a.id)} style={{ "--tone": a.tone } as React.CSSProperties}>
                  <span className="ai-act-ic">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span>
                    <b>{a.name}</b>
                    <small>{a.role}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : undefined
      }
      onClose={() => (window.history.length > 1 ? router.back() : router.push("/home"))}
      onNew={() => {
        thread.current = null;
        keep(org.id, null);
        shown.current.clear();
        setMsgs([]);
      }}
      placeholder={adv.id === "general" ? "Ask, or add a file" : `Ask your ${adv.name.toLowerCase()}`}
      quick={["Reply to my latest email", "Chart my sales by month", "How much am I owed?", "Remind me tomorrow at 10 to call Sharma", "Archive my newsletters", "What did we discuss last time?"]}
    />
  );
}

/** A file the copilot recognised: what it is, its key facts, and what to do next. */
function DocCard({ doc, onAct }: { doc: Doc; onAct: (prompt: string) => void }) {
  const info = DOC_KIND_INFO[(doc.kind in DOC_KIND_INFO ? doc.kind : "other") as DocKind];
  return (
    <div className="ai-doc">
      <div className="ai-doc-h">
        <em>{info.label}</em>
        <b>{doc.title}</b>
      </div>
      {doc.facts.length > 0 && (
        <ul>
          {doc.facts.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      <div className="ai-chips">
        {info.actions.map((a) => (
          <button key={a.label} type="button" className="ai-chip" onClick={() => onAct(`${a.prompt} (${doc.attachmentId})`)}>
            {a.label}
          </button>
        ))}
        <button type="button" className="ai-chip" onClick={() => onAct(`Save ${doc.attachmentId} to Documents as “${doc.title}”.`)}>
          Save to Documents
        </button>
      </div>
    </div>
  );
}

/** The briefing AI mode opens with: the day in a sentence, what's coming up, what needs them, what to do next, and what to tell it. */
function BriefCard({ brief, loading, dash, onAsk, onAttention, mailShown }: { brief?: Brief; loading: boolean; dash?: Dash; onAsk: (prompt: string) => void; onAttention: () => void; mailShown?: boolean }) {
  if (loading || !brief)
    return (
      <div className="ai-brief" aria-busy="true">
        <p className="ai-brief-h">Getting your day ready…</p>
        <span className="ai-brief-skel" />
        <span className="ai-brief-skel" />
      </div>
    );
  const c = brief.counts;
  const waiting = dash?.waiting?.counts;
  // The dashboard's own alerts (orders to ship, payroll, missed targets…) join the briefing's.
  const fromDash: BriefItem[] = (dash?.insights ?? []).filter((i) => i.tone !== "success").slice(0, 3).map((i) => ({ text: i.title, sub: i.detail, href: i.href, tone: i.tone === "danger" ? "danger" : i.tone === "warning" ? "warning" : "info" }));
  const approvals: BriefItem[] = waiting?.approvals ? [{ text: `${waiting.approvals} approval${waiting.approvals === 1 ? "" : "s"} waiting on you`, href: "/requests", tone: "warning" }] : [];
  // With the inbox card right below, its emails aren't repeated here.
  const attention = [...brief.attention.filter((i) => !(mailShown && i.href?.startsWith("/mail"))), ...approvals, ...fromDash].slice(0, 3);
  const next = [...brief.suggestions.filter((t) => !(mailShown && /^Draft (the )?repl/.test(t.label))), ...brief.updates];
  const keyed = next.length - brief.updates.length;
  const bits = [c.meetings && `${c.meetings} meeting${c.meetings === 1 ? "" : "s"} coming up`, c.replies && `${c.replies} email${c.replies === 1 ? "" : "s"} to answer`, c.overdueInvoices && `${c.overdueInvoices} overdue invoice${c.overdueInvoices === 1 ? "" : "s"}`, c.overdueTasks && `${c.overdueTasks} overdue task${c.overdueTasks === 1 ? "" : "s"}`].filter(Boolean) as string[];
  const line = bits.length ? `You have ${bits.length > 1 ? `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}` : bits[0]}.` : attention.length ? "A few things could use a look." : "You're all clear — nothing urgent right now.";
  const Row = ({ i }: { i: BriefItem }) => {
    const body = (
      <>
        <i className="ai-dot-tone" style={{ "--c": i.tone === "danger" ? "#ff6b6b" : i.tone === "warning" ? "#f5a35c" : i.tone === "info" ? "#6cc0ff" : "var(--ai-muted)" } as React.CSSProperties} aria-hidden />
        <span>
          {i.text}
          {i.sub && <small>{i.sub}</small>}
        </span>
        {i.href && <ChevronRight className="size-4" aria-hidden />}
      </>
    );
    const tone = { "--tone": i.tone === "danger" ? "#ff6b6b" : i.tone === "warning" ? "#f5a35c" : i.tone === "info" ? "#6b9cff" : "#8b7bff" } as React.CSSProperties;
    return i.href ? (
      <Link href={i.href} className="ai-link" style={tone}>
        {body}
      </Link>
    ) : (
      <div className="ai-link" style={tone}>
        {body}
      </div>
    );
  };
  return (
    <div className="ai-brief">
      <p className="ai-brief-h">{line}</p>
      {brief.today.length > 0 && (
        <section>
          <h3>Coming up</h3>
          <div className="ai-rows">{brief.today.slice(0, 3).map((i, k) => <Row key={k} i={i} />)}</div>
        </section>
      )}
      {attention.length > 0 && (
        <section>
          <h3>
            Needs your attention
            <button type="button" onClick={onAttention}>
              All
            </button>
          </h3>
          <div className="ai-rows">{attention.map((i, k) => <Row key={k} i={i} />)}</div>
        </section>
      )}
      <section className="ai-brief-wide">
        <h3>Suggested next</h3>
        <div className="ai-next">
          {next.slice(0, 4).map((t, k) => (
            <button key={t.label} type="button" className={k < keyed ? "is-key" : undefined} onClick={() => onAsk(t.prompt)}>
              {k < keyed && <Sparkles className="size-3.5" aria-hidden />}
              {t.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
