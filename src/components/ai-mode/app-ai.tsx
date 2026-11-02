"use client";

// AI mode in the workspace. The recap and "what needs attention" come straight
// from the dashboard's numbers (instant, no AI needed); anything typed goes to
// the copilot, which answers from the workspace's data within the person's
// role. Setup shortcuts lead the screen while the workspace is still new.
import { useQuery } from "@tanstack/react-query";
import { Boxes, BellRing, Building2, CalendarDays, ChartColumn, ChevronDown, ChevronRight, Compass, Contact, FileSearch, Inbox, Landmark, Mail, PenLine, Receipt, Scale, Sparkles, TrendingUp, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { api, errorMessage } from "@/lib/client/api";
import { ADVISORS, advisorById, DOC_KIND_INFO, type AdvisorId, type DocKind } from "@/lib/copilot/advisors";
import { industryById, visibleTo } from "@/lib/workspace/modules";
import { ActionCard, type CopilotAction } from "./action-card";
import { AiScreen, type AiMsg, type AiSection } from "./ai-screen";

type Kpi = { id: string; label: string; value: number; format: "money" | "number" | "hours" | "percent"; sub?: string; change?: number | null; good?: "up" | "down"; href: string };
type Insight = { id: string; tone: "danger" | "warning" | "info" | "success"; title: string; detail: string; href: string };
type Dash = { kpis: Kpi[]; insights: Insight[]; waiting: { counts: { approvals: number; todo: number; overdue: number } } | null };
type Doc = { attachmentId: string; kind: string; title: string; facts: string[] };
type Thread = { id: string; items: ({ role: "user" | "assistant"; text: string } | { role: "tool"; label: string; doc?: Doc })[]; actions: CopilotAction[] };
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
async function postForm<T>(path: string, text: string, files: File[], advisor: string): Promise<T> {
  const form = new FormData();
  form.set("text", text);
  form.set("advisor", advisor);
  for (const f of files) form.append("files", f, f.name);
  const res = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? "Couldn't send that — try again");
  return json as T;
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
  const thread = useRef<string | null>(null);
  // Suggestions already shown, so each answer only carries its own.
  const shown = useRef(new Set<string>());
  const [advisor, setAdvisor] = useState<AdvisorId>("general");
  const [picking, setPicking] = useState(false);
  const adv = advisorById(advisor);
  const has = (m: Parameters<typeof visibleTo>[1]) => visibleTo(org, m);
  const copilotOn = has("copilot");

  const dash = useQuery({ queryKey: ["dashboard", org.id], queryFn: () => api<Dash>(`/api/v1/orgs/${org.id}/dashboard`), staleTime: 60_000 });
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
    try {
      const path = thread.current ? `threads/${thread.current}/messages` : "threads";
      const url = `/api/v1/orgs/${org.id}/copilot/${path}`;
      const t = files.length ? await postForm<Thread>(url, text, await Promise.all(files.map(shrink)), advisor) : await api<Thread>(url, { method: "POST", body: { text, advisor } });
      thread.current = t.id;
      // The answer is everything after the last thing they asked.
      const lastAsk = t.items.map((x) => x.role).lastIndexOf("user");
      const answer = t.items.slice(lastAsk + 1).filter((x): x is { role: "assistant"; text: string } => x.role === "assistant").map((x) => x.text).join("\n\n");
      const looked = t.items.slice(lastAsk + 1).filter((x): x is { role: "tool"; label: string } => x.role === "tool").map((x) => x.label).filter((l) => !l.startsWith("Suggested:"));
      const docs = t.items.slice(lastAsk + 1).flatMap((x) => (x.role === "tool" && "doc" in x && x.doc ? [x.doc] : []));
      const proposed = t.actions.filter((a) => !shown.current.has(a.id));
      proposed.forEach((a) => shown.current.add(a.id));
      add({
        role: "assistant",
        text: answer || (proposed.length ? "Here's what I've prepared — check it and confirm." : "Done."),
        node:
          looked.length || proposed.length || docs.length ? (
            <>
              {looked.length > 0 && <p className="ai-looked">{looked.slice(0, 6).join(" · ")}</p>}
              {docs.map((d) => (
                <DocCard key={d.attachmentId} doc={d} onAct={(prompt) => void ask(prompt)} />
              ))}
              {proposed.map((a) => (
                <ActionCard key={a.id} orgId={org.id} action={a} />
              ))}
            </>
          ) : undefined,
      });
    } catch (e) {
      add({ role: "assistant", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

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
    cards: [
      { id: "recap", title: "Get today's business recap", sub: "Sales, money owed, stock and team — at a glance.", icon: ChartColumn, tone: "#4f5ef7", onPick: () => void recap() },
      { id: "attention", title: "See what needs my attention", sub: "Overdue invoices, approvals and anything unusual.", icon: BellRing, tone: "#f5a35c", onPick: () => void attention() },
      { id: "inbox", title: "Catch me up on email", sub: "What's new, what needs a reply, and drafts ready to send.", icon: Inbox, tone: "#2ec4b6", onPick: () => void ask("Catch me up on my inbox: what's new, and what needs a reply from me? Offer to draft the replies.") },
      { id: "week", title: "Plan my week", sub: "Meetings, overdue invoices and follow-ups in one view.", icon: CalendarDays, tone: "#8b7bff", onPick: () => void ask("What's on my calendar this week, which invoices are overdue, and what should I follow up on?") },
      { id: "ask", title: "Ask about my sales", sub: "This month against last, answered from your own data.", icon: Sparkles, tone: "#ff7aa2", onPick: () => void ask("How did sales do this month compared with last month?") },
    ],
  };
  const doIt: AiSection = {
    title: "Get things done in a sentence.",
    cards: [
      { id: "draft", title: "Draft an email", sub: "Tell me who and what — I'll write it for you to check and send.", icon: PenLine, tone: "#4f5ef7", onPick: () => void ask("I want to send an email. Ask me who it's for and what it's about, then draft it.") },
      { id: "invoice", title: "Make an invoice", sub: "Client, items and prices in your words — saved as a draft.", icon: Mail, tone: "#3ccf91", onPick: () => void ask("Help me make an invoice. Ask me for the client and what to bill, then prepare a draft.") },
    ],
  };
  const files: AiSection = {
    title: "Hand me a document.",
    cards: [
      { id: "bill", title: "Record a bill or receipt", sub: "Snap or upload it — I read it into Accounts with GST.", icon: Receipt, tone: "#3ccf91", onPick: () => add({ role: "assistant", text: "Tap **+** below and choose **Take a photo** or **Photo or document**, then send it. I'll read the bill — supplier, GSTIN, lines and GST — and prepare it for Accounts." }) },
      { id: "review", title: "Review a contract", sub: "Risks, money, dates and what to negotiate, clause by clause.", icon: FileSearch, tone: "#8b7bff", onPick: () => (setAdvisor("legal"), add({ role: "assistant", text: "Your **Legal & contracts advisor** is on. Tap **+** and add the contract (PDF, Word or photos), and I'll review it in depth." })) },
    ],
  };
  const advisors: AiSection = {
    title: "Talk to an advisor.",
    cards: ADVISORS.filter((a) => a.id !== "general").map((a) => ({ id: a.id, title: a.name, sub: a.role, icon: ADVISOR_ICON[a.icon]!, tone: a.tone, onPick: () => meet(a.id) })),
  };
  const launch: AiSection = {
    title: "Set up in a few taps.",
    tiles: [
      { id: "store", label: "Launch my online store", photo: industryById("retail")!.photo, onPick: () => router.push("/launch?kind=store") },
      { id: "site", label: "Build my website", photo: industryById("services")!.photo, onPick: () => router.push("/launch?kind=website") },
    ],
  };
  const finish: AiSection = {
    title: fresh ? `Let's get ${org.name} ready.` : "Finish setting up.",
    cards: [
      { id: "profile", title: "Set up my business details", sub: "Legal name, GSTIN, address and UPI — just tell me in chat.", icon: Building2, tone: "#ff7a59", onPick: () => void ask("Help me set up my workspace: check what's missing, ask me for it, and save it.") },
      { id: "team", title: "Invite my team", sub: "Give me their emails — I'll send the invitations.", icon: Users, tone: "#4fb3ff", onPick: () => void ask("I want to invite people to my team. Ask me for their emails and roles, then send the invitations.") },
      ...(has("crm") ? [{ id: "crm", title: "Bring in my customers", sub: "Import contacts from a CSV or Excel file in seconds.", icon: Contact, tone: "#3ccf91", onPick: () => router.push("/crm") }] : []),
      ...(has("mail") ? [{ id: "mail", title: "Connect my email", sub: "Gmail, Outlook or Zoho in one smart inbox.", icon: Mail, tone: "#ff7aa2", onPick: () => router.push("/mail") }] : []),
    ],
  };

  return (
    <AiScreen
      greeting={hello(user.name)}
      sections={fresh ? [finish, doIt, files, advisors, launch, ahead] : [ahead, advisors, files, doIt, launch, finish]}
      messages={msgs}
      busy={busy}
      attach
      onSend={(t, f) => void ask(t, f)}
      mark={
        <button type="button" className="ai-advisor" style={{ "--tone": adv.tone } as React.CSSProperties} onClick={() => setPicking(!picking)} aria-expanded={picking} aria-label={`Advisor: ${adv.name}`}>
          <i aria-hidden />
          {adv.id === "general" ? "AI mode" : adv.name.replace(/ advisor$/, "")}
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
        shown.current.clear();
        setMsgs([]);
      }}
      placeholder={adv.id === "general" ? "Ask, or add a file" : `Ask your ${adv.name.toLowerCase()}`}
      quick={["Reply to my latest email", "Who are my top customers?", "How much am I owed?", "Schedule a call tomorrow at 4pm"]}
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
